#!/usr/bin/env bash
# usage: scripts/run-mac.sh [port]  — Metro on <port>, Debug build with that port baked in, launch a new instance
set -euo pipefail
PORT="${1:-8081}"
cd "$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p .logs
if ! lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  npx react-native start --port "$PORT" > ".logs/metro-$PORT.log" 2>&1 &
fi
# The project signs ad-hoc. Optional gitignored macos/signing.local (CODE_SIGN_IDENTITY=…, DEVELOPMENT_TEAM=…)
# signs with a stable identity instead, so Screen Recording / Camera grants survive rebuilds.
SIGNING=()
if [[ -f macos/signing.local ]]; then
  # shellcheck disable=SC1091
  source macos/signing.local
  SIGNING=(CODE_SIGN_IDENTITY="${CODE_SIGN_IDENTITY:?set in macos/signing.local}" DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-}")
fi
xcodebuild -workspace macos/Focusline.xcworkspace -scheme Focusline-macOS -configuration Debug \
  -derivedDataPath macos/build ${SIGNING[@]+"${SIGNING[@]}"} \
  GCC_PREPROCESSOR_DEFINITIONS='$(inherited) RCT_METRO_PORT='"$PORT" build | tail -n 25
APP="$(find macos/build/Build/Products/Debug -maxdepth 1 -name '*.app' | head -1)"
open -n "$APP"
