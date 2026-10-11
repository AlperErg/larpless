/**
 * Ollama client for the screen classifier. Pure TS: `fetch` is injected (defaults to the global).
 *
 * PRIVACY: the snapshot and the request body are never logged or kept. Only latency and the verdict are logged.
 */
import type { ScreenVerdict, StudyModule } from '../contracts/domain';
import type { ScreenSnapshot } from '../contracts/native';
import type { OllamaStatus } from '../contracts/store';
import { buildMessages, buildSchema, buildSystem, extractJson, NUM_CTX, parseVerdict } from './prompt';

export type OllamaHealth = Exclude<OllamaStatus, 'unknown'>;

/** Minimal fetch shape we rely on (the global RN / Node fetch satisfies it). */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** POST whose response body arrives in pieces through `onText` (Ollama's NDJSON progress). */
export type StreamLike = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
  onText: (text: string) => void,
) => Promise<{ ok: boolean; status: number }>;

export interface PullProgress {
  /** Bytes downloaded across the layers Ollama has announced so far. */
  completed: number;
  /** Size of those layers; 0 until Ollama has read the manifest. */
  total: number;
}

export interface OllamaOptions {
  baseUrl: string | (() => string);
  model: string | (() => string);
  fetchImpl?: FetchLike;
  /** Used by pull(); defaults to XMLHttpRequest, whose responseText grows as the body arrives. */
  streamImpl?: StreamLike;
  /** Timeout for classify() when a call does not pass its own. Default 30 s. */
  timeoutMs?: number;
  /** Timeout for checkHealth() and unload(); default 3 s. */
  healthTimeoutMs?: number;
  /** Timeout for warmUp(), which may include loading the model; default 30 s. */
  warmUpTimeoutMs?: number;
  /** Logger for latency + verdict lines; default console.log. Pass () => {} to silence. */
  log?: (line: string) => void;
}

export interface OllamaCallOptions {
  /** Overrides the client timeout for this call. */
  timeoutMs?: number;
  /** How long Ollama keeps the model loaded after this call. Default `30m`. */
  keepAlive?: string;
}

export interface OllamaClient {
  checkHealth(): Promise<OllamaHealth>;
  classify(snapshot: ScreenSnapshot, modules: StudyModule[], call?: OllamaCallOptions): Promise<ScreenVerdict | null>;
  /**
   * Load the model and process the system prompt (with `modules`) without an image, so the first
   * classify() of a session skips both. Never rejects.
   */
  warmUp(modules: StudyModule[], call?: Pick<OllamaCallOptions, 'keepAlive'>): Promise<void>;
  /** Ask Ollama to unload the model now instead of after keep_alive. Never rejects. */
  unload(): Promise<void>;
  /** Names of the models Ollama has in memory (GET /api/ps); null when it can't be reached. */
  loadedModels(): Promise<string[] | null>;
  /**
   * Download the model (POST /api/pull), reporting bytes as they arrive. Rejects with Ollama's error, or an
   * AbortError when `signal` fires; Ollama keeps the partial download and resumes it on the next pull.
   */
  pull(onProgress: (p: PullProgress) => void, call?: { signal?: AbortSignal }): Promise<void>;
}

const read = (v: string | (() => string)) => (typeof v === 'function' ? v() : v);
const stripLatest = (name: string) => name.replace(/:latest$/, '');
const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** Ollama treats `name` and `name:latest` as the same model. */
export const sameModel = (a: string, b: string) => stripLatest(a) === stripLatest(b);

function abortError(message: string): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

