<p align="center"><img src="brand/larpless-logo.png" alt="LarpLess logo" width="180"></p>

# LarpLess

<p align="center"><img src="docs/images/home-screen.webp" alt="LarpLess home screen: Start session, Pomodoro presets, streak heatmap and recent sessions" width="800"></p>

**Strava for studying, as a native Mac app.** LarpLess watches your screen and webcam *on-device*, works out which subject you are studying or if you are distracted every 10 seconds, nudges you when you drift to Instagram on your screen or if you pick up your phone, and gives you a study session breakdown when you finish *(like Strava)*. If you want, you can then share the session stats with friends.

It was built in one hackathon day with **react-native-macos**: one orchestrator ran four parallel Claude Code agents (plus a fifth for the social features), each in its own git worktree.

> **Privacy first.** Frames are analysed in memory and dropped right away. Nothing is written to disk, and the only network call involving a frame goes to Ollama on `127.0.0.1`. Only labels such as "Biology, 10 s" are stored. The in-app privacy badge shows `Screenshots analysed: N · checks without a screenshot: M · stored: 0`, and on Pomodoro breaks the app stops capturing.

---

## Features

| | |
| --- | --- |
| **Subjects out of the box** | A built-in library of subjects with keywords sets the labels automatically. Adding your own courses is optional. |
| **Screen classification** | The frontmost app, the window title and (when needed) a screenshot go to a local vision model (`qwen3-vl:4b` via Ollama). It judges the *content*: a YouTube lecture counts as study, YouTube Shorts doesn't. |
| **Rules + cache fast path** | Known distractions (Instagram, TikTok, Reddit, Netflix, Discord, …) are flagged from the window title alone, and an unchanged window reuses the last verdict. Most checks need no screenshot. |
| **Webcam presence & phone detection** | Apple Vision detects whether you are there and CoreML **YOLO11n** spots a phone, at 1 fps, natively. |
| **Floating timer** | A SwiftUI `NSPanel` that floats over every app and Space. It shows green when you're studying, red when you're distracted, grey when you're away and blue on breaks. Hover it for Pomodoro, sound and session controls. |
| **Pomodoro** | An optional study format of 25 minutes of focus and a subsequent 5 minute break or 50/10 is available. |
| **Escalating alerts** | Panel turns red → notification + soft chime → second notification + pulse. A "Back on track" flash when you return. Strictness: 2 / 5 / 10 min. |
| **Ambient sound** | White, pink and brown noise generated with `AVAudioEngine`, ducked during breaks. |
| **Session Summary** | Duration, focus %, subject breakdown bar, streaks and a heatmap. |
| **Friends feed** | Supabase accounts, friend requests and a feed of shared session stats. Posts include stats only. |
| **Demo mode** | Replays recorded chunks through the real store and panel, so the demo works offline with no Ollama and no camera. |

The UI is styled after Notion: Inter + Instrument Serif, the Notion tag palette, callouts, toggle lists, and a ⌘K command palette.

## How it works

![How LarpLess works: screen and webcam are analysed on your Mac, fused into one label per chunk, and only the post you choose leaves the device](docs/images/how-it-works.png)

```mermaid
flowchart LR
  subgraph swift [Swift, in process]
    SC[FLScreenCapture] -->|snapshot, memory only| F
    WC[FLWebcam: Vision + YOLO 1 fps] -->|samples| F
    PN[FLFloatingPanel NSPanel] -->|panel actions| F
    AS[FLAppShell: menu, App Nap] -->|menu commands| F
    NT[FLNotifications]
    SD[FLSound]
  end
  F[src/native facades] --> CTRL[core/sessionController]
  CTRL --> CLS[core/classifier: rules → cache → VLM]
  CLS -->|POST /api/chat| OL[Ollama 127.0.0.1:11434]
  CTRL --> FU[core/chunkFuser] --> ST[zustand stores]
  CTRL --> AL[core/alerts] --> NT
  CTRL --> PN
  CTRL --> SD
  CTRL --> DB[core/db → AsyncStorage, labels only]
  ST --> UI[React Native UI]
  UI -->|store actions| CTRL
```

