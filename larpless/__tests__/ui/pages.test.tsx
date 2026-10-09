import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import App from '../../src/App';
import { DEFAULT_SETTINGS } from '../../src/config';
import type { Chunk } from '../../src/contracts/domain';
import type { StartOptions } from '../../src/contracts/store';
import { applyFixture } from '../../src/fixtures/apply';
import type { FixtureName } from '../../src/fixtures/apply';
import { fixtureModules, fixtureSessions, fixtureStates } from '../../src/fixtures/data';
import { initialAppState, useAppStore } from '../../src/store/appStore';
import { useNavStore } from '../../src/store/navStore';
import type { Route } from '../../src/store/navStore';
import { initialSessionState, useSessionStore } from '../../src/store/sessionStore';
import { EditableTable } from '../../src/ui/components';
import { buildCommands, filterCommands } from '../../src/ui/layout/CommandPalette';
import { useViewport } from '../../src/ui/lib/viewport';

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

/** First element with this testID that has `prop` as a function. */
function byTestID(r: ReactTestRenderer, id: string, prop = 'onPress'): ReactTestInstance {
  const hits = r.root.findAll((n) => n.props.testID === id && typeof n.props[prop] === 'function');
  if (!hits.length) throw new Error(`no ${id} with ${prop}`);
  return hits[0];
}

async function mountApp(): Promise<ReactTestRenderer> {
  let r: ReactTestRenderer;
  await act(async () => {
    r = create(<App />);
  });
  return r!;
}

const actionsBackup = { session: { ...useSessionStore.getState() }, app: { ...useAppStore.getState() } };

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  act(() => {
    useSessionStore.setState({ ...actionsBackup.session, ...initialSessionState });
    useAppStore.setState({ ...actionsBackup.app, ...initialAppState });
    useNavStore.setState({ route: 'home', params: {}, paletteOpen: false });
  });
});

describe('every page renders in every fixture state', () => {
  const routes: Route[] = ['home', 'session', 'summary', 'history', 'modules', 'settings', 'feed', 'login', 'dev', 'onboarding'];
  const fixtures: FixtureName[] = ['idle', 'running', 'distracted', 'break', 'summary'];
  for (const [w, h] of [
    [900, 600],
    [1440, 900],
  ]) {
    it(`at ${w}×${h}`, async () => {
      act(() => useViewport.getState().setSize(w, h));
      const r = await mountApp();
      for (const f of fixtures) {
        act(() => {
          useAppStore.setState({ modules: fixtureModules, sessions: fixtureSessions });
          applyFixture(f);
        });
        for (const route of routes) {
          act(() => useNavStore.getState().go(route));
          const t = textOf(r);
          expect(t).not.toContain('This page hit a snag');
          expect(t.length).toBeGreaterThan(20);
        }
      }
      act(() => r.unmount());
    });
  }

  it('empty stores show friendly empty states', async () => {
    const r = await mountApp();
    act(() => useNavStore.getState().go('home'));
    expect(textOf(r)).toContain('No sessions yet');
    act(() => useNavStore.getState().go('history'));
    expect(textOf(r)).toContain('Nothing here yet');
    act(() => useNavStore.getState().go('modules'));
    expect(textOf(r)).toContain('Your own courses (optional)');
    expect(textOf(r)).toContain('Recognised automatically');
    act(() => useNavStore.getState().go('summary'));
    expect(textOf(r)).toContain('No finished session yet');
    act(() => r.unmount());
  });
});

