/**
 * Pure fixture data. Only `import type` is allowed in this file (core imports it;
 * `apply.ts` is the one that touches the stores).
 *
 * All timestamps are relative to `Date.now()` at module load.
 */
import type {
  BreakdownEntry,
  Chunk,
  ChunkKind,
  ChunkSource,
  DistractionReason,
  PomodoroState,
  SessionSummary,
  StudyModule,
  TagColor,
} from '../contracts/domain';
import type { CurrentCheck, SessionStoreState } from '../contracts/store';

const NOW = Date.now();
const MIN = 60_000;
const CHUNK_S = 30;
const CHUNK_MS = CHUNK_S * 1000;

const START_OF_TODAY = (() => {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

/** Local-time timestamp `daysAgo` calendar days before today at hh:mm (DST-safe). */
function dayAt(daysAgo: number, hh: number, mm: number): number {
  const d = new Date(START_OF_TODAY);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, hh, mm, 0, 0).getTime();
}

/* ------------------------------------------------------------------ */
/* Modules                                                             */
/* ------------------------------------------------------------------ */

export const fixtureModules: StudyModule[] = [
  { id: 'mod_biology', name: 'Biology', color: 'green', keywords: ['cell', 'mitosis', 'BIO101'] },
  { id: 'mod_maths', name: 'Maths', color: 'blue', keywords: ['integral', 'matrix', 'MATH201'] },
  { id: 'mod_history', name: 'History', color: 'orange', keywords: ['revolution', 'HIST110'] },
];

const BIO = 'mod_biology';
const MATHS = 'mod_maths';

/* ------------------------------------------------------------------ */
/* Recorded session: 48 chunks × 30 s = 24 min                        */
/* ------------------------------------------------------------------ */

export const FIXTURE_SESSION_ID = 'ses_fixture';

/** The recorded session ended a minute ago (clamped so it always falls on today). */
const RECORDED_START = Math.max(NOW - 25 * MIN, START_OF_TODAY + MIN);

interface Segment {
  count: number;
  kind: ChunkKind;
  moduleId: string | null;
  reason: DistractionReason | null;
  activity: string;
  appName: string | null;
  /** Source of the first chunk in the run; later ones are 'cache' with a 'vlm' refresh every 4 chunks. */
  source: ChunkSource;
  confidence: number;
}

const SEGMENTS: Segment[] = [
  { count: 12, kind: 'subject', moduleId: BIO, reason: null, activity: 'Reading cell division slides', appName: 'Preview', source: 'vlm', confidence: 0.92 },
  { count: 4, kind: 'distracted', moduleId: null, reason: 'rule', activity: 'Instagram', appName: 'Safari', source: 'rule', confidence: 1 },
  { count: 4, kind: 'subject', moduleId: BIO, reason: null, activity: 'Reading cell division slides', appName: 'Preview', source: 'vlm', confidence: 0.9 },
  { count: 1, kind: 'distracted', moduleId: null, reason: 'phone', activity: 'Phone', appName: 'Preview', source: 'webcam', confidence: 0.86 },
  { count: 13, kind: 'subject', moduleId: MATHS, reason: null, activity: 'Working on MATH201 problem set', appName: 'Preview', source: 'vlm', confidence: 0.88 },
  { count: 2, kind: 'away', moduleId: null, reason: null, activity: 'Away from desk', appName: null, source: 'webcam', confidence: 0.95 },
  { count: 12, kind: 'subject', moduleId: MATHS, reason: null, activity: 'Watching integration by parts lecture', appName: 'Safari', source: 'vlm', confidence: 0.84 },
];

function buildChunks(segments: Segment[], start: number, firstIndex = 0): Chunk[] {
  const out: Chunk[] = [];
  let index = firstIndex;
  for (const seg of segments) {
    for (let i = 0; i < seg.count; i++) {
      // Subject runs: VLM on the first chunk and every 4th one (CACHE_TTL 120 s), cache in between.
      const source: ChunkSource = seg.source === 'vlm' && i % 4 !== 0 ? 'cache' : seg.source;
      out.push({
        id: `chk_fixture_${String(index).padStart(2, '0')}`,
        sessionId: FIXTURE_SESSION_ID,
        index,
        startedAt: start + (index - firstIndex) * CHUNK_MS,
        durationS: CHUNK_S,
        kind: seg.kind,
        moduleId: seg.moduleId,
        reason: seg.reason,
        activity: seg.activity,
        confidence: source === 'cache' ? Math.round((seg.confidence - 0.02) * 100) / 100 : seg.confidence,
        source,
        appName: seg.appName,
      });
      index += 1;
    }
  }
  return out;
}

export const fixtureChunks: Chunk[] = buildChunks(SEGMENTS, RECORDED_START);

/* ------------------------------------------------------------------ */
/* Summary (computed simply from chunks)                               */
/* ------------------------------------------------------------------ */

const round1 = (x: number) => Math.round(x * 10) / 10;

function summarize(
  id: string,
  startedAt: number,
  endedAt: number,
  chunks: Chunk[],
  modules: StudyModule[],
  pomodoros: number,
): SessionSummary {
  let totalS = 0;
  let distractedS = 0;
  let excludedS = 0; // away + unknown
  const perModule = new Map<string, number>();
  for (const c of chunks) {
    totalS += c.durationS;
    if (c.kind === 'subject' && c.moduleId) {
      perModule.set(c.moduleId, (perModule.get(c.moduleId) ?? 0) + c.durationS);
    } else if (c.kind === 'distracted') {
      distractedS += c.durationS;
    } else {
      excludedS += c.durationS;
    }
  }
  let focusS = 0;
  perModule.forEach((s) => {
    focusS += s;
  });
  const denom = focusS + distractedS;
  const breakdown: BreakdownEntry[] = modules
    .filter((m) => perModule.has(m.id))
    .map((m) => {
      const seconds = perModule.get(m.id) ?? 0;
      return { key: m.id, label: m.name, color: m.color, seconds, pct: denom ? round1((seconds / denom) * 100) : 0 };
    })
    .sort((a, b) => b.seconds - a.seconds);
  if (distractedS > 0) {
    breakdown.push({ key: 'distracted', label: 'Distracted', color: 'red', seconds: distractedS, pct: round1((distractedS / denom) * 100) });
  }
  const counted = totalS - excludedS;
  return {
    id,
    startedAt,
    endedAt,
    totalS,
    focusS,
    focusPct: counted ? Math.round((focusS / counted) * 100) : 0,
    breakdown,
    pomodoros,
  };
}

const RECORDED_END = RECORDED_START + fixtureChunks.length * CHUNK_MS;

export const fixtureSummary: SessionSummary = summarize(
  FIXTURE_SESSION_ID,
  RECORDED_START,
  RECORDED_END,
  fixtureChunks,
  fixtureModules,
  0,
);

/* ------------------------------------------------------------------ */
/* History: 20 sessions over 30 days, gaps, current 5-day streak       */
/* ------------------------------------------------------------------ */

const MODULE_COLOR: Record<string, TagColor> = Object.fromEntries(fixtureModules.map((m) => [m.id, m.color]));
const MODULE_NAME: Record<string, string> = Object.fromEntries(fixtureModules.map((m) => [m.id, m.name]));

/** [daysAgo, hh, mm, totalMin, focusPct, split by module (shares sum to 1), pomodoros] */
type HistRow = [number, number, number, number, number, Array<[string, number]>, number];

// Day 0 is the recorded session above. Days 0–4 form the current streak; day 5 is a gap.
const HISTORY: HistRow[] = [
  [1, 19, 30, 52, 86, [[MATHS, 0.7], [BIO, 0.3]], 2],
  [2, 10, 0, 28, 91, [[BIO, 1]], 1],
  [2, 16, 15, 45, 78, [[MATHS, 0.6], ['mod_history', 0.4]], 1],
  [3, 14, 0, 61, 83, [[BIO, 0.5], [MATHS, 0.5]], 2],
  [4, 20, 45, 33, 74, [['mod_history', 1]], 1],
  [6, 11, 30, 40, 80, [[MATHS, 1]], 1],
  [7, 15, 0, 25, 69, [[BIO, 0.8], ['mod_history', 0.2]], 1],
  [9, 9, 45, 12, 62, [[BIO, 1]], 0],
  [10, 13, 30, 55, 88, [[MATHS, 0.5], [BIO, 0.5]], 2],
  [10, 21, 0, 20, 71, [['mod_history', 1]], 0],
  [12, 17, 15, 48, 82, [[BIO, 0.6], [MATHS, 0.4]], 1],
  [15, 10, 30, 35, 76, [[MATHS, 1]], 1],
  [16, 14, 45, 26, 90, [[BIO, 1]], 1],
  [18, 19, 0, 50, 67, [[MATHS, 0.4], ['mod_history', 0.6]], 2],
  [21, 11, 0, 30, 85, [[BIO, 0.7], [MATHS, 0.3]], 1],
  [22, 16, 0, 18, 58, [['mod_history', 1]], 0],
  [25, 9, 30, 42, 79, [[MATHS, 0.8], [BIO, 0.2]], 1],
  [27, 15, 30, 27, 84, [[BIO, 1]], 1],
  [29, 13, 0, 38, 73, [[MATHS, 0.5], ['mod_history', 0.5]], 1],
];

function histSession([daysAgo, hh, mm, totalMin, focusPct, split, pomodoros]: HistRow, i: number): SessionSummary {
  const startedAt = dayAt(daysAgo, hh, mm);
  const totalS = totalMin * 60;
  const focusS = Math.round((totalS * focusPct) / 100);
  const distractedS = totalS - focusS;
  const breaks = pomodoros * 5 * 60; // break time is excluded from totalS
  let assigned = 0;
  const breakdown: BreakdownEntry[] = split.map(([moduleId, share], k) => {
    const seconds = k === split.length - 1 ? focusS - assigned : Math.round(focusS * share);
    assigned += seconds;
    return { key: moduleId, label: MODULE_NAME[moduleId], color: MODULE_COLOR[moduleId], seconds, pct: round1((seconds / totalS) * 100) };
  });
  breakdown.sort((a, b) => b.seconds - a.seconds);
  if (distractedS > 0) {
    breakdown.push({ key: 'distracted', label: 'Distracted', color: 'red', seconds: distractedS, pct: round1((distractedS / totalS) * 100) });
  }
  return {
    id: `ses_hist_${String(i + 1).padStart(2, '0')}`,
    startedAt,
    endedAt: startedAt + (totalS + breaks) * 1000,
    totalS,
    focusS,
    focusPct,
    breakdown,
    pomodoros,
  };
}

/** Newest first. `fixtureSessions[0]` is the recorded session (today). */
export const fixtureSessions: SessionSummary[] = [fixtureSummary, ...HISTORY.map(histSession)].sort(
  (a, b) => b.startedAt - a.startedAt,
);

/* ------------------------------------------------------------------ */
/* Store snapshots                                                     */
/* ------------------------------------------------------------------ */

/** Re-anchor a slice of chunks so the first one starts at `start` (ids/indices unchanged). */
function anchor(chunks: Chunk[], start: number): Chunk[] {
  return chunks.map((c, i) => ({ ...c, startedAt: start + i * CHUNK_MS }));
}

function checkOf(c: Chunk): CurrentCheck {
  return { kind: c.kind, moduleId: c.moduleId, activity: c.activity, appName: c.appName, at: c.startedAt + c.durationS * 1000 };
}

function privacyOf(chunks: Chunk[]): SessionStoreState['privacy'] {
  const framesAnalysed = chunks.filter((c) => c.source === 'vlm').length;
  return { framesAnalysed, checksWithoutScreenshot: chunks.length - framesAnalysed, framesStored: 0 };
}

function focusPomodoro(sessionStart: number): PomodoroState {
  return {
    enabled: true,
    preset: '25/5',
    phase: 'focus',
    round: 1,
    roundsBeforeLong: 4,
    phaseEndsAtMs: sessionStart + 25 * MIN,
    completed: 0,
  };
}

const OLLAMA_OK: SessionStoreState['ollama'] = { status: 'ok', model: 'qwen3-vl:4b' };
const WEBCAM_PRESENT: SessionStoreState['webcam'] = { enabled: true, personPresent: true, phoneVisible: false };
const NO_ALERT: SessionStoreState['alert'] = { level: 0, distractedSinceMs: null };

// running: 15 min in (chunks 0–29, currently on the Maths problem set), 10 s into chunk 30.
const RUNNING_DONE = 30;
const RUNNING_START = NOW - RUNNING_DONE * CHUNK_MS - 10_000;
const runningChunks = anchor(fixtureChunks.slice(0, RUNNING_DONE), RUNNING_START);

// distracted: 8 min in (chunks 0–15); the last 4 chunks are Instagram → 2 min continuous → level 2.
const DISTRACTED_DONE = 16;
const DISTRACTED_START = NOW - DISTRACTED_DONE * CHUNK_MS - 5_000;
const distractedChunks = anchor(fixtureChunks.slice(0, DISTRACTED_DONE), DISTRACTED_START);
const firstInstagram = distractedChunks.find((c) => c.reason === 'rule');

// break: the first 25-min focus round is done (48 recorded + 2 more Maths chunks = 50 × 30 s),
// and the 5-min break started 90 s ago.
const BREAK_FOCUS_S = 25 * 60;
const BREAK_START = NOW - BREAK_FOCUS_S * 1000 - 90_000;
const breakChunks = anchor(
  [
    ...fixtureChunks,
    ...buildChunks(
      [{ count: 2, kind: 'subject', moduleId: MATHS, reason: null, activity: 'Watching integration by parts lecture', appName: 'Safari', source: 'cache', confidence: 0.86 }],
      0,
      fixtureChunks.length,
    ),
  ],
  BREAK_START,
);

export type FixtureName = 'idle' | 'running' | 'distracted' | 'break' | 'summary';

export const fixtureStates: Record<FixtureName, Partial<SessionStoreState>> = {
  idle: {
    status: 'idle',
    session: null,
    timer: { baseS: 0, runningSinceMs: null },
    chunks: [],
    current: null,
    webcam: WEBCAM_PRESENT,
    privacy: { framesAnalysed: 0, checksWithoutScreenshot: 0, framesStored: 0 },
    pomodoro: null,
    alert: NO_ALERT,
    sound: { id: 'off', volume: 0.5 },
    ollama: OLLAMA_OK,
    lastSummary: null,
  },
  running: {
    status: 'running',
    session: { id: FIXTURE_SESSION_ID, startedAt: RUNNING_START, endedAt: null },
    timer: { baseS: 0, runningSinceMs: RUNNING_START },
    chunks: runningChunks,
    current: checkOf(runningChunks[runningChunks.length - 1]),
    webcam: WEBCAM_PRESENT,
    privacy: privacyOf(runningChunks),
    pomodoro: focusPomodoro(RUNNING_START),
    alert: NO_ALERT,
    sound: { id: 'brown', volume: 0.5 },
    ollama: OLLAMA_OK,
    lastSummary: null,
  },
  distracted: {
    status: 'running',
    session: { id: FIXTURE_SESSION_ID, startedAt: DISTRACTED_START, endedAt: null },
    timer: { baseS: 0, runningSinceMs: DISTRACTED_START },
    chunks: distractedChunks,
    current: checkOf(distractedChunks[distractedChunks.length - 1]),
    webcam: WEBCAM_PRESENT,
    privacy: privacyOf(distractedChunks),
    pomodoro: focusPomodoro(DISTRACTED_START),
    alert: { level: 2, distractedSinceMs: firstInstagram ? firstInstagram.startedAt : null },
    sound: { id: 'brown', volume: 0.5 },
    ollama: OLLAMA_OK,
    lastSummary: null,
  },
  break: {
    status: 'break',
    session: { id: FIXTURE_SESSION_ID, startedAt: BREAK_START, endedAt: null },
    timer: { baseS: BREAK_FOCUS_S, runningSinceMs: null },
    chunks: breakChunks,
    current: checkOf(breakChunks[breakChunks.length - 1]),
    webcam: WEBCAM_PRESENT,
    privacy: privacyOf(breakChunks),
    pomodoro: {
      enabled: true,
      preset: '25/5',
      phase: 'break',
      round: 1,
      roundsBeforeLong: 4,
      phaseEndsAtMs: BREAK_START + BREAK_FOCUS_S * 1000 + 5 * MIN,
      completed: 1,
    },
    alert: NO_ALERT,
    sound: { id: 'brown', volume: 0.5 },
    ollama: OLLAMA_OK,
    lastSummary: null,
  },
  summary: {
    status: 'ended',
    session: { id: FIXTURE_SESSION_ID, startedAt: RECORDED_START, endedAt: RECORDED_END },
    timer: { baseS: fixtureSummary.totalS, runningSinceMs: null },
    chunks: fixtureChunks,
    current: null,
    webcam: WEBCAM_PRESENT,
    privacy: privacyOf(fixtureChunks),
    pomodoro: null,
    alert: NO_ALERT,
    sound: { id: 'off', volume: 0.5 },
    ollama: OLLAMA_OK,
    lastSummary: fixtureSummary,
  },
};
