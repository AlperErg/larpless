import Accelerate
import Foundation

/// The two ONNX Runtime sessions behind FLScreenModel: the SigLIP 2 base/16 vision tower and all-MiniLM-L6-v2,
/// plus the fixed SigLIP prompt embeddings (`FLScreenModelPrompts.json`, built by
/// scripts/embed_bench/export_prompts.py). A line-for-line port of the Windows `FLScreenModel.h`, so the same
/// pinned ONNX files give the same numbers on both platforms.
///
/// Not thread-safe: FLScreenModel uses it from its serial run queue only.
/// PRIVACY: pixels and token ids live in local buffers that are zeroed after each call; nothing is logged.
final class FLScreenModelEngine {
  static let visionFile = "siglip2-vision.onnx"
  static let textFile = "minilm.onnx"
  static let vocabFile = "minilm-vocab.txt"
  static let files = [visionFile, textFile, vocabFile]

  private static let size = 224

  struct LoadError: LocalizedError {
    let errorDescription: String?
  }

  private struct Prompt {
    let id: String
    let embedding: [Float]
  }

  // One ORTEnv per process; ONNX Runtime doesn't want several.
  private static var sharedEnv: ORTEnv?

  private let vision: ORTSession
  private let text: ORTSession
  private let vocab: FLScreenModelWordPiece
  private let prompts: [Prompt]
  private let logitScale: Float
  private let logitBias: Float
  /// Embeddings of caller texts (module labels), keyed by text.
  private var textCache: [String: [Float]] = [:]
  private var weightsSize = (w: 0, h: 0)
  /// Dense resize weights: columns [w x 224] (input column → output column), rows [224 x h].
  private var colWeights: [Float] = []
  private var rowWeights: [Float] = []

  init(modelDir: URL) throws {
    guard let promptsURL = Bundle.main.url(forResource: "FLScreenModelPrompts", withExtension: "json"),
          let data = try? Data(contentsOf: promptsURL),
          let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let scale = root["logitScale"] as? NSNumber, let bias = root["logitBias"] as? NSNumber,
          let list = root["prompts"] as? [[String: Any]]
    else { throw LoadError(errorDescription: "prompt table unreadable") }
    prompts = list.compactMap { p in
      guard let id = p["id"] as? String, let e = p["embedding"] as? [NSNumber] else { return nil }
      return Prompt(id: id, embedding: e.map(\.floatValue))
    }
    logitScale = scale.floatValue
    logitBias = bias.floatValue
    guard !prompts.isEmpty else { throw LoadError(errorDescription: "prompt table unreadable") }
    guard let wp = FLScreenModelWordPiece(contentsOf: modelDir.appendingPathComponent(Self.vocabFile)) else {
      throw LoadError(errorDescription: "vocabulary unreadable")
    }
    vocab = wp

    let env: ORTEnv
    if let e = Self.sharedEnv {
      env = e
    } else {
      env = try ORTEnv(loggingLevel: .error)
      Self.sharedEnv = env
    }
    let options = try ORTSessionOptions()
    // A study session checks at most every 10 s; 4 threads keep a check well under a second.
    try options.setIntraOpNumThreads(4)
    try options.setGraphOptimizationLevel(.all)
    // Don't keep worker threads spinning between checks (battery).
    try options.addConfigEntry(withKey: "session.intra_op.allow_spinning", value: "0")
    vision = try ORTSession(env: env, modelPath: modelDir.appendingPathComponent(Self.visionFile).path, sessionOptions: options)
    text = try ORTSession(env: env, modelPath: modelDir.appendingPathComponent(Self.textFile).path, sessionOptions: options)
  }

  // MARK: image

  /// BGRA (premultiplied, alpha ignored) w x h → a logit per fixed prompt: 'lib_<subject>', 'study:<i>', 'distract:<i>'.
  func imageLogits(bgra: UnsafeBufferPointer<UInt8>, width: Int, height: Int) throws -> [String: Double] {
    let pixels = preprocess(bgra, width, height)
    defer { pixels.resetBytes(in: NSRange(location: 0, length: pixels.length)) }
    let input = try ORTValue(tensorData: pixels, elementType: .float, shape: [1, 3, NSNumber(value: Self.size), NSNumber(value: Self.size)])
    let outputs = try vision.run(withInputs: ["pixel_values": input], outputNames: ["pooler_output"], runOptions: nil)
    guard let out = outputs["pooler_output"] else { throw LoadError(errorDescription: "vision model has no pooler_output") }
    let embedding = Self.normalized(try Self.floats(out))
    var logits: [String: Double] = [:]
    for p in prompts {
      logits[p.id] = Double(Self.dot(embedding, p.embedding) * logitScale + logitBias)
    }
    return logits
  }

  /// PIL's bilinear resample (a tent filter whose support widens with the downsample factor), which is what the
  /// SigLIP processor uses; cosine to the processor's embedding is 0.9999 (scripts/embed_bench/export_prompts.py).
  /// Same weights as the Windows `TentWeights`, as a dense [out x n] matrix (row i = output i).
  private static func tentWeights(_ n: Int, _ out: Int) -> [Float] {
    var weights = [Float](repeating: 0, count: out * n)
    let scale = Double(n) / Double(out)
    let support = max(scale, 1.0)
    for i in 0..<out {
      let center = (Double(i) + 0.5) * scale
      let lo = max(0, Int((center - support).rounded(.down)))
      let hi = min(n, Int((center + support).rounded(.up)))
      var row: [(Int, Double)] = []
      var sum = 0.0
      for j in lo..<max(lo, hi) {
        let w = max(0.0, 1.0 - abs((Double(j) + 0.5 - center) / support))
        if w > 0 {
          row.append((j, w))
          sum += w
        }
      }
      for (j, w) in row { weights[i * n + j] = Float(w / sum) }
    }
    return weights
  }

