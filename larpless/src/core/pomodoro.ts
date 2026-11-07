/**
 * Pomodoro as a pure reducer. Everything is computed from `phaseEndsAtMs` (never by counting ticks),
 * so a late or skipped tick can't drift the clock.
 */
import type { PomodoroCustom, PomodoroPhase, PomodoroPreset, PomodoroState } from '../contracts/domain';

const MIN = 60_000;

export interface PresetSpec {
  focusMs: number;
  breakMs: number;
  /** null → no long break (every break is a short one). */
  longBreakMs: number | null;
  roundsBeforeLong: number;
}

export const POMODORO_PRESETS: Record<Exclude<PomodoroPreset, 'custom'>, PresetSpec> = {
  '25/5': { focusMs: 25 * MIN, breakMs: 5 * MIN, longBreakMs: 15 * MIN, roundsBeforeLong: 4 },
  '50/10': { focusMs: 50 * MIN, breakMs: 10 * MIN, longBreakMs: null, roundsBeforeLong: 4 },
  demo: { focusMs: 2 * MIN, breakMs: 1 * MIN, longBreakMs: 1 * MIN, roundsBeforeLong: 4 },
};

/** Limits (minutes) for the custom preset's study and break lengths. */
export const CUSTOM_LIMITS = { focusMin: { min: 1, max: 180 }, breakMin: { min: 1, max: 60 } } as const;
export const DEFAULT_CUSTOM: PomodoroCustom = { focusMin: 45, breakMin: 15 };

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** A valid custom spec from anything (a stale save, a half-typed field): whole minutes within CUSTOM_LIMITS. */
export function cleanCustom(raw: unknown): PomodoroCustom {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    focusMin: clampInt(src.focusMin, CUSTOM_LIMITS.focusMin.min, CUSTOM_LIMITS.focusMin.max, DEFAULT_CUSTOM.focusMin),
    breakMin: clampInt(src.breakMin, CUSTOM_LIMITS.breakMin.min, CUSTOM_LIMITS.breakMin.max, DEFAULT_CUSTOM.breakMin),
  };
}

/** The lengths for a preset. 'custom' has no long break: every break is the one length the user picked. */
export function presetSpec(preset: PomodoroPreset, custom?: PomodoroCustom): PresetSpec {
  if (preset !== 'custom') return POMODORO_PRESETS[preset];
  const c = cleanCustom(custom);
  return { focusMs: c.focusMin * MIN, breakMs: c.breakMin * MIN, longBreakMs: null, roundsBeforeLong: 4 };
}

const specOf = (state: Pick<PomodoroState, 'preset' | 'custom'>) => presetSpec(state.preset, state.custom);

export type PomodoroEvent = { from: PomodoroPhase; to: PomodoroPhase } | null;

export function phaseDurationMs(state: Pick<PomodoroState, 'preset' | 'custom'>, phase: PomodoroPhase): number {
  const p = specOf(state);
  if (phase === 'focus') return p.focusMs;
  if (phase === 'longBreak') return p.longBreakMs ?? p.breakMs;
  return p.breakMs;
}

export function isBreak(phase: PomodoroPhase): boolean {
  return phase !== 'focus';
}

/** `custom` is read only for the 'custom' preset, and copied into the state so the phase lengths stay fixed. */
export function initPomodoro(preset: PomodoroPreset, now: number, completed = 0, custom?: PomodoroCustom): PomodoroState {
  const spec = presetSpec(preset, custom);
  return {
    enabled: true,
    preset,
    phase: 'focus',
    round: 1,
    roundsBeforeLong: spec.roundsBeforeLong,
    phaseEndsAtMs: now + spec.focusMs,
    completed,
    ...(preset === 'custom' ? { custom: cleanCustom(custom) } : {}),
  };
}

/** The phase after `state.phase`, starting at `startMs`. `countCompleted` is false for a skipped focus round. */
function advance(state: PomodoroState, startMs: number, countCompleted: boolean): PomodoroState {
  const spec = specOf(state);
  if (state.phase === 'focus') {
    const lastRound = state.round >= state.roundsBeforeLong;
    const phase: PomodoroPhase = lastRound && spec.longBreakMs !== null ? 'longBreak' : 'break';
    return {
      ...state,
      phase,
      completed: state.completed + (countCompleted ? 1 : 0),
      phaseEndsAtMs: startMs + phaseDurationMs(state, phase),
    };
  }
  const round = state.round >= state.roundsBeforeLong ? 1 : state.round + 1;
  return { ...state, phase: 'focus', round, phaseEndsAtMs: startMs + spec.focusMs };
}

/**
 * Advance through every phase that has ended by `now`. Each next phase starts exactly when the
 * previous one ended (drift-free). `event` spans the whole jump: from the old phase to the new one.
 */
export function tick(state: PomodoroState, now: number): { state: PomodoroState; event: PomodoroEvent } {
  if (!state.enabled || now < state.phaseEndsAtMs) return { state, event: null };
  const from = state.phase;
  let s = state;
  // Bounded loop (e.g. after the Mac slept): at most a day's worth of phases.
  for (let i = 0; i < 1000 && now >= s.phaseEndsAtMs; i++) s = advance(s, s.phaseEndsAtMs, true);
  return { state: s, event: { from, to: s.phase } };
}

/** End the current phase now. A skipped focus round doesn't count as completed. */
export function skip(state: PomodoroState, now: number): { state: PomodoroState; event: PomodoroEvent } {
  if (!state.enabled) return { state, event: null };
  const next = advance(state, now, false);
  return { state: next, event: { from: state.phase, to: next.phase } };
}

/**
 * Enable/disable. Disabling keeps the counters; enabling (again) starts a fresh focus phase from `now`.
 * `fallbackPreset` is used when there is no state yet.
 */
export function toggle(
  state: PomodoroState | null,
  now: number,
  fallbackPreset: PomodoroPreset = '25/5',
  fallbackCustom?: PomodoroCustom,
): PomodoroState {
  if (state && state.enabled) return { ...state, enabled: false };
  return initPomodoro(state?.preset ?? fallbackPreset, now, state?.completed ?? 0, state?.custom ?? fallbackCustom);
}

/** How much of the phase is left at `now` (the frozen value while paused). */
export function remainingMs(state: PomodoroState, now: number): number {
  return state.pausedRemainingMs ?? Math.max(0, state.phaseEndsAtMs - now);
}

/** Freeze for a pause: the countdown shows `pausedRemainingMs` until `thaw`. */
export function freeze(state: PomodoroState, now: number): PomodoroState {
  return { ...state, pausedRemainingMs: remainingMs(state, now) };
}

/** Thaw after a pause: the phase ends the frozen time after `now`. */
export function thaw(state: PomodoroState, now: number): PomodoroState {
  const { pausedRemainingMs, ...rest } = state;
  return pausedRemainingMs === undefined ? state : { ...rest, phaseEndsAtMs: now + pausedRemainingMs };
}
