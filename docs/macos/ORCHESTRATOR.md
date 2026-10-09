# Orchestrator runbook

You are the only human at the keyboard. You run Phase 0 yourself (with one Claude Code session helping), then launch and merge the 4 agents.

Times assume the 2:20 start from [PLAN.md §9](PLAN.md).

---

## 1. Before the event (environment only, no app code)

- [ ] Toolchain on the demo Mac. Already verified: Xcode 27.0, CocoaPods 1.16.2, Node 26.10, watchman, Ollama 0.30.7.
- [ ] Start the Ollama app, then pull the models:

```bash
ollama pull qwen3-vl:4b
```

```bash
ollama pull qwen3-vl:8b
```

- [ ] Xcode → Settings → Accounts: sign in with an Apple ID so an **Apple Development** certificate exists (a personal team is fine).
- [ ] Download the **Inter** static TTFs (Regular, Medium, SemiBold) and **Instrument Serif** (Regular, Italic) into `~/fl-assets/fonts/`.
- [ ] Get the YOLO CoreML model into `~/fl-assets/`. Python 3.14 is too new for torch, so pin 3.12 with `uv`:

```bash
uvx --python 3.12 --from ultralytics yolo export model=yolo11n.pt format=coreml nms=True imgsz=640
```

  Fallback: download `YOLOv3TinyInt8LUT.mlmodel` from Apple's Core ML models page.
- [ ] Smoke-test react-native-macos on Xcode 27 in a throwaway folder (delete it afterwards). Note the exact versions that build:

```bash
npm view react-native-macos@0.81 version
```

- [ ] Take 10 bench screenshots for WS-C into `~/fl-assets/bench/`, named `<expected>__<desc>.png`:
  - `<expected>` is a module name or `notstudy`.
  - Examples: `biology__slides.png`, `maths__pdf.png`, `notstudy__instagram.png`, `biology__youtube_lecture.png`, `notstudy__youtube_music.png`.
  - Avoid personal data; they get deleted after the bench.
- [ ] Demo props: Biology slides PDF, a maths PDF, Instagram logged in on Safari, a phone.

## 2. Phase 0 (2:20–2:50)

Goal: a building app with every contract, mock, fixture and script in place, so 4 agents can start without touching shared files.

### 2a. Scaffold (≈ 6 min, you)

```bash
cd ~/Code/notion-hackathon/notion-hackathon
npx @react-native-community/cli@latest init Focusline --version <rn-0.81.x> --directory focusline --skip-git-init --install-pods false
cd focusline
npx react-native-macos-init --version <rnm-0.81.x>
npm i zustand @react-native-async-storage/async-storage date-fns
```

- Add these scripts to `package.json`: `"typecheck": "tsc --noEmit"`, plus the existing `"test": "jest"`.
- Exclude `scripts/` from `tsconfig.json`.
- Add to `.gitignore`: `bench/`, `.logs/`, `macos/build/`, `macos/Pods/`.

### 2b. In parallel: a Claude Code session in `focusline/` writes the TS skeleton (≈ 10 min)

Prompt it with this:

> Read /CLAUDE.md and docs/macos/CONTRACTS.md. In focusline/, create exactly the following, copying code blocks verbatim where CONTRACTS.md gives them:
> - src/contracts/{domain,native,store}.ts
> - src/config.ts
> - src/native/index.ts
> - the 7 real facades src/native/{screen,permissions,webcam,panel,notifications,sound,appShell}.ts, using the facade pattern
> - src/native/mock/{index,screen,permissions,webcam,panel,notifications,sound,appShell}.ts, with the behaviour in the mocks table
> - src/fixtures/data.ts and src/fixtures/apply.ts (§6)
> - src/store/sessionStore.ts and src/store/appStore.ts: zustand stores with the full state types, initial state, and actions that only console.log their name
> - src/dev/HarnessA.tsx and src/dev/HarnessB.tsx: placeholder components rendering "Harness A/B"
> - src/App.tsx: a simple tab bar with "Home (placeholder)", "Harness A" and "Harness B"
> - scripts/run-mac.sh and scripts/setup-worktree.sh as specified in docs/macos/ORCHESTRATOR.md §2d
>
> Then make `npm run typecheck` and `npm test` pass (add one trivial test in __tests__/core/smoke.test.ts). Don't add dependencies. Don't touch macos/.

