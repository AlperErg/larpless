#!/usr/bin/env bash
# Checks the app's unigram.json -> minilm-ml-vocab.txt conversion (windows/LarpLess/Native/FLUnigramVocab.h) on
# macOS or Linux: downloads the pinned unigram.json (or takes a local copy), checks its SHA-256, builds
# unigram_vocab_check.cpp with the header on its own, and compares the converted vocabulary with the SHA-256
# FLScreenModel.h pins (kVocabSha256 = ML_VOCAB_SHA256 in export_prompts.py). Must print "vocab OK".
#   scripts/embed_bench/unigram-vocab-check.sh [path/to/unigram.json]
# Run from larpless/. Model data only; writes nothing outside a temp folder.
set -euo pipefail

URL="https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/2c4055b12046f11709e9df2c122e59ffbdc2f900/unigram.json"
JSON_SHA="71b44701d7efd054205115acfa6ef126c5d2f84bd3affe0c59e48163674d19a6"
VOCAB_SHA="62fce312d72594ad30235447483680a6d1bbce5d7e219bbe29a241539e449f92"

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

json="${1:-}"
if [[ -z "$json" ]]; then
  json="$tmp/unigram.json"
  curl -fsSL "$URL" -o "$json"
fi
[[ "$(sha "$json")" == "$JSON_SHA" ]] || { echo "unigram.json: SHA-256 $(sha "$json"), expected $JSON_SHA" >&2; exit 1; }

"${CXX:-c++}" -std=c++17 -O2 -Wall -Wextra -Wpedantic -Werror -o "$tmp/check" "$here/unigram_vocab_check.cpp"
"$tmp/check" "$json" "$tmp/minilm-ml-vocab.txt"
got="$(sha "$tmp/minilm-ml-vocab.txt")"
[[ "$got" == "$VOCAB_SHA" ]] || { echo "vocab SHA-256 $got, expected $VOCAB_SHA" >&2; exit 1; }
echo "vocab OK"
