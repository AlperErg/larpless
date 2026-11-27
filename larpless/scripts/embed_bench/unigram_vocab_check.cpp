// Checks FLUnigramVocab.h (the app's unigram.json -> minilm-ml-vocab.txt conversion) on its own: a few fixed
// edge cases, then converts the pinned unigram.json given on the command line and writes the result, whose SHA-256
// unigram-vocab-check.sh compares with the pin. Build and run through that script.
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "../../windows/LarpLess/Native/FLUnigramVocab.h"

using LarpLess::UnigramVocabJson;

static int failures = 0;

static void Expect(char const *name, std::string const &json, bool ok, std::string const &want = {}) {
  std::string out;
  const bool got{UnigramVocabJson::Convert(json, out)};
  if (got != ok || (ok && out != want)) {
    std::fprintf(stderr, "FAIL %s\n", name);
    ++failures;
  }
}

int main(int argc, char **argv) {
  if (argc != 3) {
    std::fprintf(stderr, "usage: unigram_vocab_check <unigram.json> <out.txt>\n");
    return 2;
  }
  // ▁ is the Metaspace marker; 😀 a surrogate pair (U+1F600).
  Expect("basic", R"({"type":"Unigram","unk_id":3,"vocab":[["<s>",0.0],["▁a\"b\\c",-1.5e-05]]})", true,
         "<s>\t0.0\n\xE2\x96\x81" "a\"b\\c\t-1.5e-05\n");
  Expect("other keys skipped", R"({"x":{"y":[1,true,null,"z"]},"vocab":[["😀",-3]],"byte_fallback":false})",
         true, "\xF0\x9F\x98\x80\t-3\n");
  Expect("whitespace", " {\n \"vocab\" : [ [ \"a\" , -2.25 ] ]\n} \n", true, "a\t-2.25\n");
  Expect("no vocab", R"({"type":"Unigram"})", false);
  Expect("empty vocab", R"({"vocab":[]})", false);
  Expect("two vocabs", R"({"vocab":[["a",1]],"vocab":[["b",1]]})", false);
  Expect("empty piece", R"({"vocab":[["",0]]})", false);
  Expect("tab in piece", R"({"vocab":[["a\tb",0]]})", false);
  Expect("newline in piece", R"({"vocab":[["a\nb",0]]})", false);
  Expect("lone surrogate", R"({"vocab":[["\ud83d",0]]})", false);
  Expect("bad number", R"({"vocab":[["a",-]]})", false);
  Expect("leading zero", R"({"vocab":[["a",01]]})", false);
  Expect("raw control char", "{\"vocab\":[[\"a\x01\",0]]}", false);
  Expect("truncated", R"({"vocab":[["a",0])", false);
  Expect("trailing data", R"({"vocab":[["a",0]]} x)", false);
  Expect("trailing comma", R"({"vocab":[["a",0],]})", false);

  std::ifstream in{argv[1], std::ios::binary};
  if (!in) {
    std::fprintf(stderr, "cannot read %s\n", argv[1]);
    return 2;
  }
  std::stringstream buffer;
  buffer << in.rdbuf();
  std::string out;
  if (!UnigramVocabJson::Convert(buffer.str(), out)) {
    std::fprintf(stderr, "FAIL %s did not convert\n", argv[1]);
    return 1;
  }
  size_t lines{0};
  for (char c : out) {
    lines += c == '\n';
  }
  std::ofstream file{argv[2], std::ios::binary | std::ios::trunc};
  file.write(out.data(), static_cast<std::streamsize>(out.size()));
  if (!file) {
    std::fprintf(stderr, "cannot write %s\n", argv[2]);
    return 2;
  }
  std::printf("edge cases: %d failed\nconverted: %zu pieces, %zu bytes\n", failures, lines, out.size());
  return failures ? 1 : 0;
}