The session controller runs two cycles: a **live** one every second that keeps the floating panel current, and a **10 second chunk** that records what you did. Both label the screen the same way.

### Labelling the screen

The classifier stops at the cheapest step that gives an answer:

1. **LarpLess in front:** reuse the previous verdict.
2. **Rules:** a distraction keyword in the app or window title → `distracted`. No screenshot.
3. **Cache:** same app and title as a verdict less than 2 min old → reuse it. No screenshot.
4. **VLM:** take a screenshot and classify it with the vision model in Ollama (about 3 s). If a check for the same window is already running, it waits for that result instead of taking a second screenshot.

### Live: what the panel shows

- **Window changes:** every second the controller reads the frontmost app and title, which needs no screenshot. Once a new window has stayed in front for a second, it is labelled straight away: about 1.5 s through a rule or the cache, about 4 s through the VLM. Quick ⌘-Tabs are ignored, and a result for a window you have already left is dropped.
- **Webcam (1 fps):** `Away` after 5 s without you, `Phone` when it shows in 2 of the last 3 samples. While you are away, no window checks or screenshots happen.

### Every 10 s: the chunk that is stored

1. **Webcam:** person absent for more than ⅔ of the chunk → `away`, with no screen check.
2. **Screen:** otherwise label the screen as above. This usually reuses the live check from the cache, so the chunk costs no extra screenshot.
3. **Fuse** the screen verdict with the chunk's webcam samples (phone visible for more than ⅙ → `distracted · phone`) into a `Chunk`, save it to the history and run the alerts, which escalate per chunk.

Failed or timed-out checks give `unknown`, which is left out of the focus %.

### The model

Starting a session warms the model up, which takes about 3 s while the first window settles, so the first check doesn't also wait for the model to load. The subject list sits in the system prompt, which is identical on every check, so Ollama reuses it and only processes the new screenshot and window line. Ending a session unloads the model to free its memory.

**Layering:** `ui → store → core → native facades → Swift`. `src/core` is pure TypeScript with injected dependencies, so the whole session loop runs under Jest with fake timers.

## Tech stack

- **App:** react-native 0.81.6 + react-native-macos 0.81.9, TypeScript, Hermes. It runs Fabric + bridgeless; the legacy-style native modules work through the interop layer.
- **State / storage:** zustand 5, AsyncStorage 2.2.0 (pinned), date-fns 4.
- **Native (Swift 5, macOS 14+):** ScreenCaptureKit, AVFoundation, Vision, CoreML, UserNotifications, AppKit, SwiftUI.
- **Models:** Ollama `qwen3-vl:4b` and YOLO11n CoreML (`nms=True`, bundled).
- **Social:** `@supabase/supabase-js` + `react-native-url-polyfill`.

## Getting started

### Requirements

