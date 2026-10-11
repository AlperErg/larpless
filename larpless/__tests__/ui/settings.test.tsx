import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DEFAULT_SETTINGS } from '../../src/config';
import type { Settings } from '../../src/contracts/domain';
import { initialAppState, useAppStore } from '../../src/store/appStore';
import { useNavStore } from '../../src/store/navStore';
import { initialSessionState, useSessionStore } from '../../src/store/sessionStore';
import { SettingsPage } from '../../src/ui/pages/SettingsPage';

function render(): ReactTestRenderer {
  let r: ReactTestRenderer;
  act(() => {
    r = create(<SettingsPage />);
  });
  return r!;
}

/** First element matching `match` that has `prop` as a function (the composite, not its host view). */
function find(root: ReactTestInstance, match: (n: ReactTestInstance) => boolean, prop = 'onPress'): ReactTestInstance {
  const hit = root.findAll((n) => match(n) && typeof n.props[prop] === 'function')[0];
  if (!hit) throw new Error(`nothing matched with ${prop}`);
  return hit;
}
const byTestID = (r: ReactTestRenderer, id: string, prop = 'onPress') => find(r.root, (n) => n.props.testID === id, prop);
const byLabel = (root: ReactTestInstance, label: string) => find(root, (n) => n.props.accessibilityLabel === label);
const byID = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => n.props.testID === id)[0];

/** Press, then let updateSettings' AsyncStorage write settle. */
async function press(el: ReactTestInstance) {
  await act(async () => {
    el.props.onPress();
  });
}

async function type(r: ReactTestRenderer, id: string, text: string, commit: 'onBlur' | 'onSubmitEditing') {
  act(() => byTestID(r, id, 'onChangeText').props.onChangeText(text));
  // Re-query: the commit handler closes over the state the keystroke just set.
  await act(async () => {
    byTestID(r, id, commit).props[commit]();
  });
}

function textOf(node: ReactTestInstance | ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (typeof n === 'object' && 'children' in (n as object)) walk((n as { children: unknown }).children);
  };
  walk('toJSON' in node ? node.toJSON() : node);
  return out.join('');
}

const settings = () => useAppStore.getState().settings;
const stored = async (): Promise<Partial<Settings>> => JSON.parse((await AsyncStorage.getItem('fl:settings')) ?? '{}');
const settingsWrites = () => (AsyncStorage.setItem as jest.Mock).mock.calls.filter((c) => c[0] === 'fl:settings').length;
/** accessibilityState of the pressable behind a chip or switch. */
const a11y = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => n.props.testID === id && n.props.accessibilityState)[0].props.accessibilityState;
const isSelected = (r: ReactTestRenderer, id: string) => a11y(r, id).selected === true;
const isOn = (r: ReactTestRenderer, id: string) => a11y(r, id).checked === true;

const actionsBackup = { session: { ...useSessionStore.getState() }, app: { ...useAppStore.getState() } };

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(async () => {
  jest.useFakeTimers(); // the Switch animation must not run past the test
  await AsyncStorage.clear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  act(() => {
    useSessionStore.setState({ ...actionsBackup.session, ...initialSessionState });
    useAppStore.setState({ ...actionsBackup.app, ...initialAppState });
    useNavStore.setState({ route: 'home', params: {}, paletteOpen: false });
  });
});

