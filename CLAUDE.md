# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

LarpLess is a native macOS study tracker built with **react-native-macos** (RN 0.81, Fabric + bridgeless, Hermes). It classifies screen and webcam on-device every 10 s chunk and summarizes the session. All code lives in `larpless/`; the repo root only holds the README, `brand/` and `docs/images/`. The project was originally called **Focusline**, which is why the Xcode workspace/scheme are `Focusline*`, native types are prefixed `FL`, and AsyncStorage keys start with `fl:`. The built product is `LarpLess.app`.

## Commands

Run from `larpless/`:

```bash
npm test                                   # all Jest suites (__tests__/core, social, ui)
npx jest __tests__/core/classifier.test.ts # one file
npx jest -t "relabel"                      # tests matching a name
npm run typecheck                          # tsc --noEmit
npm run lint                               # eslint (@react-native config)
scripts/setup-worktree.sh                  # npm ci + pod install (sets the UTF-8 locale CocoaPods needs)
scripts/run-mac.sh 8081                    # Metro on 8081 + Debug build with that port baked in + launch
xcodebuild -workspace macos/Focusline.xcworkspace -scheme Focusline-macOS -configuration Debug build
```

- `run-mac.sh` opens a **new** app instance each time; quit the old one first: `pkill -f "$PWD/macos/build/Build/Products/Debug/LarpLess.app"`. Metro logs go to `.logs/metro-<port>.log`. An optional gitignored `macos/signing.local` (`CODE_SIGN_IDENTITY`, `DEVELOPMENT_TEAM`) gives a stable signature so Screen Recording/Camera grants survive rebuilds; otherwise it signs ad-hoc. Release is set up for distribution: `Developer ID Application` (team `P74N9B6V54`), hardened runtime, and `Focusline-macOS/LarpLess.entitlements` (camera; the hardened runtime blocks the webcam without it). Versions come from `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`. ATS allows only local networking (Ollama); everything else must be HTTPS.
- `src/social/env.ts` is gitignored but **imported unconditionally**, so it must exist for the build/typecheck to work (`export const SUPABASE_URL = ''; export const SUPABASE_ANON_KEY = '';` runs fully local). Schema: `supabase/schema.sql`.
- Runtime needs Ollama on `127.0.0.1:11434` with `qwen3-vl:2b`. Tests never need it. Onboarding links the installer and pulls the model (`/api/pull`, streamed through XHR). Ollama ≥ 0.30's llama-server keeps up to 8 GB of prompt cache in RAM; only `LLAMA_ARG_CACHE_RAM=0` at launch turns it off, so LarpLess opens Ollama.app with it and, at app launch and session start, restarts an Ollama.app running without it when no other model is loaded (`core/ollamaHost.ts`). Ollama.app ignores the quit Apple Event; the restart uses SIGTERM on its pid.

### Driving the running app (dev builds)

- `node scripts/js-eval.mjs 8081 "<expr>"` evaluates JS in the app via Metro's inspector (promises awaited, JSON printed). `globalThis.__FL` (`src/dev/devGlobals.ts`) exposes `native`, `config`, the stores, `applyFixture`, `harness.A()/B()` (native test harnesses from `src/dev/Harness*.tsx`), `pingRoundTrip()`, and `__FL.ui.text/measure/overflow` for reading the rendered UI (`src/ui/dev/introspect.ts`).
- `node scripts/js-eval.mjs 8081 --console 20` streams the JS console (RN 0.81 no longer prints it in Metro).
- Native logs: `log show --last 5m --style compact --predicate 'subsystem == "com.larpless.app"'`.
- Demo mode (no Ollama/camera): ⌥-click Start, or ⌘K → "Start demo session"; replays `fixtureChunks` through the real controller and panel.
- `node scripts/bench-classifier.ts --model qwen3-vl:2b` scores the VLM prompt against `bench/<expected>__<desc>.png`.

## Architecture

Layering is strict: **`ui` → `store` → `core` → `native` facades → Swift**.

- **`src/contracts/`** holds the shared types: `domain.ts` (Chunk, Settings, SessionSummary…), `native.ts` (the `NativeApis` interface every Swift module implements, including event names), `store.ts` (store state/actions). Change a contract first, then both sides.
- **`src/core/`** is pure TypeScript with injected dependencies and no imports of React Native, AsyncStorage or the stores. Time comes from an injected `now()`. This is what lets the whole session loop run under Jest with fake timers.
  - `sessionController.ts` is the runtime loop: it owns timers, chunk windows (no drift; pauses/breaks shift the open window), webcam subscription, pomodoro, alerts, panel updates and persistence. `toPanelState()` maps store state to the floating panel.
  - Per chunk, a label is resolved by the cheapest step that answers: webcam away → LarpLess frontmost (reuse previous) → `rules.ts` distraction keywords → 2 min cache by app+title → on-device screen model when installed (`screenModel.ts`, Windows; answers at confidence ≥ 0.5) → VLM (`classifier.ts` + `ollama.ts` + `prompt.ts`). `chunkFuser.ts` fuses the screen verdict with webcam samples (phone visible > ⅙ → distracted). Failures produce `unknown`, which is excluded from focus %.
  - `alerts.ts` and `pomodoro.ts` are pure state machines; `focus.ts` computes summaries/streaks; `db.ts` persists over an injected `KeyValue`.
