export type TagColor =
  | 'gray' | 'brown' | 'orange' | 'yellow' | 'green'
  | 'blue' | 'purple' | 'pink' | 'red';

export type SoundId = 'off' | 'white' | 'pink' | 'brown' | 'rain' | 'cafe';

/** `system` follows the display. Dark is the landing site's warm paper on near-black. */
export type Appearance = 'system' | 'light' | 'dark';

export interface StudyModule {
  id: string;          // stable, e.g. "mod_k3j9x"
  name: string;        // unique; also used as the VLM enum value, e.g. "Biology"
  color: TagColor;
  keywords: string[];  // prompt hints, e.g. ["mitosis", "cell", "BIO101"]
}

export type ChunkKind = 'subject' | 'distracted' | 'away' | 'unknown';
export type DistractionReason = 'phone' | 'screen' | 'rule';
/** 'embed': the on-device screen model (FLScreenModel, Windows), before Ollama. */
export type ChunkSource = 'vlm' | 'rule' | 'cache' | 'webcam' | 'none' | 'user' | 'title' | 'embed';

export interface Chunk {
  id: string;
  sessionId: string;
  index: number;                      // 0-based within the session
  startedAt: number;                  // epoch ms
  durationS: number;                  // set by the power profile: 10, 15 or 30
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
  source: 'vlm' | 'rule' | 'cache' | 'title' | 'embed';
}

export type Strictness = 2 | 5 | 10;               // minutes until the first notification
export type PowerProfile = 'eco' | 'medium' | 'high';
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
  model: string;                        // 'qwen3-vl:2b'
  /** Which default model this save has already accepted. Missing means the qwen3-vl:4b default. */
  modelDefaultRev: number;
  ollamaUrl: string;                    // 'http://127.0.0.1:11434'
  strictness: Strictness;
  /** How often the screen is read. A session may step down from this; that step is not saved. */
  powerProfile: PowerProfile;
  demoFast: boolean;                    // shorter alerts; check rate comes from powerProfile
  webcamEnabled: boolean;
  /** System now-playing strip on the floating panel. The track title is never stored. */
  nowPlayingEnabled: boolean;
  soundsEnabled: boolean;               // chimes + notification sound
  defaultSound: SoundId;
  volume: number;                       // 0..1
  pomodoroDefault: PomodoroPreset | 'off';
  onboarded: boolean;
  appearance: Appearance;
  /** Supabase project URL. Empty uses the keys bundled in src/social/env.ts. */
  supabaseUrl: string;
  /** Supabase anon key. Empty uses the keys bundled in src/social/env.ts. */
  supabaseAnonKey: string;
}
