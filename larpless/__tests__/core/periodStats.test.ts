import type { BreakdownEntry, SessionSummary } from '../../src/contracts/domain';
import { periodStart, periodStats } from '../../src/core/focus';

/** Local wall-clock time; every expectation below is built the same way, so the suite holds in any time zone. */
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

const bio = (seconds: number): BreakdownEntry => ({ key: 'mod_biology', label: 'Biology', color: 'green', seconds, pct: 0 });
const maths = (seconds: number): BreakdownEntry => ({ key: 'mod_maths', label: 'Maths', color: 'blue', seconds, pct: 0 });
const distracted = (seconds: number): BreakdownEntry => ({ key: 'distracted', label: 'Distracted', color: 'red', seconds, pct: 0 });

function ses(startedAt: number, breakdown: BreakdownEntry[], totalS?: number): SessionSummary {
  const focusS = breakdown.filter((e) => e.key !== 'distracted').reduce((a, e) => a + e.seconds, 0);
  const sum = breakdown.reduce((a, e) => a + e.seconds, 0);
  const t = totalS ?? sum;
  return { id: `s${startedAt}`, startedAt, endedAt: startedAt + t * 1000, totalS: t, focusS, focusPct: 0, breakdown, pomodoros: 0 };
}

describe('periodStart', () => {
  const wed = at(2026, 11, 18, 15, 30); // Wednesday
  it('day starts at local midnight', () => expect(periodStart('day', wed)).toBe(at(2026, 11, 18, 0)));
  it('week starts on Monday', () => expect(periodStart('week', wed)).toBe(at(2026, 11, 16, 0)));
  it('a Sunday belongs to the week that started the Monday before', () =>
    expect(periodStart('week', at(2026, 11, 22, 23, 59))).toBe(at(2026, 11, 16, 0)));
  it('month starts on the 1st', () => expect(periodStart('month', wed)).toBe(at(2026, 11, 1, 0)));
});

describe('periodStats', () => {
  it('a session at 23:59 and one at 00:00 land on different days', () => {
    const late = ses(at(2026, 11, 17, 23, 59), [bio(600)]);
    const early = ses(at(2026, 11, 18, 0, 0), [maths(1200)]);
    const day = periodStats([late, early], 'day', at(2026, 11, 18, 9));
    expect(day.sessions).toBe(1);
    expect(day.focusS).toBe(1200);
    expect(day.previous.sessions).toBe(1);
    expect(day.previous.focusS).toBe(600);
  });

  it('sums totals and weights focus % by time, not by session', () => {
    const now = at(2026, 11, 18);
    // 90 min at 100% and 10 min at 0%: the period is 90%, not the 50% average of the two sessions.
    const s = [ses(at(2026, 11, 16, 9), [bio(5400)]), ses(at(2026, 11, 17, 9), [distracted(600)])];
    const week = periodStats(s, 'week', now);
    expect(week).toMatchObject({ period: 'week', totalS: 6000, focusS: 5400, focusPct: 90, sessions: 2 });
  });

  it('away/unknown time (in totalS, not in the breakdown) does not lower focus %', () => {
    const week = periodStats([ses(at(2026, 11, 16), [bio(600)], 1800)], 'week', at(2026, 11, 18));
    expect(week.totalS).toBe(1800);
    expect(week.focusPct).toBe(100);
  });

  it('merges breakdowns: modules biggest first, Distracted last, pct of the period', () => {
    const s = [
      ses(at(2026, 11, 2), [bio(600), distracted(300)]),
      ses(at(2026, 11, 9), [maths(1800), bio(300)]),
    ];
    expect(periodStats(s, 'month', at(2026, 11, 18)).breakdown).toEqual([
      { ...maths(1800), pct: 60 },
      { ...bio(900), pct: 30 },
      { ...distracted(300), pct: 10 },
    ]);
  });

  it('takes module names from the newest session (renamed modules)', () => {
    const old = ses(at(2026, 11, 2), [{ ...bio(600), label: 'Bio' }]);
    const recent = ses(at(2026, 11, 9), [bio(600)]);
    expect(periodStats([old, recent], 'month', at(2026, 11, 18)).breakdown[0].label).toBe('Biology');
  });

  it('day: one bucket per hour, sessions in the hour they started', () => {
    const day = periodStats([ses(at(2026, 11, 18, 14, 45), [bio(1200)])], 'day', at(2026, 11, 18));
    expect(day.buckets[0].start).toBe(at(2026, 11, 18, 0));
    expect(day.buckets.reduce((a, b) => a + b.focusS, 0)).toBe(1200);
    expect(day.buckets.find((b) => b.focusS > 0)?.start).toBe(at(2026, 11, 18, 14));
  });

  it('week: 7 daily buckets Monday→Sunday', () => {
    const week = periodStats([ses(at(2026, 11, 22, 20), [bio(60)])], 'week', at(2026, 11, 18));
    expect(week.buckets.map((b) => b.start)).toEqual([16, 17, 18, 19, 20, 21, 22].map((d) => at(2026, 11, d, 0)));
    expect(week.buckets[6].focusS).toBe(60);
  });

  it('month: one bucket per day of that month (28, 29, 30 or 31)', () => {
    const len = (y: number, mo: number) => periodStats([], 'month', at(y, mo, 10)).buckets.length;
    expect(len(2026, 2)).toBe(28);
    expect(len(2028, 2)).toBe(29);
    expect(len(2026, 4)).toBe(30);
    expect(len(2026, 12)).toBe(31);
  });

  it('periods end at the next local midnight even across a DST change', () => {
    // Late March / late October contain the EU and US switches; the expectations use the local calendar.
    expect(periodStats([], 'day', at(2026, 3, 29)).end).toBe(at(2026, 3, 30, 0));
    expect(periodStats([], 'week', at(2026, 3, 25)).end).toBe(at(2026, 3, 30, 0));
    expect(periodStats([], 'week', at(2026, 10, 28)).end).toBe(at(2026, 11, 2, 0));
    expect(periodStats([], 'month', at(2026, 3, 10)).end).toBe(at(2026, 4, 1, 0));
    for (const d of [at(2026, 3, 8), at(2026, 3, 29), at(2026, 10, 25), at(2026, 11, 1)]) {
      const day = periodStats([], 'day', d);
      expect(day.buckets.length).toBe(Math.round((day.end - day.start) / 3_600_000));
    }
  });

  it('previous is the period right before, and offset steps back', () => {
    const now = at(2026, 1, 14);
    const month = periodStats([ses(at(2025, 12, 31, 23), [bio(600)])], 'month', now);
    expect(month.previous).toMatchObject({ start: at(2025, 12, 1, 0), end: at(2026, 1, 1, 0), focusS: 600, sessions: 1 });
    const back = periodStats([], 'month', now, -1);
    expect(back.start).toBe(at(2025, 12, 1, 0));
    expect(back.previous.start).toBe(at(2025, 11, 1, 0));
  });

  it('empty input gives zeros, not NaN', () => {
    const week = periodStats([], 'week', at(2026, 11, 18));
    expect(week).toMatchObject({ totalS: 0, focusS: 0, focusPct: 0, sessions: 0, breakdown: [] });
    expect(week.previous.focusPct).toBe(0);
  });
});
