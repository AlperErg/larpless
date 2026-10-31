# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

LarpLess is a study tracker for macOS and Windows built with **React Native 0.81** (Fabric + bridgeless, Hermes): one TypeScript app running on the out-of-tree platforms **react-native-macos** (Swift native modules) and **react-native-windows** (C++ native modules). It classifies the screen and webcam on-device, records one label per chunk (10/15/30 s, set by the power profile) and summarizes the session; friends can see shared stats through Supabase. The app lives in `larpless/`; `site/` is the marketing website; the repo root otherwise holds the README, `brand/` and `docs/images/`. The project was originally called **Focusline**, which is why the Xcode workspace/scheme are `Focusline*`, native types are prefixed `FL`, and AsyncStorage keys start with `fl:`. The built product is `LarpLess.app`.

## Commands

Run from `larpless/`:

```bash
npm test                                   # all Jest suites (__tests__/core, native, social, ui)
npx jest __tests__/core/classifier.test.ts # one file
npx jest -t "relabel"                      # tests matching a name
npm run typecheck                          # tsc --noEmit
npm run lint                               # eslint (@react-native config)
scripts/setup-worktree.sh                  # npm ci + pod install (sets the UTF-8 locale CocoaPods needs)
scripts/run-mac.sh 8081                    # Metro on 8081 + Debug build with that port baked in + launch
scripts/clean-build.sh                     # kill LarpLess, delete macos/build and Focusline-* DerivedData
scripts/fresh-run-mac.sh 8081              # clean-build + setup-worktree + run-mac
node scripts/acknowledgements.mjs          # regenerate src/legal/acknowledgements.json after dependency changes (needs pod install; CI runs --check)
xcodebuild -workspace macos/Focusline.xcworkspace -scheme Focusline-macOS -configuration Debug build
```

