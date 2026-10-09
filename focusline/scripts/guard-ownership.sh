#!/usr/bin/env bash
# Blocks Edit/Write outside the calling workstream's owned paths. Reads the PreToolUse JSON from stdin.
ws="$1"
file=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))')
root=$(git rev-parse --show-toplevel)
rel="${file#"$root"/}"
N='focusline/macos/Focusline-macOS/Native'
case "$ws" in
  WS-A) re="^($N/Capture/|focusline/src/native/(screen|webcam|permissions)\.ts$|focusline/src/dev/HarnessA\.tsx$|docs/macos/status/WS-A\.md$)";;
  WS-B) re="^($N/Shell/|focusline/src/native/(panel|notifications|sound|appShell)\.ts$|focusline/src/dev/HarnessB\.tsx$|docs/macos/status/WS-B\.md$)";;
  WS-C) re="^(focusline/src/core/|focusline/src/store/(sessionStore|appStore)\.ts$|focusline/__tests__/core/|focusline/scripts/bench-classifier\.ts$|docs/macos/status/WS-C\.md$)";;
  WS-D) re="^(focusline/src/ui/|focusline/src/App\.tsx$|focusline/src/store/navStore\.ts$|focusline/__tests__/ui/|docs/macos/status/WS-D\.md$)";;
  *) exit 0;;
esac
[[ "$rel" =~ $re ]] && exit 0
echo "Blocked: $rel is not owned by $ws. Write a request in docs/macos/status/$ws.md instead." >&2
exit 2
