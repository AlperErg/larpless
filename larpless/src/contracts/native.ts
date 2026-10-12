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
  /** During a live session: show if hidden, re-front if already visible (no placement reset). */
  ensureVisible(): Promise<void>;
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
  stopOllama(): void;             // quit the Ollama LarpLess opened (never the user's own); the loaded model goes with it
  onMenuCommand(cb: (c: MenuCommand) => void): Unsubscribe;   // event 'FLMenuCommand'
  /** The system is about to sleep (macOS willSleep). The session pauses at that moment. */
  onSystemSleep(cb: (e: { at: number }) => void): Unsubscribe;   // event 'FLSystemSleep'
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
  /**
   * Quits the Ollama app LarpLess opened with launch(), and the server it started. The loaded model goes
   * with them. An Ollama the user started (even one restart() relaunched) is left running: resolves at once.
   * Rejects E_TIMEOUT if a process won't exit.
   */
  quit(): Promise<void>;
}

// ---- Keychain (secrets kept out of AsyncStorage) ----
/**
 * Small secrets stored outside AsyncStorage's plain JSON: the macOS Keychain (items only this app can read
 * without asking), or on Windows a DPAPI-encrypted file. Holds the Supabase session.
 */
export interface KeychainApi {
  /** null when there is no such item. */
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  /** No-op when there is no such item. */
  removeItem(key: string): Promise<void>;
}

/* ---------- FLScreenModel (Windows only for now) ---------- */
/**
 * On-device screen classifier: SigLIP 2 image embeddings + Windows OCR text embedded with MiniLM, via ONNX
 * Runtime. Returns scores only; src/core/screenModel.ts turns them into a verdict. The macOS app has no
 * counterpart yet: there `native.screenModel.status()` reports `supported: false` and the classifier skips it.
 */
export interface ScreenModelFile {
  /** One of 'siglip2-vision.onnx', 'minilm.onnx', 'minilm-vocab.txt'. */
  name: string;
  /** https://huggingface.co/… pinned to a commit. */
  url: string;
  sha256: string;
  size: number;
}
export interface ScreenModelStatus {
  /** False where the native module doesn't exist (macOS, tests without a mock). */
  supported: boolean;
  /** Every file is in the model folder with the expected size. */
  installed: boolean;
  missing: string[];
  /** Sessions are in memory (about 1 GB). */
  loaded: boolean;
}
export interface ScreenModelProgress {
  name: string;
  receivedBytes: number;
  totalBytes: number;
  fileIndex: number;
  fileCount: number;
}
export interface ScreenModelInput {
  /** Capture width (the power profile's), at least 224. */
  maxWidth: number;
  /** BCP-47 tag for Windows OCR; default 'en-US'. */
  ocrLanguage?: string;
  /**
   * Labels to score the screen text against (module descriptions, distraction descriptions). `keywords` are
   * matched as whole words (case-insensitive) in the window title + screen text.
   */
  texts: { id: string; text: string; keywords?: string[] }[];
}
export interface ScreenModelScores extends ActiveWindow {
  width: number;
  height: number;
  capturedAt: number;
  /** Logit per fixed SigLIP prompt: 'lib_<subject>', 'study:<i>', 'distract:<i>'. */
  image: Record<string, number>;
  /** Cosine between the title + screen text and each input text; null when there was no text at all. */
  text: Record<string, number> | null;
  /** How many of each input's keywords appear as whole words; null when there was no text at all. */
  keywords: Record<string, number> | null;
  /** Characters OCR found. The text itself never leaves native code. */
  ocrChars: number;
  timings: { captureMs: number; ocrMs: number; imageMs: number; textMs: number };
}
export interface ScreenModelApi {
  status(files: Pick<ScreenModelFile, 'name' | 'size'>[]): Promise<ScreenModelStatus>;
  /** Downloads missing files, checking size and SHA-256. Rejects E_BUSY / E_DOWNLOAD / E_CHECKSUM / E_CANCELLED. */
  download(files: ScreenModelFile[]): Promise<void>;
  cancelDownload(): Promise<void>;
  onProgress(cb: (p: ScreenModelProgress) => void): Unsubscribe; // event 'FLScreenModelProgress'
  /** Captures and scores the screen. Rejects E_NOT_INSTALLED / E_MODEL / E_CAPTURE. */
  classify(input: ScreenModelInput): Promise<ScreenModelScores>;
  /** Frees the model sessions. */
  unload(): Promise<void>;
}

export interface NativeApis {
  screen: ScreenCaptureApi;
  screenModel: ScreenModelApi;
  permissions: PermissionsApi;
  webcam: WebcamApi;
  panel: FloatingPanelApi;
  notifications: NotificationsApi;
  sound: SoundApi;
  appShell: AppShellApi;
  nowPlaying: NowPlayingApi;
  ollamaHost: OllamaHostApi;
  keychain: KeychainApi;
}
