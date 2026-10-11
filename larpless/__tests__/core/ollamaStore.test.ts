import type { PullProgress } from '../../src/core/ollama';
import { prepareOllama } from '../../src/core/ollamaHost';
import { initialOllamaSetupState, PULL_UPDATE_MS, useOllamaStore } from '../../src/store/ollamaStore';
import { initialSessionState, useSessionStore } from '../../src/store/sessionStore';

/** The pull the store's client runs: the test drives progress and settles it. */
let pull: { onProgress: (p: PullProgress) => void; signal?: AbortSignal; resolve: () => void; reject: (e: Error) => void } | null = null;

jest.mock('../../src/core/ollama', () => {
  const actual = jest.requireActual('../../src/core/ollama');
  return {
    ...actual,
    createOllama: () => ({
      pull: (onProgress: (p: PullProgress) => void, call?: { signal?: AbortSignal }) =>
        new Promise<void>((resolve, reject) => {
          pull = { onProgress, signal: call?.signal, resolve, reject };
          call?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    }),
  };
});
jest.mock('../../src/core/ollamaHost', () => ({ ...jest.requireActual('../../src/core/ollamaHost'), prepareOllama: jest.fn() }));
const prepareMock = prepareOllama as jest.MockedFunction<typeof prepareOllama>;

const state = () => useOllamaStore.getState();
const refreshOllama = jest.fn(async () => {});

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  pull = null;
  refreshOllama.mockClear();
  prepareMock.mockReset();
  useOllamaStore.setState({ ...initialOllamaSetupState });
  useSessionStore.setState({ ...initialSessionState, refreshOllama });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ollamaStore pullModel', () => {
  it('reports progress at most every PULL_UPDATE_MS, then done, and refreshes the health check', async () => {
    const done = state().pullModel();
    expect(state().pull).toEqual({ status: 'pulling', completed: 0, total: 0 });
    // A second click while pulling doesn't start another download.
    await state().pullModel();

    pull!.onProgress({ completed: 100, total: 1000 });
    pull!.onProgress({ completed: 200, total: 1000 }); // same instant: dropped
    expect(state().pull).toEqual({ status: 'pulling', completed: 100, total: 1000 });
    jest.advanceTimersByTime(PULL_UPDATE_MS);
    pull!.onProgress({ completed: 700, total: 1000 });
    expect(state().pull).toEqual({ status: 'pulling', completed: 700, total: 1000 });
    expect(refreshOllama).not.toHaveBeenCalled();

    pull!.resolve();
    await done;
    expect(state().pull).toEqual({ status: 'done' });
    expect(refreshOllama).toHaveBeenCalledTimes(1);
  });

  it('goes back to idle when cancelled, and shows the error when the download fails', async () => {
    const cancelled = state().pullModel();
    state().cancelPull();
    await cancelled;
    expect(state().pull).toEqual({ status: 'idle' });

    const failed = state().pullModel();
    pull!.reject(new Error('network error'));
    await failed;
    expect(state().pull).toEqual({ status: 'error', message: 'Couldn’t reach Ollama.' });

    const missing = state().pullModel();
    pull!.reject(new Error('pull model manifest: file does not exist'));
    await missing;
    expect(state().pull).toEqual({ status: 'error', message: 'pull model manifest: file does not exist' });
  });
});

describe('ollamaStore prepare', () => {
  it('runs calls one at a time, flags a launch, and refreshes the health check after it', async () => {
    let finishFirst!: () => void;
    prepareMock.mockImplementationOnce(async (deps) => {
      deps.onStart?.();
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      return 'launched';
    });
    prepareMock.mockImplementationOnce(async () => 'ready');

    const first = state().prepare({ launch: true });
    const second = state().prepare({ launch: false });
    await Promise.resolve();
    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(state().starting).toBe(true);

    finishFirst();
    expect(await first).toBe('launched');
    expect(state().starting).toBe(false);
    expect(refreshOllama).toHaveBeenCalledTimes(1);
    expect(await second).toBe('ready');
    expect(prepareMock).toHaveBeenCalledTimes(2);
    expect(prepareMock.mock.calls[1][1]).toEqual({ launch: false });
    expect(state().prepared).toBe('ready');
  });

  it('turns an exception into failed', async () => {
    prepareMock.mockRejectedValueOnce(new Error('FLOllama missing'));
    jest.spyOn(console, 'warn').mockImplementationOnce(() => {});
    expect(await state().prepare({ launch: true })).toBe('failed');
    expect(state().prepared).toBe('failed');
  });
});
