import type { Chunk, ChunkKind, Settings } from '../../src/contracts/domain';
import { DEFAULT_SETTINGS } from '../../src/config';
import { evaluate, INITIAL_ALERT } from '../../src/core/alerts';
import type { AlertEffect, AlertState } from '../../src/core/alerts';
import { fixtureModules } from '../../src/fixtures/data';

const S: Settings = { ...DEFAULT_SETTINGS, strictness: 2, demoFast: false, soundsEnabled: true };

function chunk(kind: ChunkKind, startedAt: number, durationS = 30, extra: Partial<Chunk> = {}): Chunk {
  return {
    id: `c${startedAt}`,
    sessionId: 's',
    index: 0,
    startedAt,
    durationS,
    kind,
    moduleId: kind === 'subject' ? 'mod_biology' : null,
    reason: kind === 'distracted' ? 'rule' : null,
    activity: kind === 'distracted' ? 'Instagram' : 'Reading',
    confidence: 1,
    source: 'rule',
    appName: 'Safari',
    ...extra,
  };
}

/** Feed chunks back to back; returns the state after each and all effects. */
function run(kinds: ChunkKind[], settings: Settings = S, durationS = 30, start: AlertState = INITIAL_ALERT) {
  let st = start;
  const levels: number[] = [];
  const effects: AlertEffect[][] = [];
  kinds.forEach((k, i) => {
    const c = chunk(k, i * durationS * 1000, durationS);
    const r = evaluate(st, c, settings, c.startedAt + durationS * 1000, fixtureModules);
    st = r.next;
    levels.push(st.level);
    effects.push(r.effects);
  });
  return { st, levels, effects };
}

const types = (e: AlertEffect[]) => e.map((x) => (x.type === 'chime' ? `chime:${x.kind}` : x.type === 'pulse' ? `pulse:${x.on}` : x.type === 'tint' ? `tint:${x.tint}` : x.type));

describe('alerts', () => {
  it('escalates 1 → 2 at strictness min → 3 at 2.5×, normal 30 s chunks', () => {
    const r = run(['subject', ...Array(10).fill('distracted')]);
    // elapsed after each distracted chunk: 30, 60, 90, 120 (L2), …, 300 (L3)
    expect(r.levels).toEqual([0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3]);
    expect(types(r.effects[1])).toEqual(['tint:red']);
    expect(types(r.effects[4])).toEqual(['notify', 'chime:soft']);
    expect(types(r.effects[10])).toEqual(['notify', 'pulse:true']);
    expect(r.effects[4][0]).toEqual({ type: 'notify', level: 2, title: "You've been on Instagram for 2 min", body: 'Back to Biology?' });
    expect(r.effects[10][0]).toMatchObject({ level: 3, title: "You've been on Instagram for 5 min" });
    expect(r.st.distractedSinceMs).toBe(30_000);
  });

  it('demoFast: 20 s / 50 s with 10 s chunks', () => {
    const r = run(['subject', ...Array(5).fill('distracted')], { ...S, demoFast: true }, 10);
    expect(r.levels).toEqual([0, 1, 2, 2, 2, 3]);
    expect(r.effects[2][0]).toMatchObject({ type: 'notify', title: "You've been on Instagram for 20 s" });
  });

  it('strictness 5 / 10', () => {
    expect(run(Array(10).fill('distracted'), { ...S, strictness: 5 }).levels.indexOf(2)).toBe(9); // 300 s
    expect(run(Array(19).fill('distracted'), { ...S, strictness: 10 }).levels.includes(2)).toBe(false); // 570 s < 600 s
    expect(run(Array(20).fill('distracted'), { ...S, strictness: 10 }).levels[19]).toBe(2); // 600 s
  });

  it('recovery: first subject chunk → level 0, green, pulse off, flash, back chime', () => {
    const r = run(['subject', ...Array(10).fill('distracted'), 'subject']);
    expect(r.st).toEqual({ level: 0, distractedSinceMs: null, lastSubjectName: 'Biology' });
    expect(types(r.effects[11])).toEqual(['tint:green', 'pulse:false', 'flash', 'chime:back']);
    // Subject → subject: nothing
    expect(run(['subject', 'subject']).effects[1]).toEqual([]);
  });

  it('away and unknown neither advance nor reset the escalation', () => {
    const r = run(['distracted', 'away', 'unknown', 'distracted']);
    expect(r.levels).toEqual([1, 1, 1, 1]);
    expect(r.effects[1]).toEqual([]);
    expect(r.effects[2]).toEqual([]);
    // The away/unknown minute is not counted: distracted time so far = 60 s.
    expect(r.st.distractedSinceMs).toBe(60_000);
    const away0 = run(['away', 'unknown']);
    expect(away0.levels).toEqual([0, 0]);
    expect(away0.effects.flat()).toEqual([]);
  });

  it('no chimes when sounds are off; phone wording; fallback body', () => {
    const r = run(Array(5).fill('distracted'), { ...S, soundsEnabled: false });
    expect(r.effects.flat().some((e) => e.type === 'chime')).toBe(false);
    const phone = chunk('distracted', 0, 30, { reason: 'phone', activity: 'Phone' });
    const e = evaluate({ level: 1, distractedSinceMs: -120_000, lastSubjectName: null }, phone, S, 30_000).effects;
    expect(e[0]).toMatchObject({ type: 'notify', title: "You've been on your phone for 3 min", body: 'Back to studying?' });
  });
});
