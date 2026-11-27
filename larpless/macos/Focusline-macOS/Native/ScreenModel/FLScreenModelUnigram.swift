import Foundation

/// The XLM-R SentencePiece Unigram tokenizer used by paraphrase-multilingual-MiniLM-L12-v2: a line-by-line port of
/// windows/LarpLess/Native/FLUnigram.h, which matches Hugging Face's tokenizers on the pinned tokenizer.json
/// (Xenova/paraphrase-multilingual-MiniLM-L12-v2@2c4055b): special tokens split out of the raw text (<mask> takes the
/// whitespace before it), Precompiled nmt_nfkc normalisation (NFKC plus SentencePiece's nmt rules, see `normalize`),
/// WhitespaceSplit, Metaspace U+2581 prefix per word, Viterbi over the piece scores with fused <unk>, <s> ... </s>.
/// Known differences, all exotic: grapheme breaks or NFKC where Foundation's Unicode version differs from the Rust
/// crates'. Checked against scripts/embed_bench/unigram_cases.json by scripts/embed_bench/unigram-check-mac.sh, which
/// compiles this file on its own: keep it Foundation-only.
///
/// Pieces are compared as UTF-8 bytes and scalars, never with `String ==`, which treats canonically equivalent
/// strings ("e" + U+0301 and U+00E9) as equal.
/// PRIVACY: tokenizes in memory only; never logs its input.
final class FLScreenModelUnigram {
  private struct Special {
    let text: [UInt16]
    let id: Int32
    let lstrip: Bool
  }

  private var ids: [[UInt8]: Int32] = [:]
  private var scores: [Double] = []
  private var specials: [Special] = []
  private var maxPieceChars = 0
  private var unkScore = 0.0
  private var bos: Int32 = -1
  private var eos: Int32 = -1
  private var unk: Int32 = -1

