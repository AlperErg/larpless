import { Linking } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { OLLAMA_DOWNLOAD_URL } from '../../src/ui/platform';
import type { HardwareInfo, OllamaHostInfo } from '../../src/contracts/native';
import { native } from '../../src/native';
import type { ModelPull, OllamaStatus } from '../../src/contracts/store';
import { initialAppState, useAppStore } from '../../src/store/appStore';
import { initialOllamaSetupState, useOllamaStore } from '../../src/store/ollamaStore';
import { initialSessionState, useSessionStore } from '../../src/store/sessionStore';
import { OnboardingPage } from '../../src/ui/pages/OnboardingPage';

const RUNNING: OllamaHostInfo = { appInstalled: true, cliInstalled: true, appRunning: true, server: 'app', promptCache: 'off' };
const STOPPED: OllamaHostInfo = { ...RUNNING, appRunning: false, server: null, promptCache: null };
const NONE: OllamaHostInfo = { ...STOPPED, appInstalled: false, cliInstalled: false };

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

/** First element with this testID that has `prop` as a function. */
function byTestID(r: ReactTestRenderer, id: string, prop = 'onPress'): ReactTestInstance {
  const hit = r.root.findAll((n) => n.props.testID === id && typeof n.props[prop] === 'function')[0];
  if (!hit) throw new Error(`no ${id} with ${prop}`);
  return hit;
}
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => n.props.testID === id).length > 0;

const actions = {
  prepare: jest.fn(async () => 'launched' as const),
  refreshHost: jest.fn(async () => {}),
  pullModel: jest.fn(async () => {}),
  cancelPull: jest.fn(),
};
const backup = { ollama: { ...useOllamaStore.getState() }, session: { ...useSessionStore.getState() }, app: { ...useAppStore.getState() } };

function seed(host: OllamaHostInfo, status: OllamaStatus, pull: ModelPull = { status: 'idle' }) {
  act(() => {
    useOllamaStore.setState({ ...actions, host, pull });
    useSessionStore.setState({ refreshOllama: async () => {}, ollama: { status, model: 'qwen3-vl:4b' } });
  });
}

/** Renders onboarding, picks the vision LLM and clicks through to the Ollama step, or the AI model step with `model`. */
function renderAt(step: 'ollama' | 'model'): ReactTestRenderer {
  let r: ReactTestRenderer;
  act(() => {
    r = create(<OnboardingPage />);
  });
  act(() => byTestID(r!, 'onboarding-pc-vlm').props.onPress());
  act(() => byTestID(r!, 'onboarding-next').props.onPress()); // your Mac
  act(() => byTestID(r!, 'onboarding-next').props.onPress()); // modules
  act(() => byTestID(r!, 'onboarding-next').props.onPress()); // permissions
  if (step === 'model') act(() => byTestID(r!, 'onboarding-next').props.onPress()); // ollama
  return r!;
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  jest.useFakeTimers(); // the 2 s polling and the step fade must not outlive a test
  Object.values(actions).forEach((f) => f.mockClear());
  (Linking.openURL as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
  act(() => {
    useOllamaStore.setState({ ...backup.ollama, ...initialOllamaSetupState });
    useSessionStore.setState({ ...backup.session, ...initialSessionState });
    useAppStore.setState({ ...backup.app, ...initialAppState });
  });
});

