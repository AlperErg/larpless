// FLWordPiece: the BERT "uncased" tokenizer (BasicTokenizer + WordPiece) used by all-MiniLM-L6-v2, so
// FLScreenModel can embed text natively. Matches Hugging Face's BertTokenizer with do_lower_case=true
// (lowercase, strip accents, split CJK and punctuation, greedy longest-match WordPiece).
// Checked against scripts/embed_bench/wordpiece_cases.json (fixed sample strings, never user text).
// PRIVACY: tokenizes in memory only; never logs its input.
#pragma once

#include <windows.h>

#include <icu.h>

#include <cstdint>
#include <fstream>
#include <string>
#include <unordered_map>
#include <vector>

#pragma comment(lib, "icu.lib")
#pragma comment(lib, "normaliz.lib")

namespace LarpLess {

class WordPiece {
 public:
  // vocab.txt: one token per line, the line number is the id. Returns false if the file can't be read.
  bool Load(std::wstring const &path) {
    std::ifstream file{path, std::ios::binary};
    if (!file) {
      return false;
    }
    m_vocab.clear();
    std::string line;
    int32_t id{0};
    while (std::getline(file, line)) {
      if (!line.empty() && line.back() == '\r') {
        line.pop_back();
      }
      m_vocab.emplace(line, id++);
    }
    m_cls = Id("[CLS]");
    m_sep = Id("[SEP]");
    m_unk = Id("[UNK]");
    return m_cls >= 0 && m_sep >= 0 && m_unk >= 0;
  }

  // [CLS] tokens [SEP], truncated to maxLength ids in total.
  std::vector<int64_t> Encode(std::wstring const &text, size_t maxLength = 256) const {
    std::vector<int64_t> ids{m_cls};
    for (auto const &word : BasicTokens(text)) {
      for (int32_t id : Pieces(word)) {
        if (ids.size() + 1 >= maxLength) {
          ids.push_back(m_sep);
          return ids;
        }
        ids.push_back(id);
      }
    }
    ids.push_back(m_sep);
    return ids;
  }

 private:
  std::unordered_map<std::string, int32_t> m_vocab;
  int32_t m_cls{-1}, m_sep{-1}, m_unk{-1};

  int32_t Id(std::string const &token) const {
    const auto it{m_vocab.find(token)};
    return it == m_vocab.end() ? -1 : it->second;
  }

