import { createOllama } from '../../src/core/ollama';
import { buildSystem } from '../../src/core/prompt';
import type { FetchLike, PullProgress, StreamLike } from '../../src/core/ollama';
import type { ScreenSnapshot } from '../../src/contracts/native';
import { fixtureModules } from '../../src/fixtures/data';

const SNAP: ScreenSnapshot = {
  appName: 'Preview',
  bundleId: 'com.apple.Preview',
  windowTitle: 'BIO101 Lecture 4 – Cell division.pdf',
  isSelf: false,
  jpegBase64: 'SECRET_IMAGE_DATA',
  width: 1280,
  height: 800,
  capturedAt: 0,
};

function jsonRes(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => body });
}

function chatRes(content: string) {
  return jsonRes({ message: { role: 'assistant', content } });
}

describe('ollama', () => {
  const logs: string[] = [];
  const log = (l: string) => logs.push(l);
  beforeEach(() => {
    logs.length = 0;
  });

  it('classify posts the documented body and parses the verdict', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(() =>
      chatRes(JSON.stringify({ studying: true, subject: 'Biology', activity: 'Reading cell slides', confidence: 0.91 })),
    );
    const o = createOllama({ baseUrl: 'http://127.0.0.1:11434/', model: 'qwen3-vl:4b', fetchImpl, log });
    const v = await o.classify(SNAP, fixtureModules);
    expect(v).toEqual({ studying: true, moduleId: 'mod_biology', activity: '', confidence: 0.91, source: 'vlm' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init!.body!);
    expect(body).toMatchObject({
      model: 'qwen3-vl:4b',
      stream: false,
      think: false,
      keep_alive: '30m',
      options: { temperature: 0, num_ctx: 4096 },
    });
    expect(body.format.properties.subject.enum).toEqual(['Biology', 'Maths', 'History', 'Not study']);
    expect(body.format.required).not.toContain('activity');
    expect(body.messages[1].images).toEqual(['SECRET_IMAGE_DATA']);
    expect(body.messages[1].content).toContain('Window title: BIO101 Lecture 4');
    expect(init?.signal).toBeDefined();
    // Empty-think assistant prefill (Qwen3-VL ignores think:false).
    expect(body.messages).toHaveLength(3);
    expect(body.messages[2]).toEqual({ role: 'assistant', content: '<think>\n\n</think>\n\n' });
  });

  it('uses the per-call keep_alive on classify and warmUp', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(() =>
      chatRes(JSON.stringify({ studying: false, subject: 'Not study', activity: 'Feed', confidence: 0.9 })),
    );
    const o = createOllama({ baseUrl: 'http://127.0.0.1:11434', model: 'qwen3-vl:4b', fetchImpl, log });
    await o.classify(SNAP, fixtureModules, { keepAlive: '5m' });
    await o.warmUp(fixtureModules, { keepAlive: '5m' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body!).keep_alive).toBe('5m');
    expect(JSON.parse(fetchImpl.mock.calls[1][1]!.body!).keep_alive).toBe('5m');
  });

  it('tolerates code fences / stray text around the JSON reply', async () => {
    const fetchImpl: FetchLike = () =>
      chatRes('```json\n{"studying":true,"subject":"Maths","activity":"Problem set","confidence":0.8}\n```');
    const o = createOllama({ baseUrl: 'http://x', model: 'm', fetchImpl, log });
    await expect(o.classify(SNAP, fixtureModules)).resolves.toMatchObject({ studying: true, moduleId: 'mod_maths' });
  });

  it('never logs the image or the request body', async () => {
    const fetchImpl: FetchLike = () => chatRes('{"studying":false,"subject":"Not study","activity":"Feed","confidence":0.9}');
    const o = createOllama({ baseUrl: 'http://x', model: 'm', fetchImpl, log });
    await o.classify(SNAP, fixtureModules);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/ms → Not study/);
    expect(logs.join('\n')).not.toContain('SECRET_IMAGE_DATA');
    expect(logs.join('\n')).not.toContain('BIO101');
  });

  it('returns null on timeout (AbortController)', async () => {
    jest.useFakeTimers();
    try {
      let aborted = false;
      const fetchImpl: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        });
      const o = createOllama({ baseUrl: 'http://x', model: 'm', fetchImpl, timeoutMs: 8_000, log });
      const p = o.classify(SNAP, fixtureModules);
      await jest.advanceTimersByTimeAsync(8_000);
      await expect(p).resolves.toBeNull();
      expect(aborted).toBe(true);
      expect(logs[0]).toMatch(/timeout/);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns null on timeout even if fetch ignores the signal', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl: FetchLike = () => new Promise(() => {});
      const o = createOllama({ baseUrl: 'http://x', model: 'm', fetchImpl, timeoutMs: 1000, log });
      const p = o.classify(SNAP, fixtureModules);
      await jest.advanceTimersByTimeAsync(1000);
      await expect(p).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns null on bad JSON, HTTP errors, network errors and unknown subjects', async () => {
    const cases: FetchLike[] = [
      () => chatRes('this is not json'),
      () => chatRes('{"studying":true,"subject":"Chemistry","activity":"x","confidence":1}'),
      () => jsonRes({ error: 'model not found' }, false, 404),
      () => jsonRes({}),
      () => Promise.reject(new TypeError('Network request failed')),
    ];
    for (const fetchImpl of cases) {
      const o = createOllama({ baseUrl: 'http://x', model: 'm', fetchImpl, log });
      await expect(o.classify(SNAP, fixtureModules)).resolves.toBeNull();
    }
  });

  describe('warmUp', () => {
    it('loads the model with the same system prompt and num_ctx as classify, generating one token', async () => {
      const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(() => chatRes(''));
      const o = createOllama({ baseUrl: 'http://127.0.0.1:11434', model: 'qwen3-vl:4b', fetchImpl, log });
      await o.warmUp(fixtureModules);
      await o.classify(SNAP, fixtureModules);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:11434/api/chat');
      const warm = JSON.parse(init!.body!);
      const real = JSON.parse(fetchImpl.mock.calls[1][1]!.body!);
      expect(warm).toMatchObject({ model: 'qwen3-vl:4b', keep_alive: '30m', options: { num_ctx: 4096, num_predict: 1 } });
      expect(warm.messages[0]).toEqual({ role: 'system', content: buildSystem(fixtureModules) });
      expect(warm.messages[0]).toEqual(real.messages[0]);
      expect(warm.options.num_ctx).toBe(real.options.num_ctx); // a different num_ctx would reload the model
      expect(JSON.stringify(warm)).not.toContain('images');
      expect(logs[0]).toMatch(/warm-up \d+ ms/);
    });

    it('never rejects', async () => {
      const o = createOllama({ baseUrl: 'http://x', model: 'm', fetchImpl: () => Promise.reject(new Error('down')), log });
      await expect(o.warmUp(fixtureModules)).resolves.toBeUndefined();
      expect(logs[0]).toMatch(/warm-up failed/);
    });
  });

  describe('unload', () => {
    it('posts keep_alive 0 with no prompt to /api/generate', async () => {
      const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(() => jsonRes({ done: true, done_reason: 'unload' }));
      const o = createOllama({ baseUrl: 'http://127.0.0.1:11434/', model: 'qwen3-vl:4b', fetchImpl, log });
      await o.unload();
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:11434/api/generate');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init!.body!)).toEqual({ model: 'qwen3-vl:4b', keep_alive: 0 });
      expect(logs).toEqual(['[ollama] qwen3-vl:4b unloaded']);
    });

    it('never rejects (Ollama down or HTTP error)', async () => {
      for (const fetchImpl of [() => Promise.reject(new Error('x')), () => jsonRes({}, false, 500)] as FetchLike[]) {
        await expect(createOllama({ baseUrl: 'http://x', model: 'm', fetchImpl, log }).unload()).resolves.toBeUndefined();
      }
      expect(logs).toEqual(['[ollama] m unload failed', '[ollama] m unload failed']);
    });
  });

  describe('checkHealth', () => {
    const tags = (names: string[]): FetchLike => () => jsonRes({ models: names.map((name) => ({ name, model: name })) });

    it('ok when the model is listed (with or without :latest)', async () => {
      expect(await createOllama({ baseUrl: 'http://x', model: 'qwen3-vl:4b', fetchImpl: tags(['qwen3-vl:4b']) }).checkHealth()).toBe('ok');
      expect(await createOllama({ baseUrl: 'http://x', model: 'gemma4', fetchImpl: tags(['gemma4:latest']) }).checkHealth()).toBe('ok');
      expect(await createOllama({ baseUrl: 'http://x', model: 'gemma4:latest', fetchImpl: tags(['gemma4']) }).checkHealth()).toBe('ok');
    });

    it('modelMissing when it is not', async () => {
      expect(await createOllama({ baseUrl: 'http://x', model: 'qwen3-vl:8b', fetchImpl: tags(['qwen3-vl:4b']) }).checkHealth()).toBe(
        'modelMissing',
      );
    });

    it('down on network error or HTTP error', async () => {
      expect(await createOllama({ baseUrl: 'http://x', model: 'm', fetchImpl: () => Promise.reject(new Error('x')) }).checkHealth()).toBe('down');
      expect(await createOllama({ baseUrl: 'http://x', model: 'm', fetchImpl: () => jsonRes({}, false, 500) }).checkHealth()).toBe('down');
    });

    it('reads model and url lazily (settings can change)', async () => {
      let model = 'a';
      const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(() => jsonRes({ models: [{ name: 'b' }] }));
      const o = createOllama({ baseUrl: () => 'http://h:1', model: () => model, fetchImpl });
      expect(await o.checkHealth()).toBe('modelMissing');
      model = 'b';
      expect(await o.checkHealth()).toBe('ok');
      expect(fetchImpl.mock.calls[0][0]).toBe('http://h:1/api/tags');
    });
  });
});

