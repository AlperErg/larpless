import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { ScreenModelStatus } from '../../src/contracts/native';
import { initialAppState, useAppStore } from '../../src/store/appStore';
import { initialOllamaSetupState, useOllamaStore } from '../../src/store/ollamaStore';
import { initialScreenModelState, useScreenModelStore } from '../../src/store/screenModelStore';
import { initialSessionState, useSessionStore } from '../../src/store/sessionStore';
import { OnboardingPage, onboardingSteps } from '../../src/ui/pages/OnboardingPage';

// The Windows flow: platform.ts reads Platform.OS at import, so the switch is mocked for this file only.
jest.mock('../../src/ui/platform', () => ({ ...jest.requireActual('../../src/ui/platform'), IS_WINDOWS: true, DEVICE: 'PC' }));

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
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => byTestID(r, id).props.onPress());
};

const backup = {
  app: { ...useAppStore.getState() },
  ollama: { ...useOllamaStore.getState() },
  session: { ...useSessionStore.getState() },
  screenModel: { ...useScreenModelStore.getState() },
};

function seed(status: Partial<ScreenModelStatus> = {}) {
  act(() => {
    useScreenModelStore.setState({
      refresh: async () => {},
      status: { supported: true, installed: false, missing: [], loaded: false, ...status },
    });
    useOllamaStore.setState({ prepare: jest.fn(async () => 'launched' as const), refreshHost: jest.fn(async () => {}) });
    useSessionStore.setState({ refreshOllama: async () => {}, ollama: { status: 'down', model: 'qwen3-vl:2b' } });
  });
}

function render(): ReactTestRenderer {
  let r: ReactTestRenderer;
  act(() => {
    r = create(<OnboardingPage />);
  });
  return r!;
}

beforeEach(() => {
  jest.useFakeTimers(); // the 2 s polling and the step fade must not outlive a test
});

afterEach(() => {
  jest.useRealTimers();
  act(() => {
    useAppStore.setState({ ...backup.app, ...initialAppState });
    useOllamaStore.setState({ ...backup.ollama, ...initialOllamaSetupState });
    useSessionStore.setState({ ...backup.session, ...initialSessionState });
    useScreenModelStore.setState({ ...backup.screenModel, ...initialScreenModelState });
  });
});

describe('onboardingSteps', () => {
  it('keeps the Mac flow as it was', () => {
    expect(onboardingSteps(false, 'vlm')).toEqual(['modules', 'permissions', 'ollama', 'model']);
    expect(onboardingSteps(false, 'classifier')).toEqual(['modules', 'permissions', 'ollama', 'model']);
  });

  it('starts Windows with the PC question and follows the chosen model', () => {
    expect(onboardingSteps(true, 'vlm')).toEqual(['pc', 'modules', 'permissions', 'ollama', 'model']);
    expect(onboardingSteps(true, 'classifier')).toEqual(['pc', 'modules', 'permissions', 'classifier']);
  });
});

describe('onboarding on Windows: Your PC', () => {
  it('asks first, explains both models, and waits for a choice', () => {
    seed();
    const r = render();
    expect(has(r, 'onboarding-pc')).toBe(true);
    const text = textOf(r);
    expect(text).toContain('How powerful is this PC?');
    expect(text).toContain('Uses: On-device classifier');
    expect(text).toContain('Uses: Vision LLM (Ollama)');
    expect(text).toContain('1. Your PC');
    expect(byTestID(r, 'onboarding-next').props.disabled).toBe(true);
    act(() => r.unmount());
  });

  it('the classifier skips both Ollama steps and ends on its download', async () => {
    seed();
    const r = render();
    await press(r, 'onboarding-pc-classifier');
    expect(byTestID(r, 'onboarding-next').props.disabled).toBe(false);
    await press(r, 'onboarding-next');
    expect(useAppStore.getState().settings.classifierMode).toBe('classifier');
    expect(has(r, 'onboarding-modules')).toBe(true);
    expect(textOf(r)).toContain('4. Classifier');
    expect(textOf(r)).not.toContain('Ollama');
    await press(r, 'onboarding-next'); // modules
    await press(r, 'onboarding-next'); // permissions
    expect(has(r, 'onboarding-classifier')).toBe(true);
    expect(has(r, 'onboarding-screen-model-start')).toBe(true);
    expect(byTestID(r, 'onboarding-finish').props.title).toBe('Finish anyway');
    act(() => r.unmount());
  });

  it('the vision LLM keeps the Ollama steps', async () => {
    seed();
    const r = render();
    await press(r, 'onboarding-pc-vlm');
    await press(r, 'onboarding-next');
    expect(useAppStore.getState().settings.classifierMode).toBe('vlm');
    await press(r, 'onboarding-next'); // modules
    await press(r, 'onboarding-next'); // permissions
    expect(has(r, 'onboarding-ollama')).toBe(true);
    expect(textOf(r)).toContain('5. AI model');
    act(() => r.unmount());
  });

  it('goes back from the modules step to the PC question', async () => {
    seed();
    const r = render();
    await press(r, 'onboarding-pc-vlm');
    await press(r, 'onboarding-next');
    const back = r.root.findAll((n) => n.props.title === 'Back' && typeof n.props.onPress === 'function')[0];
    await act(async () => back.props.onPress());
    expect(has(r, 'onboarding-pc')).toBe(true);
    act(() => r.unmount());
  });

  it('offers only the vision LLM in a build without the screen model', async () => {
    seed({ supported: false });
    const r = render();
    expect(byTestID(r, 'onboarding-pc-classifier').props.disabled).toBe(true);
    expect(textOf(r)).toContain('Not available in this build');
    act(() => r.unmount());
  });
});
