# Focusline macOS: interface contracts

**Frozen after Phase 0.** In Phase 0 the orchestrator copies the code blocks below verbatim into `focusline/src/...`. After that, only the orchestrator changes them. To request a change, add it under "Requests" in your `docs/macos/status/WS-X.md`.

All paths are relative to `focusline/`.

---

## 1. Domain types: `src/contracts/domain.ts`

```ts
export type TagColor =
  | 'gray' | 'brown' | 'orange' | 'yellow' | 'green'
  | 'blue' | 'purple' | 'pink' | 'red';

export type SoundId = 'off' | 'white' | 'pink' | 'brown' | 'rain' | 'cafe';

export interface StudyModule {
  id: string;          // stable, e.g. "mod_k3j9x"
  name: string;        // unique; also used as the VLM enum value, e.g. "Biology"
  color: TagColor;
  keywords: string[];  // prompt hints, e.g. ["mitosis", "cell", "BIO101"]
}

export type ChunkKind = 'subject' | 'distracted' | 'away' | 'unknown';
export type DistractionReason = 'phone' | 'screen' | 'rule';
export type ChunkSource = 'vlm' | 'rule' | 'cache' | 'webcam' | 'none' | 'user';

export interface Chunk {
  id: string;
  sessionId: string;
  index: number;                      // 0-based within the session
  startedAt: number;                  // epoch ms
  durationS: number;                  // 30 normally, 10 in demoFast
  kind: ChunkKind;
  moduleId: string | null;            // non-null only when kind === 'subject'
  reason: DistractionReason | null;   // non-null only when kind === 'distracted'
  activity: string;                   // short text: "Reading cell division slides", "Instagram"
  confidence: number;                 // 0..1
  source: ChunkSource;
  appName: string | null;             // frontmost app; the window title is NEVER stored
}

export interface BreakdownEntry {
  key: string;        // moduleId, or 'distracted'
  label: string;      // module name, or 'Distracted'
  color: TagColor;    // module colour; 'red' for distracted
  seconds: number;
  pct: number;        // 0..100 of (subject + distracted) seconds
}

export interface SessionSummary {
  id: string;
  startedAt: number;
  endedAt: number;
  totalS: number;      // running focus-phase time (excludes pauses and breaks)
  focusS: number;      // seconds in 'subject' chunks
  focusPct: number;    // 0..100 = subject / (all - away - unknown)
  breakdown: BreakdownEntry[];
  pomodoros: number;   // completed focus rounds
}

export interface ScreenVerdict {
  studying: boolean;
  moduleId: string | null;
  activity: string;
  confidence: number;
  source: 'vlm' | 'rule' | 'cache';
}

export type Strictness = 2 | 5 | 10;               // minutes until the first notification
export type PomodoroPreset = '25/5' | '50/10' | 'demo';
export type PomodoroPhase = 'focus' | 'break' | 'longBreak';

export interface PomodoroState {
  enabled: boolean;
  preset: PomodoroPreset;
  phase: PomodoroPhase;
  round: number;              // 1-based current focus round
  roundsBeforeLong: number;   // 4
  phaseEndsAtMs: number;      // epoch ms; never count ticks
  completed: number;          // finished focus rounds
}

export interface Settings {
  model: string;                        // 'qwen3-vl:4b'
  ollamaUrl: string;                    // 'http://127.0.0.1:11434'
  strictness: Strictness;
  demoFast: boolean;                    // 10 s chunks, 20 s/50 s alerts, 'demo' pomodoro
  webcamEnabled: boolean;
  soundsEnabled: boolean;               // chimes + notification sound
  defaultSound: SoundId;
  volume: number;                       // 0..1
  pomodoroDefault: PomodoroPreset | 'off';
  onboarded: boolean;
}
```

## 2. Native APIs: `src/contracts/native.ts`

