import type { Chunk, ChunkKind, SessionSummary } from '../../src/contracts/domain';
import { breakdown, computeSummary, focusPct, heatmap, streak } from '../../src/core/focus';
import { fixtureChunks, fixtureModules, fixtureSessions, fixtureSummary } from '../../src/fixtures/data';

function chunk(kind: ChunkKind, moduleId: string | null = null, durationS = 30): Chunk {
  return {
    id: Math.random().toString(36),
    sessionId: 's',
    index: 0,
    startedAt: 0,
    durationS,
    kind,
    moduleId: kind === 'subject' ? moduleId : null,
    reason: kind === 'distracted' ? 'screen' : null,
    activity: '',
    confidence: 1,
    source: 'vlm',
    appName: null,
  };
}

function ses(startedAt: number, totalS: number): SessionSummary {
  return { id: `s${startedAt}`, startedAt, endedAt: startedAt + totalS * 1000, totalS, focusS: 0, focusPct: 0, breakdown: [], pomodoros: 0 };
}

const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('focus', () => {
  it('focusPct excludes away and unknown', () => {
    const chunks = [chunk('subject', 'mod_biology'), chunk('subject', 'mod_maths'), chunk('subject', 'mod_maths'), chunk('distracted'), chunk('away'), chunk('unknown')];
    expect(focusPct(chunks)).toBe(75);
    expect(focusPct([chunk('away'), chunk('unknown')])).toBe(0);
    expect(focusPct([])).toBe(0);
  });

  it('breakdown: subjects in module order, then distracted; pct of subject + distracted', () => {
    const chunks = [chunk('subject', 'mod_maths'), chunk('subject', 'mod_maths'), chunk('subject', 'mod_biology'), chunk('distracted'), chunk('away')];
    expect(breakdown(chunks, fixtureModules)).toEqual([
      { key: 'mod_biology', label: 'Biology', color: 'green', seconds: 30, pct: 25 },
      { key: 'mod_maths', label: 'Maths', color: 'blue', seconds: 60, pct: 50 },
      { key: 'distracted', label: 'Distracted', color: 'red', seconds: 30, pct: 25 },
    ]);
    expect(breakdown([chunk('subject', 'mod_gone')], fixtureModules)).toEqual([
      { key: 'other', label: 'Other module', color: 'gray', seconds: 30, pct: 100 },
    ]);
    expect(breakdown([], fixtureModules)).toEqual([]);
  });

  it('computeSummary on the fixture session matches the fixture summary numbers', () => {
    const s = computeSummary(
      { id: fixtureSummary.id, startedAt: fixtureSummary.startedAt, endedAt: fixtureSummary.endedAt },
      fixtureChunks,
      fixtureModules,
      0,
    );
    expect(s.totalS).toBe(fixtureSummary.totalS);
    expect(s.focusS).toBe(fixtureSummary.focusS);
    expect(s.focusPct).toBe(fixtureSummary.focusPct);
    expect(s.endedAt).toBe(fixtureSummary.endedAt);
    const byKey = (b: typeof s.breakdown) => Object.fromEntries(b.map((e) => [e.key, [e.seconds, e.pct]]));
    expect(byKey(s.breakdown)).toEqual(byKey(fixtureSummary.breakdown));
    expect(s.breakdown.map((e) => e.key)).toEqual(['mod_biology', 'mod_maths', 'distracted']);
  });

  it('computeSummary uses the timer totalS when given', () => {
    const s = computeSummary({ id: 'x', startedAt: 0, endedAt: null }, [chunk('subject', 'mod_biology')], fixtureModules, 2, 42.4, 99_000);
    expect(s).toMatchObject({ totalS: 42, focusS: 30, pomodoros: 2, endedAt: 99_000 });
  });

  describe('streak', () => {
    it('counts consecutive qualifying days ending today', () => {
      const today = at(2026, 10, 9, 18);
      expect(streak([ses(at(2026, 10, 9, 9), 900), ses(at(2026, 10, 8), 1200), ses(at(2026, 10, 7), 3000), ses(at(2026, 10, 5), 3000)], today)).toBe(3);
    });

    it('ends yesterday when today has nothing yet; 0 when the last one is older', () => {
      const today = at(2026, 10, 9, 8);
      expect(streak([ses(at(2026, 10, 8), 900), ses(at(2026, 10, 7), 900)], today)).toBe(2);
      expect(streak([ses(at(2026, 10, 7), 900)], today)).toBe(0);
    });

    it('ignores sessions shorter than 15 min', () => {
      const today = at(2026, 10, 9, 20);
      expect(streak([ses(at(2026, 10, 9), 899), ses(at(2026, 10, 8), 900)], today)).toBe(1);
      expect(streak([ses(at(2026, 10, 9), 600), ses(at(2026, 10, 9, 14), 600)], today)).toBe(0);
    });

    it('buckets by local start day across midnight', () => {
      // 23:50 on the 8th (counts for the 8th), then 00:10 on the 9th → 2 days.
      const today = at(2026, 10, 9, 0, 40);
      expect(streak([ses(at(2026, 10, 9, 0, 10), 1200), ses(at(2026, 10, 8, 23, 50), 1200)], today)).toBe(2);
      // A single session crossing midnight counts only for its start day → today empty, yesterday 1.
      expect(streak([ses(at(2026, 10, 8, 23, 50), 3600)], at(2026, 10, 9, 1))).toBe(1);
    });

    it('fixture sessions have a current 5-day streak', () => {
      expect(streak(fixtureSessions, Date.now())).toBe(5);
    });
  });

  it('heatmap: weeks × 7 days ending today, oldest first, minutes per day', () => {
    const today = at(2026, 10, 9, 15);
    const h = heatmap([ses(at(2026, 10, 9, 9), 1800), ses(at(2026, 10, 9, 14), 600), ses(at(2026, 10, 1), 3000), ses(at(2025, 1, 1), 3000)], today);
    expect(h).toHaveLength(84);
    expect(h[83]).toEqual({ date: '2026-10-09', minutes: 40 });
    expect(h.find((d) => d.date === '2026-10-01')?.minutes).toBe(50);
    expect(h[0].date).toBe('2026-07-18');
    expect(h.reduce((a, d) => a + d.minutes, 0)).toBe(90);
    expect(heatmap([], today, 4)).toHaveLength(28);
  });
});
