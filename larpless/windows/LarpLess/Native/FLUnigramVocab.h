// FLUnigramVocab: turns the pinned unigram.json (Hugging Face tokenizers' saved Unigram model,
// Xenova/paraphrase-multilingual-MiniLM-L12-v2@2c4055b) into minilm-ml-vocab.txt, the "piece<TAB>score" lines
// FLUnigram loads (line number = id). FLScreenModel runs it once, right after the download; the result must hash
// to the SHA-256 FLScreenModel pins, which export_prompts.py derives the same way from tokenizer.json.
// Scores are copied as written in the JSON (the shortest round-trip form, identical to Python's repr() of the
// float), never re-formatted. Standard library only, so scripts/embed_bench/unigram-vocab-check.sh can build it
// on macOS or Linux. Input is model data, never user text.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

namespace LarpLess {

class UnigramVocabJson {
 public:
  // {"type": "Unigram", "unk_id": N, "vocab": [["piece", score], ...], ...}: any other keys are skipped. Returns
  // false (out unspecified) on malformed JSON, a missing or empty "vocab", or a piece that is empty or holds a tab,
  // CR or LF (those would break the line format).
  static bool Convert(std::string_view json, std::string &out) {
    UnigramVocabJson p{json};
    out.clear();
    out.reserve(json.size() / 2);
    bool found{false};
    p.Ws();
    if (!p.Eat('{')) {
      return false;
    }
    p.Ws();
    if (!p.Eat('}')) {
      for (;;) {
        std::string key;
        p.Ws();
        if (!p.String(key)) {
          return false;
        }
        p.Ws();
        if (!p.Eat(':')) {
          return false;
        }
        p.Ws();
        if (key == "vocab") {
          if (found || !p.Vocab(out)) {
            return false;
          }
          found = true;
        } else if (!p.Skip(0)) {
          return false;
        }
        p.Ws();
        if (p.Eat('}')) {
          break;
        }
        if (!p.Eat(',')) {
          return false;
        }
      }
    }
    p.Ws();
    return found && !out.empty() && p.m_at == p.m_json.size();
  }

 private:
  explicit UnigramVocabJson(std::string_view json) : m_json{json} {}

  std::string_view m_json;
  size_t m_at{0};

  static constexpr int kMaxDepth{64};

  bool Peek(char c) const {
    return m_at < m_json.size() && m_json[m_at] == c;
  }

  bool Eat(char c) {
    if (!Peek(c)) {
      return false;
    }
    ++m_at;
    return true;
  }

  void Ws() {
    while (m_at < m_json.size() &&
           (m_json[m_at] == ' ' || m_json[m_at] == '\t' || m_json[m_at] == '\n' || m_json[m_at] == '\r')) {
      ++m_at;
    }
  }

  // [["piece", score], ...] -> "piece\tscore\n" per entry.
  bool Vocab(std::string &out) {
    if (!Eat('[')) {
      return false;
    }
    Ws();
    if (Eat(']')) {
      return true;
    }
    std::string piece;
    std::string_view score;
    for (;;) {
      Ws();
      if (!Eat('[')) {
        return false;
      }
      Ws();
      if (!String(piece)) {
        return false;
      }
      Ws();
      if (!Eat(',')) {
        return false;
      }
      Ws();
      if (!Number(score)) {
        return false;
      }
      Ws();
      if (!Eat(']')) {
        return false;
      }
      if (piece.empty() || piece.find_first_of("\t\r\n") != std::string::npos) {
        return false;
      }
      out += piece;
      out += '\t';
      out += score;
      out += '\n';
      Ws();
      if (Eat(']')) {
        return true;
      }
      if (!Eat(',')) {
        return false;
      }
    }
  }