describe('onboarding: Your Mac', () => {
  it('asks which model reads the screen, in Mac wording', () => {
    seed(RUNNING, 'down');
    let r: ReactTestRenderer;
    act(() => {
      r = create(<OnboardingPage />);
    });
    const text = textOf(r!);
    expect(text).toContain('How powerful is this Mac?');
    expect(text).toContain('1. Your Mac');
    expect(text).toContain('An Intel or base M1–M3 Mac, or one with 8 GB');
    expect(text).toContain('An M4 or newer, or a Pro, Max or Ultra chip, with 16 GB or more');
    act(() => r!.unmount());
  });

  const GIB = 2 ** 30;
  async function renderWith(hw: HardwareInfo | Error): Promise<ReactTestRenderer> {
    const spy = jest.spyOn(native.appShell, 'hardware');
    if (hw instanceof Error) spy.mockRejectedValue(hw);
    else spy.mockResolvedValue(hw);
    let r: ReactTestRenderer;
    await act(async () => {
      r = create(<OnboardingPage />);
    });
    spy.mockRestore();
    return r!;
  }
  const selected = (r: ReactTestRenderer, id: string) =>
    r.root.findAll((n) => n.props.testID === id && n.props.accessibilityState)[0].props.accessibilityState.selected;

  it('preselects the vision LLM for Apple silicon with 16 GB and says why', async () => {
    seed(RUNNING, 'down');
    const r = await renderWith({ memoryBytes: 16 * GIB, appleSilicon: true, chip: 'Apple M4', gpu: null });
    expect(selected(r, 'onboarding-pc-vlm')).toBe(true);
    expect(textOf(r)).toContain('This Mac: Apple M4, 16 GB.');
    expect(textOf(r)).toContain('Recommended for this Mac');
    expect(textOf(r)).not.toContain('Recommended if you’re not sure');
    expect(byTestID(r, 'onboarding-next').props.disabled).toBe(false);
    act(() => r.unmount());
  });

  it('preselects the on-device classifier for a base M1, M2 or M3', async () => {
    seed(RUNNING, 'down');
    const r = await renderWith({ memoryBytes: 24 * GIB, appleSilicon: true, chip: 'Apple M2', gpu: null });
    expect(selected(r, 'onboarding-pc-classifier')).toBe(true);
    expect(textOf(r)).toContain('This Mac: Apple M2, 24 GB.');
    act(() => r.unmount());
  });

  it('preselects the on-device classifier for an 8 GB or Intel Mac, and the other card still works', async () => {
    seed(RUNNING, 'down');
    const r = await renderWith({ memoryBytes: 8 * GIB, appleSilicon: true, chip: 'Apple M1', gpu: null });
    expect(selected(r, 'onboarding-pc-classifier')).toBe(true);
    act(() => byTestID(r, 'onboarding-pc-vlm').props.onPress());
    expect(selected(r, 'onboarding-pc-vlm')).toBe(true);
    act(() => byTestID(r, 'onboarding-next').props.onPress());
    expect(useAppStore.getState().settings.classifierMode).toBe('vlm');
    act(() => r.unmount());

    // Onboarding reopens at the saved step; start over.
    act(() => useAppStore.setState({ settings: { ...useAppStore.getState().settings, onboardingStep: '' } }));
    const intel = await renderWith({ memoryBytes: 32 * GIB, appleSilicon: false, chip: 'Intel(R) Core(TM) i9-9880H CPU @ 2.30GHz', gpu: null });
    expect(selected(intel, 'onboarding-pc-classifier')).toBe(true);
    expect(textOf(intel)).toContain('This Mac: Intel Core i9-9880H, 32 GB.');
    act(() => intel.unmount());
  });

  it('going back to the step shows the earlier pick, not the recommendation', async () => {
    seed(RUNNING, 'down');
    const r = await renderWith({ memoryBytes: 8 * GIB, appleSilicon: true, chip: 'Apple M1', gpu: null });
    act(() => byTestID(r, 'onboarding-pc-vlm').props.onPress());
    act(() => byTestID(r, 'onboarding-next').props.onPress());
    const back = r.root.findAll((n) => n.props.title === 'Back' && typeof n.props.onPress === 'function')[0];
    await act(async () => back.props.onPress());
    expect(selected(r, 'onboarding-pc-vlm')).toBe(true);
    act(() => byTestID(r, 'onboarding-next').props.onPress());
    expect(useAppStore.getState().settings.classifierMode).toBe('vlm');
    act(() => r.unmount());
  });

  it('waits for a choice when the hardware can’t be read', async () => {
    seed(RUNNING, 'down');
    const r = await renderWith(new Error('unsupported'));
    expect(byTestID(r, 'onboarding-next').props.disabled).toBe(true);
    expect(has(r, 'onboarding-pc-hardware')).toBe(false);
    expect(textOf(r)).toContain('Recommended if you’re not sure');
    act(() => r.unmount());
  });

  it('the on-device classifier replaces the Ollama steps', () => {
    seed(RUNNING, 'down');
    let r: ReactTestRenderer;
    act(() => {
      r = create(<OnboardingPage />);
    });
    act(() => byTestID(r!, 'onboarding-pc-classifier').props.onPress());
    act(() => byTestID(r!, 'onboarding-next').props.onPress());
    expect(useAppStore.getState().settings.classifierMode).toBe('classifier');
    act(() => byTestID(r!, 'onboarding-next').props.onPress()); // modules
    act(() => byTestID(r!, 'onboarding-next').props.onPress()); // permissions
    expect(has(r!, 'onboarding-classifier')).toBe(true);
    expect(textOf(r!)).toContain('runs entirely on this Mac');
    act(() => r!.unmount());
  });
});