```ts
import type { PomodoroPhase, PomodoroPreset, SoundId } from './domain';

export type Unsubscribe = () => void;

/* ---------- FLScreenCapture (WS-A) ---------- */
export interface ActiveWindow {
  appName: string | null;      // "Safari"
  bundleId: string | null;     // "com.apple.Safari"
  windowTitle: string | null;  // null when Screen Recording is not granted
  isSelf: boolean;             // Focusline is frontmost
}
export interface CaptureOptions { maxWidth: number; jpegQuality: number } // 1280, 0.7
export interface ScreenSnapshot extends ActiveWindow {
  jpegBase64: string;          // in-memory only. NEVER log or persist.
  width: number;
  height: number;
  capturedAt: number;          // epoch ms
}
export interface ScreenCaptureApi {
  getActiveWindow(): Promise<ActiveWindow>;
  /** Main display, Focusline's own windows excluded, no cursor. Rejects E_PERMISSION / E_CAPTURE. */
  capture(opts: CaptureOptions): Promise<ScreenSnapshot>;
}

/* ---------- FLPermissions (WS-A) ---------- */
export type PermissionKind = 'screen' | 'camera';
export type PermissionStatus = 'granted' | 'denied' | 'notDetermined';
export interface PermissionsApi {
  status(): Promise<Record<PermissionKind, PermissionStatus>>;
  request(kind: PermissionKind): Promise<PermissionStatus>;
  openSettings(kind: PermissionKind): Promise<void>;
  /** Relaunch the app (needed after Screen Recording is granted). */
  relaunch(): Promise<void>;
}

/* ---------- FLWebcam (WS-A) ---------- */
export interface WebcamSample {
  t: number;               // epoch ms
  personPresent: boolean;
  phoneVisible: boolean;
  phoneScore: number;      // 0..1, best "cell phone" confidence
}
export interface WebcamApi {
  start(opts: { fps: number }): Promise<void>;   // rejects E_PERMISSION / E_CAMERA
  stop(): Promise<void>;
  /** Phase 2 (live photo). In-memory JPEG. */
  capturePhoto(): Promise<{ jpegBase64: string; width: number; height: number }>;
  onSample(cb: (s: WebcamSample) => void): Unsubscribe;   // event 'FLWebcamSample'
}

/* ---------- FLFloatingPanel (WS-B) ---------- */
export type PanelStatus = 'studying' | 'distracted' | 'away' | 'break' | 'paused' | 'idle';
export type PanelTint = 'green' | 'red' | 'gray' | 'blue';
export interface PanelState {
  status: PanelStatus;
  title: string;              // "Biology" | "Distracted" | "Away" | "Break" | "Paused"
  subtitle: string | null;    // "Reading slides" | "Instagram" | "Round 2 of 4"
  tint: PanelTint;
  /** elapsedS = baseS + (now - runningSinceMs)/1000 while running; baseS when runningSinceMs is null. The panel ticks itself. */
  timer: { baseS: number; runningSinceMs: number | null };
  pomodoro: { phase: PomodoroPhase; round: number; rounds: number; phaseEndsAtMs: number } | null;
  sound: { id: SoundId; volume: number };
  pulse: boolean;             // alert level 3
  flash: 'backOnTrack' | null; // shown once whenever the value changes to 'backOnTrack' (1.2 s)
}
export type PanelAction =
  | { type: 'pause' } | { type: 'resume' } | { type: 'end' }
  | { type: 'pomodoroToggle' } | { type: 'pomodoroSkip' }
  | { type: 'pomodoroPreset'; preset: PomodoroPreset }
  | { type: 'sound'; id: SoundId }
  | { type: 'volume'; value: number }
  | { type: 'openMain' };
export interface FloatingPanelApi {
  show(): Promise<void>;
  hide(): Promise<void>;
  update(state: PanelState): void;                       // fire-and-forget
  onAction(cb: (a: PanelAction) => void): Unsubscribe;   // event 'FLPanelAction'
}

/* ---------- FLNotifications (WS-B) ---------- */
export interface NotificationsApi {
  requestPermission(): Promise<'granted' | 'denied'>;
  post(n: { id: string; title: string; body: string; sound: boolean }): Promise<void>;
}

/* ---------- FLSound (WS-B) ---------- */
export type ChimeKind = 'soft' | 'phase' | 'back';
export interface SoundApi {
  play(id: SoundId, fadeMs?: number): Promise<void>;   // crossfade, default 400 ms; 'off' fades out
  setVolume(v: number): void;                          // 0..1
  duck(factor: number, fadeMs?: number): void;         // 0.3 during breaks, 1 to restore
  chime(kind: ChimeKind): void;
}

/* ---------- FLAppShell (WS-B) ---------- */
export type MenuCommand = 'commandPalette' | 'startSession' | 'endSession';
export interface AppShellApi {
  beginSessionActivity(): void;   // prevents App Nap from throttling JS timers
  endSessionActivity(): void;
  bringToFront(): void;
  onMenuCommand(cb: (c: MenuCommand) => void): Unsubscribe;   // event 'FLMenuCommand'
}

export interface NativeApis {
  screen: ScreenCaptureApi;
  permissions: PermissionsApi;
  webcam: WebcamApi;
  panel: FloatingPanelApi;
  notifications: NotificationsApi;
  sound: SoundApi;
  appShell: AppShellApi;
}
```

