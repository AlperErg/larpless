import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { SessionSummary } from '../../src/contracts/domain';
import { periodStats } from '../../src/core/focus';
import { BarChart } from '../../src/ui/components/stats/BarChart';
import { StatsRing, chartData } from '../../src/ui/components/stats/StatsRing';
import { signedDuration, signedPoints } from '../../src/ui/components/stats/shared';
import { cubicBezier } from '../../src/ui/lib/useTween';
import App from '../../src/App';
import { fixtureSessions } from '../../src/fixtures/data';
import { initialAppState, useAppStore } from '../../src/store/appStore';
import { useNavStore } from '../../src/store/navStore';

// Tweens jump to their target: the tests check what is shown, not the frames in between.
jest.mock('../../src/ui/lib/useTween', () => ({
  ...jest.requireActual('../../src/ui/lib/useTween'),
  useTween: (target: number) => target,
}));

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).getTime();

function ses(startedAt: number, focusS: number, distractedS = 0, moduleKey = 'mod_biology'): SessionSummary {
  const totalS = focusS + distractedS;
  return {
    id: `s${startedAt}`,
    startedAt,
    endedAt: startedAt + totalS * 1000,
    totalS,
    focusS,
    focusPct: 0,
    breakdown: [
      { key: moduleKey, label: moduleKey === 'mod_biology' ? 'Biology' : 'Maths', color: 'green', seconds: focusS, pct: 0 },
      ...(distractedS ? [{ key: 'distracted', label: 'Distracted', color: 'red' as const, seconds: distractedS, pct: 0 }] : []),
    ],
    pomodoros: 0,
  };
}

const now = at(2026, 11, 18); // Wednesday
const sessions = [
  ses(at(2026, 11, 18, 9), 3600, 400), // today
  ses(at(2026, 11, 17, 9), 1800, 0, 'mod_maths'), // yesterday, this week
  ses(at(2026, 11, 10, 9), 1200), // last week
];

const all = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => n.props.testID === id);
/** Host elements only (a testID is also on the composite component above each one). */
const hosts = (r: ReactTestRenderer, id: string) => all(r, id).filter((n) => typeof n.type === 'string');
function textIn(r: ReactTestRenderer, id: string): string {
  const out: string[] = [];
  const collect = (n: ReactTestInstance | string): void => {
    if (typeof n === 'string') out.push(n);
    else n.children.forEach(collect);
  };
  collect(all(r, id)[0]);
  return out.join('');
}
const fire = (r: ReactTestRenderer, id: string, prop = 'onPress') =>
  act(() => all(r, id).filter((n) => typeof n.props[prop] === 'function')[0].props[prop]());

describe('StatsRing', () => {
  let r: ReactTestRenderer;
  beforeEach(() => {
    act(() => {
      r = create(<StatsRing sessions={sessions} now={now} />);
    });
  });
  afterEach(() => act(() => r.unmount()));

  it('starts closed: only the pill shows, with the focus % for the week', () => {
    expect(textIn(r, 'stats-ring-open')).toContain('93% this week');
    expect(all(r, 'stats-ring-period')).toHaveLength(0);
    expect(all(r, 'stats-ring-chart')).toHaveLength(0);
  });

  it('opens the stats, then the subjects only on their own button', () => {
    fire(r, 'stats-ring-open');
    expect(textIn(r, 'stats-ring-pct')).toBe('93%');
    expect(textIn(r, 'stats-ring-focus')).toContain('1h 30m');
    expect(textIn(r, 'stats-ring-best')).toContain('Wednesday 18, 1h');
    expect(all(r, 'stats-ring-subjects-list')).toHaveLength(0);

    fire(r, 'stats-ring-subjects-toggle');
    const list = textIn(r, 'stats-ring-subjects-list');
    expect(list).toContain('Biology');
    expect(list).toContain('Maths');
    expect(list).not.toContain('Distracted');

    fire(r, 'stats-ring-subjects-toggle');
    expect(all(r, 'stats-ring-subjects-list')).toHaveLength(0);
    fire(r, 'stats-ring-open');
    expect(all(r, 'stats-ring-period')).toHaveLength(0);
  });

  it('switches period', () => {
    fire(r, 'stats-ring-open');
    fire(r, 'stats-ring-period-day');
    expect(all(r, 'stats-ring-period-day').some((n) => n.props.accessibilityState?.selected)).toBe(true);
    expect(textIn(r, 'stats-ring-best')).toContain('09:00, 1h');
  });
});

describe('BarChart', () => {
  const data = chartData('week', periodStats(sessions, 'week', now).buckets);

  function mount() {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<BarChart testID="c" data={data} />);
    });
    // The chart draws once it knows its width.
    act(() => all(r, 'c')[0].findAll((n) => typeof n.props.onLayout === 'function')[0].props.onLayout({ nativeEvent: { layout: { width: 700, height: 140 } } }));
    return r;
  }

  it('draws one round-capped bar per day with focused time, labelled Monday to Sunday', () => {
    const r = mount();
    const bars = hosts(r, 'c-bar');
    expect(bars).toHaveLength(2);
    expect(bars[0].props.rx).toBe(bars[0].props.width / 2);
    expect(data.map((d) => d.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    act(() => r.unmount());
  });

  it('hovering a column fades the other bars and shows a tooltip; leaving clears it', () => {
    const r = mount();
    fire(r, 'c-col-1', 'onHoverIn'); // Tuesday
    expect(textIn(r, 'c-tooltip')).toBe('Tuesday 17 Nov30m focused');
    expect(hosts(r, 'c-bar').map((b) => b.props.opacity)).toEqual([1, 0.3]);
    fire(r, 'c-col-1', 'onHoverOut');
    expect(all(r, 'c-tooltip')).toHaveLength(0);
    expect(hosts(r, 'c-bar').map((b) => b.props.opacity)).toEqual([1, 1]);
    act(() => r.unmount());
  });

  it('shows no tooltip for an empty day', () => {
    const r = mount();
    fire(r, 'c-col-4', 'onHoverIn');
    expect(all(r, 'c-tooltip')).toHaveLength(0);
    act(() => r.unmount());
  });

  it("uses bklit's easing curve", () => {
    const ease = cubicBezier(0.85, 0, 0.15, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 3);
    expect(ease(0.2)).toBeLessThan(0.05); // slow start
    expect(ease(0.8)).toBeGreaterThan(0.95); // soft landing
  });
});

describe('formatting', () => {
  it('formats signed deltas', () => {
    expect(signedDuration(4800)).toBe('+1h 20m');
    expect(signedDuration(-900)).toBe('−15m');
    expect(signedDuration(30)).toBe('same');
    expect(signedPoints(12)).toBe('+12 pts');
    expect(signedPoints(-1)).toBe('−1 pt');
    expect(signedPoints(0)).toBe('same');
  });
});

describe('History page', () => {
  afterEach(() =>
    act(() => {
      useAppStore.setState({ ...initialAppState });
      useNavStore.setState({ route: 'home', params: {}, paletteOpen: false });
    }),
  );

  it('shows the focus ring and no calendar', async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<App />);
    });
    act(() => {
      useAppStore.setState({ sessions: fixtureSessions });
      useNavStore.getState().go('history');
    });
    expect(all(r, 'history-stats-open').length).toBeGreaterThan(0);
    expect(all(r, 'history-heatmap')).toHaveLength(0);
    act(() => r.unmount());
  });
});