  /// [rows x cols] → [cols x rows].
  private static func transposed(_ m: [Float], rows: Int, cols: Int) -> [Float] {
    var out = [Float](repeating: 0, count: m.count)
    vDSP_mtrans(m, 1, &out, 1, vDSP_Length(cols), vDSP_Length(rows))
    return out
  }

  /// BGRA (w x h) → RGB CHW 224x224 float32, (x / 255 - 0.5) / 0.5. The separable resize is two matrix products
  /// per channel (Accelerate), so it stays fast in Debug builds too: plane [h x w] · cols [w x 224], then
  /// rows [224 x h] · that.
  private func preprocess(_ bgra: UnsafeBufferPointer<UInt8>, _ w: Int, _ h: Int) -> NSMutableData {
    let size = Self.size
    if weightsSize.w != w || weightsSize.h != h {
      colWeights = Self.transposed(Self.tentWeights(w, size), rows: size, cols: w)
      rowWeights = Self.tentWeights(h, size)
      weightsSize = (w, h)
    }
    let out = NSMutableData(length: 3 * size * size * MemoryLayout<Float>.size)!
    let pixels = out.mutableBytes.bindMemory(to: Float.self, capacity: 3 * size * size)
    var plane = [Float](repeating: 0, count: h * w)
    var cols = [Float](repeating: 0, count: h * size)
    // BGRA byte offsets of R, G, B.
    for (c, offset) in [2, 1, 0].enumerated() {
      vDSP_vfltu8(bgra.baseAddress! + offset, 4, &plane, 1, vDSP_Length(h * w))
      vDSP_mmul(plane, 1, colWeights, 1, &cols, 1, vDSP_Length(h), vDSP_Length(size), vDSP_Length(w))
      vDSP_mmul(rowWeights, 1, cols, 1, pixels + c * size * size, 1, vDSP_Length(size), vDSP_Length(size), vDSP_Length(h))
    }
    var scale: Float = 1 / 127.5
    var shift: Float = -1
    vDSP_vsmsa(pixels, 1, &scale, &shift, pixels, 1, vDSP_Length(3 * size * size))
    vDSP_vclr(&plane, 1, vDSP_Length(plane.count))
    vDSP_vclr(&cols, 1, vDSP_Length(cols.count))
    return out
  }

  // MARK: text

  /// Mean-pooled, L2-normalised last_hidden_state (sentence-transformers' default for all-MiniLM-L6-v2).
  func embedText(_ s: String) throws -> [Float] {
    var ids = vocab.encode(s, maxLength: 256)
    defer { for i in ids.indices { ids[i] = 0 } }
    let n = ids.count
    let shape = [NSNumber(value: 1), NSNumber(value: n)]
    let idData = ids.withUnsafeBytes { NSMutableData(bytes: $0.baseAddress!, length: $0.count) }
    defer { idData.resetBytes(in: NSRange(location: 0, length: idData.length)) }
    let mask = [Int64](repeating: 1, count: n).withUnsafeBytes { NSMutableData(bytes: $0.baseAddress!, length: $0.count) }
    let types = NSMutableData(length: n * MemoryLayout<Int64>.size)!
    let inputs: [String: ORTValue] = [
      "input_ids": try ORTValue(tensorData: idData, elementType: .int64, shape: shape),
      "attention_mask": try ORTValue(tensorData: mask, elementType: .int64, shape: shape),
      "token_type_ids": try ORTValue(tensorData: types, elementType: .int64, shape: shape),
    ]
    let outputs = try text.run(withInputs: inputs, outputNames: ["last_hidden_state"], runOptions: nil)
    guard let out = outputs["last_hidden_state"] else { throw LoadError(errorDescription: "text model has no last_hidden_state") }
    let dims = try out.tensorTypeAndShapeInfo().shape.map(\.intValue)
    guard dims.count == 3 else { throw LoadError(errorDescription: "unexpected last_hidden_state shape") }
    let tokens = dims[1], dim = dims[2]
    let data = try Self.floats(out)
    var pooled = [Float](repeating: 0, count: dim)
    for t in 0..<tokens {
      for d in 0..<dim {
        pooled[d] += data[t * dim + d]
      }
    }
    return Self.normalized(pooled)
  }

  /// `embedText` for caller labels, which repeat on every check.
  func cachedEmbedding(_ s: String) throws -> [Float] {
    if let e = textCache[s] { return e }
    let e = try embedText(s)
    textCache[s] = e
    return e
  }

  // MARK: math

  private static func floats(_ value: ORTValue) throws -> [Float] {
    let data = try value.tensorData() as Data
    return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
  }

  static func normalized(_ v: [Float]) -> [Float] {
    var norm = 0.0
    for x in v { norm += Double(x) * Double(x) }
    let inv: Float = norm > 0 ? Float(1.0 / norm.squareRoot()) : 0
    return v.map { $0 * inv }
  }

  static func dot(_ a: [Float], _ b: [Float]) -> Float {
    var sum = 0.0
    for i in 0..<min(a.count, b.count) { sum += Double(a[i]) * Double(b[i]) }
    return Float(sum)
  }
}
