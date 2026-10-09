/**
 * Distraction escalation (PLAN.md §8), as a pure function of the previous state and the new chunk.
 *
 * Level 1: first distracted chunk → panel red.
 * Level 2: distracted continuously ≥ strictness min (20 s in demoFast) → notification + soft chime.
 * Level 3: ≥ 2.5 × strictness (50 s in demoFast) → 2nd notification + pulse.
 * Recovery: first subject chunk → level 0, flash "back on track", 'back' chime.
 * `away` and `unknown` neither advance nor reset (their time is not counted towards the next level).
 * The controller never evaluates during breaks.
 */
import type { Chunk, Settings, StudyModule } from '../contracts/domain';
import type { ChimeKind, PanelTint } from '../contracts/native';

export type AlertLevel = 0 | 1 | 2 | 3;

export interface AlertState {
  level: AlertLevel;
  /** Start of the current continuous distraction (epoch ms), null when not distracted. */
  distractedSinceMs: number | null;
  /** Name of the last module studied, for "Back to {subject}?". */
  lastSubjectName: string | null;
}

export const INITIAL_ALERT: AlertState = { level: 0, distractedSinceMs: null, lastSubjectName: null };

export type AlertEffect =
  | { type: 'tint'; tint: PanelTint }
  | { type: 'notify'; level: 2 | 3; title: string; body: string }
  | { type: 'chime'; kind: ChimeKind }
  | { type: 'pulse'; on: boolean }
  | { type: 'flash' };

export function thresholdsMs(settings: Pick<Settings, 'strictness' | 'demoFast'>): { level2: number; level3: number } {
  if (settings.demoFast) return { level2: 20_000, level3: 50_000 };
  const base = settings.strictness * 60_000;
  return { level2: base, level3: base * 2.5 };
}

/** "45 s" under a minute, else "3 min". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}

function distractionName(chunk: Chunk): string {
  if (chunk.reason === 'phone') return 'your phone';
  return chunk.activity.trim() || 'something else';
}

export function evaluate(
  prev: AlertState,
  chunk: Chunk,
  settings: Pick<Settings, 'strictness' | 'demoFast' | 'soundsEnabled'>,
  now: number,
  modules: readonly Pick<StudyModule, 'id' | 'name'>[] = [],
): { next: AlertState; effects: AlertEffect[] } {
  const effects: AlertEffect[] = [];

  if (chunk.kind === 'away' || chunk.kind === 'unknown') {
    // Pause the escalation clock: shift the start forward by this chunk so away time isn't counted.
    if (prev.distractedSinceMs === null) return { next: prev, effects };
    return { next: { ...prev, distractedSinceMs: prev.distractedSinceMs + chunk.durationS * 1000 }, effects };
  }

  if (chunk.kind === 'subject') {
    const name = modules.find((m) => m.id === chunk.moduleId)?.name ?? prev.lastSubjectName;
    const next: AlertState = { level: 0, distractedSinceMs: null, lastSubjectName: name };
    if (prev.level > 0) {
      effects.push({ type: 'tint', tint: 'green' });
      if (prev.level === 3) effects.push({ type: 'pulse', on: false });
      effects.push({ type: 'flash' });
      if (settings.soundsEnabled) effects.push({ type: 'chime', kind: 'back' });
    }
    return { next, effects };
  }

  // distracted
  const since = prev.distractedSinceMs ?? chunk.startedAt;
  const elapsed = Math.max(0, now - since);
  const { level2, level3 } = thresholdsMs(settings);
  const target: AlertLevel = elapsed >= level3 ? 3 : elapsed >= level2 ? 2 : 1;
  const level = (Math.max(prev.level, target) as AlertLevel);
  const next: AlertState = { level, distractedSinceMs: since, lastSubjectName: prev.lastSubjectName };

  if (prev.level === 0) effects.push({ type: 'tint', tint: 'red' });
  if (level > prev.level && level >= 2) {
    const lvl = level as 2 | 3;
    effects.push({
      type: 'notify',
      level: lvl,
      title: `You've been on ${distractionName(chunk)} for ${formatDuration(elapsed)}`,
      body: prev.lastSubjectName ? `Back to ${prev.lastSubjectName}?` : 'Back to studying?',
    });
    if (prev.level < 2 && settings.soundsEnabled) effects.push({ type: 'chime', kind: 'soft' });
    if (lvl === 3) effects.push({ type: 'pulse', on: true });
  }
  return { next, effects };
}
