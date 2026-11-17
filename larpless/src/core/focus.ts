/**
 * Focus metrics: summary, focus %, breakdown, streak, heatmap, period stats. Local-day bucketing via date-fns.
 */
import { addDays, addHours, addMonths, addWeeks, format, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
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

// ── Period stats (#23) ──────────────────────────────────────────────────────────────────────────

export type StatsPeriod = 'day' | 'week' | 'month';

/** One bar of the period chart: an hour of the day, or a day of the week/month. */
export interface PeriodBucket {
  start: number;
  focusS: number;
  totalS: number;
}

export interface PeriodTotals {
  /** Local start of the period (inclusive) and of the next one (exclusive), epoch ms. */
  start: number;
  end: number;
  totalS: number;
  focusS: number;
  /** subject / (subject + distracted) over every session in the period, 0..100, rounded. */
  focusPct: number;
  sessions: number;
}

export interface PeriodStats extends PeriodTotals {
  period: StatsPeriod;
  /** Per module then Distracted, summed over the period's sessions, biggest module first. */
  breakdown: BreakdownEntry[];
  buckets: PeriodBucket[];
  /** The period before, for comparison ("vs yesterday / last week / last month"). */
  previous: PeriodTotals;
}

/** Local start of the period containing `at`. Weeks start on Monday, like History's week groups. */
export function periodStart(period: StatsPeriod, at: number | Date): number {
  const d = toMs(at);
  if (period === 'day') return startOfDay(d).getTime();
  if (period === 'week') return startOfWeek(d, { weekStartsOn: 1 }).getTime();
  return startOfMonth(d).getTime();
}

/** Local start of the period `n` periods after the one starting at `start` (calendar maths, so DST-safe). */
function shiftPeriod(period: StatsPeriod, start: number, n: number): number {
  if (period === 'day') return addDays(start, n).getTime();
  if (period === 'week') return addWeeks(start, n).getTime();
  return addMonths(start, n).getTime();
}

/** A session belongs to the period it started in, like the heatmap and the streak. */
const inRange = (s: SessionSummary, start: number, end: number) => s.startedAt >= start && s.startedAt < end;

/** Distracted seconds of one session, from its breakdown. */
const distractedS = (s: SessionSummary) => s.breakdown.find((e) => e.key === 'distracted')?.seconds ?? 0;

function totalsOf(sessions: readonly SessionSummary[], start: number, end: number): PeriodTotals {
  let totalS = 0;
  let focusS = 0;
  let distracted = 0;
  let n = 0;
  for (const s of sessions) {
    if (!inRange(s, start, end)) continue;
    n += 1;
    totalS += s.totalS;
    focusS += s.focusS;
    distracted += distractedS(s);
  }
  const counted = focusS + distracted;
  return { start, end, totalS, focusS, focusPct: counted ? Math.round((focusS / counted) * 100) : 0, sessions: n };
}

/** Sums the sessions' breakdowns per key; pct is recomputed over the period. Names/colours come from the newest session. */
function mergeBreakdowns(sessions: readonly SessionSummary[]): BreakdownEntry[] {
  const map = new Map<string, BreakdownEntry>();
  const newestFirst = [...sessions].sort((a, b) => b.startedAt - a.startedAt);
  for (const s of newestFirst) {
    for (const e of s.breakdown) {
      const cur = map.get(e.key);
      if (cur) cur.seconds += e.seconds;
      else map.set(e.key, { ...e });
    }
  }
  const all = Array.from(map.values());
  const denom = all.reduce((a, e) => a + e.seconds, 0);
  for (const e of all) e.pct = denom ? round1((e.seconds / denom) * 100) : 0;
  const modulesFirst = all.filter((e) => e.key !== 'distracted').sort((a, b) => b.seconds - a.seconds);
  const distracted = all.filter((e) => e.key === 'distracted');
  return [...modulesFirst, ...distracted];
}

/** Bucket starts: 24 local hours for a day (23 or 25 on a DST change), else each local day. */
function bucketStarts(period: StatsPeriod, start: number, end: number): number[] {
  const out: number[] = [];
  if (period === 'day') {
    for (let t = start; t < end; t = addHours(t, 1).getTime()) out.push(t);
  } else {
    for (let t = start; t < end; t = addDays(t, 1).getTime()) out.push(t);
  }
  return out;
}

/**
 * Focus stats for the day, week (Monday start) or month containing `now`, in local time, plus the totals of the
 * period before. `offset` steps back (−1) or forward through periods. Sessions count in the period they started in.
 */
export function periodStats(
  sessions: readonly SessionSummary[],
  period: StatsPeriod,
  now: number | Date,
  offset = 0,
): PeriodStats {
  const start = shiftPeriod(period, periodStart(period, now), offset);
  const end = shiftPeriod(period, start, 1);
  const inPeriod = sessions.filter((s) => inRange(s, start, end));

  const starts = bucketStarts(period, start, end);
  const buckets: PeriodBucket[] = starts.map((t) => ({ start: t, focusS: 0, totalS: 0 }));
  for (const s of inPeriod) {
    // Last bucket starting at or before the session (buckets are few: ≤ 31).
    let i = starts.length - 1;
    while (i > 0 && starts[i] > s.startedAt) i -= 1;
    buckets[i].focusS += s.focusS;
    buckets[i].totalS += s.totalS;
  }

  return {
    period,
    ...totalsOf(inPeriod, start, end),
    breakdown: mergeBreakdowns(inPeriod),
    buckets,
    previous: totalsOf(sessions, shiftPeriod(period, start, -1), start),
  };
}