- CI: `.github/workflows/test.yml` runs typecheck, lint and `npm test -- --ci` on Linux for every push/PR. `macos-build.yml` runs only on PRs into `main`: `pod install`, `acknowledgements.mjs --check`, then the Debug `xcodebuild`.
- The build needs **CMake**: a run-script phase in `project.pbxproj` calls `macos/scripts/build-mediaremote-adapter.sh`, which builds the vendored `macos/vendor/mediaremote-adapter` and copies the framework and perl launcher into the app's Resources (now playing; since macOS 15.4 a Developer ID app can't read MediaRemote itself).
- `run-mac.sh` opens a **new** app instance each time; quit the old one first: `pkill -f "$PWD/macos/build/Build/Products/Debug/LarpLess.app"`. Metro logs go to `.logs/metro-<port>.log`. An optional gitignored `macos/signing.local` (`CODE_SIGN_IDENTITY`, `DEVELOPMENT_TEAM`) gives a stable signature so Screen Recording/Camera grants survive rebuilds; otherwise Debug signs ad-hoc. Release is set up for distribution: `Developer ID Application` (team `P74N9B6V54`), hardened runtime, and `Focusline-macOS/LarpLess.entitlements` (camera; the hardened runtime blocks the webcam without it). Versions come from `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`. ATS allows only local networking (Ollama); everything else must be HTTPS.
- Supabase credentials come only from **Settings → Friends** (`settings.supabaseUrl`/`supabaseAnonKey`, persisted in AsyncStorage and applied on load via `setSupabaseCredentials`); both empty runs fully local. There is no `env.ts`. Schema: `supabase/schema.sql` (re-runnable; the project needs **Confirm email** off because accounts are username + password). `node scripts/demo-social.mjs seed|accept|request <user>|status` manages demo accounts (needs `SUPABASE_URL`/`SUPABASE_ANON_KEY` in the environment).
- Runtime needs Ollama on `127.0.0.1:11434` with `qwen3-vl:2b`. Tests never need it. Onboarding links the installer and pulls the model (`/api/pull`, streamed through XHR). Ollama ≥ 0.30's llama-server keeps up to 8 GB of prompt cache in RAM; only `LLAMA_ARG_CACHE_RAM=0` at launch turns it off, so LarpLess opens Ollama.app with it and, at app launch and session start, restarts an Ollama.app running without it when no other model is loaded (`core/ollamaHost.ts`, serialized through `ollamaStore.prepare()`). Ollama.app ignores the quit Apple Event; quit/restart use SIGTERM on its pid. Ending a session unloads the model and quits the Ollama that LarpLess itself opened, never one the user started.
- Website: `cd site && npm install && npm run dev`; `npm run build` type-checks and runs Vite. Netlify builds it with `site/` as the base directory (`netlify.toml`); `SITE_URL` (else Netlify's `URL`) sets the absolute canonical/OG origin.

### Driving the running app (dev builds)

- `node scripts/js-eval.mjs 8081 "<expr>"` evaluates JS in the app via Metro's inspector (promises awaited, JSON printed; it may disconnect an open RN DevTools window). `globalThis.__FL` (`src/dev/devGlobals.ts`) exposes `NativeModules`, `native`, `config`, `useSessionStore`/`useAppStore`/`useOllamaStore`, `storage` (AsyncStorage), `applyFixture`, `harness` (runners such as `harness.A()`, `harness['A.capture']()`, `harness.Bpanel()` from `src/dev/Harness*.tsx`), `ping()`/`pingRoundTrip()`, and `__FL.ui.text/measure/overflow` for reading the rendered UI (`src/ui/dev/introspect.ts`).
- `node scripts/js-eval.mjs 8081 --console 20` streams the JS console (RN 0.81 no longer prints it in Metro).
- Native logs: `log show --last 5m --style compact --predicate 'subsystem == "com.larpless.app"'`.
- Demo mode (no Ollama/camera): ⌥-click Start, or ⌘K → "Start demo session"; replays `fixtureChunks` through the real controller and panel. ⌘K → "Toggle demo fast mode" shortens alert thresholds.
- `node scripts/bench-classifier.ts --model qwen3-vl:2b` scores the VLM prompt against gitignored `bench/<subject|notstudy>__<category>__<desc>.png` (optional `<name>.json` sidecar with `appName`/`windowTitle`); with no images it renders synthetic mock-ups and never captures the real screen.

## Architecture

Layering is strict: **`ui` → `store` → `core` → `native` facades → Swift** (or C++ on Windows).

- **`src/contracts/`** holds the shared types: `domain.ts` (Chunk, Settings, SessionSummary…), `native.ts` (the `NativeApis` interface every native module implements, including event names and error codes), `store.ts` (store state/actions). Change a contract first, then every side.
- **`src/core/`** is pure TypeScript with injected dependencies and no imports of React Native, AsyncStorage or the stores (it may import `src/fixtures/data.ts`, never `fixtures/apply.ts`). Time comes from an injected `now()`. This is what lets the whole session loop run under Jest with fake timers.
  - `sessionController.ts` is the runtime loop. A 1 s **live** tick reads the frontmost window (no screenshot), classifies a new window once it has stayed in front for the profile's settle time, and drives the panel; a **chunk** window closes every `chunkS` and records a label (no drift; pauses/breaks shift the open window; a tick gap > 30 s is treated as sleep and pauses the session). It also owns the webcam subscription, pomodoro, alerts, persistence and Ollama teardown. `toPanelState()` maps store state to the floating panel.
  - `classifier.ts` resolves a label by the cheapest step that answers: LarpLess frontmost (reuse previous) → distraction site → study tool (both from `sites.ts`' `SITE_CATALOG`, wrapped by `rules.ts`) → cache by app+title (profile TTL, "not study" ≤ 1 min) → optional title-only check (`config.TITLE_CHECK`, off) → single-flight VLM (`ollama.ts` + `prompt.ts`). Only one vision call runs at a time; same-window callers share it, and one follow-up reads whatever is frontmost when it returns. `sites.ts` also post-processes verdicts (chat apps, VMs, stores) and adds per-site prompt hints (`look` entries).
  - `powerProfile.ts`: eco/medium/high set chunk length, settle time, capture size, cache TTL and keep-alive. The saved setting is a ceiling; a slow call or three windows during one call steps the session down for the rest of that session only (module-level override, never saved).
  - `chunkFuser.ts` fuses the screen verdict with the chunk's webcam samples (absent > ⅔ → `away` with no screen check; phone visible > ⅙ → distracted). Failures produce `unknown`, which is excluded from focus %.
  - `subjectLibrary.ts` is the built-in subject list (always on, user-disablable via `settings.disabledSubjects`); user modules are optional extras. `alerts.ts` and `pomodoro.ts` are pure state machines; `focus.ts` computes summaries/streaks; `demoMode.ts` replays chunks.
  - `db.ts` persists over an injected `KeyValue` (`fl:modules`, `fl:settings`, `fl:sessions`, `fl:chunks:<id>`). `cleanSettings` keeps only keys present in `DEFAULT_SETTINGS` (`src/config.ts`), so **a new setting must be added there** or it is dropped on load/save; it also forces `ollamaUrl` to a local address. `cleanChunk` whitelists Chunk fields.
- **`src/store/`** (zustand 5) is where the concrete dependencies are wired. `sessionStore.ts` lazily builds the one `SessionController` with real `native`, Ollama, `appDb` and `Date.now`; store actions just delegate to it, and the controller writes back via `setState`. `appStore.ts` injects AsyncStorage into `core/db` and pushes settings to native/Supabase. `ollamaStore.ts` handles host info, `prepare()` and model pulls. `navStore.ts` is the router (no navigation library; `App.tsx` switches on `route` and auto-routes on session status changes). `socialStore.ts` wraps `src/social/api.ts`; the local session flow never waits on it.
- **`src/native/`** has one thin facade per native module (`NativeModules.FLx` + `NativeEventEmitter`) plus `mock/` implementations. `native/index.ts` picks the mock when `config.USE_MOCK_NATIVE` is true or the module is missing.
- **`src/social/`**: every API helper takes the Supabase client as a parameter, so tests pass `test/fakeSupabase.ts`. Posts carry stats only. `supabase.ts` stores the auth session in the Keychain (`FLKeychain`; DPAPI file on Windows) via `keychainAuthStorage`, migrating any old AsyncStorage copy.
- **`src/legal/`**: `acknowledgements.json` is generated (never hand-edit it); licence texts npm and CocoaPods don't supply live in `licenses/`.
- **`src/ui/`**: components, pages, ⌘K `CommandPalette`. `theme.ts` is the only file in `src/ui` with hex colours; `applyScheme` mutates the light/dark tokens in place, so scheme-dependent styles go through `themed()`. Canvas colours are mirrored natively in `Shell/NotionColors.swift`, `AppDelegate.mm` and Windows' `LarpLess.cpp`. `ui/lib/actions.ts` holds shared UI actions (start/end session).
- **Swift (`macos/Focusline-macOS/Native/`)**: `Capture/` (ScreenCaptureKit, webcam with Vision + bundled YOLO11n CoreML, permissions), `Shell/` (SwiftUI floating `NSPanel`, notifications, AVAudioEngine noise, menu/App Nap/sleep, `FLNowPlaying`), `Ollama/` (`FLOllama`: finds, opens, restarts and quits Ollama.app; reads process environments only for the cache variable and to carry `OLLAMA_`/`LLAMA_` vars across a restart), `Keychain/`, `Shared/` (`FLPing` smoke test, bridging header). Each module is a Swift class (`RCTEventEmitter` when it sends events, else `NSObject`) plus a `.m` file with `RCT_EXTERN_MODULE`/`RCT_EXTERN_METHOD` (see `Shared/FLPing.*` for the minimal pattern), working through the RN interop layer.
  - `Native/` is an Xcode **synchronized folder**: new files join the target automatically, no `project.pbxproj` edits. Resources are flattened into the bundle, so prefix every type and file name (`FLCapture…`, `FLShell…`).
  - Adding or changing a native method touches the contract, the facade, the mock, the Swift class and its `.m` (and the Windows header). `__tests__/native/contract.test.ts` (parsers in `test/nativeSources.ts`) reads all of them from source and fails on mismatched selectors, arity, types, superclasses or undeclared events.

### Testing notes

- `jest.setup.js` forces `USE_MOCK_NATIVE` and `USE_MOCK_CLASSIFIER` to true and mocks AsyncStorage, `lucide-react-native` and `react-native-svg`, whatever `src/config.ts` says. Tests must never reach native modules or Ollama.
- Core tests build the controller directly with `mockApis`, `createMemoryKv()` and a fake `StoreApi`; UI tests render `App` with `react-test-renderer`, seed stores via `src/fixtures/` (`applyFixture`) and find elements by `testID`. Jest runs as `ios`, which `platform.ts` treats as macOS.
- `__tests__/social/schema.test.ts` runs `supabase/schema.sql` and its RLS policies in real Postgres (PGlite in a child process, `test/pglite.ts` + `test/pgliteServer.mjs`); `fakeSupabase` can't enforce RLS.

## Privacy invariants

These are product guarantees; preserve them in any change:

- Screenshots, webcam frames, base64 strings, pixel buffers and `CGImage`s stay in memory only: never written to disk/AsyncStorage/temp files, never logged (log sizes and timings only), never sent anywhere but local Ollama (`ollamaUrl` must stay local). This also applies to `__FL` harness results and `js-eval` output.
- Only labels are persisted; window titles are never stored. `privacy.framesStored` is the constant `0`.
- A screenshot is taken only on the VLM path. Nothing is captured during Pomodoro breaks or while the user is away.
- Now-playing title, artist and artwork stay inside the Swift panel: never sent to JS, logged or stored (JS only calls `setEnabled`).
- Supabase tokens live in the Keychain, not AsyncStorage. Posts carry stats only, never chunks, app names, titles or images.

## Windows

There is also a Windows build (react-native-windows, C++ native modules as single headers in `larpless/windows/LarpLess/Native/`, same module names, methods, events and error codes). Its commands, gotchas, module status and Ollama GPU setup (Vulkan on AMD iGPUs via `OLLAMA_IGPU_ENABLE=1`) are in [`larpless/windows/CLAUDE.md`](larpless/windows/CLAUDE.md). `npm run test:windows` runs the same suites against react-native-windows (`@rnx-kit/jest-preset`; not in CI). The preset replaces `setupFiles`, so `jest.config.windows.js` appends `jest.setup.js` itself, and platform-dependent copy in tests should come from `platform.ts` (`DEVICE`, `MOD`) rather than literal "Mac"/"⌘". UI differences go through `src/ui/platform.ts` (`IS_WINDOWS`, `MOD`, `ANIMATE`/`MotionView`…) and must leave the Mac output unchanged.

## Stale references

Comments cite `PLAN.md` and `CONTRACTS.md` sections and `WS-A`…`WS-D` workstreams, and `scripts/guard-ownership.sh` references `docs/macos/status/WS-*.md` (the per-agent workstream ownership hook from the hackathon). Those docs were removed; treat `src/contracts/` and the code as the source of truth. `larpless/README.md` is the untouched RN template; the root `README.md` is the real one.