describe('Settings page', () => {
  it('focus and sound choices apply at once, persist, and show as selected', async () => {
    const r = render();
    expect(isSelected(r, 'settings-strictness-2')).toBe(true);
    expect(isSelected(r, 'settings-power-medium')).toBe(true);

    await press(byTestID(r, 'settings-power-eco'));
    await press(byTestID(r, 'settings-strictness-5'));
    await press(byTestID(r, 'settings-pomodoro-25/5'));
    await press(byTestID(r, 'settings-sound-rain'));
    await press(byTestID(r, 'settings-demoFast'));
    await press(byTestID(r, 'settings-webcam'));
    await press(byTestID(r, 'settings-sounds'));

    const expected = {
      powerProfile: 'eco',
      strictness: 5,
      pomodoroDefault: '25/5',
      defaultSound: 'rain',
      demoFast: true,
      webcamEnabled: false,
      soundsEnabled: false,
    };
    expect(settings()).toMatchObject(expected);
    expect(await stored()).toMatchObject(expected);
    expect(isSelected(r, 'settings-power-eco')).toBe(true);
    expect(isSelected(r, 'settings-power-medium')).toBe(false);
    expect(isSelected(r, 'settings-strictness-5')).toBe(true);
    expect(isSelected(r, 'settings-strictness-2')).toBe(false);
    expect(isSelected(r, 'settings-pomodoro-25/5')).toBe(true);
    expect(isSelected(r, 'settings-sound-rain')).toBe(true);
    expect(isOn(r, 'settings-demoFast')).toBe(true);
    expect(isOn(r, 'settings-webcam')).toBe(false);

    await press(byTestID(r, 'settings-webcam'));
    expect(settings().webcamEnabled).toBe(true);
    expect((await stored()).webcamEnabled).toBe(true);
    act(() => r.unmount());
  });

  it('volume: − and + step by 10 %, a bar step sets it directly, and it stays within 0–100 %', async () => {
    const r = render();
    const bar = byID(r, 'settings-volume');
    expect(textOf(bar)).toContain('50%');

    await press(byLabel(bar, '+'));
    expect(settings().volume).toBe(0.6); // rounded, not 0.6000000000000001
    expect(textOf(bar)).toContain('60%');

    await press(byLabel(bar, 'Volume 30%'));
    expect(settings().volume).toBe(0.3);
    for (let i = 0; i < 4; i++) await press(byLabel(bar, '−'));
    expect(settings().volume).toBe(0);

    await press(byLabel(bar, 'Volume 100%'));
    await press(byLabel(bar, '+'));
    expect(settings().volume).toBe(1);
    expect((await stored()).volume).toBe(1);
    act(() => r.unmount());
  });

  it('volume changes reach the live session’s sound, but not when no session is running', async () => {
    const setVolume = jest.fn();
    act(() => useSessionStore.setState({ setVolume }));
    const r = render();
    const bar = byID(r, 'settings-volume');

    await press(byLabel(bar, '+'));
    expect(setVolume).not.toHaveBeenCalled();

    for (const status of ['running', 'paused', 'break'] as const) {
      act(() => useSessionStore.setState({ status }));
      await press(byLabel(bar, '+'));
    }
    expect(setVolume.mock.calls).toEqual([[0.7], [0.8], [0.9]]);
    act(() => r.unmount());
  });

  it('model and Ollama URL save on blur or Enter, trimmed; blank or unchanged values are ignored', async () => {
    const r = render();

    await type(r, 'settings-model', '  llava:7b  ', 'onBlur');
    expect(settings().model).toBe('llava:7b');
    expect((await stored()).model).toBe('llava:7b');

    await type(r, 'settings-url', 'http://10.0.0.2:11434 ', 'onSubmitEditing');
    expect(settings().ollamaUrl).toBe('http://10.0.0.2:11434');

    const writes = settingsWrites();
    await type(r, 'settings-model', '   ', 'onBlur');
    await type(r, 'settings-url', 'http://10.0.0.2:11434', 'onBlur');
    expect(settingsWrites()).toBe(writes);
    expect(settings()).toMatchObject({ model: 'llava:7b', ollamaUrl: 'http://10.0.0.2:11434' });
    act(() => r.unmount());
  });

  it('follows settings changed elsewhere, e.g. loaded after the page opened', () => {
    const r = render();
    act(() => useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, model: 'gemma3:4b', strictness: 10, webcamEnabled: false } }));
    expect(byTestID(r, 'settings-model', 'onChangeText').props.value).toBe('gemma3:4b');
    expect(isSelected(r, 'settings-strictness-10')).toBe(true);
    expect(isOn(r, 'settings-webcam')).toBe(false);
    act(() => r.unmount());
  });

  it('shows the Ollama status; Retry re-checks, disables itself meanwhile and survives a failure', async () => {
    let finish!: (ok: boolean) => void;
    const refreshOllama = jest.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = (ok) => (ok ? resolve() : reject(new Error('down')));
        }),
    );
    act(() => useSessionStore.setState({ refreshOllama, ollama: { status: 'down', model: 'qwen3-vl:4b' } }));
    const r = render();
    expect(textOf(byID(r, 'settings-ollama'))).toContain('Ollama offline');

    await press(byLabel(r.root, 'Retry'));
    expect(refreshOllama).toHaveBeenCalledTimes(1);
    expect(byLabel(r.root, 'Checking…').props.disabled).toBe(true);

    await act(async () => {
      useSessionStore.setState({ ollama: { status: 'ok', model: 'qwen3-vl:4b' } });
      finish(true);
    });
    expect(byLabel(r.root, 'Retry').props.disabled).toBeFalsy();
    expect(textOf(byID(r, 'settings-ollama'))).toContain('qwen3-vl:4b ready');

    await press(byLabel(r.root, 'Retry'));
    await act(async () => finish(false));
    expect(byLabel(r.root, 'Retry').props.disabled).toBeFalsy();
    act(() => r.unmount());
  });

  it('developer buttons open Dev tools and onboarding', async () => {
    const r = render();
    await press(byTestID(r, 'settings-devtools'));
    expect(useNavStore.getState().route).toBe('dev');
    await press(byLabel(r.root, 'Run onboarding again'));
    expect(useNavStore.getState().route).toBe('onboarding');
    act(() => r.unmount());
  });

  it('a failed save is logged, and the control still shows your choice', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    const r = render();
    await press(byTestID(r, 'settings-strictness-10'));
    expect(warn).toHaveBeenCalledWith('[ui] updateSettings failed:', 'disk full');
    expect(isSelected(r, 'settings-strictness-10')).toBe(true);
    warn.mockRestore();
    act(() => r.unmount());
  });
});
