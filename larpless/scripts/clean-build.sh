#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

pkill -f 'LarpLess.app/Contents/MacOS/LarpLess' >/dev/null 2>&1 || true
rm -rf "$ROOT/macos/build"

DERIVED_DATA="$HOME/Library/Developer/Xcode/DerivedData"
if [[ -d "$DERIVED_DATA" ]]; then
  find "$DERIVED_DATA" -maxdepth 1 -type d -name 'Focusline-*' -exec rm -rf {} +
fi

printf 'Removed previous LarpLess build products.\n'