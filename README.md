<p align="center"><img src="brand/larpless-logo.png" alt="LarpLess logo" width="180"></p>

# LarpLess

<p align="center"><img src="docs/images/home-screen.webp" alt="LarpLess home screen: Start session, Pomodoro presets, streak heatmap and recent sessions" width="800"></p>

**Strava for studying, as a native Mac app.** LarpLess watches your screen and webcam *on-device*, works out which subject you are studying or if you are distracted every 10 to 30 seconds, nudges you when you drift to Instagram on your screen or if you pick up your phone, and gives you a study session breakdown when you finish *(like Strava)*. If you want, you can then share the session stats with friends.

It was built in one hackathon day with **react-native-macos**: one orchestrator ran four parallel Claude Code agents (plus a fifth for the social features), each in its own git worktree.

> **Privacy first.** Frames are analysed in memory and dropped right away. Nothing is written to disk, and the only network call involving a frame goes to Ollama on `127.0.0.1`. Only labels such as "Biology, 10 s" are stored. The in-app privacy badge shows `Screenshots analysed: N · checks without a screenshot: M · stored: 0`, and on Pomodoro breaks the app stops capturing.

---

## Features

| | |
| --- | --- |
| **Subjects out of the box** | A built-in library of subjects with keywords sets the labels automatically. Adding your own courses is optional. |
| **Screen classification** | The frontmost app, the window title and (when needed) a screenshot go to a local vision model (`qwen3-vl:4b` via Ollama). It judges the *content*: a YouTube lecture counts as study, YouTube Shorts doesn't. |
| **Rules + cache fast path** | Known distractions (Instagram, TikTok, Reddit, Netflix, Discord, …) are flagged from the window title alone, and an unchanged window reuses the last verdict. Most checks need no screenshot. |
| **Power profiles** | Eco, Medium or High sets how often the screen is checked and how big the screenshot is. A session that falls behind steps down on its own, so slower Macs still get answers. |
| **Webcam presence & phone detection** | CoreML **YOLO11n** detects whether you are there and spots a phone, at 1 fps, natively. |
| **Floating timer** | A SwiftUI `NSPanel` that floats over every app and Space. It shows green when you're studying, red when you're distracted, grey when you're away and blue on breaks. Hover it for Pomodoro, sound and session controls. |
| **Now playing** | A strip under the timer shows the current song, the time left, and previous / play / next. The title is shown, never saved. |
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
    WC[FLWebcam: YOLO 1 fps] -->|samples| F
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

