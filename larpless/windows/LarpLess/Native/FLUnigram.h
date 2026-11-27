// FLUnigram: the XLM-R SentencePiece Unigram tokenizer used by paraphrase-multilingual-MiniLM-L12-v2, so
// FLScreenModel can embed non-English text natively. Matches Hugging Face's tokenizers on the pinned tokenizer.json
// (Xenova/paraphrase-multilingual-MiniLM-L12-v2@2c4055b): special tokens split out of the raw text (<mask> takes the
// whitespace before it), Precompiled nmt_nfkc normalisation (NFKC plus SentencePiece's nmt rules, see Normalize),
// WhitespaceSplit, Metaspace U+2581 prefix per word, Viterbi over the piece scores with fused <unk>, <s> ... </s>.
// Known differences, all exotic: grapheme breaks or NFKC where ICU's Unicode version differs from the Rust crates'
// (export_prompts.py measures the rule on random short strings).
// Checked against scripts/embed_bench/unigram_cases.json (fixed sample strings, never user text) by
// scripts/embed_bench/unigram-check-windows.ps1 (see windows/AGENTS.md).
// PRIVACY: tokenizes in memory only; never logs its input.
#pragma once

#include <windows.h>

#include <icu.h>

#include <algorithm>
#include <charconv>
#include <cstdint>
#include <fstream>
#include <limits>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#pragma comment(lib, "icu.lib")
#pragma comment(lib, "normaliz.lib")

namespace LarpLess {

class Unigram {
 public:
  // minilm-ml-vocab.txt: "piece<TAB>score" per line (scripts/embed_bench/export_prompts.py --text-model minilm-ml),
  // the line number is the id. Returns false if the file can't be read or lacks the special tokens.
  bool Load(std::wstring const &path) {
    std::ifstream file{path, std::ios::binary};
    if (!file) {
      return false;
    }
    std::stringstream buffer;
    buffer << file.rdbuf();
    const std::string data{buffer.str()};
    m_ids.clear();
    m_scores.clear();
    m_maxPieceChars = 0;
    double minScore{std::numeric_limits<double>::infinity()};
    size_t pos{0};
    while (pos < data.size()) {
      size_t end{data.find('\n', pos)};
      if (end == std::string::npos) {
        end = data.size();
      }
      size_t lineEnd{end};
      if (lineEnd > pos && data[lineEnd - 1] == '\r') {
        --lineEnd;
      }
      const size_t tab{data.rfind('\t', lineEnd)};
      if (tab == std::string::npos || tab < pos) {
        return false;
      }
      double score{0};
      if (std::from_chars(data.data() + tab + 1, data.data() + lineEnd, score).ec != std::errc{}) {
        return false;
      }
      std::string piece{data.substr(pos, tab - pos)};
      m_maxPieceChars = (std::max)(m_maxPieceChars, Utf8Length(piece));
      m_ids.emplace(std::move(piece), static_cast<int32_t>(m_scores.size()));
      m_scores.push_back(score);
      minScore = (std::min)(minScore, score);
      pos = end + 1;
    }
    m_unkScore = minScore - 10.0;  // tokenizers' K_UNK_PENALTY
    m_bos = Id("<s>");
    m_eos = Id("</s>");
    m_unk = Id("<unk>");
    m_specials.clear();
    for (char const *special : {"<s>", "<pad>", "</s>", "<unk>", "<mask>"}) {
      const int32_t id{Id(special)};
      if (id < 0) {
        return false;
      }
      std::wstring text;
      for (char const *c{special}; *c; ++c) {
        text += static_cast<wchar_t>(*c);
      }
      m_specials.push_back({std::move(text), id, std::string{special} == "<mask>"});
    }
    return m_bos >= 0 && m_eos >= 0 && m_unk >= 0;
  }