describe('ollama loadedModels', () => {
  it('lists /api/ps names, null when Ollama is unreachable', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(() =>
      jsonRes({ models: [{ name: 'qwen3-vl:4b', model: 'qwen3-vl:4b' }, { model: 'llama3' }] }),
    );
    const o = createOllama({ baseUrl: 'http://x/', model: 'm', fetchImpl });
    expect(await o.loadedModels()).toEqual(['qwen3-vl:4b', 'llama3']);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://x/api/ps');
    const down = createOllama({ baseUrl: 'http://x', model: 'm', fetchImpl: () => Promise.reject(new Error('refused')) });
    expect(await down.loadedModels()).toBeNull();
  });
});

describe('ollama pull', () => {
  type Init = Parameters<StreamLike>[1];
  /** A StreamLike that sends `chunks` in order, then resolves with `status`. */
  const stream = (chunks: string[], status = 200) =>
    jest.fn<ReturnType<StreamLike>, Parameters<StreamLike>>(async (_url, _init, onText) => {
      chunks.forEach(onText);
      return { ok: status >= 200 && status < 300, status };
    });
  const line = (o: object) => `${JSON.stringify(o)}\n`;
  const BIG = 'sha256:aaaa';
  const SMALL = 'sha256:bbbb';

  it('posts the model and sums progress over layers, across split lines', async () => {
    const text = [
      line({ status: 'pulling manifest' }),
      line({ status: 'pulling aaaa', digest: BIG, total: 3000, completed: 0 }),
      line({ status: 'pulling aaaa', digest: BIG, total: 3000, completed: 1500 }),
      line({ status: 'pulling bbbb', digest: SMALL, total: 100, completed: 100 }),
      line({ status: 'pulling aaaa', digest: BIG, total: 3000, completed: 3000 }),
      line({ status: 'verifying sha256 digest' }),
      line({ status: 'success' }),
    ].join('');
    // Cut the stream mid-line to check the line buffering.
    const streamImpl = stream([text.slice(0, 50), text.slice(50, 140), text.slice(140)]);
    const progress: PullProgress[] = [];
    const o = createOllama({ baseUrl: 'http://127.0.0.1:11434/', model: 'qwen3-vl:4b', streamImpl, log: () => {} });
    await o.pull((p) => progress.push(p));

    const [url, init] = streamImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/pull');
    expect((init as Init).method).toBe('POST');
    expect(JSON.parse((init as Init).body!)).toEqual({ model: 'qwen3-vl:4b', stream: true });
    expect(progress).toEqual([
      { completed: 0, total: 3000 },
      { completed: 1500, total: 3000 },
      { completed: 1600, total: 3100 },
      { completed: 3100, total: 3100 },
    ]);
  });

  it("rejects with Ollama's error line, an HTTP error, or a stream that stops early", async () => {
    const pull = (streamImpl: StreamLike) => createOllama({ baseUrl: 'http://x', model: 'nope', streamImpl, log: () => {} }).pull(() => {});
    await expect(pull(stream([line({ error: 'pull model manifest: file does not exist' })], 500))).rejects.toThrow(
      'pull model manifest: file does not exist',
    );
    await expect(pull(stream(['not json\n'], 502))).rejects.toThrow('HTTP 502');
    await expect(pull(stream([line({ status: 'pulling manifest' })]))).rejects.toThrow('stopped early');
  });

  it('passes the abort signal through and rethrows the AbortError', async () => {
    const abort = new AbortController();
    const streamImpl: StreamLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    const done = createOllama({ baseUrl: 'http://x', model: 'm', streamImpl, log: () => {} }).pull(() => {}, { signal: abort.signal });
    abort.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
  });
});