The session controller runs two cycles: a **live** one every second that keeps the floating panel current, and a **chunk** of 10, 15 or 30 s (set by the [power profile](#power-profiles)) that records what you did. Both label the screen the same way.

### Labelling the screen

The classifier stops at the cheapest step that gives an answer:

1. **LarpLess in front:** reuse the previous verdict.
2. **Rules:** a distraction keyword in the app or window title → `distracted`. No screenshot.
3. **Cache:** same app and title as a verdict less than 2 min old → reuse it. No screenshot.
4. **VLM:** take a screenshot and classify it with the vision model in Ollama (about 3 s on a fast Mac). Only one vision call runs at a time, and it is allowed to finish. A check for the same window shares its result. If you switched windows meanwhile, one follow-up reads whatever is in front when the call returns, so windows you only passed through are never captured.

### Live: what the panel shows

- **Window changes:** every second the controller reads the frontmost app and title, which needs no screenshot. Once a new window has stayed in front for the profile's settle time (1 s on High, 2 s on Medium, 3 s on Eco), it is labelled straight away: within about half a second through a rule or the cache, about 3 s later through the VLM. Quick ⌘-Tabs are ignored, and a result for a window you have already left is dropped.
- **Webcam (1 fps):** `Away` after 5 s without you, `Phone` when it shows in 2 of the last 3 samples. While you are away, no window checks or screenshots happen.

### Every chunk: what is stored

1. **Webcam:** person absent for more than ⅔ of the chunk → `away`, with no screen check.
2. **Screen:** otherwise label the screen as above. This usually reuses the live check from the cache, so the chunk costs no extra screenshot.
3. **Fuse** the screen verdict with the chunk's webcam samples (phone visible for more than ⅙ → `distracted · phone`) into a `Chunk`, save it to the history and run the alerts, which escalate per chunk.

Failed or timed-out checks give `unknown`, which is left out of the focus %. A vision call may take up to 30 s. One that hits that limit pauses vision checks for one chunk, so a struggling Mac isn't handed the next screenshot straight away.

### Power profiles

Settings → Focus → **Power** picks how hard LarpLess works. Medium is the default.

| | Chunk | Settle | Screenshot | Cache | Ollama keep-alive |
| --- | --- | --- | --- | --- | --- |
| **Eco** | 30 s | 3 s | 768 px, JPEG 0.5 | 3 min | 5 min |
| **Medium** | 15 s | 2 s | 1024 px, JPEG 0.6 | 2 min | 15 min |
| **High** | 10 s | 1 s | 1280 px, JPEG 0.7 | 2 min | 30 min |

The keep-alive is how long Ollama keeps the model in memory after the last check. It only matters during long gaps such as Pomodoro breaks, because checks during a session keep resetting it.

The saved profile is a ceiling. If a vision call takes longer than a chunk, or you go through three different windows during one call (the one being checked included), the session steps down one level (High → Medium → Eco) and stays there until it ends. The step is not saved, so the next session starts at your chosen profile again.

### The model

Starting a session warms the model up, which takes about 3 s while the first window settles, so the first check doesn't also wait for the model to load. The subject list sits in the system prompt, which is identical on every check, so Ollama reuses it and only processes the new screenshot and window line. Ending a session unloads the model to free its memory right away instead of waiting out the keep-alive.

**Layering:** `ui → store → core → native facades → Swift`. `src/core` is pure TypeScript with injected dependencies, so the whole session loop runs under Jest with fake timers.

## Tech stack

- **App:** react-native 0.81.6 + react-native-macos 0.81.9, TypeScript, Hermes. It runs Fabric + bridgeless; the legacy-style native modules work through the interop layer.
- **State / storage:** zustand 5, AsyncStorage 2.2.0 (pinned), date-fns 4.
- **Native (Swift 5, macOS 14+):** ScreenCaptureKit, AVFoundation, Vision, CoreML, UserNotifications, AppKit, SwiftUI.
- **Now playing:** a vendored [mediaremote-adapter](https://github.com/ungive/mediaremote-adapter) (BSD-3-Clause) run through `/usr/bin/perl`. Since macOS 15.4, a Developer ID app can't read MediaRemote itself.
- **Models:** Ollama `qwen3-vl:4b` and YOLO11n CoreML (`nms=True`, bundled; presence and phone).
- **Social:** `@supabase/supabase-js` + `react-native-url-polyfill`.
- **Website:** Vite + TypeScript in `site/`.

## Getting started

### Hardware Requirements

#### Minimum Requirements

- Mac with an apple silicon chip and 16 GB of RAM or more
- **macOS 14.5** Sonoma or above.

#### Recommended Requirements

This app relies on a VLM which is a GPU-intensive process. For a responsive experience, processors with strong GPU performance is needed. M-series chips that have more GPU cores which are the Pro, Max and Ultra lineups will perform much better than a regular M-series chip.
It is also worth considering that performance may degrade over time for MacBook Airs since they have no active cooling.

- Mac with Apple M4 or M1 Pro or M1 Max chip
- 24 GB of RAM or more

### Software Requirements

- **Xcode 16.1+**.
- **Node 20** or above.
- **Cocoapods** (`brew install cocoapods`).
- **CMake** (`brew install cmake`).
- **[Ollama](https://ollama.com)** running locally, with the vision model pulled:

```bash
ollama pull qwen3-vl:4b
```

LarpLess asks Ollama for a 4K context and unloads the model when a session ends. Ollama's model runner also keeps a prompt cache in RAM (up to 8 GB by default) that fills up during long sessions without helping LarpLess. On a 16–24 GB Mac you can turn it off by quitting Ollama and starting it with:

```bash
open --env LLAMA_ARG_CACHE_RAM=0 -a Ollama
```

This lasts until Ollama is quit.

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

The Debug app is signed ad-hoc, so no Apple ID is needed, but macOS forgets those permissions after every rebuild. To keep them, sign with your own Apple Development certificate (**any Apple ID works**, via Xcode → Settings → Accounts → Manage Certificates). Create `larpless/macos/signing.local` (gitignored) and `run-mac.sh` picks it up:

```bash
CODE_SIGN_IDENTITY="Apple Development: Your Name (XXXXXXXXXX)"
DEVELOPMENT_TEAM=YOURTEAMID
```

`security find-identity -v -p codesigning` lists your certificate names; the team ID is the Organizational Unit in the certificate's details.

The Release configuration is set up for distribution: Developer ID signing for the LarpLess team, hardened runtime, and the camera entitlement from `LarpLess.entitlements`. Building it needs that team's **Developer ID Application** certificate. To build Release locally without it, override the identity:

```bash
xcodebuild -workspace macos/Focusline.xcworkspace -scheme Focusline-macOS -configuration Release -derivedDataPath macos/build CODE_SIGN_IDENTITY="Apple Development: Your Name (XXXXXXXXXX)" DEVELOPMENT_TEAM=YOURTEAMID build
```

### Demo mode

- **⌥-click Start** on Home, or ⌘K → *Start demo session*: replays fixture chunks through the real store and floating panel.
- ⌘K → *Toggle demo fast mode*: short alert thresholds (20 s / 50 s instead of minutes). How often the screen is checked still follows the power profile.
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

Clean previous macOS build products before a fresh native rebuild:

```bash
./scripts/clean-build.sh
```

Run this from `larpless/`. The cleanup script stops a running `LarpLess` app and removes `macos/build` plus matching Xcode `Focusline-*` DerivedData.

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

**Adding native code.** `macos/Focusline-macOS/Native/` is an Xcode *synchronized folder*: drop files in and they join the target, with no `project.pbxproj` edits. Resources are flattened into the bundle, so prefix every type and file name (`FLCapture…`, `FLShell…`). The one exception is the **Bundle MediaRemote adapter** run-script phase in `project.pbxproj`: it calls `macos/scripts/build-mediaremote-adapter.sh`, which builds `macos/vendor/mediaremote-adapter` with CMake and copies the framework and the perl launcher into the app's Resources.

**Website.** The coming-soon page lives in `site/` at the repo root:

```bash
cd site && npm install && npm run dev
```

`npm run build` type-checks and writes the static site.

## Privacy

- Screen and webcam frames stay in memory only. They never go to disk, AsyncStorage, temp files, logs, or the network (except local Ollama).
- Snapshots, base64 strings, pixel buffers and `CGImage`s are never logged. Logs carry sizes and timings only.
- Only labels are persisted. Window titles are never stored.
- The now-playing title and artist stay inside the Swift panel. They are never sent to JS, logged or stored, and the debug OCR scan skips the media strip. Settings keep only the on/off toggle and drop any key they don't know on load and on save.
- The now-playing helper is started with `--no-artwork`, so no album art passes through the app.
- `privacy.framesStored` is the constant `0`.
- Nothing is captured during Pomodoro breaks or while you're away.