- An Apple-silicon Mac with 16 GB of RAM or more on **macOS 14.5** or above.
- **Xcode 16.1+**.
- **Node 20** or above.
- **Cocoapods**.
- **[Ollama](https://ollama.com)** running locally, with the vision model pulled:

```bash
ollama pull qwen3-vl:4b
```

LarpLess asks Ollama for a 4K context and unloads the model when a session ends. Ollama's model runner also keeps a prompt cache in RAM (up to 8 GB by default) that fills up during long sessions without helping LarpLess. On a 16–24 GB Mac you can turn it off by quitting Ollama and starting it with:

```bash
open --env LLAMA_ARG_CACHE_RAM=0 -a Ollama
```

This lasts until Ollama is quit (`launchctl setenv` does not reach the Ollama app).

### Install

From `/larpless/`:

```bash
scripts/setup-worktree.sh
```

This runs `npm ci` and then `pod install` with the UTF-8 locale CocoaPods needs. If you run `pod install` yourself, `export LANG=en_US.UTF-8` first.

### Supabase Setup

The social layer reads `larpless/src/social/env.ts`, which is gitignored. Create it and fill it with your Supabase details. This is required for the app to run.

```ts
export const SUPABASE_URL = 'https://<project>.supabase.co';
export const SUPABASE_ANON_KEY = '<anon key>';
```

Then, in the Supabase dashboard, run [`larpless/supabase/schema.sql`](larpless/supabase/schema.sql) in the SQL editor and turn off **Authentication → Providers → Email → Confirm email** (accounts use a username + password; you can also sign in with the email of an account made outside the app). If both values are empty, the app skips Supabase entirely and runs fully local.

### Run

```bash
scripts/run-mac.sh 8081
```

This starts Metro on the port, builds the Debug app with that port baked in, and launches it. Each run opens a **new** app instance, so quit the previous one first:

```bash
pkill -f "$PWD/macos/build/Build/Products/Debug/LarpLess.app"
```

On first launch, grant **Screen Recording** (macOS needs an app relaunch afterwards; onboarding has a button for it), **Camera** and **Notifications**.

The app is signed ad-hoc, so no Apple ID is needed, but macOS forgets those permissions after every rebuild. To keep them, sign with your own Apple Development certificate (**any Apple ID works**, via Xcode → Settings → Accounts → Manage Certificates). Create `larpless/macos/signing.local` (gitignored) and `run-mac.sh` picks it up:

```bash
CODE_SIGN_IDENTITY="Apple Development: Your Name (XXXXXXXXXX)"
DEVELOPMENT_TEAM=YOURTEAMID
```

`security find-identity -v -p codesigning` lists your certificate names; the team ID is the Organizational Unit in the certificate's details.

### Demo mode

- **⌥-click Start** on Home, or ⌘K → *Start demo session*: replays fixture chunks through the real store and floating panel.
- ⌘K → *Toggle demo fast mode*: short alert thresholds (20 s / 50 s instead of minutes).
- `node scripts/demo-social.mjs seed`: creates demo accounts with friendships and sample posts. Also `accept`, `request <user>` and `status`.

## Development

Run these from `larpless/`.

Type-check:

```bash
npm run typecheck
```

Run the Jest suites (`__tests__/core`, `social`, `ui`):

```bash
npm test
```

Build only:

```bash
xcodebuild -workspace macos/Focusline.xcworkspace -scheme Focusline-macOS -configuration Debug build
```

**Driving the running app from the shell.** `scripts/js-eval.mjs` connects to Metro's inspector, evaluates JS inside the app and prints JSON. `globalThis.__FL` exposes the native facades, the stores, `applyFixture`, `config` and the native test harnesses:

```bash
node scripts/js-eval.mjs 8081 "__FL.pingRoundTrip()"
```

Stream the JS console for 20 s (RN 0.81 no longer prints it in the Metro terminal):

```bash
node scripts/js-eval.mjs 8081 --console 20
```

Native logs use `os.Logger` under the subsystem `com.larpless.app`:

```bash
log show --last 5m --style compact --predicate 'subsystem == "com.larpless.app"'
```

**Classifier bench.** `node scripts/bench-classifier.ts --model qwen3-vl:4b` scores the prompt against `bench/<expected>__<desc>.png`. If that folder is empty it renders 10 synthetic mock-ups instead and never captures the real screen. Add `--clean` to delete the images afterwards.

**Adding native code.** `macos/Focusline-macOS/Native/` is an Xcode *synchronized folder*: drop files in and they join the target, with no `project.pbxproj` edits. Resources are flattened into the bundle, so prefix every type and file name (`FLCapture…`, `FLShell…`).

## Privacy

- Screen and webcam frames stay in memory only. They never go to disk, AsyncStorage, temp files, logs, or the network (except local Ollama).
- Snapshots, base64 strings, pixel buffers and `CGImage`s are never logged. Logs carry sizes and timings only.
- Only labels are persisted. Window titles are never stored.
- `privacy.framesStored` is the constant `0`.
- Nothing is captured during Pomodoro breaks or while you're away.
