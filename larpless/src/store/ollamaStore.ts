import { create } from 'zustand';
import type { OllamaPrepareOutcome, OllamaSetupState, OllamaSetupStore } from '../contracts/store';
import { createOllama } from '../core/ollama';
import { prepareOllama } from '../core/ollamaHost';
import { native } from '../native';
import { useAppStore } from './appStore';

export const initialOllamaSetupState: OllamaSetupState = {
  host: null,
  prepared: null,
  starting: false,
  pull: { status: 'idle' },
};

/** Ollama reports pull progress many times a second; the store takes at most one update per this many ms. */
export const PULL_UPDATE_MS = 250;

const settings = () => useAppStore.getState().settings;
const ollama = createOllama({ baseUrl: () => settings().ollamaUrl, model: () => settings().model });
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** prepare() calls run one after another, so an app-launch check and a session start can't both restart. */
let prepareChain: Promise<unknown> = Promise.resolve();
let pullAbort: AbortController | null = null;

export const useOllamaStore = create<OllamaSetupStore>()((set, get) => ({
  ...initialOllamaSetupState,

  async refreshHost() {
    try {
      set({ host: await native.ollamaHost.info() });
    } catch (e) {
      console.warn('[ollama] host info failed:', errorText(e));
    }
  },

  prepare(opts) {
    const run = async (): Promise<OllamaPrepareOutcome> => {
      let outcome: OllamaPrepareOutcome;
      try {
        outcome = await prepareOllama(
          {
            host: native.ollamaHost,
            ollama,
            baseUrl: () => settings().ollamaUrl,
            model: () => settings().model,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            onStart: () => set({ starting: true }),
            log: (line) => console.log(line),
          },
          opts,
        );
      } catch (e) {
        console.warn('[ollama] prepare failed:', errorText(e));
        outcome = 'failed';
      }
      set({ prepared: outcome, starting: false });
      await get().refreshHost();
      return outcome;
    };
    const next = prepareChain.then(run, run);
    prepareChain = next;
    return next;
  },

  async pullModel() {
    if (get().pull.status === 'pulling') return;
    const abort = new AbortController();
    pullAbort = abort;
    set({ pull: { status: 'pulling', completed: 0, total: 0 } });
    let lastAt = 0;
    try {
      await ollama.pull(
        (p) => {
          const t = Date.now();
          if (t - lastAt < PULL_UPDATE_MS) return;
          lastAt = t;
          set({ pull: { status: 'pulling', ...p } });
        },
        { signal: abort.signal },
      );
      set({ pull: { status: 'done' } });
    } catch (e) {
      if (abort.signal.aborted) set({ pull: { status: 'idle' } });
      else {
        const message = errorText(e) === 'network error' ? 'Couldn’t reach Ollama.' : errorText(e);
        set({ pull: { status: 'error', message } });
      }
    } finally {
      if (pullAbort === abort) pullAbort = null;
    }
  },

  cancelPull() {
    pullAbort?.abort();
  },
}));
