import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { BOOT_EXIT_MS, BOOT_INTRO_MS, BOOT_SEGMENTS, BOOT_CENTER, BOOT_HANDS, bootPose, BootScreen, handDiscs, segmentReveal, spinAngle } from '../../src/ui/components/BootScreen';

function textOf(r: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (typeof n === 'object' && 'children' in (n as object)) walk((n as { children: unknown }).children);
  };
  walk(r.toJSON());
  return out.join('');
}

describe('boot pose', () => {
  it('draws the study arc before the others, then rests on the full mark', () => {
    const reveal = (pen: number) => BOOT_SEGMENTS.map((s) => segmentReveal(s, pen));
    const early = bootPose(0, null, false);
    expect(reveal(early.pen).every((t) => t === 0)).toBe(true);
    expect(early.hands).toBe(0);
    expect(early.word).toBe(0);

    const drawing = reveal(bootPose(320, null, false).pen);
    expect(drawing[0]).toBe(1);
    expect(drawing[0]).toBeGreaterThan(drawing[BOOT_SEGMENTS.length - 1]);

    const settled = bootPose(BOOT_INTRO_MS, null, false);
    expect(reveal(settled.pen).every((t) => t === 1)).toBe(true);
    expect(settled.hands).toBe(1);
    expect(settled.crown).toBe(1);
    expect(settled.word).toBe(1);
    expect(settled.cover).toBe(1);
    expect(settled.done).toBe(false);
  });

  it('walks the ring clockwise: study, break, distracted, away', () => {
    const colors = BOOT_SEGMENTS.map((t) => t.color);
    const firstBreak = colors.indexOf('blue');
    const firstDrift = colors.indexOf('yellow');
    const firstAway = colors.indexOf('gray');
    expect(colors.slice(0, firstBreak).every((c) => c === 'green')).toBe(true);
    expect(firstBreak).toBeLessThan(firstDrift);
    expect(firstDrift).toBeLessThan(firstAway);
  });

  it('turns the hands smoothly from rest, the hour hand twelve times slower', () => {
    expect(spinAngle(0)).toBe(0);
    // Starts from rest: the first frame barely moves.
    expect(spinAngle(16)).toBeLessThan(0.01);
    // No step in angle or speed where the ramp ends.
    const end = 600;
    expect(spinAngle(end + 1) - spinAngle(end)).toBeCloseTo(spinAngle(end) - spinAngle(end - 1), 2);
    for (let t = 0; t < 3000; t += 16) expect(spinAngle(t + 16)).toBeGreaterThan(spinAngle(t));

    const p = bootPose(1500, null, false);
    expect(p.minuteDeg).toBeGreaterThan(0);
    expect(p.hourDeg).toBeCloseTo(spinAngle(1500 - 380) / 12);
    const still = bootPose(1500, null, true);
    expect(still.minuteDeg).toBe(0);
    expect(still.hourDeg).toBe(0);
  });

  it('pivots both hands on the clock centre and keeps them inside the ring', () => {
    for (let deg = 0; deg < 360; deg += 5) {
      for (const len of [BOOT_HANDS.hour, BOOT_HANDS.minute]) {
        const discs = handDiscs(deg, len);
        expect(discs[0].x).toBeCloseTo(BOOT_CENTER.x);
        expect(discs[0].y).toBeCloseTo(BOOT_CENTER.y);
        for (const p of discs) {
          const r = Math.hypot(p.x - BOOT_CENTER.x, p.y - BOOT_CENTER.y) + BOOT_HANDS.width / 2;
          expect(r).toBeLessThan(BOOT_HANDS.ringInner);
        }
      }
    }
  });

  it('keeps the hands turning through the exit', () => {
    const a = bootPose(BOOT_INTRO_MS + 100, BOOT_INTRO_MS, false);
    const b = bootPose(BOOT_INTRO_MS + 200, BOOT_INTRO_MS, false);
    expect(b.minuteDeg).not.toBe(a.minuteDeg);
    expect(b.hands).toBe(1);
  });

  it('fades the cover out once the exit has started', () => {
    const mid = bootPose(BOOT_INTRO_MS + BOOT_EXIT_MS / 2, BOOT_INTRO_MS, false);
    expect(mid.cover).toBeLessThan(1);
    expect(mid.cover).toBeGreaterThan(0);
    const gone = bootPose(BOOT_INTRO_MS + BOOT_EXIT_MS, BOOT_INTRO_MS, false);
    expect(gone.cover).toBe(0);
    expect(gone.done).toBe(true);
  });
});

describe('BootScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the name, then leaves once the app is ready', () => {
    const onDone = jest.fn();
    let r: ReactTestRenderer;
    act(() => {
      r = create(<BootScreen ready={false} onDone={onDone} />);
    });
    act(() => {
      jest.advanceTimersByTime(BOOT_INTRO_MS);
    });
    expect(textOf(r!)).toContain('LarpLess');
    expect(onDone).not.toHaveBeenCalled();

    act(() => {
      r!.update(<BootScreen ready onDone={onDone} />);
    });
    // Cross the intro threshold (the clock steps in 16 ms), then play the exit.
    act(() => {
      jest.advanceTimersByTime(32);
    });
    act(() => {
      jest.advanceTimersByTime(BOOT_EXIT_MS + 40);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => r!.unmount());
  });
});
