import Foundation

/// The BERT "uncased" tokenizer (BasicTokenizer + WordPiece) used by all-MiniLM-L6-v2, so FLScreenModel can embed
/// text natively. Swift port of the Windows `FLWordPiece.h`: lowercase, strip accents, split CJK and punctuation,
/// greedy longest-match WordPiece. Checked against scripts/embed_bench/wordpiece_cases.json (fixed sample strings,
/// never user text) by scripts/embed_bench/wordpiece-check-mac.sh, which compiles this file on its own: keep it
/// Foundation-only.
///
/// PRIVACY: tokenizes in memory only; never logs its input.
final class FLScreenModelWordPiece {
  // Keyed by UTF-8 bytes, not String: String equality is canonical equivalence, which would match tokens that
  // Hugging Face's tokenizer (byte-for-byte) treats as different.
  private var vocab: [[UInt8]: Int64] = [:]
  private let cls: Int64
  private let sep: Int64
  private let unk: Int64

  /// vocab.txt: one token per line, the line number is the id. Nil if the file can't be read.
  init?(contentsOf url: URL) {
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
    var lines = text.components(separatedBy: "\n")
    if lines.last == "" { lines.removeLast() }
    for (id, raw) in lines.enumerated() {
      let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : raw
      let key = Array(line.utf8)
      if vocab[key] == nil { vocab[key] = Int64(id) }
    }
    guard let c = vocab[Array("[CLS]".utf8)], let s = vocab[Array("[SEP]".utf8)], let u = vocab[Array("[UNK]".utf8)]
    else { return nil }
    cls = c
    sep = s
    unk = u
  }

  /// [CLS] tokens [SEP], truncated to maxLength ids in total.
  func encode(_ text: String, maxLength: Int = 256) -> [Int64] {
    var ids: [Int64] = [cls]
    for word in Self.basicTokens(text) {
      for id in pieces(word) {
        if ids.count + 1 >= maxLength {
          ids.append(sep)
          return ids
        }
        ids.append(id)
      }
    }
    ids.append(sep)
    return ids
  }

  // Same rules as transformers' _is_whitespace / _is_control / _is_punctuation / _is_chinese_char.
  private static func isWhitespace(_ c: Unicode.Scalar) -> Bool {
    c == " " || c == "\t" || c == "\n" || c == "\r" || c.properties.generalCategory == .spaceSeparator
  }

  private static func isControl(_ c: Unicode.Scalar) -> Bool {
    if c == "\t" || c == "\n" || c == "\r" { return false }
    let t = c.properties.generalCategory
    return t == .control || t == .format
  }

  private static func isPunctuation(_ c: Unicode.Scalar) -> Bool {
    let v = c.value
    if (33...47).contains(v) || (58...64).contains(v) || (91...96).contains(v) || (123...126).contains(v) { return true }
    switch c.properties.generalCategory {
    case .dashPunctuation, .openPunctuation, .closePunctuation, .connectorPunctuation, .otherPunctuation,
         .initialPunctuation, .finalPunctuation:
      return true
    default:
      return false
    }
  }

  private static func isCjk(_ c: Unicode.Scalar) -> Bool {
    switch c.value {
    case 0x4E00...0x9FFF, 0x3400...0x4DBF, 0x20000...0x2A6DF, 0x2A700...0x2B73F, 0x2B740...0x2B81F, 0x2B820...0x2CEAF,
         0xF900...0xFAFF, 0x2F800...0x2FA1F:
      return true
    default:
      return false
    }
  }

  private static func string(_ scalars: some Sequence<Unicode.Scalar>) -> String {
    var s = String()
    s.unicodeScalars.append(contentsOf: scalars)
    return s
  }

  /// Lowercase + NFD + drop combining marks, per whitespace-separated token.
  private static func lowerStripAccents(_ token: [Unicode.Scalar]) -> [Unicode.Scalar] {
    string(token).lowercased().decomposedStringWithCanonicalMapping.unicodeScalars
      .filter { $0.properties.generalCategory != .nonspacingMark }
  }

  /// BasicTokenizer: clean, isolate CJK, split on whitespace, lowercase/strip accents, split punctuation.
  /// Each token is a list of code points.
  private static func basicTokens(_ text: String) -> [[Unicode.Scalar]] {
    var cleaned: [Unicode.Scalar] = []
    cleaned.reserveCapacity(text.unicodeScalars.count)
    for c in text.unicodeScalars {
      if c.value == 0 || c.value == 0xFFFD || isControl(c) { continue }
      if isCjk(c) {
        cleaned.append(" ")
        cleaned.append(c)
        cleaned.append(" ")
      } else {
        cleaned.append(isWhitespace(c) ? " " : c)
      }
    }
    var out: [[Unicode.Scalar]] = []
    var token: [Unicode.Scalar] = []
    func flush() {
      guard !token.isEmpty else { return }
      var piece: [Unicode.Scalar] = []
      for c in lowerStripAccents(token) {
        if isPunctuation(c) {
          if !piece.isEmpty {
            out.append(piece)
            piece.removeAll()
          }
          out.append([c])
        } else {
          piece.append(c)
        }
      }
      if !piece.isEmpty { out.append(piece) }
      token.removeAll()
    }
    for c in cleaned {
      if c == " " {
        flush()
      } else {
        token.append(c)
      }
    }
    flush()
    return out
  }

  /// Greedy longest-match-first WordPiece over code points.
  private func pieces(_ word: [Unicode.Scalar]) -> [Int64] {
    if word.count > 100 { return [unk] }
    var ids: [Int64] = []
    var start = 0
    while start < word.count {
      var found: Int64?
      var end = word.count
      while end > start {
        var key = start > 0 ? Array("##".utf8) : []
        key.append(contentsOf: Self.string(word[start..<end]).utf8)
        if let id = vocab[key] {
          found = id
          break
        }
        end -= 1
      }
      guard let id = found else { return [unk] }
      ids.append(id)
      start = end
    }
    return ids
  }
}
