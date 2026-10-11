import type {
  Chunk, ChunkKind, PomodoroPreset, PomodoroState, SessionSummary, Settings, SoundId, StudyModule,
} from './domain';
import type { OllamaHostInfo } from './native';

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

/** What prepareOllama() found or did (core/ollamaHost.ts). */
export type OllamaPrepareOutcome =
  | 'remote'      // the Ollama URL isn't this Mac: nothing to manage
  | 'missing'     // Ollama isn't installed
  | 'down'        // not running, and LarpLess didn't (or couldn't) start it
  | 'launched'    // LarpLess opened Ollama.app with the prompt cache off
  | 'restarted'   // LarpLess restarted Ollama.app to turn the prompt cache off
  | 'ready'       // running, prompt cache already off (or set by the user)
  | 'busy'        // prompt cache on, but another model is loaded, so Ollama was left alone
  | 'external'    // prompt cache on (or unreadable), but the server isn't Ollama.app's: LarpLess can't restart it
  | 'failed';     // a launch or restart didn't work, or Ollama didn't answer within 20 s

export type ModelPull =
  | { status: 'idle' }
  | { status: 'pulling'; completed: number; total: number }
  | { status: 'done' }
  | { status: 'error'; message: string };

export interface OllamaSetupState {
  host: OllamaHostInfo | null;
  /** null until prepare() has run. */
  prepared: OllamaPrepareOutcome | null;
  /** A launch or restart is in progress. */
  starting: boolean;
  pull: ModelPull;
}
export interface OllamaSetupActions {
  refreshHost(): Promise<void>;
  /**
   * Opens Ollama.app when `launch` and it's down, and restarts it without the prompt cache when no other
   * model is loaded (or `force`). Calls run one at a time. Never rejects.
   */
  prepare(opts: { launch: boolean; force?: boolean }): Promise<OllamaPrepareOutcome>;
  /** Download settings.model through Ollama's /api/pull. */
  pullModel(): Promise<void>;
  /** Stop the download; Ollama resumes it next time. */
  cancelPull(): void;
}
export type OllamaSetupStore = OllamaSetupState & OllamaSetupActions;

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
