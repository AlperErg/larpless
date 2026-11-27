#!/usr/bin/env bash
# Checks the Swift tokenizer (macos/.../ScreenModel/FLScreenModelUnigram.swift) against unigram_cases.json, the
# token ids Hugging Face's tokenizer gives for fixed sample strings (never user text). Must print
# "unigram 22/22 identical", like unigram-check-windows.ps1 for the C++ one.
# Usage, from larpless/: scripts/embed_bench/unigram-check-mac.sh [minilm-ml-vocab.txt] [cases.json]
# The vocabulary defaults to the app's converted copy in ~/Library/Application Support/com.larpless.app/Models,
# else scripts/embed_bench/minilm-ml-vocab.txt (export_prompts.py). Add --bench to time loading and a long page.
set -euo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)"
bench=0
if [[ "${1:-}" == "--bench" ]]; then bench=1; shift; fi
vocab="${1:-$HOME/Library/Application Support/com.larpless.app/Models/minilm-ml-vocab.txt}"
[[ -f "$vocab" || -n "${1:-}" ]] || vocab=scripts/embed_bench/minilm-ml-vocab.txt
cases="${2:-scripts/embed_bench/unigram_cases.json}"
[[ -f "$vocab" ]] || { echo "no vocabulary at $vocab (download the model in the app, or run export_prompts.py)" >&2; exit 2; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cat > "$work/main.swift" <<'SWIFT'
import Foundation

let args = CommandLine.arguments
var t0 = Date()
guard let tokenizer = FLScreenModelUnigram(contentsOf: URL(fileURLWithPath: args[1])) else {
  print("cannot read the vocabulary at \(args[1])")
  exit(2)
}
let loadMs = Date().timeIntervalSince(t0) * 1000
let data = try Data(contentsOf: URL(fileURLWithPath: args[2]))
let cases = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
var same = 0
for (i, c) in cases.enumerated() {
  let want = (c["ids"] as! [NSNumber]).map(\.int64Value)
  let got = tokenizer.encode(c["text"] as! String)
  if got == want {
    same += 1
  } else {
    print("case \(i): got \(got), want \(want)")
  }
}
print("unigram \(same)/\(cases.count) identical")
if args[3] == "1" {
  // A generated 1,500-character page (fixed text, never a screen).
  let page = String(repeating: "Ecuaciones diferenciales: método de separación de variables, ejemplo 3. ", count: 21)
  t0 = Date()
  for _ in 0..<100 { _ = tokenizer.encode(page) }
  print(String(format: "load %.0f ms, encode %.2f ms per %d-character page", loadMs, Date().timeIntervalSince(t0) * 10, page.count))
}
exit(same == cases.count ? 0 : 1)
SWIFT
swiftc -O -o "$work/check" macos/Focusline-macOS/Native/ScreenModel/FLScreenModelUnigram.swift "$work/main.swift"
"$work/check" "$vocab" "$cases" "$bench"
