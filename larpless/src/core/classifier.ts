/**
 * Screen classifier: PLAN.md §6 steps 2–5 (isSelf → rules → cache → single-flight VLM).
 *
 * Single flight: one screenshot at a time. A call for the same window shares that result.
 * A call for another window waits, and when the running call finishes exactly one follow-up
 * reads whatever is frontmost then. Windows that came and went are not shot.
 *
 * A screenshot is taken ONLY on the VLM path. PRIVACY: the snapshot is dropped in `finally`
 * and never logged. Window keys hold titles: keep them in memory, never persist or log them.
 */
import type { ScreenVerdict, StudyModule } from '../contracts/domain';
import type { CaptureOptions, NativeApis, ScreenSnapshot } from '../contracts/native';
import type { OllamaClient } from './ollama';
import { BEHIND_WINDOWS } from './powerProfile';
import type { PowerSpec } from './powerProfile';
import { MAX_ACTIVITY_CHARS } from './prompt';
import { matchDistraction } from './rules';

export interface ClassifierConfig {
  USE_MOCK_CLASSIFIER: boolean;
  CACHE_TTL_MS: number;
  CAPTURE: CaptureOptions;
}

export interface ClassifierDeps {
  native: Pick<NativeApis, 'screen'>;
  ollama: Pick<OllamaClient, 'classify' | 'warmUp' | 'unload'>;
  now: () => number;
  config: ClassifierConfig;
  /** Capture size, cache TTL, timeout and keep_alive. Falls back to `config` when omitted. */
  getPower?: () => PowerSpec;
}

/** Why there's no verdict (the chunk becomes `unknown`). */
export type ClassifyError = 'permission' | 'capture' | 'vlm';

export interface ClassifyResult {
  verdict: ScreenVerdict | null;
  tookScreenshot: boolean;
  appName: string | null;
  /** windowKey() of the window this result describes; null when LarpLess itself was frontmost. */
  key: string | null;
  error?: ClassifyError;
  /** How long the vision call took. Absent when the model was not called. */
  tookMs?: number;
  /** True when three or more windows arrived while this call was running. */
  fellBehind?: boolean;
  /** One id per vision call, copied onto every waiter, so a slow call steps the profile down once. */
  gen?: number;
}

/** Identity of a window for "has it changed?" checks. Contains the title: in memory only. */
export function windowKey(appName: string | null, windowTitle: string | null): string {
  return JSON.stringify([appName, windowTitle]);
}

export interface ClassifyContext {
  /** Override config.USE_MOCK_CLASSIFIER (tests, dev tools). */
  mockClassifier?: boolean;
}

export interface Classifier {
  classifyCurrent(modules: StudyModule[], ctx?: ClassifyContext): Promise<ClassifyResult>;
  /** Preload the VLM and its system prompt (no-op with USE_MOCK_CLASSIFIER). Never rejects. */
  warmUp(modules: StudyModule[]): Promise<void>;
  /** Free the VLM's memory now (no-op with USE_MOCK_CLASSIFIER). Never rejects. */
  unload(): Promise<void>;
  /** Forget the previous verdict and the cache (call at session start). */
  reset(): void;
}

interface CacheEntry {
  appName: string | null;
  windowTitle: string;
  verdict: ScreenVerdict;
  at: number;
}

const lc = (s: string) => s.toLowerCase();

/**
 * USE_MOCK_CLASSIFIER: derive a verdict from the window title, no Ollama.
 * A module matches when its name or a keyword appears in the title (keywords of 6+ letters also
 * match their stem, so "integral" matches "Integration by parts").
 */
export function mockVerdictFromTitle(
  appName: string | null,
  windowTitle: string | null,
  modules: StudyModule[],
): ScreenVerdict {
  const title = lc(windowTitle ?? '');
  const hit = title
    ? modules.find((m) =>
        [m.name, ...m.keywords].some((k) => {
          const kw = lc(k.trim());
          if (!kw) return false;
          return title.includes(kw) || (kw.length >= 6 && title.includes(kw.slice(0, -1)));
        }),
      )
    : undefined;
  const activity = (windowTitle ?? appName ?? 'Unknown').slice(0, MAX_ACTIVITY_CHARS);
  return hit
    ? { studying: true, moduleId: hit.id, activity, confidence: 0.7, source: 'vlm' }
    : { studying: false, moduleId: null, activity, confidence: 0.6, source: 'vlm' };
}

function errorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown })?.code;
  return typeof code === 'string' ? code : undefined;
}

interface Flight {
  key: string;
  gen: number;
  seen: Set<string>;
  result: Promise<ClassifyResult>;
  followUp?: Promise<ClassifyResult>;
}

