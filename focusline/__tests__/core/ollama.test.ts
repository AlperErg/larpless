import { createOllama } from '../../src/core/ollama';
import type { FetchLike } from '../../src/core/ollama';
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
    expect(v).toEqual({ studying: true, moduleId: 'mod_biology', activity: 'Reading cell slides', confidence: 0.91, source: 'vlm' });

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
      options: { temperature: 0 },
    });
    expect(body.format.properties.subject.enum).toEqual(['Biology', 'Maths', 'History', 'Not study']);
    expect(body.messages[1].images).toEqual(['SECRET_IMAGE_DATA']);
    expect(body.messages[1].content).toContain('Window title: BIO101 Lecture 4');
    expect(init?.signal).toBeDefined();
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
      const o = createOllama({ baseUrl: 'http://x', model: 'm', fetchImpl, timeoutMs: 20_000, log });
      const p = o.classify(SNAP, fixtureModules);
      await jest.advanceTimersByTimeAsync(20_000);
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