## 3. Store: `src/contracts/store.ts`

```ts
import type {
  Chunk, ChunkKind, PomodoroPreset, PomodoroState, SessionSummary, Settings, SoundId, StudyModule,
} from './domain';

export type SessionStatus = 'idle' | 'running' | 'paused' | 'break' | 'ended';
export type OllamaStatus = 'unknown' | 'ok' | 'down' | 'modelMissing';

export interface CurrentCheck {
  kind: ChunkKind | 'starting';
  moduleId: string | null;
  activity: string;
  appName: string | null;
  at: number;                      // epoch ms of the last check
}

export interface StartOptions { pomodoro: PomodoroPreset | 'off'; demo?: boolean }

export interface SessionStoreState {
  status: SessionStatus;
  session: { id: string; startedAt: number; endedAt: number | null } | null;
  timer: { baseS: number; runningSinceMs: number | null };   // focus time only
  chunks: Chunk[];
  current: CurrentCheck | null;
  webcam: { enabled: boolean; personPresent: boolean; phoneVisible: boolean };
  privacy: { framesAnalysed: number; checksWithoutScreenshot: number; framesStored: 0 };
  pomodoro: PomodoroState | null;
  alert: { level: 0 | 1 | 2 | 3; distractedSinceMs: number | null };
  sound: { id: SoundId; volume: number };
  ollama: { status: OllamaStatus; model: string };
  lastSummary: SessionSummary | null;
}

export interface SessionStoreActions {
  start(opts: StartOptions): Promise<void>;
  pause(): void;
  resume(): void;
  end(): Promise<SessionSummary | null>;
  relabelChunk(chunkId: string, patch: Pick<Chunk, 'kind' | 'moduleId' | 'reason'>): Promise<void>;
  setSound(id: SoundId): void;
  setVolume(v: number): void;
  togglePomodoro(): void;
  skipPomodoroPhase(): void;
  refreshOllama(): Promise<void>;
}
export type SessionStore = SessionStoreState & SessionStoreActions;

export interface AppDataState {
  loaded: boolean;
  modules: StudyModule[];
  settings: Settings;
  sessions: SessionSummary[];      // newest first
}
export interface AppDataActions {
  load(): Promise<void>;
  saveModules(m: StudyModule[]): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  getChunks(sessionId: string): Promise<Chunk[]>;
}
export type AppStore = AppDataState & AppDataActions;
```

The store files are `src/store/sessionStore.ts` (`useSessionStore`) and `src/store/appStore.ts` (`useAppStore`), both zustand. Phase 0 creates them with the initial state and no-op actions; WS-C implements the actions. `src/store/navStore.ts` belongs to WS-D (its route list is in the WS-D brief).

## 4. Config: `src/config.ts` (orchestrator-owned values)

```ts
import type { Settings } from './contracts/domain';

export const config = {
  USE_MOCK_NATIVE: true,          // flip to false at the 4:00 checkpoint
  USE_MOCK_CLASSIFIER: true,      // true → classifier derives the verdict from windowTitle, no Ollama
  CHUNK_S: 30,
  DEMO_CHUNK_S: 10,
  CAPTURE: { maxWidth: 1280, jpegQuality: 0.7 },
  CLASSIFY_TIMEOUT_MS: 20_000,
  CACHE_TTL_MS: 120_000,
  WEBCAM_FPS: 1,
  SHOW_DEV_TOOLS: __DEV__,
};

export const DEFAULT_SETTINGS: Settings = {
  model: 'qwen3-vl:4b',
  ollamaUrl: 'http://127.0.0.1:11434',
  strictness: 2,
  demoFast: false,
  webcamEnabled: true,
  soundsEnabled: true,
  defaultSound: 'off',
  volume: 0.5,
  pomodoroDefault: 'off',
  onboarded: false,
};
```

## 5. Facade selection: `src/native/index.ts` (orchestrator)