export function createClassifier({ native, ollama, now, config, getPower }: ClassifierDeps): Classifier {
  let previous: ScreenVerdict | null = null;
  let previousApp: string | null = null;
  let previousKey: string | null = null;
  let cache: CacheEntry | null = null;
  let inFlight: Flight | null = null;
  let nextGen = 1;

  const power = () => getPower?.();
  const cacheTtl = () => power()?.cacheTtlMs ?? config.CACHE_TTL_MS;

  const remember = (v: ScreenVerdict | null, app: string | null, key: string) => {
    if (v) {
      previous = v;
      previousApp = app;
      previousKey = key;
    }
    return v;
  };

  async function runVlm(modules: StudyModule[], ctx: ClassifyContext, appName: string | null, key: string): Promise<ClassifyResult> {
    const started = now();
    let snap: ScreenSnapshot | null = null;
    const spec = power();
    try {
      try {
        snap = await native.screen.capture(spec?.capture ?? config.CAPTURE);
      } catch (e) {
        return {
          verdict: null,
          tookScreenshot: false,
          appName,
          key,
          tookMs: Math.max(0, now() - started),
          error: errorCode(e) === 'E_PERMISSION' ? 'permission' : 'capture',
        };
      }
      const useMock = ctx.mockClassifier ?? config.USE_MOCK_CLASSIFIER;
      const snapApp = snap.appName ?? appName;
      const snapTitle = snap.windowTitle;
      const snapKey = windowKey(snapApp, snapTitle);
      const verdict = useMock
        ? mockVerdictFromTitle(snapApp, snapTitle, modules)
        : spec
          ? await ollama.classify(snap, modules, { timeoutMs: spec.classifyTimeoutMs, keepAlive: spec.keepAlive })
          : await ollama.classify(snap, modules);
      if (verdict && snapTitle !== null) {
        cache = { appName: snapApp, windowTitle: snapTitle, verdict, at: now() };
      }
      return {
        verdict: remember(verdict, snapApp, snapKey),
        tookScreenshot: true,
        appName: snapApp,
        key: snapKey,
        tookMs: Math.max(0, now() - started),
        ...(verdict ? {} : { error: 'vlm' as const }),
      };
    } finally {
      snap = null;
    }
  }

  const classifier: Classifier = {
    reset() {
      previous = null;
      previousApp = null;
      previousKey = null;
      cache = null;
    },

    async warmUp(modules) {
      if (config.USE_MOCK_CLASSIFIER) return;
      const keepAlive = power()?.keepAlive;
      if (keepAlive) await ollama.warmUp(modules, { keepAlive });
      else await ollama.warmUp(modules);
    },

    async unload() {
      if (config.USE_MOCK_CLASSIFIER) return;
      await ollama.unload();
    },

    async classifyCurrent(modules, ctx = {}) {
      const win = await native.screen.getActiveWindow();
      const appName = win.appName ?? null;

      // 1. LarpLess itself is frontmost → reuse the previous screen verdict. No screenshot.
      if (win.isSelf) {
        if (!previous) return { verdict: null, tookScreenshot: false, appName: null, key: null };
        const source = previous.source === 'rule' ? 'rule' : 'cache';
        return { verdict: { ...previous, source }, tookScreenshot: false, appName: previousApp, key: previousKey };
      }

      const key = windowKey(appName, win.windowTitle);

      // 2. Rules fast path. No screenshot.
      const rule = matchDistraction(win.appName, win.windowTitle);
      if (rule) {
        const verdict: ScreenVerdict = { studying: false, moduleId: null, activity: rule.activity, confidence: 1, source: 'rule' };
        return { verdict: remember(verdict, appName, key), tookScreenshot: false, appName, key };
      }

      // 3. Cache: same app + title as the last VLM verdict, within the TTL. No screenshot.
      const t = now();
      if (
        cache &&
        win.windowTitle !== null &&
        cache.appName === appName &&
        cache.windowTitle === win.windowTitle &&
        t - cache.at < cacheTtl()
      ) {
        return { verdict: remember({ ...cache.verdict, source: 'cache' }, appName, key), tookScreenshot: false, appName, key };
      }

      // 4. VLM, one screenshot at a time. The slot is taken before the next await.
      if (inFlight) {
        const running = inFlight;
        running.seen.add(key);
        const shared = await running.result;
        const fellBehind = running.seen.size >= BEHIND_WINDOWS;
        if (running.key === key) {
          return {
            ...shared,
            verdict: shared.verdict && { ...shared.verdict, source: 'cache' },
            tookScreenshot: false,
            fellBehind: shared.fellBehind || fellBehind,
          };
        }
        // Drop every window that arrived during the call. One follow-up reads the frontmost window now.
        if (!running.followUp) {
          running.followUp = classifier.classifyCurrent(modules, ctx).then((next) =>
            fellBehind ? { ...next, fellBehind: true, gen: running.gen } : next,
          );
          return running.followUp;
        }
        const sharedFollow = await running.followUp;
        return {
          ...sharedFollow,
          verdict: sharedFollow.verdict && { ...sharedFollow.verdict, source: 'cache' },
          tookScreenshot: false,
        };
      }
      const gen = nextGen++;
      let resolveFlight: (r: ClassifyResult) => void = () => {};
      const result = new Promise<ClassifyResult>((resolve) => {
        resolveFlight = resolve;
      });
      const flight: Flight = { key, gen, seen: new Set([key]), result };
      inFlight = flight;
      try {
        const done = await runVlm(modules, ctx, appName, key);
        const out: ClassifyResult = { ...done, gen, fellBehind: flight.seen.size >= BEHIND_WINDOWS };
        resolveFlight(out);
        return out;
      } catch {
        const out: ClassifyResult = {
          verdict: null,
          tookScreenshot: false,
          appName,
          key,
          gen,
          fellBehind: flight.seen.size >= BEHIND_WINDOWS,
          error: 'vlm',
        };
        resolveFlight(out);
        return out;
      } finally {
        if (inFlight === flight) inFlight = null;
      }
    },
  };
  return classifier;
}