  // <s> tokens </s>, truncated to maxLength ids in total.
  std::vector<int64_t> Encode(std::wstring const &text, size_t maxLength = 256) const {
    std::vector<int64_t> ids{m_bos};
    auto push = [&](int32_t id) {
      if (ids.size() + 1 >= maxLength) {
        return false;
      }
      ids.push_back(id);
      return true;
    };
    bool room{true};
    // Added tokens are matched on the raw text first (leftmost; the five never share a prefix), and the text
    // between them is tokenized on its own.
    size_t segmentStart{0};
    size_t i{0};
    while (room && i < text.size()) {
      Special const *match{nullptr};
      for (auto const &special : m_specials) {
        if (text.compare(i, special.text.size(), special.text) == 0) {
          match = &special;
          break;
        }
      }
      if (!match) {
        ++i;
        continue;
      }
      size_t start{i};
      if (match->lstrip) {
        while (start > segmentStart && IsWhitespace(text[start - 1])) {
          --start;
        }
      }
      room = EncodeSegment(text.substr(segmentStart, start - segmentStart), push) && push(match->id);
      i += match->text.size();
      segmentStart = i;
    }
    if (room) {
      EncodeSegment(text.substr(segmentStart), push);
    }
    ids.push_back(m_eos);
    return ids;
  }

 private:
  struct Special {
    std::wstring text;
    int32_t id;
    bool lstrip;
  };
  std::unordered_map<std::string, int32_t> m_ids;
  std::vector<double> m_scores;
  std::vector<Special> m_specials;
  size_t m_maxPieceChars{0};
  double m_unkScore{0};
  int32_t m_bos{-1}, m_eos{-1}, m_unk{-1};

  int32_t Id(std::string const &piece) const {
    const auto it{m_ids.find(piece)};
    return it == m_ids.end() ? -1 : it->second;
  }

