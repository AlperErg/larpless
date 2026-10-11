import type { OllamaHostApi, OllamaHostInfo } from '../../src/contracts/native';
import type { OllamaHealth } from '../../src/core/ollama';
import { isLocalUrl, prepareOllama, SERVER_WAIT_MS } from '../../src/core/ollamaHost';
import type { PrepareDeps } from '../../src/core/ollamaHost';

const APP_DEFAULT: OllamaHostInfo = {
  appInstalled: true,
  cliInstalled: true,
  appRunning: true,
  server: 'app',
  promptCache: 'default',
};

/**
 * Deps around a fake host. `health` is what checkHealth answers, in order (the last one repeats);
 * launch/restart flip it to `afterStart`.
 */
function setup(info: Partial<OllamaHostInfo>, opts: { health?: OllamaHealth[]; loaded?: string[] | null; afterStart?: OllamaHealth; url?: string } = {}) {
  let health = [...(opts.health ?? ['ok'])];
  const afterStart = opts.afterStart ?? 'ok';
  const host: jest.Mocked<OllamaHostApi> = {
    info: jest.fn(async () => ({ ...APP_DEFAULT, ...info })),
    launch: jest.fn(async () => {
      health = [afterStart];
    }),
    restart: jest.fn(async () => {
      health = ['down', afterStart];
    }),
    quit: jest.fn(async () => {}),
  };
  const slept: number[] = [];
  const onStart = jest.fn();
  const deps: PrepareDeps = {
    host,
    ollama: {
      checkHealth: jest.fn(async () => (health.length > 1 ? health.shift()! : health[0])),
      loadedModels: jest.fn(async () => (opts.loaded === undefined ? [] : opts.loaded)),
    },
    baseUrl: () => opts.url ?? 'http://127.0.0.1:11434',
    model: () => 'qwen3-vl:4b',
    sleep: async (ms) => {
      slept.push(ms);
    },
    onStart,
  };
  return { deps, host, slept, onStart };
}

describe('isLocalUrl', () => {
  it('accepts loopback addresses only', () => {
    expect(isLocalUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLocalUrl('http://localhost:11434/')).toBe(true);
    expect(isLocalUrl('http://[::1]:11434')).toBe(true);
    expect(isLocalUrl(' HTTP://LOCALHOST ')).toBe(true);
    expect(isLocalUrl('http://10.0.0.2:11434')).toBe(false);
    expect(isLocalUrl('http://localhost.evil.com')).toBe(false);
    expect(isLocalUrl('http://127.0.0.1.nip.io')).toBe(false);
    expect(isLocalUrl('127.0.0.1:11434')).toBe(false);
  });
});

describe('prepareOllama', () => {
  it('leaves a remote Ollama alone', async () => {
    const h = setup({}, { url: 'http://10.0.0.2:11434' });
    expect(await prepareOllama(h.deps, { launch: true })).toBe('remote');
    expect(h.host.info).not.toHaveBeenCalled();
  });

  it('opens Ollama.app when it is down and launching is allowed, then waits for it', async () => {
    const h = setup({ appRunning: false, server: null, promptCache: null }, { health: ['down'] });
    expect(await prepareOllama(h.deps, { launch: false })).toBe('down');
    expect(h.host.launch).not.toHaveBeenCalled();

    expect(await prepareOllama(h.deps, { launch: true })).toBe('launched');
    expect(h.host.launch).toHaveBeenCalledTimes(1);
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.host.restart).not.toHaveBeenCalled();
  });

  it('reports missing / down without an app to open', async () => {
    const none = setup({ appInstalled: false, cliInstalled: false, appRunning: false, server: null, promptCache: null }, { health: ['down'] });
    expect(await prepareOllama(none.deps, { launch: true })).toBe('missing');
    const cli = setup({ appInstalled: false, appRunning: false, server: null, promptCache: null }, { health: ['down'] });
    expect(await prepareOllama(cli.deps, { launch: true })).toBe('down');
    expect(cli.host.launch).not.toHaveBeenCalled();
  });

  it('fails when the launched server never answers', async () => {
    const h = setup({ appRunning: false, server: null, promptCache: null }, { health: ['down'], afterStart: 'down' });
    expect(await prepareOllama(h.deps, { launch: true })).toBe('failed');
    expect(h.slept.reduce((a, b) => a + b, 0)).toBe(SERVER_WAIT_MS);
  });

  it('does nothing when the prompt cache is already off or user-set', async () => {
    for (const promptCache of ['off', 'custom'] as const) {
      const h = setup({ promptCache });
      expect(await prepareOllama(h.deps, { launch: true })).toBe('ready');
      expect(h.host.restart).not.toHaveBeenCalled();
    }
  });

  it('restarts an idle Ollama.app (nothing, or only our model, loaded) without the cache', async () => {
    for (const loaded of [[], ['qwen3-vl:4b']]) {
      const h = setup({}, { loaded });
      expect(await prepareOllama(h.deps, { launch: false })).toBe('restarted');
      expect(h.host.restart).toHaveBeenCalledTimes(1);
      expect(h.onStart).toHaveBeenCalledTimes(1);
    }
  });

  it('leaves Ollama alone while another model is loaded, unless forced', async () => {
    const busy = setup({}, { loaded: ['qwen3-vl:4b', 'llama3.2'] });
    expect(await prepareOllama(busy.deps, { launch: true })).toBe('busy');
    expect(busy.host.restart).not.toHaveBeenCalled();

    const unknown = setup({}, { loaded: null });
    expect(await prepareOllama(unknown.deps, { launch: true })).toBe('busy');

    const forced = setup({}, { loaded: ['llama3.2'] });
    expect(await prepareOllama(forced.deps, { launch: true, force: true })).toBe('restarted');
    expect(forced.deps.ollama.loadedModels).not.toHaveBeenCalled();
  });

  it("can't restart a server Ollama.app doesn't run, or one it can't see", async () => {
    const other = setup({ appRunning: false, server: 'other' });
    expect(await prepareOllama(other.deps, { launch: true, force: true })).toBe('external');
    const unseen = setup({ server: null, promptCache: null });
    expect(await prepareOllama(unseen.deps, { launch: true })).toBe('external');
    expect(other.host.restart).not.toHaveBeenCalled();
    expect(unseen.host.restart).not.toHaveBeenCalled();
  });

  it('reports a failed launch or restart', async () => {
    const h = setup({});
    h.host.restart.mockRejectedValueOnce(Object.assign(new Error("Ollama didn't quit"), { code: 'E_TIMEOUT' }));
    expect(await prepareOllama(h.deps, { launch: true })).toBe('failed');
    const l = setup({ appRunning: false, server: null, promptCache: null }, { health: ['down'] });
    l.host.launch.mockRejectedValueOnce(new Error('E_LAUNCH'));
    expect(await prepareOllama(l.deps, { launch: true })).toBe('failed');
  });
});