### 2c. Meanwhile you, in Xcode (≈ 10 min)

1. Open `macos/Focusline.xcworkspace` and select the `Focusline-macOS` target.
2. **Signing:** your team, bundle id `com.focusline.app`, "Automatically manage signing". Turn off App Sandbox and Hardened Runtime if the template enabled them.
3. **Deployment target:** macOS 14.0. Swift Language Version: 5.
4. **Info.plist:** add `NSCameraUsageDescription` ("Focusline checks whether you're at your desk or on your phone. Frames are analysed on this Mac and never stored."), `NSAppTransportSecurity → NSAllowsLocalNetworking = YES`, `ATSApplicationFontsPath = Fonts`, `LSMinimumSystemVersion = 14.0`.
5. **Fonts:**
   - Copy the TTFs into `macos/Focusline-macOS/Fonts/`.
   - Add that folder to the target as a **folder reference** (blue folder) so it lands in `Contents/Resources/Fonts`.
   - Check the PostScript names with `mdls -name com_apple_ats_name_postscript <file>` and fix CONTRACTS.md §9 if they differ.
6. **Native folder:**
   - Create `macos/Focusline-macOS/Native/{Shared,Capture,Shell,Social}/` on disk, each with a `.gitkeep`.
   - In Xcode, add `Native` to the target. Xcode 16+ creates a **synchronized folder**; check that the icon is a folder, not a yellow group.
7. **Bridging header:** create `Native/Shared/Focusline-Bridging-Header.h` (contents in CONTRACTS.md §7). Set `SWIFT_OBJC_BRIDGING_HEADER = Focusline-macOS/Native/Shared/Focusline-Bridging-Header.h`.
8. **Ping module:** add `Native/Shared/FLPing.swift` and `FLPing.m` from CONTRACTS.md §7.
9. **AppDelegate:**
   - Main window 1100×720, minimum 900×600, title "Focusline".
   - `applicationShouldTerminateAfterLastWindowClosed` returns `NO`, so the panel keeps running.
   - Reopening from the Dock shows the main window.
10. **YOLO model:** copy it into `Native/Capture/Models/`. It's a `.mlpackage` (or `.mlmodel`); Xcode compiles it automatically.
11. Run `cd macos && pod install`.

### 2d. The scripts the 2b session writes

`scripts/run-mac.sh`:

```bash
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
```

`scripts/setup-worktree.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
cd "$(cd "$(dirname "$0")/.." && pwd)"
npm ci
(cd macos && pod install)
```

### 2e. Verify, commit, branch (≈ 4 min)

- [ ] `npm run typecheck` and `npm test` are green.
- [ ] `scripts/run-mac.sh 8081`: the app opens with the dev tabs.
- [ ] Add a temporary button in the Home placeholder that calls `NativeModules.FLPing.ping()` and listens for `FLPingEvent`. Confirm "pong" and the event both arrive, then remove the button.
  - If events fail under the New Architecture: `cd macos && RCT_NEW_ARCH_ENABLED=0 pod install` and rebuild. Record this in PLAN.md §2.
- [ ] `scripts/run-mac.sh 8082` while 8081 is still running: a second instance loads from 8082. If not, tell WS-A and WS-B to use build-only (see their briefs).
- [ ] Granting Screen Recording once now (System Settings) saves time later.

Commit and tag, then create the worktrees:

```bash
cd ~/Code/notion-hackathon/notion-hackathon && git add -A && git commit -m "Phase 0: scaffold, contracts, mocks, fixtures, FLPing" && git tag p0
```

```bash
for ws in a-native-capture b-native-shell c-core d-ui; do git worktree add "../fl-${ws%%-*}" -b "ws/$ws" p0; done
```

