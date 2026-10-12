import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { BOOT_EXIT_MS, BOOT_INTRO_MS, BOOT_TICKS, bootPose, BootScreen } from '../../src/ui/components/BootScreen';

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
    const early = bootPose(0, null, false);
    expect(early.ticks.every((t) => t === 0)).toBe(true);
    expect(early.word).toBe(0);

    const drawing = bootPose(220, null, false);
    expect(drawing.ticks[0]).toBeGreaterThan(drawing.ticks[1]);
    expect(drawing.word).toBe(0);

    const settled = bootPose(BOOT_INTRO_MS, null, false);
    expect(settled.ticks.every((t) => t === 1)).toBe(true);
    expect(settled.hands).toBe(1);
    expect(settled.crown).toBe(1);
    expect(settled.word).toBe(1);
    expect(settled.cover).toBe(1);
    expect(settled.done).toBe(false);
  });

  it('walks the ring clockwise: study, break, distracted, away', () => {
    const colors = BOOT_TICKS.map((t) => t.color);
    const firstBreak = colors.indexOf('blue');
    const firstDrift = colors.indexOf('red');
    const firstAway = colors.indexOf('gray');
    expect(colors.slice(0, firstBreak).every((c) => c === 'green')).toBe(true);
    expect(firstBreak).toBeLessThan(firstDrift);
    expect(firstDrift).toBeLessThan(firstAway);
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