  /// minilm-ml-vocab.txt: "piece<TAB>score" per line (converted from unigram.json at download, see
  /// FLScreenModelVocab), the line number is the id. Nil if the file can't be read or lacks the special tokens.
  init?(contentsOf url: URL) {
    guard let data = try? Data(contentsOf: url) else { return nil }
    let ok = data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
      let bytes = raw.bindMemory(to: UInt8.self)
      ids.reserveCapacity(260_000)
      scores.reserveCapacity(260_000)
      var minScore = Double.infinity
      var pos = 0
      let count = bytes.count
      while pos < count {
        var end = pos
        while end < count && bytes[end] != 0x0A { end += 1 }
        var lineEnd = end
        if lineEnd > pos && bytes[lineEnd - 1] == 0x0D { lineEnd -= 1 }
        var tab = lineEnd - 1
        while tab >= pos && bytes[tab] != 0x09 { tab -= 1 }
        guard tab >= pos,
              let text = String(bytes: UnsafeBufferPointer(rebasing: bytes[(tab + 1)..<lineEnd]), encoding: .ascii),
              let score = Double(text)
        else { return false }
        let piece = Array(bytes[pos..<tab])
        maxPieceChars = max(maxPieceChars, Self.utf8Length(piece))
        ids[piece] = Int32(scores.count)
        scores.append(score)
        minScore = min(minScore, score)
        pos = end + 1
      }
      unkScore = minScore - 10.0 // tokenizers' K_UNK_PENALTY
      return true
    }
    guard ok else { return nil }
    bos = id("<s>")
    eos = id("</s>")
    unk = id("<unk>")
    for special in ["<s>", "<pad>", "</s>", "<unk>", "<mask>"] {
      let i = id(special)
      guard i >= 0 else { return nil }
      specials.append(Special(text: Array(special.utf16), id: i, lstrip: special == "<mask>"))
    }
    guard bos >= 0, eos >= 0, unk >= 0 else { return nil }
  }

  /// <s> tokens </s>, truncated to maxLength ids in total.
  func encode(_ s: String, maxLength: Int = 256) -> [Int64] {
    let text = Array(s.utf16)
    var out: [Int64] = [Int64(bos)]
    let push: (Int32) -> Bool = { id in
      if out.count + 1 >= maxLength { return false }
      out.append(Int64(id))
      return true
    }
    var room = true
    // Added tokens are matched on the raw text first (leftmost; the five never share a prefix), and the text
    // between them is tokenized on its own.
    var segmentStart = 0
    var i = 0
    while room && i < text.count {
      guard let match = specials.first(where: { Self.hasPrefix(text, at: i, $0.text) }) else {
        i += 1
        continue
      }
      var start = i
      if match.lstrip {
        while start > segmentStart && Self.isWhitespace(UInt32(text[start - 1])) { start -= 1 }
      }
      room = encodeSegment(text[segmentStart..<start], push) && push(match.id)
      i += match.text.count
      segmentStart = i
    }
    if room {
      _ = encodeSegment(text[segmentStart...], push)
    }
    out.append(Int64(eos))
    return out
  }

  private func id(_ piece: String) -> Int32 {
    ids[Array(piece.utf8)] ?? -1
  }

  private static func hasPrefix(_ text: [UInt16], at i: Int, _ prefix: [UInt16]) -> Bool {
    guard i + prefix.count <= text.count else { return false }
    for k in 0..<prefix.count where text[i + k] != prefix[k] { return false }
    return true
  }

  private static func utf8Length(_ bytes: [UInt8]) -> Int {
    bytes.reduce(0) { $0 + ($1 & 0xC0 != 0x80 ? 1 : 0) }
  }

  private static func appendUtf8(_ out: inout [UInt8], _ c: UInt32) {
    if c < 0x80 {
      out.append(UInt8(c))
    } else if c < 0x800 {
      out.append(UInt8(0xC0 | (c >> 6)))
      out.append(UInt8(0x80 | (c & 0x3F)))
    } else if c < 0x10000 {
      out.append(UInt8(0xE0 | (c >> 12)))
      out.append(UInt8(0x80 | ((c >> 6) & 0x3F)))
      out.append(UInt8(0x80 | (c & 0x3F)))
    } else {
      out.append(UInt8(0xF0 | (c >> 18)))
      out.append(UInt8(0x80 | ((c >> 12) & 0x3F)))
      out.append(UInt8(0x80 | ((c >> 6) & 0x3F)))
      out.append(UInt8(0x80 | (c & 0x3F)))
    }
  }

  /// Rust's char::is_whitespace (the Unicode White_Space property), used by WhitespaceSplit and <mask>'s lstrip.
  private static func isWhitespace(_ c: UInt32) -> Bool {
    Unicode.Scalar(c)?.properties.isWhitespace ?? false
  }

  // SentencePiece's nmt_nfkc, as the tokenizer's Precompiled charsmap holds it: NFKC plus these rules.
  // export_prompts.py checks the same tables (NMT_REMOVE / NMT_SPACE / NMT_KEEP there) against the charsmap.
  private static func nmtRemove(_ c: UInt32) -> Bool {
    (0x01...0x08).contains(c) || c == 0x0B || (0x0E...0x1F).contains(c) || c == 0x7F || c == 0x8F || c == 0x9F
  }

  private static func nmtSpace(_ c: UInt32) -> Bool {
    c == 0x09 || c == 0x0A || c == 0x0C || c == 0x0D || c == 0x1680 || (0x200B...0x200F).contains(c) ||
      c == 0x2028 || c == 0x2029 || c == 0x2581 || c == 0xFEFF || c == 0xFFFD
  }

  /// Left as they are by the charsmap (newer than its Unicode tables, and U+FF5E FULLWIDTH TILDE).
  private static func nmtKeep(_ c: UInt32) -> Bool {
    c == 0x32FF || (0xA7F2...0xA7F4).contains(c) || c == 0xAB69 || c == 0xFF5E || (0x10781...0x10785).contains(c) ||
      (0x10787...0x107B0).contains(c) || (0x107B2...0x107BA).contains(c) || (0x1E030...0x1E06D).contains(c) ||
      c == 0x1F16C || c == 0x1F23B || (0x1FBF0...0x1FBF9).contains(c)
  }

  private static func string(_ scalars: [UInt32]) -> String {
    var view = String.UnicodeScalarView()
    for c in scalars {
      if let s = Unicode.Scalar(c) { view.append(s) }
    }
    return String(view)
  }

  private static func scalars(_ s: String) -> [UInt32] {
    s.unicodeScalars.map(\.value)
  }

  private static func nfkc(_ scalars: [UInt32]) -> [UInt32] {
    Self.scalars(string(scalars).precomposedStringWithCompatibilityMapping)
  }

  private static func nfd(_ scalars: [UInt32]) -> [UInt32] {
    Self.scalars(string(scalars).decomposedStringWithCanonicalMapping)
  }

  /// The charsmap's entry for one code point, if it has one: nmt rules, else NFKC when that changes it.
  private static func mapOne(_ c: UInt32) -> [UInt32]? {
    if nmtRemove(c) { return [] }
    if nmtSpace(c) { return [0x20] }
    if c < 0x80 || nmtKeep(c) { return nil }
    let mapped = nfkc([c])
    return mapped == [c] ? nil : mapped
  }

  /// Its multi-code-point keys are the sequences that NFKC composes into one code point X and whose code points,
  /// each NFKC-mapped to a single one, spell NFD(X): "Ấ" (tone mark) and halfwidth jamo are keys,
  /// "Ḹ" (already partly composed) is not. Checked against all 219,874 keys of the pinned charsmap.
  private static func mapSequence(_ sequence: [UInt32]) -> [UInt32]? {
    let mapped = nfkc(sequence)
    if mapped == sequence || mapped.count != 1 { return nil }
    var each: [UInt32] = []
    for c in sequence {
      let one = nfkc([c])
      if one.count != 1 { return nil }
      each += one
    }
    return each == nfd(mapped) ? mapped : nil
  }

  private static func utf8Bytes(_ c: UInt32) -> Int {
    c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }

  /// tokenizers' Precompiled normaliser, one grapheme at a time: a grapheme under 6 UTF-8 bytes is replaced whole
  /// by the entry of its shortest prefix that has one (so U+FF4F U+031A -> "o", dropping the mark); otherwise,
  /// or with no such prefix, each code point is mapped on its own.
  private static func appendGrapheme(_ out: inout [UInt32], _ cps: [UInt32]) {
    if cps.reduce(0, { $0 + utf8Bytes($1) }) < 6 {
      for i in 0..<cps.count {
        if let mapped = i == 0 ? mapOne(cps[0]) : mapSequence(Array(cps[0...i])) {
          out += mapped
          return
        }
      }
    }
    for c in cps {
      if let mapped = mapOne(c) {
        out += mapped
      } else {
        out.append(c)
      }
    }
  }

  /// Lone surrogates become U+FFFD (Rust strings can't hold them; String(decoding:) does the same), which the nmt
  /// rules turn into a space. Swift's Characters are extended grapheme clusters, like ICU's character breaks.
  private static func normalize(_ segment: ArraySlice<UInt16>) -> [UInt32] {
    let clean = String(decoding: segment, as: UTF16.self)
    var out: [UInt32] = []
    out.reserveCapacity(segment.count)
    for grapheme in clean {
      appendGrapheme(&out, grapheme.unicodeScalars.map(\.value))
    }
    return out
  }

  /// Normalise, split on whitespace, then U+2581 + word through Viterbi. Returns false once the ids are full.
  private func encodeSegment(_ segment: ArraySlice<UInt16>, _ push: (Int32) -> Bool) -> Bool {
    var word: [UInt32] = []
    func flush() -> Bool {
      if word.isEmpty { return true }
      var utf8: [UInt8] = []
      var bounds = [0] // byte offset of each code point, plus the end
      Self.appendUtf8(&utf8, 0x2581)
      bounds.append(utf8.count)
      for c in word {
        Self.appendUtf8(&utf8, c)
        bounds.append(utf8.count)
      }
      word.removeAll(keepingCapacity: true)
      for id in viterbi(utf8, bounds) where !push(id) { return false }
      return true
    }
    for c in Self.normalize(segment) {
      if Self.isWhitespace(c) {
        if !flush() { return false }
      } else {
        word.append(c)
      }
    }
    return flush()
  }

  /// tokenizers' Unigram::encode_optimized: best path by summed piece score (ties keep the first found, scanning
  /// starts left to right and lengths short to long); a code point no single piece covers becomes <unk>
  /// (min score - 10), and adjacent <unk>s fuse into one.
  private func viterbi(_ utf8: [UInt8], _ bounds: [Int]) -> [Int32] {
    struct Node {
      var score = 0.0
      var start = 0
      var id: Int32 = -1 // -1: not reached yet
    }
    let n = bounds.count - 1
    var best = [Node](repeating: Node(), count: n + 1)
    best[0].id = 0
    for start in 0..<n {
      let here = best[start].score
      var single = false
      let longest = min(n - start, maxPieceChars)
      if longest >= 1 {
        for len in 1...longest {
          guard let id = ids[Array(utf8[bounds[start]..<bounds[start + len]])] else { continue }
          let candidate = scores[Int(id)] + here
          if best[start + len].id < 0 || candidate > best[start + len].score {
            best[start + len] = Node(score: candidate, start: start, id: id)
          }
          single = single || len == 1
        }
      }
      if !single {
        let candidate = unkScore + here
        if best[start + 1].id < 0 || candidate > best[start + 1].score {
          best[start + 1] = Node(score: candidate, start: start, id: unk)
        }
      }
    }
    var pieces: [[UInt8]] = []
    var unkRun: [UInt8] = [] // fused <unk> run, built back to front
    var end = n
    while end > 0 {
      let node = best[end]
      let piece = Array(utf8[bounds[node.start]..<bounds[end]])
      if node.id == unk {
        unkRun.insert(contentsOf: piece, at: 0)
      } else {
        if !unkRun.isEmpty {
          pieces.append(unkRun)
          unkRun = []
        }
        pieces.append(piece)
      }
      end = node.start
    }
    if !unkRun.isEmpty { pieces.append(unkRun) }
    return pieces.reversed().map { ids[$0] ?? unk }
  }
}