const xhrStream: StreamLike = (url, init, onText) =>
  new Promise((resolve, reject) => {
    if (init.signal?.aborted) {
      reject(abortError('aborted'));
      return;
    }
    const xhr = new XMLHttpRequest();
    let seen = 0;
    const flush = () => {
      const text = xhr.responseText;
      if (text.length > seen) {
        onText(text.slice(seen));
        seen = text.length;
      }
    };
    const onAbort = () => xhr.abort();
    const settle = () => init.signal?.removeEventListener('abort', onAbort);
    xhr.open(init.method, url);
    for (const [k, v] of Object.entries(init.headers ?? {})) xhr.setRequestHeader(k, v);
    // Setting onprogress is what makes React Native deliver the body incrementally.
    xhr.onprogress = flush;
    xhr.onload = () => {
      settle();
      flush();
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    };
    xhr.onerror = () => {
      settle();
      reject(new Error('network error'));
    };
    xhr.onabort = () => {
      settle();
      reject(abortError('aborted'));
    };
    init.signal?.addEventListener('abort', onAbort);
    xhr.send(init.body ?? null);
  });

/**
 * Run `fn` with an AbortSignal that fires after `ms`. Also rejects on the timeout by itself, in case
 * the fetch implementation (or `res.json()`) ignores the signal. The timer is always cleared.
 */
