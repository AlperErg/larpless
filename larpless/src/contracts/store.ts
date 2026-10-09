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
