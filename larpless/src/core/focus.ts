/**
 * Focus metrics: summary, focus %, breakdown, streak, heatmap. Local-day bucketing via date-fns.
 */
import { addDays, format, startOfDay } from 'date-fns';
import type { BreakdownEntry, Chunk, SessionSummary, StudyModule } from '../contracts/domain';

/** A day counts towards the streak when it has a session of at least 15 min. */
export const STREAK_MIN_S = 15 * 60;

const round1 = (x: number) => Math.round(x * 10) / 10;

/** subject / (all − away − unknown), 0..100, rounded. 0 when nothing counts. */
export function focusPct(chunks: readonly Chunk[]): number {
  let subject = 0;
  let counted = 0;
  for (const c of chunks) {
    if (c.kind === 'subject') subject += c.durationS;
    if (c.kind === 'subject' || c.kind === 'distracted') counted += c.durationS;
  }
  return counted ? Math.round((subject / counted) * 100) : 0;
}

/**
 * Seconds per module (in module order) then 'Distracted'. pct is of subject + distracted seconds.
 * Chunks pointing at a deleted module are grouped under "Other module" (gray), after the modules.
 */
export function breakdown(chunks: readonly Chunk[], modules: readonly StudyModule[]): BreakdownEntry[] {
  const perModule = new Map<string, number>();
  let distracted = 0;
  for (const c of chunks) {
    if (c.kind === 'subject' && c.moduleId) perModule.set(c.moduleId, (perModule.get(c.moduleId) ?? 0) + c.durationS);
    else if (c.kind === 'distracted') distracted += c.durationS;
  }
  let denom = distracted;
  perModule.forEach((s) => {
    denom += s;
  });
  const pct = (s: number) => (denom ? round1((s / denom) * 100) : 0);

  const out: BreakdownEntry[] = [];
  const known = new Set<string>();
  for (const m of modules) {
    known.add(m.id);
    const s = perModule.get(m.id);
    if (s) out.push({ key: m.id, label: m.name, color: m.color, seconds: s, pct: pct(s) });
  }
  let orphan = 0;
  perModule.forEach((s, id) => {
    if (!known.has(id)) orphan += s;
  });
  if (orphan) out.push({ key: 'other', label: 'Other module', color: 'gray', seconds: orphan, pct: pct(orphan) });
  if (distracted) out.push({ key: 'distracted', label: 'Distracted', color: 'red', seconds: distracted, pct: pct(distracted) });
  return out;
}

export interface SessionTimes {
  id: string;
  startedAt: number;
  endedAt: number | null;
}

/**
 * @param totalS focus-phase running time (excludes pauses and breaks). Defaults to the sum of chunk durations.
 */
export function computeSummary(
  session: SessionTimes,
  chunks: readonly Chunk[],
  modules: readonly StudyModule[],
  pomodoros: number,
  totalS?: number,
  endedAt?: number,
): SessionSummary {
  const sum = chunks.reduce((a, c) => a + c.durationS, 0);
  const focusS = chunks.filter((c) => c.kind === 'subject').reduce((a, c) => a + c.durationS, 0);
  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? endedAt ?? session.startedAt + sum * 1000,
    totalS: Math.round(totalS ?? sum),
    focusS,
    focusPct: focusPct(chunks),
    breakdown: breakdown(chunks, modules),
    pomodoros,
  };
}

const toMs = (d: number | Date) => (typeof d === 'number' ? d : d.getTime());

/** Local calendar days (yyyy-MM-dd) that have a qualifying session. */
function qualifyingDays(sessions: readonly SessionSummary[]): Set<string> {
  const days = new Set<string>();
  for (const s of sessions) if (s.totalS >= STREAK_MIN_S) days.add(format(s.startedAt, 'yyyy-MM-dd'));
  return days;
}

/** Consecutive days with a qualifying session, ending today or yesterday. */
export function streak(sessions: readonly SessionSummary[], today: number | Date): number {
  const days = qualifyingDays(sessions);
  let day = startOfDay(toMs(today));
  if (!days.has(format(day, 'yyyy-MM-dd'))) {
    day = addDays(day, -1);
    if (!days.has(format(day, 'yyyy-MM-dd'))) return 0;
  }
  let n = 0;
  while (days.has(format(day, 'yyyy-MM-dd'))) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}

/** weeks × 7 days ending today (oldest first), minutes of totalS per local day. */
export function heatmap(
  sessions: readonly SessionSummary[],
  today: number | Date,
  weeks = 12,
): { date: string; minutes: number }[] {
  const perDay = new Map<string, number>();
  for (const s of sessions) {
    const k = format(s.startedAt, 'yyyy-MM-dd');
    perDay.set(k, (perDay.get(k) ?? 0) + s.totalS);
  }
  const end = startOfDay(toMs(today));
  const n = weeks * 7;
  const out: { date: string; minutes: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = format(addDays(end, -i), 'yyyy-MM-dd');
    out.push({ date, minutes: Math.round((perDay.get(date) ?? 0) / 60) });
  }
  return out;
}