```ts
import { NativeModules } from 'react-native';
import { config } from '../config';
import type { NativeApis } from '../contracts/native';
import { screen } from './screen';
import { permissions } from './permissions';
import { webcam } from './webcam';
import { panel } from './panel';
import { notifications } from './notifications';
import { sound } from './sound';
import { appShell } from './appShell';
import { mockApis } from './mock';

function pick<K extends keyof NativeApis>(key: K, moduleName: string, real: NativeApis[K]): NativeApis[K] {
  if (config.USE_MOCK_NATIVE) return mockApis[key];
  if (!NativeModules[moduleName]) {
    console.warn(`[native] ${moduleName} missing, using mock`);
    return mockApis[key];
  }
  return real;
}

export const native: NativeApis = {
  screen: pick('screen', 'FLScreenCapture', screen),
  permissions: pick('permissions', 'FLPermissions', permissions),
  webcam: pick('webcam', 'FLWebcam', webcam),
  panel: pick('panel', 'FLFloatingPanel', panel),
  notifications: pick('notifications', 'FLNotifications', notifications),
  sound: pick('sound', 'FLSound', sound),
  appShell: pick('appShell', 'FLAppShell', appShell),
};
```

Phase 0 writes the real facades in full (they're thin; see the pattern below). After that, WS-A owns `screen/permissions/webcam.ts` and WS-B owns `panel/notifications/sound/appShell.ts`.

**Facade pattern:**

```ts
import { NativeModules, NativeEventEmitter } from 'react-native';
import type { WebcamApi } from '../contracts/native';

const M = NativeModules.FLWebcam;
const emitter = M ? new NativeEventEmitter(M) : null;

export const webcam: WebcamApi = {
  start: (o) => M.start(o),
  stop: () => M.stop(),
  capturePhoto: () => M.capturePhoto(),
  onSample: (cb) => {
    const sub = emitter!.addListener('FLWebcamSample', cb);
    return () => sub.remove();
  },
};
```

**Mocks** (`src/native/mock/*.ts`, Phase 0; deterministic, no timers until `start`/`show`):

| Mock | Behaviour |
|---|---|
| `screen` | `getActiveWindow` follows a script and advances every 2 calls: Preview "BIO101 Lecture 4 – Cell division.pdf" → Preview "MATH201 Problem set 3.pdf" → Safari "Instagram" → Safari "Integration by parts – YouTube" → repeat. `capture` returns the current window plus a 1×1 JPEG base64 constant. |
| `permissions` | Everything `granted`. |
| `webcam` | Emits at `fps`. `personPresent` is false 35–60 s into every 120 s; `phoneVisible` is true 80–90 s. |
| `panel`, `sound`, `notifications`, `appShell` | `console.log('[mock X]', <status/title/id only>)`. `onMenuCommand`/`onAction` return a no-op unsubscribe. |

## 6. Fixtures (orchestrator, Phase 0)

The fixtures are split across two files to avoid an import cycle (`store → core/demoMode → fixtures → store`):
- `src/fixtures/data.ts` is pure data and may only use `import type`. Core imports this one.
- `src/fixtures/apply.ts` imports the store. Only the UI and dev tools import it.

**`src/fixtures/data.ts`:**
- `fixtureModules: StudyModule[]`:
  - Biology / green / ["cell", "mitosis", "BIO101"]
  - Maths / blue / ["integral", "matrix", "MATH201"]
  - History / orange / ["revolution", "HIST110"]
- `fixtureChunks: Chunk[]`: a recorded 24-minute session (48 chunks of 30 s) with a mix of Biology, Maths, a 2-minute Instagram distraction (`rule`), 20 s of phone, and 1 minute away. `demoMode` replays it.
- `fixtureSessions: SessionSummary[]`: 30 days of history with gaps and a current 5-day streak.
- `fixtureStates: Record<'idle' | 'running' | 'distracted' | 'break' | 'summary', Partial<SessionStoreState>>`

**`src/fixtures/apply.ts`:**
- `applyFixture(name)`: calls `useSessionStore.setState(fixtureStates[name])`, and for `'summary'` also sets `useAppStore`'s `modules` and `sessions`.

## 7. Native module conventions (Swift ↔ JS)

| JS name | Swift class | Events | Owner |
|---|---|---|---|
| `FLPing` | `FLPing` (Phase 0 smoke test) | `FLPingEvent` | orchestrator |
| `FLScreenCapture` | `FLScreenCapture: NSObject` | none | WS-A |
| `FLPermissions` | `FLPermissions: NSObject` | none | WS-A |
| `FLWebcam` | `FLWebcam: RCTEventEmitter` | `FLWebcamSample` | WS-A |
| `FLFloatingPanel` | `FLFloatingPanel: RCTEventEmitter` | `FLPanelAction` | WS-B |
| `FLNotifications` | `FLNotifications: NSObject` | none | WS-B |
| `FLSound` | `FLSound: NSObject` | none | WS-B |
| `FLAppShell` | `FLAppShell: RCTEventEmitter` | `FLMenuCommand` | WS-B |
| `FLStoryCard` | `FLStoryCard: NSObject` (Phase 2) | none | WS-E |

**Canonical pattern** (`Native/Shared/FLPing.swift` + `FLPing.m`):

```swift
import Foundation

@objc(FLPing)
final class FLPing: RCTEventEmitter {
  private var hasListeners = false
  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["FLPingEvent"] }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  @objc func ping(_ resolve: @escaping RCTPromiseResolveBlock,
                  reject: @escaping RCTPromiseRejectBlock) {
    resolve("pong")
    if hasListeners { sendEvent(withName: "FLPingEvent", body: ["t": Date().timeIntervalSince1970 * 1000]) }
  }
}
```

```objc
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(FLPing, RCTEventEmitter)
RCT_EXTERN_METHOD(ping:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
```

**Selector rule:** Swift `@objc func capture(_ opts: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock)` ↔ `RCT_EXTERN_METHOD(capture:(NSDictionary *)opts resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)`. Void methods with no promise (`update`, `setVolume`, `duck`, `chime`, `beginSessionActivity`, …) are `RCT_EXTERN_METHOD(update:(NSDictionary *)state)`.

**Payloads:** numbers are `Double` (epoch ms), strings, bools, and nested `NSDictionary`. Return JS `null` as `NSNull()`.

The bridging header `Native/Shared/Focusline-Bridging-Header.h` imports `<React/RCTBridgeModule.h>`, `<React/RCTEventEmitter.h>` and `<React/RCTUtils.h>`.

## 8. AsyncStorage keys (labels only, never images)

| Key | Value |
|---|---|
| `fl:modules` | `StudyModule[]` |
| `fl:settings` | `Settings` |
| `fl:sessions` | `SessionSummary[]`, newest first |
| `fl:chunks:<sessionId>` | `Chunk[]` |

`src/core/db.ts` takes an injected `KeyValue { getItem(k), setItem(k, v), removeItem(k) }`. The app passes AsyncStorage; tests pass an in-memory Map.

## 9. Design tokens (shared by `src/ui/theme.ts` and `Native/Shell/NotionColors.swift`)

**Base (light):**

| Token | Value |
|---|---|
| `bg` | `#FFFFFF` |
| `sidebar` | `#F7F6F3` |
| `text` | `#37352F` |
| `muted` | `#787774` |
| `border` | `#E9E9E7` |
| `hover` | `#EFEFED` |
| `accent` | `#2383E2` (primary button) |

**Base (dark, cut item):** `bg #191919`, `sidebar #202020`, `text #FFFFFFCF`.

**Tags** (`bg` / `text`); also used for panel tints (green, red, gray, blue):

| Colour | bg | text |
|---|---|---|
| gray | `#F1F1EF` | `#787774` |
| brown | `#F4EEEE` | `#9F6B53` |
| orange | `#FBECDD` | `#D9730D` |
| yellow | `#FBF3DB` | `#CB912F` |
| green | `#EDF3EC` | `#448361` |
| blue | `#E7F3F8` | `#337EA9` |
| purple | `#F6F3F9` | `#9065B0` |
| pink | `#FAF1F5` | `#C14C8A` |
| red | `#FDEBEC` | `#D44C47` |

**Fonts** (bundled in `macos/Focusline-macOS/Fonts/`, registered with `ATSApplicationFontsPath = Fonts`):
- Inter: Regular, Medium, SemiBold
- Instrument Serif: Regular, Italic

Phase 0 checks the PostScript names with `mdls -name com_apple_ats_name_postscript <file>` and records them here. Expected: `Inter-Regular`, `Inter-Medium`, `Inter-SemiBold`, `InstrumentSerif-Regular`, `InstrumentSerif-Italic`.

**Radius:** 4. **Motion:** 150–250 ms ease-out; springs for widths.
