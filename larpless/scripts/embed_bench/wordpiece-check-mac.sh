#!/usr/bin/env bash
# Checks the Swift tokenizer (macos/.../ScreenModel/FLScreenModelWordPiece.swift) against wordpiece_cases.json,
# the token ids Hugging Face's tokenizer gives for fixed sample strings (never user text).
# Usage, from larpless/: scripts/embed_bench/wordpiece-check-mac.sh <path to minilm-vocab.txt>
# (the downloaded copy is in ~/Library/Application Support/com.larpless.app/Models).
set -euo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)"
vocab="${1:-$HOME/Library/Application Support/com.larpless.app/Models/minilm-vocab.txt}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cat > "$work/main.swift" <<'SWIFT'
import Foundation

let args = CommandLine.arguments
guard let tokenizer = FLScreenModelWordPiece(contentsOf: URL(fileURLWithPath: args[1])) else {
  print("cannot read the vocabulary at \(args[1])")
  exit(2)
}
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
print("wordpiece \(same)/\(cases.count) identical")
exit(same == cases.count ? 0 : 1)
SWIFT
swiftc -O -o "$work/check" macos/Focusline-macOS/Native/ScreenModel/FLScreenModelWordPiece.swift "$work/main.swift"
"$work/check" "$vocab" scripts/embed_bench/wordpiece_cases.json