  static size_t Utf8Length(std::string const &s) {
    size_t n{0};
    for (unsigned char c : s) {
      n += (c & 0xC0) != 0x80;
    }
    return n;
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

  static void AppendUtf16(std::wstring &out, UChar32 c) {
    if (c >= 0x10000) {
      out += static_cast<wchar_t>(0xD800 + ((c - 0x10000) >> 10));
      out += static_cast<wchar_t>(0xDC00 + ((c - 0x10000) & 0x3FF));
    } else {
      out += static_cast<wchar_t>(c);
    }
  }

  // Lone surrogates become U+FFFD (Rust strings can't hold them), which the nmt rules turn into a space.
  static std::vector<UChar32> CodePoints(std::wstring const &s) {
    std::vector<UChar32> out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); ++i) {
      const wchar_t c{s[i]};
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.size() && s[i + 1] >= 0xDC00 && s[i + 1] <= 0xDFFF) {
        out.push_back(0x10000 + ((static_cast<UChar32>(c) - 0xD800) << 10) + (static_cast<UChar32>(s[i + 1]) - 0xDC00));
        ++i;
      } else {
        out.push_back(c >= 0xD800 && c <= 0xDFFF ? 0xFFFD : c);
      }
    }
    return out;
  }

  // Rust's char::is_whitespace (the Unicode White_Space property), used by WhitespaceSplit and <mask>'s lstrip.
  static bool IsWhitespace(UChar32 c) {
    return u_isUWhiteSpace(c);
  }

  // SentencePiece's nmt_nfkc, as the tokenizer's Precompiled charsmap holds it: NFKC plus these rules.
  // export_prompts.py checks the same tables (NMT_REMOVE / NMT_SPACE / NMT_KEEP there) against the charsmap.
  static bool NmtRemove(UChar32 c) {
    return (c >= 0x01 && c <= 0x08) || c == 0x0B || (c >= 0x0E && c <= 0x1F) || c == 0x7F || c == 0x8F || c == 0x9F;
  }
  static bool NmtSpace(UChar32 c) {
    return c == 0x09 || c == 0x0A || c == 0x0C || c == 0x0D || c == 0x1680 || (c >= 0x200B && c <= 0x200F) ||
           c == 0x2028 || c == 0x2029 || c == 0x2581 || c == 0xFEFF || c == 0xFFFD;
  }
  // Left as they are by the charsmap (newer than its Unicode tables, and U+FF5E FULLWIDTH TILDE).
  static bool NmtKeep(UChar32 c) {
    return c == 0x32FF || (c >= 0xA7F2 && c <= 0xA7F4) || c == 0xAB69 || c == 0xFF5E || (c >= 0x10781 && c <= 0x10785) ||
           (c >= 0x10787 && c <= 0x107B0) || (c >= 0x107B2 && c <= 0x107BA) || (c >= 0x1E030 && c <= 0x1E06D) ||
           c == 0x1F16C || c == 0x1F23B || (c >= 0x1FBF0 && c <= 0x1FBF9);
  }

  static std::wstring Normalized(NORM_FORM form, std::wstring const &s) {
    const int size{NormalizeString(form, s.c_str(), static_cast<int>(s.size()), nullptr, 0)};
    if (size <= 0) {
      return s;
    }
    std::wstring out(static_cast<size_t>(size), L'\0');
    const int written{NormalizeString(form, s.c_str(), static_cast<int>(s.size()), out.data(), size)};
    if (written <= 0) {
      return s;
    }
    out.resize(static_cast<size_t>(written));
    return out;
  }

  // The charsmap's entry for one code point, if it has one: nmt rules, else NFKC when that changes it.
  static bool MapOne(UChar32 c, std::wstring &mapped) {
    if (NmtRemove(c)) {
      mapped.clear();
      return true;
    }
    if (NmtSpace(c)) {
      mapped = L" ";
      return true;
    }
    if (c < 0x80 || NmtKeep(c)) {
      return false;
    }
    std::wstring one;
    AppendUtf16(one, c);
    mapped = Normalized(NormalizationKC, one);
    return mapped != one;
  }

  // Its multi-code-point keys are the sequences that NFKC composes into one code point X and whose code points,
  // each NFKC-mapped to a single one, spell NFD(X): "Ấ" (tone mark) and halfwidth jamo are keys,
  // "Ḹ" (already partly composed) is not. Checked against all 219,874 keys of the pinned charsmap.
  static bool MapSequence(std::wstring const &sequence, std::wstring &mapped) {
    mapped = Normalized(NormalizationKC, sequence);
    if (mapped == sequence || CodePoints(mapped).size() != 1) {
      return false;
    }
    std::wstring each;
    for (UChar32 c : CodePoints(sequence)) {
      std::wstring one;
      AppendUtf16(one, c);
      one = Normalized(NormalizationKC, one);
      if (CodePoints(one).size() != 1) {
        return false;
      }
      each += one;
    }
    return each == Normalized(NormalizationD, mapped);
  }

  static size_t Utf8Bytes(UChar32 c) {
    return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }

  // tokenizers' Precompiled normaliser, one grapheme at a time: a grapheme under 6 UTF-8 bytes is replaced whole
  // by the entry of its shortest prefix that has one (so U+FF4F U+031A -> "o", dropping the mark); otherwise,
  // or with no such prefix, each code point is mapped on its own.
  static void AppendGrapheme(std::wstring &out, std::wstring const &grapheme) {
    const auto cps{CodePoints(grapheme)};
    std::wstring mapped;
    size_t bytes{0};
    for (UChar32 c : cps) {
      bytes += Utf8Bytes(c);
    }
    if (bytes < 6) {
      std::wstring prefix;
      for (size_t i = 0; i < cps.size(); ++i) {
        AppendUtf16(prefix, cps[i]);
        if (i == 0 ? MapOne(cps[0], mapped) : MapSequence(prefix, mapped)) {
          out += mapped;
          return;
        }
      }
    }
    for (UChar32 c : cps) {
      if (MapOne(c, mapped)) {
        out += mapped;
      } else {
        AppendUtf16(out, c);
      }
    }
  }

  static std::vector<UChar32> Normalize(std::wstring const &text) {
    std::wstring clean;  // lone surrogates replaced
    for (UChar32 c : CodePoints(text)) {
      AppendUtf16(clean, c);
    }
    std::wstring out;
    UErrorCode status{U_ZERO_ERROR};
    UBreakIterator *graphemes{ubrk_open(
        UBRK_CHARACTER, "", reinterpret_cast<UChar const *>(clean.c_str()), static_cast<int32_t>(clean.size()), &status)};
    if (U_FAILURE(status) || !graphemes) {
      for (UChar32 c : CodePoints(clean)) {  // no break iterator: every code point its own grapheme
        std::wstring one;
        AppendUtf16(one, c);
        AppendGrapheme(out, one);
      }
      return CodePoints(out);
    }
    for (int32_t start{ubrk_first(graphemes)}, end{ubrk_next(graphemes)}; end != UBRK_DONE;
         start = end, end = ubrk_next(graphemes)) {
      AppendGrapheme(out, clean.substr(static_cast<size_t>(start), static_cast<size_t>(end - start)));
    }
    ubrk_close(graphemes);
    return CodePoints(out);
  }

  // Normalise, split on whitespace, then U+2581 + word through Viterbi. Returns false once the ids are full.
  template <typename Push>
  bool EncodeSegment(std::wstring const &segment, Push &push) const {
    std::vector<UChar32> word;
    auto flush = [&] {
      if (word.empty()) {
        return true;
      }
      std::string utf8;
      std::vector<size_t> bounds{0};  // byte offset of each code point, plus the end
      AppendUtf8(utf8, 0x2581);
      bounds.push_back(utf8.size());
      for (UChar32 c : word) {
        AppendUtf8(utf8, c);
        bounds.push_back(utf8.size());
      }
      word.clear();
      for (int32_t id : Viterbi(utf8, bounds)) {
        if (!push(id)) {
          return false;
        }
      }
      return true;
    };
    for (UChar32 c : Normalize(segment)) {
      if (IsWhitespace(c)) {
        if (!flush()) {
          return false;
        }
      } else {
        word.push_back(c);
      }
    }
    return flush();
  }

  // tokenizers' Unigram::encode_optimized: best path by summed piece score (ties keep the first found, scanning
  // starts left to right and lengths short to long); a code point no single piece covers becomes <unk>
  // (min score - 10), and adjacent <unk>s fuse into one.
  std::vector<int32_t> Viterbi(std::string const &utf8, std::vector<size_t> const &bounds) const {
    struct Node {
      double score{0};
      size_t start{0};
      int32_t id{-1};  // -1: not reached yet
    };
    const size_t n{bounds.size() - 1};
    std::vector<Node> best(n + 1);
    best[0].id = 0;
    for (size_t start = 0; start < n; ++start) {
      const double here{best[start].score};
      bool single{false};
      const size_t longest{(std::min)(n - start, m_maxPieceChars)};
      for (size_t len = 1; len <= longest; ++len) {
        const auto it{m_ids.find(utf8.substr(bounds[start], bounds[start + len] - bounds[start]))};
        if (it == m_ids.end()) {
          continue;
        }
        Node &target{best[start + len]};
        const double candidate{m_scores[static_cast<size_t>(it->second)] + here};
        if (target.id < 0 || candidate > target.score) {
          target = {candidate, start, it->second};
        }
        single = single || len == 1;
      }
      if (!single) {
        Node &target{best[start + 1]};
        const double candidate{m_unkScore + here};
        if (target.id < 0 || candidate > target.score) {
          target = {candidate, start, m_unk};
        }
      }
    }
    std::vector<std::string> pieces;
    std::string unk;  // fused <unk> run, built back to front
    for (size_t end = n; end > 0;) {
      Node const &node{best[end]};
      std::string piece{utf8.substr(bounds[node.start], bounds[end] - bounds[node.start])};
      if (node.id == m_unk) {
        unk.insert(0, piece);
      } else {
        if (!unk.empty()) {
          pieces.push_back(std::move(unk));
          unk.clear();
        }
        pieces.push_back(std::move(piece));
      }
      end = node.start;
    }
    if (!unk.empty()) {
      pieces.push_back(std::move(unk));
    }
    std::vector<int32_t> ids;
    ids.reserve(pieces.size());
    for (auto it = pieces.rbegin(); it != pieces.rend(); ++it) {
      const int32_t id{Id(*it)};
      ids.push_back(id >= 0 ? id : m_unk);
    }
    return ids;
  }
};

} // namespace LarpLess
