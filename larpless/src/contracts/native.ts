import type { PomodoroPhase, PomodoroPreset, SoundId } from './domain';

export type Unsubscribe = () => void;

/* ---------- FLScreenCapture (WS-A) ---------- */
export interface ActiveWindow {
  appName: string | null;      // "Safari"
  bundleId: string | null;     // "com.apple.Safari"
  windowTitle: string | null;  // null when Screen Recording is not granted
  isSelf: boolean;             // LarpLess is frontmost
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
  /** Main display, LarpLess's own windows excluded, no cursor. Rejects E_PERMISSION / E_CAPTURE. */
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
  /** Light or dark. `system` is resolved in JS before this is called. */
  setColorScheme(scheme: 'light' | 'dark'): void;
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

/* ---------- FLNowPlaying ---------- */
export interface NowPlayingApi {
  setEnabled(on: boolean): void;
}

/* ---------- FLAppShell (WS-B) ---------- */
export type MenuCommand = 'commandPalette' | 'startSession' | 'endSession';
export interface AppShellApi {
  beginSessionActivity(): void;   // prevents App Nap from throttling JS timers
  endSessionActivity(): void;
  bringToFront(): void;
  stopOllama(): void;             // quit the local Ollama app and server; the loaded model goes with them
  onMenuCommand(cb: (c: MenuCommand) => void): Unsubscribe;   // event 'FLMenuCommand'
}

/* ---------- FLOllama ---------- */
/**
 * llama.cpp's RAM prompt cache in the running Ollama server (env LLAMA_ARG_CACHE_RAM). 'default' means
 * unset, i.e. up to 8 GiB of old prompts, one ~340 MB entry per screenshot that LarpLess never reuses.
 */
export type OllamaPromptCache = 'off' | 'default' | 'custom';
export interface OllamaHostInfo {
  /** Ollama.app is installed, so LarpLess can open and restart it. */
  appInstalled: boolean;
  /** The `ollama` command is installed (Homebrew, or the link the app creates). */
  cliInstalled: boolean;
  appRunning: boolean;
  /** Who runs `ollama serve`: Ollama.app, something else (a terminal, Homebrew), or nothing. */
  server: 'app' | 'other' | null;
  /** That server's prompt cache; null when no server runs or its environment can't be read. */
  promptCache: OllamaPromptCache | null;
}
export interface OllamaHostApi {
  info(): Promise<OllamaHostInfo>;
  /** Opens Ollama.app in the background with the prompt cache off; no-op when it's running. Rejects E_NOT_INSTALLED. */
  launch(): Promise<void>;
  /**
   * Quits Ollama.app and opens it again with the prompt cache off, keeping its OLLAMA_/LLAMA_ variables.
   * Rejects E_NOT_RUNNING, or E_TIMEOUT when Ollama doesn't quit.
   */
  restart(): Promise<void>;
}

export interface NativeApis {
  screen: ScreenCaptureApi;
  permissions: PermissionsApi;
  webcam: WebcamApi;
  panel: FloatingPanelApi;
  notifications: NotificationsApi;
  sound: SoundApi;
  appShell: AppShellApi;
  nowPlaying: NowPlayingApi;
  ollamaHost: OllamaHostApi;
}
