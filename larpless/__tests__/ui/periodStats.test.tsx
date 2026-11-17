import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { SessionSummary } from '../../src/contracts/domain';
import { PeriodStats } from '../../src/ui/components';
import { signedDuration, signedPoints } from '../../src/ui/components/PeriodStats';
import App from '../../src/App';
import { fixtureSessions } from '../../src/fixtures/data';
import { initialAppState, useAppStore } from '../../src/store/appStore';
import { useNavStore } from '../../src/store/navStore';

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).getTime();

function ses(startedAt: number, focusS: number, distractedS = 0): SessionSummary {
  const totalS = focusS + distractedS;
  return {
    id: `s${startedAt}`,
    startedAt,
    endedAt: startedAt + totalS * 1000,
    totalS,
    focusS,
    focusPct: 0,
    breakdown: [
      { key: 'mod_biology', label: 'Biology', color: 'green', seconds: focusS, pct: 0 },
      ...(distractedS ? [{ key: 'distracted', label: 'Distracted', color: 'red' as const, seconds: distractedS, pct: 0 }] : []),
    ],
    pomodoros: 0,
  };
}

/** All text under the first element with this testID. */
function textIn(r: ReactTestRenderer, id: string): string {
  const out: string[] = [];
  const collect = (n: ReactTestInstance | string): void => {
    if (typeof n === 'string') out.push(n);
    else n.children.forEach(collect);
  };
  collect(r.root.findAll((n) => n.props.testID === id)[0]);
  return out.join('');
}

const press = (r: ReactTestRenderer, id: string) =>
  act(() => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0].props.onPress());

describe('PeriodStats', () => {
  const now = at(2026, 11, 18); // Wednesday
  const sessions = [
    ses(at(2026, 11, 18, 9), 3600, 400), // today
    ses(at(2026, 11, 17, 9), 1800), // yesterday, this week
    ses(at(2026, 11, 10, 9), 1200), // last week
  ];

  it('defaults to the week, compares with last week, and switches period', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<PeriodStats sessions={sessions} now={now} />);
    });
    expect(textIn(r, 'period-stats')).toContain('This week');
    expect(textIn(r, 'period-stats-focus')).toBe('Focused1h 30m+1h 10m vs last week');
    expect(textIn(r, 'period-stats-pct')).toContain('93%');
    expect(textIn(r, 'period-stats-sessions')).toBe('Sessions2+1 vs last week');
    expect(r.root.findAll((n) => n.props.testID === 'period-stats-chart-bar' && typeof n.type === 'string')).toHaveLength(2);

    press(r, 'period-stats-period-day');
    expect(textIn(r, 'period-stats')).toContain('Today');
    expect(textIn(r, 'period-stats-focus')).toBe('Focused1h+30m vs yesterday');

    press(r, 'period-stats-period-month');
    expect(textIn(r, 'period-stats-sessions')).toBe('Sessions3+3 vs last month');
    act(() => r.unmount());
  });

  it('shows an empty line, and no focus % delta, when the period has no sessions', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<PeriodStats sessions={sessions} now={at(2026, 12, 20)} />);
    });
    press(r, 'period-stats-period-day');
    expect(textIn(r, 'period-stats-empty')).toBe('No sessions today yet.');
    expect(textIn(r, 'period-stats-pct')).toBe('Focus– ');
    act(() => r.unmount());
  });

  it('formats signed deltas', () => {
    expect(signedDuration(4800)).toBe('+1h 20m');
    expect(signedDuration(-900)).toBe('−15m');
    expect(signedDuration(30)).toBe('same');
    expect(signedPoints(12)).toBe('+12 pts');
    expect(signedPoints(-4)).toBe('−4 pts');
    expect(signedPoints(0)).toBe('same');
  });

  it('is on the History page', async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<App />);
    });
    act(() => {
      useAppStore.setState({ sessions: fixtureSessions });
      useNavStore.getState().go('history');
    });
    expect(r.root.findAll((n) => n.props.testID === 'history-period').length).toBeGreaterThan(0);
    act(() => {
      r.unmount();
      useAppStore.setState({ ...initialAppState });
      useNavStore.setState({ route: 'home', params: {}, paletteOpen: false });
    });
  });
});