  // A JSON string, unescaped into UTF-8 (\uXXXX surrogate pairs joined; a lone surrogate is malformed).
  bool String(std::string &out) {
    out.clear();
    if (!Eat('"')) {
      return false;
    }
    while (m_at < m_json.size()) {
      const char c{m_json[m_at++]};
      if (c == '"') {
        return true;
      }
      if (static_cast<unsigned char>(c) < 0x20) {
        return false;
      }
      if (c != '\\') {
        out += c;
        continue;
      }
      if (m_at >= m_json.size()) {
        return false;
      }
      switch (m_json[m_at++]) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          uint32_t cp{0};
          if (!Hex4(cp)) {
            return false;
          }
          if (cp >= 0xD800 && cp <= 0xDBFF) {
            uint32_t low{0};
            if (!Eat('\\') || !Eat('u') || !Hex4(low) || low < 0xDC00 || low > 0xDFFF) {
              return false;
            }
            cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
          } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
            return false;
          }
          Utf8(cp, out);
          break;
        }
        default: return false;
      }
    }
    return false;
  }

  bool Hex4(uint32_t &cp) {
    if (m_at + 4 > m_json.size()) {
      return false;
    }
    for (int i = 0; i < 4; ++i) {
      const char c{m_json[m_at++]};
      cp <<= 4;
      if (c >= '0' && c <= '9') {
        cp |= static_cast<uint32_t>(c - '0');
      } else if (c >= 'a' && c <= 'f') {
        cp |= static_cast<uint32_t>(c - 'a' + 10);
      } else if (c >= 'A' && c <= 'F') {
        cp |= static_cast<uint32_t>(c - 'A' + 10);
      } else {
        return false;
      }
    }
    return true;
  }

  static void Utf8(uint32_t cp, std::string &out) {
    if (cp < 0x80) {
      out += static_cast<char>(cp);
    } else if (cp < 0x800) {
      out += static_cast<char>(0xC0 | (cp >> 6));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
      out += static_cast<char>(0xE0 | (cp >> 12));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    } else {
      out += static_cast<char>(0xF0 | (cp >> 18));
      out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    }
  }

  // The text of a JSON number: -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?
  bool Number(std::string_view &text) {
    const size_t start{m_at};
    Eat('-');
    if (Eat('0')) {
    } else if (!Digits()) {
      return false;
    }
    if (Eat('.') && !Digits()) {
      return false;
    }
    if (Eat('e') || Eat('E')) {
      if (!Eat('+')) {
        Eat('-');
      }
      if (!Digits()) {
        return false;
      }
    }
    text = m_json.substr(start, m_at - start);
    return true;
  }

  bool Digits() {
    const size_t start{m_at};
    while (m_at < m_json.size() && m_json[m_at] >= '0' && m_json[m_at] <= '9') {
      ++m_at;
    }
    return m_at > start;
  }

  bool Literal(std::string_view word) {
    if (m_json.substr(m_at, word.size()) != word) {
      return false;
    }
    m_at += word.size();
    return true;
  }

  // Any JSON value, discarded.
  bool Skip(int depth) {
    if (depth > kMaxDepth || m_at >= m_json.size()) {
      return false;
    }
    std::string scratch;
    std::string_view number;
    switch (m_json[m_at]) {
      case '"': return String(scratch);
      case 't': return Literal("true");
      case 'f': return Literal("false");
      case 'n': return Literal("null");
      case '[': {
        ++m_at;
        Ws();
        if (Eat(']')) {
          return true;
        }
        for (;;) {
          Ws();
          if (!Skip(depth + 1)) {
            return false;
          }
          Ws();
          if (Eat(']')) {
            return true;
          }
          if (!Eat(',')) {
            return false;
          }
        }
      }
      case '{': {
        ++m_at;
        Ws();
        if (Eat('}')) {
          return true;
        }
        for (;;) {
          Ws();
          if (!String(scratch)) {
            return false;
          }
          Ws();
          if (!Eat(':')) {
            return false;
          }
          Ws();
          if (!Skip(depth + 1)) {
            return false;
          }
          Ws();
          if (Eat('}')) {
            return true;
          }
          if (!Eat(',')) {
            return false;
          }
        }
      }
      default: return Number(number);
    }
  }
};

}  // namespace LarpLess