describe('⌘K palette', () => {
  it('commands depend on status and filter by substring', () => {
    const idle = buildCommands({ status: 'idle', demoFast: false, hasSummary: false, devTools: true }).map((c) => c.id);
    expect(idle).toEqual(expect.arrayContaining(['start', 'start-demo', 'go-home', 'go-dev', 'demo-fast']));
    expect(idle).not.toContain('end');
    const running = buildCommands({ status: 'running', demoFast: false, hasSummary: false, devTools: false }).map((c) => c.id);
    expect(running).toEqual(expect.arrayContaining(['pause', 'end']));
    expect(running).not.toContain('start');
    expect(running).not.toContain('go-dev');
    const cmds = buildCommands({ status: 'paused', demoFast: true, hasSummary: true, devTools: true });
    expect(filterCommands(cmds, 'hist').map((c) => c.id)).toEqual(['go-history']);
    expect(filterCommands(cmds, 'RESUME').map((c) => c.id)).toEqual(['resume']);
  });

  it('opens, moves with arrows, runs with Enter, closes with Escape', async () => {
    const r = await mountApp();
    act(() => useNavStore.setState({ route: 'home', paletteOpen: true }));
    expect(textOf(r)).toContain('Start session');
    const input = () => byTestID(r, 'palette-input', 'onKeyDown');
    const key = (k: string) => act(() => input().props.onKeyDown({ nativeEvent: { key: k }, stopPropagation() {} }));
    act(() => input().props.onChangeText('go to'));
    key('ArrowDown'); // Home → Session
    key('ArrowDown'); // → History
    key('ArrowUp'); // → Session
    key('Enter');
    expect(useNavStore.getState().paletteOpen).toBe(false);
    expect(useNavStore.getState().route).toBe('session');

    act(() => useNavStore.getState().setPaletteOpen(true));
    key('Escape');
    expect(useNavStore.getState().paletteOpen).toBe(false);

    act(() => useNavStore.getState().setPaletteOpen(true));
    act(() => byTestID(r, 'palette-backdrop').props.onPress());
    expect(useNavStore.getState().paletteOpen).toBe(false);
    act(() => r.unmount());
  });

  it('opens from the Dev tools button and the sidebar search row', async () => {
    const r = await mountApp();
    act(() => useNavStore.getState().go('dev'));
    act(() => byTestID(r, 'dev-open-palette').props.onPress());
    expect(useNavStore.getState().paletteOpen).toBe(true);
    act(() => useNavStore.getState().setPaletteOpen(false));
    act(() => useNavStore.getState().go('home'));
    act(() => byTestID(r, 'nav-search').props.onPress());
    expect(useNavStore.getState().paletteOpen).toBe(true);
    act(() => r.unmount());
  });
});

describe('full flow with fake store actions (stand-in for WS-C)', () => {
  it('onboarding → Home → Start → Session → End → Summary → relabel → Home', async () => {
    const started: StartOptions[] = [];
    const relabels: Array<[string, Partial<Chunk>]> = [];
    act(() => {
      useAppStore.setState({
        settings: { ...DEFAULT_SETTINGS },
        saveModules: async (m) => useAppStore.setState({ modules: m }),
        updateSettings: async (p) => useAppStore.setState((s) => ({ settings: { ...s.settings, ...p } })),
      });
      useSessionStore.setState({
        start: async (o) => {
          started.push(o);
          useSessionStore.setState(fixtureStates.running);
        },
        end: async () => {
          useSessionStore.setState(fixtureStates.summary);
          return fixtureStates.summary.lastSummary ?? null;
        },
        relabelChunk: async (id, patch) => {
          relabels.push([id, patch]);
        },
      });
    });

    const r = await mountApp();
    expect(useNavStore.getState().route).toBe('onboarding');
    // Step 1: a built-in subject name is refused; a more specific course name is kept.
    const table = () => r.root.findByType(EditableTable);
    const row = (name: string) => ({ id: 'mod_custom', name, color: 'green' as const, keywordsText: 'BIO101' });
    act(() => table().props.onChange([row('biology')]));
    expect(textOf(r)).toContain('Biology is already built in');
    act(() => table().props.onChange([row('Biology BIO101')]));
    expect(r.root.findAll((n) => n.props.testID === 'onboarding-name-problem')).toHaveLength(0);
    act(() => byTestID(r, 'onboarding-next').props.onPress());
    expect(useAppStore.getState().modules.map((m) => m.name)).toEqual(['Biology BIO101']);
    act(() => byTestID(r, 'onboarding-next').props.onPress()); // permissions
    await act(async () => byTestID(r, 'onboarding-finish').props.onPress()); // ollama
    expect(useAppStore.getState().settings.onboarded).toBe(true);
    expect(useNavStore.getState().route).toBe('home');

    // ⌥-click Start → demo session.
    act(() => useAppStore.setState({ modules: fixtureModules }));
    await act(async () => byTestID(r, 'start-session').props.onPress({ nativeEvent: { altKey: true } }));
    expect(started).toEqual([{ pomodoro: 'off', demo: true }]);
    expect(useNavStore.getState().route).toBe('session');
    expect(textOf(r)).toContain('Studying Maths');

    await act(async () => byTestID(r, 'end-session').props.onPress());
    expect(useNavStore.getState().route).toBe('summary');
    expect(textOf(r)).toContain('Session complete');
    expect(textOf(r)).toContain('Distracted 11%');

    // Expand the first Instagram chunk and relabel it as Maths.
    act(() => byTestID(r, 'toggle-chk_fixture_12').props.onPress());
    act(() => byTestID(r, 'relabel-chk_fixture_12-mod_maths').props.onPress());
    expect(relabels).toEqual([['chk_fixture_12', { kind: 'subject', moduleId: 'mod_maths', reason: null }]]);
    expect(textOf(r)).toContain('Distracted 9%');

    act(() => byTestID(r, 'summary-done').props.onPress());
    expect(useNavStore.getState().route).toBe('home');
    act(() => r.unmount());
  });
});
