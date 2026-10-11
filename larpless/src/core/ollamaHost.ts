/**
 * Gets the local Ollama ready for a session without llama.cpp's RAM prompt cache. Pure TS: the native
 * host facade, the HTTP client and the clock are injected.
 *
 * Ollama ≥ 0.30 runs models in llama-server, which keeps up to 8 GiB of old prompts in RAM: one ~340 MB
 * entry per screenshot, and LarpLess never reuses one. No request option turns it off; only
 * LLAMA_ARG_CACHE_RAM=0 in Ollama's environment at launch does. So LarpLess opens Ollama.app with it, and
 * restarts an Ollama.app running with the default once nothing but LarpLess's model is loaded.
 */
import type { OllamaHostApi } from '../contracts/native';
import type { OllamaPrepareOutcome } from '../contracts/store';
import { sameModel } from './ollama';
import type { OllamaClient } from './ollama';

export interface PrepareDeps {
  host: OllamaHostApi;
  ollama: Pick<OllamaClient, 'checkHealth' | 'loadedModels'>;
  baseUrl(): string;
  model(): string;
  sleep(ms: number): Promise<void>;
  /** Called right before Ollama is launched or restarted. */
  onStart?(): void;
  log?(line: string): void;
}

export interface PrepareOptions {
  /** Open Ollama.app when it isn't running. */
  launch: boolean;
  /** Restart even when another model is loaded (the user asked for it). */
  force?: boolean;
}

/** How long a launched or restarted Ollama gets to answer. */
export const SERVER_WAIT_MS = 20_000;
const POLL_MS = 500;

/** Ollama.app can only be managed when the URL points at this Mac. */
export function isLocalUrl(url: string): boolean {
  const host = /^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]*\]|[^/:?#]*)/i.exec(url.trim())?.[1]?.toLowerCase();
  if (!host) return false;
  return host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

export async function prepareOllama(deps: PrepareDeps, opts: PrepareOptions): Promise<OllamaPrepareOutcome> {
  const log = deps.log ?? (() => {});
  if (!isLocalUrl(deps.baseUrl())) return 'remote';
  const info = await deps.host.info();

  if ((await deps.ollama.checkHealth()) === 'down') {
    if (!info.appInstalled) return info.cliInstalled ? 'down' : 'missing';
    if (!opts.launch) return 'down';
    log('[ollama] opening Ollama.app with the prompt cache off');
    deps.onStart?.();
    try {
      await deps.host.launch();
    } catch {
      return 'failed';
    }
    return (await waitForServer(deps)) ? 'launched' : 'failed';
  }

  if (info.promptCache === 'off' || info.promptCache === 'custom') return 'ready';
  if (info.promptCache === null || info.server !== 'app') return 'external';
  if (!opts.force) {
    // A restart drops every loaded model; only do it when nobody else is using one.
    const loaded = await deps.ollama.loadedModels();
    if (loaded === null || loaded.some((m) => !sameModel(m, deps.model()))) return 'busy';
  }
  log('[ollama] restarting Ollama.app to turn its prompt cache off');
  deps.onStart?.();
  try {
    await deps.host.restart();
  } catch {
    return 'failed';
  }
  return (await waitForServer(deps)) ? 'restarted' : 'failed';
}

async function waitForServer(deps: PrepareDeps): Promise<boolean> {
  for (let waited = 0; waited < SERVER_WAIT_MS; waited += POLL_MS) {
    await deps.sleep(POLL_MS);
    if ((await deps.ollama.checkHealth()) !== 'down') return true;
  }
  return false;
}