  static std::vector<UChar32> CodePoints(std::wstring const &s) {
    std::vector<UChar32> out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); ++i) {
      const wchar_t c{s[i]};
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.size() && s[i + 1] >= 0xDC00 && s[i + 1] <= 0xDFFF) {
        out.push_back(0x10000 + ((static_cast<UChar32>(c) - 0xD800) << 10) + (static_cast<UChar32>(s[i + 1]) - 0xDC00));
        ++i;
      } else {
        out.push_back(c);
      }
    }
    return out;
  }

  static void AppendUtf8(std::string &out, UChar32 c) {
    if (c < 0x80) {
      out += static_cast<char>(c);
    } else if (c < 0x800) {
      out += static_cast<char>(0xC0 | (c >> 6));
      out += static_cast<char>(0x80 | (c & 0x3F));
    } else if (c < 0x10000) {
      out += static_cast<char>(0xE0 | (c >> 12));
      out += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (c & 0x3F));
    } else {
      out += static_cast<char>(0xF0 | (c >> 18));
      out += static_cast<char>(0x80 | ((c >> 12) & 0x3F));
      out += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (c & 0x3F));
    }
  }

  // Same rules as transformers' _is_whitespace / _is_control / _is_punctuation / _is_chinese_char.
  static bool IsWhitespace(UChar32 c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || u_charType(c) == U_SPACE_SEPARATOR;
  }
  static bool IsControl(UChar32 c) {
    if (c == '\t' || c == '\n' || c == '\r') {
      return false;
    }
    const int8_t t{u_charType(c)};
    return t == U_CONTROL_CHAR || t == U_FORMAT_CHAR;
  }
  static bool IsPunctuation(UChar32 c) {
    if ((c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)) {
      return true;
    }
    switch (u_charType(c)) {
      case U_DASH_PUNCTUATION:
      case U_START_PUNCTUATION:
      case U_END_PUNCTUATION:
      case U_CONNECTOR_PUNCTUATION:
      case U_OTHER_PUNCTUATION:
      case U_INITIAL_PUNCTUATION:
      case U_FINAL_PUNCTUATION:
        return true;
      default:
        return false;
    }
  }
  static bool IsCjk(UChar32 c) {
    return (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0x20000 && c <= 0x2A6DF) ||
           (c >= 0x2A700 && c <= 0x2B73F) || (c >= 0x2B740 && c <= 0x2B81F) || (c >= 0x2B820 && c <= 0x2CEAF) ||
           (c >= 0xF900 && c <= 0xFAFF) || (c >= 0x2F800 && c <= 0x2FA1F);
  }

  // Lowercase + NFD + drop combining marks, per whitespace-separated token.
  static std::vector<UChar32> LowerStripAccents(std::vector<UChar32> const &token) {
    std::wstring lower;
    for (UChar32 c : token) {
      const UChar32 l{u_tolower(c)};
      if (l >= 0x10000) {
        lower += static_cast<wchar_t>(0xD800 + ((l - 0x10000) >> 10));
        lower += static_cast<wchar_t>(0xDC00 + ((l - 0x10000) & 0x3FF));
      } else {
        lower += static_cast<wchar_t>(l);
      }
    }
    std::vector<UChar32> out;
    const int size{NormalizeString(NormalizationD, lower.c_str(), static_cast<int>(lower.size()), nullptr, 0)};
    if (size <= 0) {
      return CodePoints(lower);
    }
    std::wstring nfd(static_cast<size_t>(size), L'\0');
    const int written{NormalizeString(NormalizationD, lower.c_str(), static_cast<int>(lower.size()), nfd.data(), size)};
    nfd.resize(written > 0 ? static_cast<size_t>(written) : 0);
    for (UChar32 c : CodePoints(nfd)) {
      if (u_charType(c) != U_NON_SPACING_MARK) {
        out.push_back(c);
      }
    }
    return out;
  }

  // BasicTokenizer: clean, isolate CJK, split on whitespace, lowercase/strip accents, split punctuation.
  static std::vector<std::string> BasicTokens(std::wstring const &text) {
    std::vector<UChar32> cleaned;
    for (UChar32 c : CodePoints(text)) {
      if (c == 0 || c == 0xFFFD || IsControl(c)) {
        continue;
      }
      if (IsCjk(c)) {
        cleaned.push_back(' ');
        cleaned.push_back(c);
        cleaned.push_back(' ');
      } else {
        cleaned.push_back(IsWhitespace(c) ? ' ' : c);
      }
    }
    std::vector<std::string> out;
    std::vector<UChar32> token;
    auto flush = [&] {
      if (token.empty()) {
        return;
      }
      std::string piece;
      for (UChar32 c : LowerStripAccents(token)) {
        if (IsPunctuation(c)) {
          if (!piece.empty()) {
            out.push_back(std::move(piece));
            piece.clear();
          }
          std::string p;
          AppendUtf8(p, c);
          out.push_back(std::move(p));
        } else {
          AppendUtf8(piece, c);
        }
      }
      if (!piece.empty()) {
        out.push_back(std::move(piece));
      }
      token.clear();
    };
    for (UChar32 c : cleaned) {
      if (c == ' ') {
        flush();
      } else {
        token.push_back(c);
      }
    }
    flush();
    return out;
  }

  static size_t Utf8Length(std::string const &s) {
    size_t n{0};
    for (unsigned char c : s) {
      n += (c & 0xC0) != 0x80;
    }
    return n;
  }

  // Greedy longest-match-first WordPiece over UTF-8 code point boundaries.
  std::vector<int32_t> Pieces(std::string const &word) const {
    if (Utf8Length(word) > 100) {
      return {m_unk};
    }
    std::vector<size_t> bounds;  // byte offsets of code point starts, plus the end
    for (size_t i = 0; i < word.size(); ++i) {
      if ((static_cast<unsigned char>(word[i]) & 0xC0) != 0x80) {
        bounds.push_back(i);
      }
    }
    bounds.push_back(word.size());
    std::vector<int32_t> ids;
    size_t start{0};
    while (start + 1 < bounds.size()) {
      int32_t found{-1};
      size_t end{bounds.size() - 1};
      for (; end > start; --end) {
        std::string sub{word.substr(bounds[start], bounds[end] - bounds[start])};
        if (start > 0) {
          sub = "##" + sub;
        }
        found = Id(sub);
        if (found >= 0) {
          break;
        }
      }
      if (found < 0) {
        return {m_unk};
      }
      ids.push_back(found);
      start = end;
    }
    return ids;
  }
};

} // namespace LarpLess
