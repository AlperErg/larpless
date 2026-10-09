import { initPomodoro, remainingMs, resumeWith, skip, tick, toggle } from '../../src/core/pomodoro';

const MIN = 60_000;

describe('pomodoro', () => {
  it('initPomodoro: focus round 1, ends after the preset focus length', () => {
    expect(initPomodoro('25/5', 0)).toEqual({ enabled: true, preset: '25/5', phase: 'focus', round: 1, roundsBeforeLong: 4, phaseEndsAtMs: 25 * MIN, completed: 0 });
    expect(initPomodoro('50/10', 1000).phaseEndsAtMs).toBe(1000 + 50 * MIN);
    expect(initPomodoro('demo', 0).phaseEndsAtMs).toBe(2 * MIN);
  });

  it('tick: nothing before phaseEndsAtMs, then focus → break (completed + 1)', () => {
    const s0 = initPomodoro('25/5', 0);
    expect(tick(s0, 25 * MIN - 1)).toEqual({ state: s0, event: null });
    const { state, event } = tick(s0, 25 * MIN);
    expect(event).toEqual({ from: 'focus', to: 'break' });
    expect(state).toMatchObject({ phase: 'break', completed: 1, round: 1, phaseEndsAtMs: 30 * MIN });
  });

  it('25/5: long break (15 min) after 4 focus rounds, then round 1 again', () => {
    let s = initPomodoro('25/5', 0);
    const phases: string[] = [];
    let t = 0;
    for (let i = 0; i < 9; i++) {
      t = s.phaseEndsAtMs;
      const r = tick(s, t);
      s = r.state;
      phases.push(`${s.phase}:${s.round}`);
    }
    expect(phases).toEqual(['break:1', 'focus:2', 'break:2', 'focus:3', 'break:3', 'focus:4', 'longBreak:4', 'focus:1', 'break:1']);
    expect(s.completed).toBe(5);
    // 4 × 25 + 3 × 5 + 15 + 25 = 155 min into the session at the last transition
    expect(t).toBe(155 * MIN);
  });

  it('50/10: no long break', () => {
    let s = initPomodoro('50/10', 0);
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      s = tick(s, s.phaseEndsAtMs).state;
      seen.add(s.phase);
    }
    expect([...seen].sort()).toEqual(['break', 'focus']);
    expect(s.phaseEndsAtMs).toBe(5 * 60 * MIN + 50 * MIN); // 5 × (50 + 10), then the 6th focus
  });

  it('demo preset: 2 / 1 / 1', () => {
    let s = initPomodoro('demo', 0);
    s = tick(s, 2 * MIN).state;
    expect(s).toMatchObject({ phase: 'break', phaseEndsAtMs: 3 * MIN });
    s = tick(s, 3 * MIN).state;
    expect(s).toMatchObject({ phase: 'focus', round: 2, phaseEndsAtMs: 5 * MIN });
  });

  it('is computed from phaseEndsAtMs, not tick counts: a late tick jumps several phases without drift', () => {
    const s0 = initPomodoro('25/5', 0);
    const { state, event } = tick(s0, 31 * MIN); // focus ended at 25, break ended at 30
    expect(event).toEqual({ from: 'focus', to: 'focus' });
    expect(state).toMatchObject({ phase: 'focus', round: 2, completed: 1, phaseEndsAtMs: 55 * MIN });
  });

  it('skip: ends the phase now; a skipped focus round is not completed', () => {
    const s0 = initPomodoro('25/5', 0);
    const a = skip(s0, 10 * MIN);
    expect(a.event).toEqual({ from: 'focus', to: 'break' });
    expect(a.state).toMatchObject({ phase: 'break', completed: 0, phaseEndsAtMs: 15 * MIN });
    const b = skip(a.state, 11 * MIN);
    expect(b.state).toMatchObject({ phase: 'focus', round: 2, phaseEndsAtMs: 36 * MIN });
  });

  it('toggle: disable keeps counters and stops ticking; enable restarts focus from now', () => {
    let s = tick(initPomodoro('25/5', 0), 25 * MIN).state;
    const off = toggle(s, 26 * MIN);
    expect(off.enabled).toBe(false);
    expect(tick(off, 99 * MIN)).toEqual({ state: off, event: null });
    expect(skip(off, 99 * MIN).event).toBeNull();
    s = toggle(off, 40 * MIN);
    expect(s).toMatchObject({ enabled: true, phase: 'focus', round: 1, completed: 1, phaseEndsAtMs: 65 * MIN, preset: '25/5' });
    expect(toggle(null, 0, 'demo')).toMatchObject({ enabled: true, preset: 'demo' });
  });

  it('pause/resume helpers keep the remaining time', () => {
    const s = initPomodoro('25/5', 0);
    const left = remainingMs(s, 10 * MIN);
    expect(left).toBe(15 * MIN);
    expect(resumeWith(s, 50 * MIN, left).phaseEndsAtMs).toBe(65 * MIN);
  });
});
