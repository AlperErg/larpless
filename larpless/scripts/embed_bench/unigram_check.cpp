// Parity check for windows/LarpLess/Native/FLUnigram.h: encodes every case in unigram_cases.json (fixed sample
// strings, never user text) and compares with the ids Hugging Face's tokenizer gave. Built and run by
// unigram-check-windows.ps1; prints "unigram N/M identical" and exits 0 only when all match.
// The cases file is ASCII JSON (export_prompts.py writes it with ensure_ascii), so \uXXXX escapes decode
// straight to UTF-16.
#include "FLUnigram.h"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace {

struct Case {
  std::wstring text;
  std::vector<int64_t> ids;
};

class Parser {
 public:
  explicit Parser(std::string s) : m_s{std::move(s)} {}

  std::vector<Case> Cases() {
    std::vector<Case> out;
    Expect('[');
    if (Peek() == ']') {
      ++m_i;
      return out;
    }
    do {
      out.push_back(OneCase());
    } while (Next() == ',');
    Back();
    Expect(']');
    return out;
  }

 private:
  std::string m_s;
  size_t m_i{0};

  [[noreturn]] void Fail(char const *what) {
    std::fprintf(stderr, "bad unigram_cases.json at byte %zu: %s\n", m_i, what);
    std::exit(2);
  }
  void Skip() {
    while (m_i < m_s.size() && (m_s[m_i] == ' ' || m_s[m_i] == '\n' || m_s[m_i] == '\r' || m_s[m_i] == '\t')) {
      ++m_i;
    }
  }
  char Peek() {
    Skip();
    return m_i < m_s.size() ? m_s[m_i] : '\0';
  }
  char Next() {
    const char c{Peek()};
    ++m_i;
    return c;
  }
  void Back() {
    --m_i;
  }
  void Expect(char c) {
    if (Next() != c) {
      Fail("unexpected character");
    }
  }

  std::wstring String() {
    Expect('"');
    std::wstring out;
    while (m_i < m_s.size() && m_s[m_i] != '"') {
      char c{m_s[m_i++]};
      if (c != '\\') {
        out += static_cast<wchar_t>(static_cast<unsigned char>(c));
        continue;
      }
      c = m_s[m_i++];
      switch (c) {
        case 'n': out += L'\n'; break;
        case 'r': out += L'\r'; break;
        case 't': out += L'\t'; break;
        case 'b': out += L'\b'; break;
        case 'f': out += L'\f'; break;
        case 'u': out += static_cast<wchar_t>(std::stoul(m_s.substr(m_i, 4), nullptr, 16)); m_i += 4; break;
        default: out += static_cast<wchar_t>(c); break;  // " \ /
      }
    }
    ++m_i;
    return out;
  }

  std::vector<int64_t> Ids() {
    std::vector<int64_t> out;
    Expect('[');
    if (Peek() == ']') {
      ++m_i;
      return out;
    }
    do {
      Skip();
      size_t used{0};
      out.push_back(std::stoll(m_s.substr(m_i, 24), &used));
      m_i += used;
    } while (Next() == ',');
    Back();
    Expect(']');
    return out;
  }

  Case OneCase() {
    Case c;
    Expect('{');
    do {
      const std::wstring key{String()};
      Expect(':');
      if (key == L"text") {
        c.text = String();
      } else if (key == L"ids") {
        c.ids = Ids();
      } else {
        Fail("unknown key");
      }
    } while (Next() == ',');
    Back();
    Expect('}');
    return c;
  }
};

std::string Join(std::vector<int64_t> const &ids) {
  std::string out{"["};
  for (size_t i = 0; i < ids.size(); ++i) {
    out += (i ? ", " : "") + std::to_string(ids[i]);
  }
  return out + "]";
}

} // namespace

int wmain(int argc, wchar_t **argv) {
  if (argc < 3) {
    std::fprintf(stderr, "usage: unigram_check <minilm-ml-vocab.txt> <unigram_cases.json>\n");
    return 2;
  }
  LarpLess::Unigram tokenizer;
  if (!tokenizer.Load(argv[1])) {
    std::fwprintf(stderr, L"cannot read the vocabulary at %ls\n", argv[1]);
    return 2;
  }
  std::ifstream file{argv[2], std::ios::binary};
  if (!file) {
    std::fwprintf(stderr, L"cannot read %ls\n", argv[2]);
    return 2;
  }
  std::stringstream buffer;
  buffer << file.rdbuf();
  const auto cases{Parser{buffer.str()}.Cases()};
  size_t same{0};
  for (size_t i = 0; i < cases.size(); ++i) {
    const auto got{tokenizer.Encode(cases[i].text)};
    if (got == cases[i].ids) {
      ++same;
    } else {
      std::printf("case %zu: got %s, want %s\n", i, Join(got).c_str(), Join(cases[i].ids).c_str());
    }
  }
  std::printf("unigram %zu/%zu identical\n", same, cases.size());
  return same == cases.size() ? 0 : 1;
}
