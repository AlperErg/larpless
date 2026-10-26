#!/usr/bin/env bash
# usage: scripts/fresh-run-mac.sh [port]  — clean-build.sh, then setup-worktree.sh, then run-mac.sh [port]
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
"$DIR/clean-build.sh"
"$DIR/setup-worktree.sh"
"$DIR/run-mac.sh" "$@"
