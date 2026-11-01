import { DEFAULT_SETTINGS } from '../../src/config';
import type { ScreenVerdict, Settings } from '../../src/contracts/domain';
import type { ActiveWindow, NativeApis } from '../../src/contracts/native';
import type { SessionStoreState } from '../../src/contracts/store';
import { createClassifier } from '../../src/core/classifier';
import { createDb, createMemoryKv } from '../../src/core/db';
import { effectiveProfile, resetSessionProfile } from '../../src/core/powerProfile';
import type { ScreenModelStep } from '../../src/core/screenModel';
import { createSessionController } from '../../src/core/sessionController';
import type { StoreApi } from '../../src/core/sessionController';
import { fixtureModules } from '../../src/fixtures/data';
import { mockApis } from '../../src/native/mock';

// The session loop with the on-device screen model ('classifier' mode) and mode switches mid-session.

const INITIAL: SessionStoreState = {
  status: 'idle',
  pausedForSleep: false,
  session: null,
  timer: { baseS: 0, runningSinceMs: null },
  chunks: [],
  current: null,
  webcam: { enabled: true, personPresent: true, phoneVisible: false },
  missingPermissions: [],
  privacy: { framesAnalysed: 0, checksWithoutScreenshot: 0, framesStored: 0 },
  pomodoro: null,
  alert: { level: 0, distractedSinceMs: null },
  sound: { id: 'off', volume: 0.5 },
  ollama: { status: 'unknown', model: 'qwen3-vl:2b' },
  lastSummary: null,
};
const win: ActiveWindow = { appName: 'Notepad', bundleId: 'notepad.exe', windowTitle: 'shopping list.txt', isSelf: false };

function setup(verdict: ScreenVerdict | null, startMode: 'classifier' | 'vlm' = 'classifier') {
  let mode = startMode;
  let state: SessionStoreState = { ...INITIAL };
  const store: StoreApi = {
    getState: () => state,
    setState: (p) => {
      state = { ...state, ...p };
    },
  };
  const settings: Settings = { ...DEFAULT_SETTINGS, onboarded: true, powerProfile: 'eco', webcamEnabled: false };
  const native: NativeApis = {
    ...mockApis,
    screen: { getActiveWindow: async () => ({ ...win }), capture: jest.fn(async () => ({ ...win, jpegBase64: 'IMG', width: 1, height: 1, capturedAt: 0 })) },
    panel: { show: jest.fn(async () => {}), ensureVisible: jest.fn(async () => {}), hide: jest.fn(async () => {}), update: jest.fn(), setColorScheme: jest.fn(), onAction: jest.fn(() => () => {}) },
    notifications: { requestPermission: jest.fn(async () => 'granted' as const), post: jest.fn(async () => {}) },
    sound: { play: jest.fn(async () => {}), setVolume: jest.fn(), duck: jest.fn(), chime: jest.fn() },
    appShell: { beginSessionActivity: jest.fn(), endSessionActivity: jest.fn(), bringToFront: jest.fn(), stopOllama: jest.fn(), onMenuCommand: () => () => {}, onSystemSleep: () => () => {} },
    ollamaHost: { ...mockApis.ollamaHost, quit: jest.fn(async () => {}) },
  };
  const step: ScreenModelStep = {
    ready: jest.fn(async () => true),
    classify: jest.fn(async () => ({ verdict, window: win, ocrChars: 400, tookMs: 300 })),
    unload: jest.fn(async () => {}),
  };
  const ollama = { classify: jest.fn(async () => null), checkHealth: jest.fn(async () => 'ok' as const), unload: jest.fn(async () => {}), warmUp: jest.fn(async () => {}) };
  const classifier = createClassifier({
    native,
    ollama,
    now: () => Date.now(),
    config: { USE_MOCK_CLASSIFIER: false, CACHE_TTL_MS: 120_000, CAPTURE: { maxWidth: 1280, jpegQuality: 0.7 } },
    getPower: () => effectiveProfile(settings.powerProfile),
    screenModel: step,
    screenModelOnly: () => mode === 'classifier',
  });
  const prepareOllama = jest.fn(async () => (mode === 'classifier' ? undefined : 'launched'));
  const ctrl = createSessionController({
    native,
    db: createDb(createMemoryKv()),
    store,
    getModules: () => fixtureModules,
    getSettings: () => settings,
    classifier,
    ollama,
    prepareOllama,
    now: () => Date.now(),
    config: { WEBCAM_FPS: 1 },
    log: () => {},
  });
  return {
    ctrl,
    step,
    ollama,
    prepareOllama,
    setMode: (m: 'classifier' | 'vlm') => {
      mode = m;
    },
    get state() {
      return state;
    },
  };
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 9, 14).getTime() });
  resetSessionProfile();
});
afterEach(() => {
  jest.useRealTimers();
});

const unsure: ScreenVerdict = { studying: false, moduleId: null, activity: '', confidence: 0.45, source: 'embed' };

it('an unsure on-device answer is not retried on the same window every settle period', async () => {
  const h = setup(unsure);
  await h.ctrl.start({ pomodoro: 'off' });
  await jest.advanceTimersByTimeAsync(120_000);
  // Eco: one live check plus one per 30 s chunk close (unsure answers aren't cached), not one every ~3 s.
  expect((h.step.classify as jest.Mock).mock.calls.length).toBeLessThanOrEqual(6);
  expect(h.state.privacy.framesAnalysed).toBeLessThanOrEqual(6);
  expect(h.state.chunks.every((c) => c.kind === 'unknown')).toBe(true);
  await h.ctrl.end();
});

it('switching to the vision LLM mid-session opens and warms Ollama and frees the screen model', async () => {
  const h = setup(unsure);
  await h.ctrl.start({ pomodoro: 'off' });
  await jest.advanceTimersByTimeAsync(5_000);
  expect(h.ollama.warmUp).not.toHaveBeenCalled();
  const prepared = h.prepareOllama.mock.calls.length;
  h.setMode('vlm');
  h.ctrl.readerChanged();
  await jest.advanceTimersByTimeAsync(0);
  expect(h.prepareOllama.mock.calls.length).toBe(prepared + 1);
  expect(h.ollama.warmUp).toHaveBeenCalled();
  expect(h.step.unload).toHaveBeenCalled();
  await h.ctrl.end();
});

it('switching to the classifier mid-session frees Ollama and skips its warm-up', async () => {
  const h = setup(null, 'vlm');
  await h.ctrl.start({ pomodoro: 'off' });
  await jest.advanceTimersByTimeAsync(1_000);
  const warmed = h.ollama.warmUp.mock.calls.length;
  h.setMode('classifier');
  h.ctrl.readerChanged();
  await jest.advanceTimersByTimeAsync(0);
  expect(h.ollama.unload).toHaveBeenCalled();
  expect(h.ollama.warmUp.mock.calls.length).toBe(warmed);
  await h.ctrl.end();
});

it('readerChanged does nothing without a live session', () => {
  const h = setup(unsure);
  h.ctrl.readerChanged();
  expect(h.prepareOllama).not.toHaveBeenCalled();
  expect(h.step.unload).not.toHaveBeenCalled();
});