- **`src/store/`** (zustand 5) is where the concrete dependencies are wired. `sessionStore.ts` lazily builds the one `SessionController` with real `native`, Ollama, `appDb` and `Date.now`; store actions just delegate to it, and the controller writes back via `setState`. `appStore.ts` injects AsyncStorage into `core/db`. `navStore.ts` is the router (no navigation library; `App.tsx` switches on `route` and auto-routes on session status changes). `socialStore.ts` wraps `src/social/api.ts`.
- **`src/native/`** has one thin facade per Swift module (`NativeModules.FLx` + `NativeEventEmitter`) plus `mock/` implementations. `native/index.ts` picks the mock when `config.USE_MOCK_NATIVE` is true or the module is missing.
- **`src/social/`**: every API helper takes the Supabase client as a parameter, so tests pass `test/fakeSupabase.ts`. Posts carry stats only.
- **`src/ui/`**: Notion-styled components (`theme.ts` tokens, Inter + Instrument Serif), pages, ⌘K `CommandPalette`. `ui/lib/actions.ts` holds shared UI actions (start/end session).
- **Swift (`macos/Focusline-macOS/Native/`)**: `Capture/` (ScreenCaptureKit, webcam with Vision + bundled YOLO11n CoreML, permissions), `Shell/` (SwiftUI floating `NSPanel`, notifications, AVAudioEngine noise, menu/App Nap), `Ollama/` (`FLOllama`: finds, opens and restarts Ollama.app; reads the server's environment only for the cache variable), `Shared/` (`FLPing` smoke test, bridging header). Each module is a Swift `RCTEventEmitter` class plus a `.m` file with `RCT_EXTERN_MODULE`/`RCT_EXTERN_METHOD` (see `Shared/FLPing.*` for the minimal pattern), working through the RN interop layer.
  - `Native/` is an Xcode **synchronized folder**: new files join the target automatically, no `project.pbxproj` edits. Resources are flattened into the bundle, so prefix every type and file name (`FLCapture…`, `FLShell…`).

### Testing notes

- `jest.setup.js` forces `USE_MOCK_NATIVE` and `USE_MOCK_CLASSIFIER` to true and mocks AsyncStorage, whatever `src/config.ts` says. Tests must never reach Swift modules or Ollama.
- Core tests build the controller directly with `mockApis`, `createMemoryKv()` and a fake `StoreApi`; UI tests render `App` with `react-test-renderer`, seed stores via `src/fixtures/` and find elements by `testID`.

## Privacy invariants

These are product guarantees; preserve them in any change:

- Screenshots, webcam frames, base64 strings, pixel buffers and `CGImage`s stay in memory only: never written to disk/AsyncStorage/temp files, never logged (log sizes and timings only), never sent anywhere but local Ollama. This also applies to `__FL` harness results and `js-eval` output.
- Only labels are persisted; window titles are never stored. `privacy.framesStored` is the constant `0`.
- A screenshot is taken only on the VLM path. Nothing is captured during Pomodoro breaks or while the user is away.
- OCR text and image/text embeddings count as frame data: FLScreenModel (Windows) keeps them in native memory and returns only scores and the OCR character count to JS.

## Windows

There is also a Windows build (react-native-windows, C++ native modules in `larpless/windows/LarpLess/Native/`). Its commands, gotchas, module status and Ollama GPU setup (Vulkan on AMD iGPUs via `OLLAMA_IGPU_ENABLE=1`) are in [`larpless/windows/CLAUDE.md`](larpless/windows/CLAUDE.md). Webcam presence and phones use the same YOLO11n thresholds as Mac, through ONNX Runtime. UI differences go through `src/ui/platform.ts` and must leave the Mac output unchanged.

## Stale references

Comments cite `PLAN.md` and `CONTRACTS.md` sections, and `scripts/guard-ownership.sh` references `docs/macos/status/WS-*.md` (the per-agent workstream ownership hook from the hackathon). Those docs were removed; treat `src/contracts/` and the code as the source of truth.
