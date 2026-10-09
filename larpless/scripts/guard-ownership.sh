#!/usr/bin/env bash
# Blocks Edit/Write outside the calling workstream's owned paths. Reads the PreToolUse JSON from stdin.
ws="$1"
file=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))')
root=$(git rev-parse --show-toplevel)
rel="${file#"$root"/}"
N='larpless/macos/Focusline-macOS/Native'
case "$ws" in
  WS-A) re="^($N/Capture/|larpless/src/native/(screen|webcam|permissions)\.ts$|larpless/src/dev/HarnessA\.tsx$|docs/macos/status/WS-A\.md$)";;
  WS-B) re="^($N/Shell/|larpless/src/native/(panel|notifications|sound|appShell)\.ts$|larpless/src/dev/HarnessB\.tsx$|docs/macos/status/WS-B\.md$)";;
  WS-C) re="^(larpless/src/core/|larpless/src/store/(sessionStore|appStore)\.ts$|larpless/__tests__/core/|larpless/scripts/bench-classifier\.ts$|docs/macos/status/WS-C\.md$)";;
  WS-D) re="^(larpless/src/ui/|larpless/src/App\.tsx$|larpless/src/store/navStore\.ts$|larpless/__tests__/ui/|docs/macos/status/WS-D\.md$)";;
  *) exit 0;;
esac
[[ "$rel" =~ $re ]] && exit 0
echo "Blocked: $rel is not owned by $ws. Write a request in docs/macos/status/$ws.md instead." >&2
exit 2
