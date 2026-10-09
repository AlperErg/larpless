/**
 * Screen classifier: PLAN.md §6 steps 2–5 (isSelf → rules → cache → single-flight VLM).
 *
 * A screenshot is taken ONLY on the VLM path. PRIVACY: the snapshot is dropped in `finally`
 * and never logged.
 */
import type { ScreenVerdict, StudyModule } from '../contracts/domain';
import type { CaptureOptions, NativeApis, ScreenSnapshot } from '../contracts/native';
import type { OllamaClient } from './ollama';
import { MAX_ACTIVITY_CHARS } from './prompt';
import { matchDistraction } from './rules';

export interface ClassifierConfig {
  USE_MOCK_CLASSIFIER: boolean;
  CACHE_TTL_MS: number;
  CAPTURE: CaptureOptions;
}

export interface ClassifierDeps {
  native: Pick<NativeApis, 'screen'>;
  ollama: Pick<OllamaClient, 'classify'>;
  now: () => number;
  config: ClassifierConfig;
}

/** Why there's no verdict (the chunk becomes `unknown`). */
export type ClassifyError = 'permission' | 'capture' | 'busy' | 'vlm';

export interface ClassifyResult {
  verdict: ScreenVerdict | null;
  tookScreenshot: boolean;
  appName: string | null;
  error?: ClassifyError;
}

export interface ClassifyContext {
  /** Override config.USE_MOCK_CLASSIFIER (tests, dev tools). */
  mockClassifier?: boolean;
}

export interface Classifier {
  classifyCurrent(modules: StudyModule[], ctx?: ClassifyContext): Promise<ClassifyResult>;
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

export function createClassifier({ native, ollama, now, config }: ClassifierDeps): Classifier {
  let previous: ScreenVerdict | null = null;
  let previousApp: string | null = null;
  let cache: CacheEntry | null = null;
  let inFlight = false;

  const remember = (v: ScreenVerdict | null, app: string | null) => {
    if (v) {
      previous = v;
      previousApp = app;
    }
    return v;
  };

  return {
    reset() {
      previous = null;
      previousApp = null;
      cache = null;
    },

    async classifyCurrent(modules, ctx = {}) {
      const win = await native.screen.getActiveWindow();
      const appName = win.appName ?? null;

      // 1. Focusline itself is frontmost → reuse the previous screen verdict. No screenshot.
      if (win.isSelf) {
        if (!previous) return { verdict: null, tookScreenshot: false, appName: null };
        const source = previous.source === 'rule' ? 'rule' : 'cache';
        return { verdict: { ...previous, source }, tookScreenshot: false, appName: previousApp };
      }

      // 2. Rules fast path. No screenshot.
      const rule = matchDistraction(win.appName, win.windowTitle);
      if (rule) {
        const verdict: ScreenVerdict = { studying: false, moduleId: null, activity: rule.activity, confidence: 1, source: 'rule' };
        return { verdict: remember(verdict, appName), tookScreenshot: false, appName };
      }

      // 3. Cache: same app + title as the last VLM verdict, within the TTL. No screenshot.
      const t = now();
      if (
        cache &&
        win.windowTitle !== null &&
        cache.appName === appName &&
        cache.windowTitle === win.windowTitle &&
        t - cache.at < config.CACHE_TTL_MS
      ) {
        return { verdict: remember({ ...cache.verdict, source: 'cache' }, appName), tookScreenshot: false, appName };
      }

      // 4. VLM, single flight.
      if (inFlight) return { verdict: null, tookScreenshot: false, appName, error: 'busy' };
      inFlight = true;
      let snap: ScreenSnapshot | null = null;
      try {
        try {
          snap = await native.screen.capture(config.CAPTURE);
        } catch (e) {
          return {
            verdict: null,
            tookScreenshot: false,
            appName,
            error: errorCode(e) === 'E_PERMISSION' ? 'permission' : 'capture',
          };
        }
        const useMock = ctx.mockClassifier ?? config.USE_MOCK_CLASSIFIER;
        const snapApp = snap.appName ?? appName;
        const snapTitle = snap.windowTitle;
        const verdict = useMock
          ? mockVerdictFromTitle(snapApp, snapTitle, modules)
          : await ollama.classify(snap, modules);
        if (verdict && snapTitle !== null) {
          cache = { appName: snapApp, windowTitle: snapTitle, verdict, at: now() };
        }
        return { verdict: remember(verdict, snapApp), tookScreenshot: true, appName: snapApp, ...(verdict ? {} : { error: 'vlm' as const }) };
      } finally {
        snap = null;
        inFlight = false;
      }
    },
  };
}
