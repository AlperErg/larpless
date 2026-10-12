import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import App from '../../src/App';
import { applyFixture } from '../../src/fixtures/apply';
import { fixtureModules, fixtureSessions } from '../../src/fixtures/data';
import { useAppStore } from '../../src/store/appStore';
import { useNavStore } from '../../src/store/navStore';
import { useSessionStore } from '../../src/store/sessionStore';
import { SessionPage } from '../../src/ui/pages/SessionPage';

export function textOf(r: ReactTestRenderer): string {
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

function render(el: React.ReactElement): ReactTestRenderer {
  let r: ReactTestRenderer;
  act(() => {
    r = create(el);
  });
  return r!;
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  act(() => useAppStore.setState({ modules: fixtureModules, sessions: fixtureSessions }));
});

const timerLabel = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.props.testID === 'session-timer' && n.props.accessibilityLabel != null)[0].props.accessibilityLabel;

describe('Session page', () => {
  it('running: timer, studying Maths, last check, breakdown, privacy', () => {
    act(() => applyFixture('running'));
    const r = render(<SessionPage />);
    const t = textOf(r);
    expect(t).toContain('Focus session');
    expect(t).toContain('Studying Maths');
    expect(t).toContain('Last check: Maths');
    expect(t).toContain('Biology');
    expect(t).toContain('Distracted');
    expect(t).toMatch(/Round 1 of 4 · \d+:\d\d left/);
    expect(t).toContain('stored: 0');
    expect(t).toContain("You're here");
    expect(t).toContain('Brown noise');
    expect(t).toContain('Pause');
    expect(t).toContain('End session');
    act(() => r.unmount());
  });

  it('distracted: red status line and alert banner', () => {
    act(() => applyFixture('distracted'));
    const r = render(<SessionPage />);
    const t = textOf(r);
    expect(t).toContain('Distracted · Instagram');
    expect(t).toContain('Last check: Distracted — Instagram');
    expect(t).toMatch(/Distracted for \d+ min/);
    act(() => r.unmount());
  });

  it('break: break chip, skip button, nothing captured', () => {
    act(() => applyFixture('break'));
    const r = render(<SessionPage />);
    const t = textOf(r);
    expect(t).toContain('On a break');
    expect(t).toMatch(/Break · \d+:\d\d/);
    expect(t).toContain('Skip break');
    expect(t).toContain('Not looking (break)');
    expect(timerLabel(r)).toBe('0:25:00');
    act(() => r.unmount());
  });

  it('paused by sleep: says why and offers Resume', () => {
    act(() => applyFixture('running'));
    act(() => useSessionStore.setState({ status: 'paused', pausedForSleep: true }));
    const r = render(<SessionPage />);
    const t = textOf(r);
    expect(t).toContain('Paused while your Mac slept');
    expect(t).toContain('Resume');
    act(() => useSessionStore.setState({ pausedForSleep: false }));
    expect(textOf(r)).not.toContain('slept');
    act(() => r.unmount());
  });

  it('idle and ended states', () => {
    act(() => applyFixture('idle'));
    let r = render(<SessionPage />);
    expect(textOf(r)).toContain('No session running');
    act(() => r.unmount());
    act(() => applyFixture('summary'));
    r = render(<SessionPage />);
    expect(textOf(r)).toContain('Session ended');
    act(() => r.unmount());
  });

  it('modules missing: falls back to readable names', () => {
    act(() => useAppStore.setState({ modules: [] }));
    act(() => applyFixture('running'));
    const r = render(<SessionPage />);
    expect(textOf(r)).toContain('Studying Maths');
    act(() => r.unmount());
  });
});

describe('App routing', () => {
  it('boots to onboarding, follows session status to session and summary', async () => {
    act(() => applyFixture('idle'));
    let r: ReactTestRenderer;
    await act(async () => {
      r = create(<App />);
    });
    expect(useNavStore.getState().route).toBe('onboarding');
    act(() => applyFixture('running'));
    expect(useNavStore.getState().route).toBe('session');
    expect(textOf(r!)).toContain('Studying Maths');
    act(() => applyFixture('distracted'));
    expect(useNavStore.getState().route).toBe('session');
    act(() => applyFixture('summary'));
    expect(useNavStore.getState().route).toBe('summary');
    act(() => useNavStore.getState().go('dev'));
    expect(textOf(r!)).toContain('Dev tools');
    expect(useSessionStore.getState().status).toBe('ended');
    act(() => r!.unmount());
  });
});
