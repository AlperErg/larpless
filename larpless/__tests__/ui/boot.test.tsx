import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import {
  BOOT_EXIT_MS,
  BOOT_IDLE_EVERY,
  BOOT_IDLE_FROM,
  BOOT_INTRO_MS,
  EYE_CENTERS,
  GLANCE_DX,
  bootPose,
  BootScreen,
  eyeHole,
  mascotPath,
} from '../../src/ui/components/BootScreen';

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
  it('wakes with its eyes shut, looks at you, blinks, then rests in the icon pose', () => {
    const first = bootPose(0, null, false);
    expect(first.body).toBe(0);
    expect(first.lid).toBe(1);
    expect(first.eyeX).toBe(0);
    expect(first.word).toBe(0);

    // Locked in: open and centred, before the blink.
    const looking = bootPose(560, null, false);
    expect(looking.lid).toBe(0);
    expect(looking.eyeX).toBe(0);

    // The blink shuts the eyes again for a moment.
    const lids = Array.from({ length: 30 }, (_, i) => bootPose(600 + i * 10, null, false).lid);
    expect(Math.max(...lids)).toBeGreaterThan(0.9);

    const settled = bootPose(BOOT_INTRO_MS, null, false);
    expect(settled.body).toBe(1);
    expect(settled.lid).toBe(0);
    expect(settled.eyeX).toBe(GLANCE_DX);
    expect(settled.word).toBe(1);
    expect(settled.cover).toBe(1);
    expect(settled.done).toBe(false);
  });

  it('ends on the app icon: eyes at x 606 and 770', () => {
    expect(EYE_CENTERS.map((x) => x + GLANCE_DX)).toEqual([606, 770]);
  });

  it('keeps blinking while the app is still loading', () => {
    const lidAt = (t: number) => bootPose(t, null, false).lid;
    expect(lidAt(BOOT_IDLE_FROM - 1)).toBe(0);
    expect(lidAt(BOOT_IDLE_FROM + 85)).toBeGreaterThan(0.9);
    expect(lidAt(BOOT_IDLE_FROM + 400)).toBe(0);
    expect(lidAt(BOOT_IDLE_FROM + BOOT_IDLE_EVERY + 85)).toBeGreaterThan(0.9);
  });

  it('shows the icon pose at once when motion is reduced', () => {
    const p = bootPose(0, null, true);
    expect(p).toMatchObject({ body: 1, eyeX: GLANCE_DX, lid: 0, word: 1, cover: 1 });
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

describe('mascot path', () => {
  it('matches the icon eye hole exactly when open', () => {
    expect(eyeHole(606, 450, 96, 200)).toBe(
      'M606,350 H606 A48,48 0 0 0 558,398 V502 A48,48 0 0 0 606,550 H606 A48,48 0 0 0 654,502 V398 A48,48 0 0 0 606,350 Z',
    );
  });

  it('moves both eyes with the glance and shifts the slab down', () => {
    expect(mascotPath(GLANCE_DX, 0)).toContain('M606,350');
    expect(mascotPath(GLANCE_DX, 0)).toContain('M770,350');
    expect(mascotPath(0, 0, 42)).toContain('M300,212');
    expect(mascotPath(0, 0, 42)).toContain('M430,392');
  });

  it('shuts the eyes to a thin dash that still sits inside the slab lip', () => {
    const shut = mascotPath(0, 1);
    // 28 units tall around y 450: under the 42-unit lip the dash shows the slab colour only.
    expect(shut).toContain('M430,436');
    expect(shut).toContain('V450');
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
