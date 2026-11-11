import { greeting, homeGreeting } from '../../src/ui/lib/format';

/** Local time on a day in November 2026 (the 9th is a Monday). */
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 30).getTime();

/** Twelve weeks; days past 30 roll over into the following months. */
const DAYS = Array.from({ length: 84 }, (_, i) => i + 1);

describe('greeting', () => {
  it('matches the time of day', () => {
    const seen = (hour: number) => new Set(DAYS.map((d) => greeting(at(d, hour))));
    expect(seen(3)).toContain('Burning the midnight oil');
    expect(seen(9)).toContain('Good morning');
    expect(seen(14)).toContain('Good afternoon');
    expect(seen(19)).toContain('Good evening');
    expect(seen(23)).toContain('Late one tonight');
    // Nothing leaks between bands.
    expect(seen(9).has('Good afternoon')).toBe(false);
    expect(seen(14).has('Good morning')).toBe(false);
    expect(seen(3).has('Good morning')).toBe(false);
  });

  it('varies from day to day and uses every line of a band', () => {
    expect(new Set(DAYS.map((d) => greeting(at(d, 9)))).size).toBe(4);
    expect(new Set(DAYS.map((d) => greeting(at(d, 14)))).size).toBe(3);
    expect(greeting(at(10, 9))).not.toBe(greeting(at(11, 9)));
  });

  it('is stable within a band on the same day', () => {
    expect(greeting(at(10, 6))).toBe(greeting(at(10, 11)));
    expect(homeGreeting(at(10, 6), 4)).toBe(homeGreeting(at(10, 11), 4));
  });
});

describe('homeGreeting', () => {
  it('is the opener plus a closing line', () => {
    for (const d of DAYS) {
      const now = at(d, 9);
      expect(homeGreeting(now)).toMatch(new RegExp(`^${greeting(now)}\\. \\S.*[.?]$`));
    }
  });

  it('varies the closing line', () => {
    const tails = new Set(DAYS.map((d) => homeGreeting(at(d, 9)).replace(/^[^.]+\. /, '')));
    expect(tails).toContain('Ready when you are.');
    // 11 always in the pool + Monday, Friday and Sunday.
    expect(tails.size).toBe(14);
  });

  it('has streak and friends lines whatever the streak', () => {
    const tails = new Set(DAYS.map((d) => homeGreeting(at(d, 9), 0).replace(/^[^.]+\. /, '')));
    expect(tails).toContain('A session today keeps the streak going.');
    expect(tails).toContain('Studying is easier with friends.');
  });

  it('each visit shows a different greeting, and every closing line within one day', () => {
    const now = at(10, 9); // a Tuesday: 11 closing lines
    const visits = Array.from({ length: 11 }, (_, v) => homeGreeting(now, 0, v));
    expect(new Set(visits).size).toBe(11);
    expect(new Set(visits.map((l) => l.replace(/^[^.]+\. /, ''))).size).toBe(11);
    expect(homeGreeting(now, 0, 1)).not.toBe(homeGreeting(now, 0, 0));
    // The opener still fits the time of day.
    expect(visits.every((l) => /^(Good morning|Morning|Rise and shine|Early start)\. /.test(l))).toBe(true);
    // Same visit, same line.
    expect(homeGreeting(now, 0, 3)).toBe(homeGreeting(now, 0, 3));
  });

  it('stays short enough for one line', () => {
    const all = DAYS.flatMap((d) => [3, 9, 14, 19, 23].map((h) => homeGreeting(at(d, h), 120, d)));
    expect(Math.max(...all.map((l) => l.length))).toBeLessThanOrEqual(70);
  });

  it('weekday lines only show on their day', () => {
    const lines = (day: number) => [3, 9, 14, 19, 23].map((h) => homeGreeting(at(day, h)));
    const monday = 'New week, clean slate.';
    // 2 November 2026 is a Monday; days past 30 roll over into the following months.
    const mondays = Array.from({ length: 14 }, (_, k) => 2 + 7 * k);
    expect(mondays.flatMap(lines).some((l) => l.endsWith(monday))).toBe(true);
    expect([3, 4, 5, 6, 7, 8].flatMap(lines).some((l) => l.endsWith(monday))).toBe(false);
  });

  it('mentions the streak only from two days', () => {
    const withStreak = (streak: number) => DAYS.map((d) => homeGreeting(at(d, 9), streak));
    expect(withStreak(5).some((l) => l.endsWith('5-day streak. Keep it going.'))).toBe(true);
    expect(withStreak(1).some((l) => l.includes('-day streak'))).toBe(false);
    expect(withStreak(0).some((l) => l.includes('-day streak'))).toBe(false);
  });
});
