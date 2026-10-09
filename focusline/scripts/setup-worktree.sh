#!/usr/bin/env bash
set -euo pipefail
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
cd "$(cd "$(dirname "$0")/.." && pwd)"
npm ci
(cd macos && pod install)
