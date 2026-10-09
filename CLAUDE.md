# Focusline (macOS, React Native): rules for every agent

Focusline is a "Strava for studying" Mac app built with **react-native-macos**. It classifies your screen and webcam **on the device**, shows a floating timer, and reports study time per subject.

Read these before doing anything:

1. `docs/macos/PLAN.md`: architecture, stack, runtime loop, timeline
2. `docs/macos/CONTRACTS.md`: frozen types, native module APIs, store shape, tokens
3. Your brief: `docs/macos/agents/WS-*.md` (only the one you were assigned)

`plan.md` at the repo root is the original **product spec**, written for a web app. Its product behaviour still applies. Its web-specific tech (Vite, getDisplayMedia, MediaPipe, PiP, Dexie, Tailwind) is replaced by `docs/macos/PLAN.md`.

## Privacy invariants (never break these)

- Screen and webcam frames live **in memory only**. Never write them to disk, AsyncStorage, temp files, the network (except `127.0.0.1:11434` Ollama), or logs.
- Never `console.log` / `print` / `NSLog` a `ScreenSnapshot`, a `jpegBase64` string, a pixel buffer, or a `CGImage`. Log sizes and timings only.
- Drop references straight after use. In JS, null out variables in `finally`. In Swift, don't retain `CVPixelBuffer` or `CGImage` beyond the call.
- Persist **labels only** (see the `Chunk` type). Window titles are never persisted.
- `privacy.framesStored` is the constant `0`. Keep it true.
- During Pomodoro breaks and while away, nothing is captured.

## Ownership (parallel agents in git worktrees)

- Edit **only** the paths your brief says you own. If you need a change elsewhere, write it under "Requests" in `docs/macos/status/WS-X.md` and continue with a local workaround or mock.
- Only the orchestrator may change:
  - `src/contracts/**`, `src/config.ts`, `src/native/index.ts`, `src/native/mock/**`, `src/fixtures/**`
  - `package.json`, lockfile, `Podfile`, `Info.plist`, `*.pbxproj`, `AppDelegate*`
  - `CLAUDE.md`, `docs/macos/{PLAN,CONTRACTS,ORCHESTRATOR}.md`
- **No new npm packages, pods or entitlements.** List what you need in your status file.
- Commit after every finished task, with small commits: `WS-X: <what>`. Never rewrite history, force-push or merge other workstream branches. The orchestrator merges `main` into your branch at checkpoints.

## Architecture rules

- Layers: `ui → store → core → native facades → Swift`. Dependencies only point downward.
- `src/core/**` is pure TypeScript. No `react-native` imports, and no direct AsyncStorage (inject a key-value store). Core must be testable with Jest and fake timers.
- JS talks to Swift **only** through the typed facades in `src/native/*.ts`. The UI uses facades only for onboarding permissions and menu commands; everything session-related goes through store actions.
- Styling: `StyleSheet` plus tokens from `src/ui/theme.ts`. No hex colours anywhere else in TS.
- Animation: core `Animated` only.
- Banned (unclear macOS support): react-navigation, NativeWind/Tailwind, reanimated, react-native-svg/lucide, expo-*.
- Native modules follow the pattern in CONTRACTS.md: Swift class `@objc(FLName)`, an `RCT_EXTERN_MODULE` `.m` file next to it, events only via `RCTEventEmitter` and only when there are listeners.

## Swift conventions

- Swift 5 language mode, macOS 14.0 deployment target. Do UI and AppKit work on the main thread (`DispatchQueue.main`), and capture and vision work on private serial queues.
- Native code lives in `focusline/macos/Focusline-macOS/Native/{Shared,Capture,Shell,Social}/`. This is an Xcode **synchronized folder**: just add files there and never edit `project.pbxproj`.
- Promise rejections use codes `E_PERMISSION`, `E_CAPTURE`, `E_CAMERA`, `E_NOT_RUNNING`, `E_INVALID_ARG`.

## Commands (run from `focusline/`)

```bash
npm run typecheck
```

```bash
npm test
```

```bash
scripts/run-mac.sh 8081
```

```bash
xcodebuild -workspace macos/Focusline.xcworkspace -scheme Focusline-macOS -configuration Debug build
```

- Metro ports: WS-D uses 8081, WS-A uses 8082, WS-B uses 8083. WS-C only needs Jest.
- `src/config.ts` → `USE_MOCK_NATIVE` / `USE_MOCK_CLASSIFIER` switch between mocks and the real Swift modules and Ollama.

## Definition of done for any task

The typecheck passes, the tests pass, the app builds (if you touched native or UI code), your acceptance checklist item is ticked in `docs/macos/status/WS-X.md`, and the work is committed.
