#!/usr/bin/env bash
# usage: scripts/run-mac.sh [port]  — Metro on <port>, Debug build with that port baked in, launch a new instance
set -euo pipefail
PORT="${1:-8081}"
cd "$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p .logs
if ! lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  npx react-native start --port "$PORT" > ".logs/metro-$PORT.log" 2>&1 &
fi
xcodebuild -workspace macos/Focusline.xcworkspace -scheme Focusline-macOS -configuration Debug \
  -derivedDataPath macos/build \
  GCC_PREPROCESSOR_DEFINITIONS='$(inherited) RCT_METRO_PORT='"$PORT" build | tail -n 25
APP="$(find macos/build/Build/Products/Debug -maxdepth 1 -name '*.app' | head -1)"
open -n "$APP"