async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(abortError('timeout'));
    }, ms);
  });
  try {
    return await Promise.race([fn(ctrl.signal), timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export function createOllama(opts: OllamaOptions): OllamaClient {
  const fetchImpl: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const streamImpl = opts.streamImpl ?? xhrStream;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const healthTimeoutMs = opts.healthTimeoutMs ?? 3_000;
  const warmUpTimeoutMs = opts.warmUpTimeoutMs ?? 30_000;
  const log = opts.log ?? ((line: string) => console.log(line));

  return {
    async checkHealth() {
      const model = read(opts.model);
      try {
        const data = await withTimeout(healthTimeoutMs, async (signal) => {
          const res = await fetchImpl(`${trimSlash(read(opts.baseUrl))}/api/tags`, { method: 'GET', signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        });
        const models = (data as { models?: { name?: unknown; model?: unknown }[] } | null)?.models;
        if (!Array.isArray(models)) return 'down';
        const found = models.some((m) =>
          [m?.name, m?.model].some((n) => typeof n === 'string' && sameModel(n, model)),
        );
        return found ? 'ok' : 'modelMissing';
      } catch {
        return 'down';
      }
    },

    async classify(snapshot, modules, call) {
      const model = read(opts.model);
      const t0 = Date.now();
      const keepAlive = call?.keepAlive ?? '30m';
      // Built once; dropped in finally so the base64 copy doesn't linger.
      let body: string | null = JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: keepAlive,
        options: { temperature: 0, num_ctx: NUM_CTX },
        format: buildSchema(modules.map((m) => m.name)),
        messages: buildMessages({
          appName: snapshot.appName,
          windowTitle: snapshot.windowTitle,
          modules,
          imageBase64: snapshot.jpegBase64,
          // Qwen3-VL ignores think:false; the empty-think prefill skips reasoning (bench: p50 3.2 s).
          prefillNoThink: true,
        }),
      });
      try {
        const data = await withTimeout(call?.timeoutMs ?? timeoutMs, async (signal) => {
          const res = await fetchImpl(`${trimSlash(read(opts.baseUrl))}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body!,
            signal,
          });
          body = null;
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        });
        const content = (data as { message?: { content?: unknown } } | null)?.message?.content;
        if (typeof content !== 'string') throw new Error('no content');
        // With the prefill Ollama no longer enforces `format`, so tolerate fences / stray text.
        const parsed = extractJson(content);
        if (parsed === null) throw new Error('bad json');
        const verdict = parseVerdict(parsed, modules);
        const ms = Date.now() - t0;
        if (verdict) {
          const label = verdict.studying
            ? modules.find((m) => m.id === verdict.moduleId)?.name ?? '?'
            : 'Not study';
          log(`[ollama] ${model} ${ms} ms → ${label} (${verdict.confidence.toFixed(2)})`);
        } else {
          log(`[ollama] ${model} ${ms} ms → unparseable verdict`);
        }
        return verdict;
      } catch (e) {
        const ms = Date.now() - t0;
        const why = (e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'error';
        log(`[ollama] ${model} ${ms} ms → ${why}`);
        return null;
      } finally {
        body = null;
      }
    },

    async warmUp(modules, call) {
      const model = read(opts.model);
      const t0 = Date.now();
      try {
        await withTimeout(warmUpTimeoutMs, async (signal) => {
          const res = await fetchImpl(`${trimSlash(read(opts.baseUrl))}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Same model, num_ctx and system message as classify(): a different num_ctx would reload the model.
            body: JSON.stringify({
              model,
              stream: false,
              think: false,
              keep_alive: call?.keepAlive ?? '30m',
              options: { temperature: 0, num_ctx: NUM_CTX, num_predict: 1 },
              messages: [
                { role: 'system', content: buildSystem(modules) },
                { role: 'user', content: 'Ready?' },
              ],
            }),
            signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        });
        log(`[ollama] ${model} warm-up ${Date.now() - t0} ms`);
      } catch {
        log(`[ollama] ${model} warm-up failed after ${Date.now() - t0} ms`);
      }
    },

    async unload() {
      const model = read(opts.model);
      try {
        // Empty prompt + keep_alive 0 is Ollama's documented unload; it doesn't load a model that isn't resident.
        await withTimeout(healthTimeoutMs, async (signal) => {
          const res = await fetchImpl(`${trimSlash(read(opts.baseUrl))}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, keep_alive: 0 }),
            signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        });
        log(`[ollama] ${model} unloaded`);
      } catch {
        log(`[ollama] ${model} unload failed`);
      }
    },

    async loadedModels() {
      try {
        const data = await withTimeout(healthTimeoutMs, async (signal) => {
          const res = await fetchImpl(`${trimSlash(read(opts.baseUrl))}/api/ps`, { method: 'GET', signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        });
        const models = (data as { models?: { name?: unknown; model?: unknown }[] } | null)?.models;
        if (!Array.isArray(models)) return null;
        return models
          .map((m) => (typeof m?.name === 'string' ? m.name : typeof m?.model === 'string' ? m.model : ''))
          .filter(Boolean);
      } catch {
        return null;
      }
    },

    async pull(onProgress, call) {
      const model = read(opts.model);
      const t0 = Date.now();
      // Ollama reports each layer (blob) separately; progress is the sum over the layers seen so far.
      const layers = new Map<string, PullProgress>();
      let error: string | null = null;
      let success = false;
      let pending = '';
      const onLine = (line: string) => {
        if (!line.trim()) return;
        let msg: { status?: unknown; digest?: unknown; total?: unknown; completed?: unknown; error?: unknown };
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (typeof msg.error === 'string') error = msg.error;
        if (msg.status === 'success') success = true;
        if (typeof msg.digest !== 'string' || typeof msg.total !== 'number') return;
        layers.set(msg.digest, { total: msg.total, completed: typeof msg.completed === 'number' ? msg.completed : 0 });
        let completed = 0;
        let total = 0;
        for (const l of layers.values()) {
          completed += l.completed;
          total += l.total;
        }
        onProgress({ completed, total });
      };
      try {
        const res = await streamImpl(
          `${trimSlash(read(opts.baseUrl))}/api/pull`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: true }),
            signal: call?.signal,
          },
          (text) => {
            const lines = (pending + text).split('\n');
            pending = lines.pop() ?? '';
            lines.forEach(onLine);
          },
        );
        onLine(pending);
        if (error) throw new Error(error);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!success) throw new Error('the download stopped early');
        log(`[ollama] ${model} pulled in ${Date.now() - t0} ms`);
      } catch (e) {
        const aborted = (e as { name?: string })?.name === 'AbortError';
        log(`[ollama] ${model} pull ${aborted ? 'cancelled' : 'failed'} after ${Date.now() - t0} ms`);
        throw e;
      }
    },
  };
}