```bash
for d in ../fl-a ../fl-b ../fl-c ../fl-d; do (cd "$d/focusline" && scripts/setup-worktree.sh) & done; wait
```

**Shortcut if Phase 0 overruns:** WS-C only needs the TS skeleton and Jest. Commit as soon as 2b is green, tag `p0a`, create `../fl-c` from `p0a` and launch WS-C first. Start the others from `p0` once the native checks pass.

## 3. Launching agents

Open one Claude Code session per worktree (`cd ../fl-a && claude`, etc.) and paste the prompt below, swapping in X and the brief file:

> You are agent **WS-X** working in this git worktree (branch `ws/...`). Read, in order: `CLAUDE.md`, `docs/macos/PLAN.md`, `docs/macos/CONTRACTS.md`, `docs/macos/agents/WS-X-....md`.
>
> Work through your brief's tasks **in order**:
> - Edit only the paths your brief says you own.
> - Commit after each task as `WS-X: <task>`.
> - Keep `docs/macos/status/WS-X.md` up to date after every task: done, deviations, requests, dependencies needed.
>
> Never change contracts, package.json, Podfile, Info.plist or pbxproj. If one of them blocks you, write a request in your status file and work around it with a mock.
>
> Use Metro port `<port>` (`scripts/run-mac.sh <port>`).
>
> Stop and report when your Sprint 1 checklist passes (at checkpoint time), when you're blocked, or when you finish everything.

**Ports:**

| Agent | Port |
|---|---|
| WS-D | 8081 |
| WS-A | 8082 |
| WS-B | 8083 |
| WS-C | none (Jest only) |

**Optional ownership guard.** In each worktree, add `.claude/settings.local.json` (it stays uncommitted):

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit", "hooks": [ { "type": "command", "command": "focusline/scripts/guard-ownership.sh WS-A" } ] } ] } }
```

`focusline/scripts/guard-ownership.sh`:

```bash
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
```

## 4. Checkpoints

### Checkpoint 1 (3:30)

1. Read the four `docs/macos/status/WS-*.md` files in each worktree: requests and dependencies.
2. Merge, native first because those paths don't overlap with anyone else's:

```bash
git checkout main && for b in a-native-capture b-native-shell c-core d-ui; do git merge --no-ff "ws/$b" -m "Merge ws/$b (cp1)" || break; done
```

3. Verify from `focusline/`: `npm run typecheck && npm test && scripts/run-mac.sh 8081`.
4. Apply any approved contract or dependency requests on `main`, commit, then run `git tag cp1`.
5. Tell each agent: "Checkpoint 1 merged. Run `git merge main`, resolve conflicts only in files you own, re-run your checks, then continue with Sprint 2."

### Checkpoint 2 (4:00, lunch): first real end-to-end session

1. Merge as in checkpoint 1, then `git tag cp2`.
2. In `src/config.ts` set `USE_MOCK_NATIVE: false` and `USE_MOCK_CLASSIFIER: false`. Commit.
3. Warm the model: `ollama run qwen3-vl:4b "hi"` (or 8b if WS-C's bench chose it). Set `Settings.model` to match.
4. Run the PLAN.md §12 demo script. Log every bug in a short list.
5. Assign the bugs to the owning agents. Cross-cutting wiring goes to WS-C plus you.

### Integration (4:20–5:15)

- Merge every 20 minutes (`cp3`, `cp4`, …) using the same procedure.
- If E2E is green by 4:40, give `agents/WS-E-social-phase2.md` to the first agent that's idle.
- Hold the cut order in PLAN.md §10 strictly. At 5:00, cut anything that isn't working.

### Freeze (5:25)

Merge the last time, tag `demo`, and build once from a clean `macos/build`.

**Demo Mac checklist:**
- [ ] Focus/Do Not Disturb off, so notifications show.
- [ ] Ollama running with the model warm.
- [ ] Screen Recording and Camera granted.
- [ ] `demoFast` on.
- [ ] You know where the demoMode toggle is (⌥-click Start).