describe('onboarding: Ollama step', () => {
  it('links to the installer when Ollama is missing, and polls for it', () => {
    seed(NONE, 'down');
    const r = renderAt('ollama');
    expect(textOf(r)).toContain('Not installed');
    expect(has(r, 'ollama-open')).toBe(false);
    act(() => byTestID(r, 'ollama-download').props.onPress());
    expect(Linking.openURL).toHaveBeenCalledWith(OLLAMA_DOWNLOAD_URL);

    const polls = actions.refreshHost.mock.calls.length;
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(actions.refreshHost.mock.calls.length).toBe(polls + 1);

    // Installed (the user dragged it to Applications): offer to open it instead.
    act(() => useOllamaStore.setState({ host: STOPPED }));
    expect(textOf(r)).toContain('Not running');
    expect(has(r, 'ollama-download')).toBe(false);
    act(() => r.unmount());
  });

  it('opens an installed Ollama through prepare (prompt cache off) and shows it starting', () => {
    seed(STOPPED, 'down');
    const r = renderAt('ollama');
    act(() => byTestID(r, 'ollama-open').props.onPress());
    expect(actions.prepare).toHaveBeenCalledWith({ launch: true });

    act(() => useOllamaStore.setState({ starting: true }));
    expect(textOf(r)).toContain('Starting…');
    expect(has(r, 'ollama-open')).toBe(false);

    act(() => useOllamaStore.setState({ starting: false, prepared: 'failed' }));
    expect(has(r, 'ollama-open-failed')).toBe(true);
    act(() => r.unmount());
  });

  it("shows the memory saver, and restarts an Ollama.app that runs with the 8 GB cache", () => {
    seed(RUNNING, 'ok');
    const r = renderAt('ollama');
    expect(textOf(r)).toContain('Running');
    expect(textOf(r)).toContain('Memory saver on');

    act(() => useOllamaStore.setState({ host: { ...RUNNING, promptCache: 'default' } }));
    act(() => byTestID(r, 'ollama-restart').props.onPress());
    expect(actions.prepare).toHaveBeenCalledWith({ launch: true, force: true });

    // A server LarpLess can't restart gets the command instead.
    act(() => useOllamaStore.setState({ host: { ...RUNNING, appRunning: false, server: 'other', promptCache: 'default' } }));
    expect(has(r, 'ollama-restart')).toBe(false);
    expect(textOf(r)).toContain('LLAMA_ARG_CACHE_RAM=0 ollama serve');
    act(() => r.unmount());
  });
});

describe('onboarding: AI model step', () => {
  it('downloads the missing model with progress, cancel, and errors', () => {
    seed(RUNNING, 'modelMissing');
    const r = renderAt('model');
    expect(textOf(r)).toContain('about 3.3 GB');
    act(() => byTestID(r, 'ollama-pull-start').props.onPress());
    expect(actions.pullModel).toHaveBeenCalledTimes(1);

    act(() => useOllamaStore.setState({ pull: { status: 'pulling', completed: 0, total: 0 } }));
    expect(textOf(r)).toContain('Starting download…');
    act(() => useOllamaStore.setState({ pull: { status: 'pulling', completed: 1.2e9, total: 3.3e9 } }));
    expect(textOf(r)).toContain('1.2 GB of 3.3 GB · 36%');
    act(() => byTestID(r, 'ollama-pull-cancel').props.onPress());
    expect(actions.cancelPull).toHaveBeenCalledTimes(1);

    act(() => useOllamaStore.setState({ pull: { status: 'error', message: 'disk full' } }));
    expect(textOf(r)).toContain('Download failed: disk full');
    expect(textOf(r)).toContain('Try again');
    expect(textOf(r)).toContain('Finish anyway');

    act(() => {
      useOllamaStore.setState({ pull: { status: 'done' } });
      useSessionStore.setState({ ollama: { status: 'ok', model: 'qwen3-vl:4b' } });
    });
    expect(has(r, 'ollama-ready')).toBe(true);
    expect(has(r, 'ollama-pull')).toBe(false);
    expect(textOf(byTestID(r, 'onboarding-finish'))).toBe('Finish');
    act(() => r.unmount());
  });

  it('sends the user back a step while Ollama is down', () => {
    seed(STOPPED, 'down');
    const r = renderAt('model');
    expect(has(r, 'ollama-down')).toBe(true);
    expect(has(r, 'ollama-pull')).toBe(false);
    act(() => r.unmount());
  });
});

describe('onboarding: resume after a relaunch', () => {
  it('saves the current step and reopens at it', () => {
    seed(RUNNING, 'down');
    const r = renderAt('ollama');
    expect(useAppStore.getState().settings.onboardingStep).toBe('ollama');
    act(() => r.unmount());

    act(() => useAppStore.setState({ settings: { ...useAppStore.getState().settings, onboardingStep: 'permissions' } }));
    let again: ReactTestRenderer;
    act(() => {
      again = create(<OnboardingPage />);
    });
    expect(has(again!, 'onboarding-permissions')).toBe(true);
    act(() => again!.unmount());
  });

  it('starts at the first step for an unknown saved step', () => {
    act(() => useAppStore.setState({ settings: { ...useAppStore.getState().settings, onboardingStep: 'gone' } }));
    let r: ReactTestRenderer;
    act(() => {
      r = create(<OnboardingPage />);
    });
    expect(has(r!, 'onboarding-permissions')).toBe(false);
    expect(useAppStore.getState().settings.onboardingStep).toBe('pc');
    act(() => r!.unmount());
  });
});
