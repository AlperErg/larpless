/**
 * Screen classifier: PLAN.md §6 steps 2–5 (isSelf → rules → cache → single-flight VLM). The screen is read by
 * one of two models, picked by the classifier mode on every call: Ollama's vision LLM ('vlm'), or in the
 * 'classifier' mode (`screenModelOnly`) the on-device screen model (core/screenModel.ts, Windows) alone, whose
 * verdict is final; Ollama is then never asked.
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
import { matchDistraction, matchStudyTool } from './rules';
import { isFinalAlone } from './screenModel';
import type { ScreenModelStep } from './screenModel';
import {
  isChatSite,
  isStoreWindow,
  isVirtualMachineApp,
  normalizeActivityCategory,
  vmShowsDistraction,
} from './sites';

/** Cached "Not study" verdicts expire sooner so a wrong label does not stick. */
export const DISTRACTED_CACHE_MAX_MS = 60_000;

export interface ClassifierConfig {
  USE_MOCK_CLASSIFIER: boolean;
  CACHE_TTL_MS: number;
  CAPTURE: CaptureOptions;
  /**
   * After the rules and the cache, ask the model about the window title with no screenshot.
   * A confident "studying" answer is used; anything else still goes to the vision model, since a
   * title can't show what's on the page. Off by default; meant for CPU-only Ollama.
   */
  TITLE_CHECK?: boolean;
}

/** Use a title-only verdict at or above this. Below it, take a screenshot. */
export const TITLE_CHECK_MIN_CONFIDENCE = 0.6;

export interface ClassifierDeps {
  native: Pick<NativeApis, 'screen'>;
  ollama: Pick<OllamaClient, 'classify' | 'warmUp' | 'unload'> & Partial<Pick<OllamaClient, 'classifyTitle'>>;
  now: () => number;
  config: ClassifierConfig;
  /** Capture size, cache TTL, timeout and keep_alive. Falls back to `config` when omitted. */
  getPower?: () => PowerSpec;
  /** On-device screen model (Windows), used only in the 'classifier' mode. */
  screenModel?: ScreenModelStep;
  /**
   * True for the 'classifier' mode: the screen model reads the screen instead of Ollama and its verdict is final
   * (study at any confidence, "not study" from EMBED_NOT_STUDY_CONFIDENCE). False: Ollama alone, the screen model
   * is never run. Read on every call.
   */
  screenModelOnly?: () => boolean;
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
  /** One id per vision call. Same-window sharers copy it; a follow-up shot gets its own. */
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
  /** TTL captured when the verdict was written, so a later step-down cannot extend it. */
  ttlMs: number;
}

const lc = (s: string) => s.toLowerCase();

/**
 * A "Not study" verdict is kept only when the model is at least this sure.
 * Below it, the label is a guess at a subject. The prompt asks for 0.9 or more on a clear feed.
 */
export const SURE_NOT_STUDY = 0.8;

/** Coursework the model keeps misreading as a distraction reason. */
const WORK_ACTIVITY = /\b(simulat\w*|lab|homework|assignment|coursework|problem set|waveform)\b/i;
const CHAT_WORK = /\b(group project|project|assignment|homework|coursework|lecture|exam|lab|diagram)\b/i;

function bogusShoppingCategory(activity: string, appName: string | null, windowTitle: string | null): boolean {
  return normalizeActivityCategory(activity) === 'Shopping' && !isStoreWindow(appName, windowTitle);
}

function genericChatCategory(activity: string): boolean {
  return normalizeActivityCategory(activity) === 'Chatting';
}

/**
 * Not study is a confident distraction, or it isn't. An unsure answer, or one whose reason is
 * "simulation" / a lab, or a virtual machine with no game or feed in it, becomes the closest
 * subject instead of distracted.
 */
export function guessStudy(
  verdict: ScreenVerdict,
  modules: readonly StudyModule[],
  appName: string | null,
  windowTitle: string | null,
): ScreenVerdict {
  if (verdict.studying || verdict.source === 'rule' || modules.length === 0) return verdict;
  const blob = `${verdict.activity} ${appName ?? ''} ${windowTitle ?? ''}`;
  const chat = isChatSite(appName, windowTitle);
  const chatWork = chat && CHAT_WORK.test(`${verdict.activity} ${windowTitle ?? ''}`);
  const bogusShop = bogusShoppingCategory(verdict.activity, appName, windowTitle);
  const vm = isVirtualMachineApp(appName, windowTitle) && !vmShowsDistraction(verdict.activity);
  const unreadChat = chat && genericChatCategory(verdict.activity);
  const work = WORK_ACTIVITY.test(blob) || chatWork || vm;
  if (!work && !bogusShop && !unreadChat && verdict.confidence >= SURE_NOT_STUDY) return verdict;

  const hay = lc(blob);
  // Longest keyword wins, so "info management" beats "management".
  let mentioned: (typeof modules)[number] | undefined;
  let mentionedLen = 0;
  for (const m of modules) {
    for (const k of [m.name, ...m.keywords]) {
      const kw = lc(k.trim());
      if (kw.length >= 4 && kw.length > mentionedLen && hay.includes(kw)) {
        mentioned = m;
        mentionedLen = kw.length;
      }
    }
  }
  const named = (name: string) => modules.find((m) => lc(m.name) === lc(name));
  const sim = /\bsimulat/i.test(blob);
  const guessed =
    mentioned ??
    (sim ? named('Computer Architecture') ?? named('Digital Logic') ?? named('Coding') : undefined) ??
    (vm ? named('Operating Systems') ?? named('Cybersecurity') : undefined) ??
    named('Coding') ??
    modules[0];
  return {
    studying: true,
    moduleId: guessed.id,
    // A VM reason is about the box ("Using a virtual machine"), not the work; drop it like a chat label.
    activity: bogusShop || vm || genericChatCategory(verdict.activity) ? '' : verdict.activity,
    confidence: Math.min(verdict.confidence, 0.55),
    source: verdict.source,
  };
}

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

export function createClassifier({ native, ollama, now, config, getPower, screenModel, screenModelOnly }: ClassifierDeps): Classifier {
  const embedOnly = () => screenModelOnly?.() ?? false;
  let previous: ScreenVerdict | null = null;
  let previousApp: string | null = null;
  let previousKey: string | null = null;
  let cache: CacheEntry | null = null;
  /** Frontmost window on the last decide(); used to drop cache when the user switches away. */
  let lastDecideKey: string | null = null;
  let inFlight: Flight | null = null;
  let nextGen = 1;
  /** Bumped on reset so a call that started earlier cannot arm a hold for the next session. */
  let epoch = 0;
  /** After a client-side timeout, don't send another request until this time. Ollama may still be finishing the aborted one. */
  let holdUntil = 0;

  const power = () => getPower?.();
  const cacheTtl = () => power()?.cacheTtlMs ?? config.CACHE_TTL_MS;
  const ceilingMs = () => power()?.classifyTimeoutMs ?? 30_000;

  /** Bound a capture so a stuck screenshot can't hold the single-flight slot forever. */
  function captureWithin(ms: number, opts: ClassifierConfig['CAPTURE']): Promise<ScreenSnapshot> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('capture timeout'), { code: 'E_CAPTURE' })), ms);
    });
    return Promise.race([native.screen.capture(opts), deadline]).finally(() => {
      if (timer !== null) clearTimeout(timer);
    });
  }

  const remember = (v: ScreenVerdict | null, app: string | null, key: string) => {
    if (v) {
      previous = v;
      previousApp = app;
      previousKey = key;
    }
    return v;
  };

  /**
   * The 'classifier' mode: the on-device screen model (FLScreenModel) reads the screen and its verdict is final
   * (isFinalAlone). An unsure "not study" call, or none at all (not installed, error, timeout), is `unknown`;
   * Ollama is never asked. Unsure isn't an error (nothing failed), and a frame that was read still counts as
   * analysed (privacy.framesAnalysed).
   */
  async function runScreenModel(modules: StudyModule[], appName: string | null, key: string, maxWidth: number): Promise<ClassifyResult> {
    const started = now();
    const failed = (): ClassifyResult => ({ verdict: null, tookScreenshot: false, appName, key, tookMs: Math.max(0, now() - started), error: 'vlm' });
    if (!screenModel || !(await screenModel.ready())) return failed();
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('screen model timeout')), Math.max(0, ceilingMs() - (now() - started)));
      });
      const r = await Promise.race([screenModel.classify(modules, { maxWidth }), deadline]);
      const snapApp = r.window.appName ?? appName;
      const snapKey = windowKey(snapApp, r.window.windowTitle);
      const verdict = r.verdict && isFinalAlone(r.verdict) ? r.verdict : null;
      if (verdict && r.window.windowTitle !== null) {
        cache = { appName: snapApp, windowTitle: r.window.windowTitle, verdict, at: now(), ttlMs: cacheTtl() };
      }
      return { verdict: remember(verdict, snapApp, snapKey), tookScreenshot: true, appName: snapApp, key: snapKey, tookMs: Math.max(0, now() - started) };
    } catch {
      return failed();
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function runVlm(modules: StudyModule[], ctx: ClassifyContext, appName: string | null, key: string): Promise<ClassifyResult> {
    const spec = power();
    const capture = spec?.capture ?? config.CAPTURE;
    if (!(ctx.mockClassifier ?? config.USE_MOCK_CLASSIFIER) && embedOnly()) {
      return runScreenModel(modules, appName, key, capture.maxWidth);
    }
    const started = now();
    const budget = ceilingMs();
    let snap: ScreenSnapshot | null = null;
    try {
      try {
        snap = await captureWithin(Math.max(1, budget - (now() - started)), capture);
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
      const left = budget - Math.max(0, now() - started);
      if (!useMock && left <= 0) {
        return {
          verdict: null,
          tookScreenshot: true,
          appName: snapApp,
          key: snapKey,
          tookMs: Math.max(0, now() - started),
          error: 'capture',
        };
      }
      const raw = useMock
        ? mockVerdictFromTitle(snapApp, snapTitle, modules)
        : spec
          ? await ollama.classify(snap, modules, { timeoutMs: left, keepAlive: spec.keepAlive })
          : await ollama.classify(snap, modules, { timeoutMs: left });
      const verdict = raw ? guessStudy(raw, modules, snapApp, snapTitle) : raw;
      if (verdict && snapTitle !== null) {
        cache = { appName: snapApp, windowTitle: snapTitle, verdict, at: now(), ttlMs: cacheTtl() };
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

  type Decision =
    | { kind: 'fast'; result: ClassifyResult }
    | { kind: 'vlm'; appName: string | null; key: string };

  /** Rules, cache, the title check and "this app" never take a screenshot, so they don't need the flight. */
  async function decide(modules: StudyModule[], ctx: ClassifyContext): Promise<Decision> {
    const win = await native.screen.getActiveWindow();
    const appName = win.appName ?? null;
    // A subject turned off mid-session must not come back from the previous verdict or the cache.
    const allowed = (v: ScreenVerdict) => v.moduleId === null || modules.some((m) => m.id === v.moduleId);
    if (win.isSelf) {
      if (!previous || !allowed(previous)) return { kind: 'fast', result: { verdict: null, tookScreenshot: false, appName: null, key: null } };
      const source = previous.source === 'rule' ? 'rule' : 'cache';
      return {
        kind: 'fast',
        result: { verdict: { ...previous, source }, tookScreenshot: false, appName: previousApp, key: previousKey },
      };
    }
    const key = windowKey(appName, win.windowTitle);
    if (cache && lastDecideKey !== null && lastDecideKey !== key) {
      const cachedKey = windowKey(cache.appName, cache.windowTitle);
      if (lastDecideKey === cachedKey) cache = null;
    }
    lastDecideKey = key;

    const rule = matchDistraction(win.appName, win.windowTitle);
    if (rule) {
      const verdict: ScreenVerdict = { studying: false, moduleId: null, activity: rule.activity, confidence: 1, source: 'rule' };
      return { kind: 'fast', result: { verdict: remember(verdict, appName, key), tookScreenshot: false, appName, key } };
    }
    // Before the cache: a Vivado window the model already called "simulation" must not stay distracted.
    const study = matchStudyTool(win.appName, win.windowTitle, modules);
    if (study) {
      const verdict: ScreenVerdict = {
        studying: true,
        moduleId: study.moduleId,
        activity: study.activity,
        confidence: 1,
        source: 'rule',
      };
      return { kind: 'fast', result: { verdict: remember(verdict, appName, key), tookScreenshot: false, appName, key } };
    }
    const t = now();
    const entryTtl = (v: ScreenVerdict) =>
      !v.studying ? Math.min(cache!.ttlMs, DISTRACTED_CACHE_MAX_MS) : cache!.ttlMs;
    if (
      cache &&
      allowed(cache.verdict) &&
      win.windowTitle !== null &&
      cache.appName === appName &&
      cache.windowTitle === win.windowTitle &&
      t - cache.at < entryTtl(cache.verdict)
    ) {
      return {
        kind: 'fast',
        result: { verdict: remember({ ...cache.verdict, source: 'cache' }, appName, key), tookScreenshot: false, appName, key },
      };
    }
    const useMock = ctx.mockClassifier ?? config.USE_MOCK_CLASSIFIER;
    if (config.TITLE_CHECK && !embedOnly() && !useMock && ollama.classifyTitle && win.windowTitle) {
      const titleVerdict = await ollama.classifyTitle(appName, win.windowTitle, modules, {
        timeoutMs: Math.min(8_000, ceilingMs()),
        keepAlive: power()?.keepAlive,
      });
      if (titleVerdict && titleVerdict.studying && titleVerdict.confidence >= TITLE_CHECK_MIN_CONFIDENCE) {
        const verdict: ScreenVerdict = { ...titleVerdict, source: 'title' };
        cache = { appName, windowTitle: win.windowTitle, verdict, at: now(), ttlMs: cacheTtl() };
        return {
          kind: 'fast',
          result: { verdict: remember(verdict, appName, key), tookScreenshot: false, appName, key },
        };
      }
    }
    return { kind: 'vlm', appName, key };
  }

  async function joinFlight(running: Flight, modules: StudyModule[], ctx: ClassifyContext): Promise<ClassifyResult> {
    const decided = await decide(modules, ctx);
    if (decided.kind === 'fast') return decided.result;
    running.seen.add(decided.key);
    const shared = await running.result;
    const fellBehind = running.seen.size >= BEHIND_WINDOWS;
    if (running.key === decided.key) {
      return {
        ...shared,
        verdict: shared.verdict && { ...shared.verdict, source: 'cache' },
        tookScreenshot: false,
        fellBehind: shared.fellBehind || fellBehind,
      };
    }
    // One follow-up, claimed synchronously inside classifyCurrent before its first await.
    if (!running.followUp) {
      running.followUp = classifier.classifyCurrent(modules, ctx);
      return running.followUp;
    }
    const sharedFollow = await running.followUp;
    return {
      ...sharedFollow,
      verdict: sharedFollow.verdict && { ...sharedFollow.verdict, source: 'cache' },
      tookScreenshot: false,
    };
  }

  const classifier: Classifier = {
    reset() {
      previous = null;
      previousApp = null;
      previousKey = null;
      cache = null;
      lastDecideKey = null;
      holdUntil = 0;
      epoch += 1;
    },

    async warmUp(modules) {
      if (config.USE_MOCK_CLASSIFIER || embedOnly()) return;
      const keepAlive = power()?.keepAlive;
      if (keepAlive) await ollama.warmUp(modules, { keepAlive });
      else await ollama.warmUp(modules);
    },

    async unload() {
      if (config.USE_MOCK_CLASSIFIER) return;
      // Both, whatever the mode: it may have changed since this session loaded one of them.
      await Promise.all([ollama.unload(), screenModel?.unload()]);
    },

    async classifyCurrent(modules, ctx = {}) {
      // Claim the slot before any await so a slow getActiveWindow can't miss an in-flight call.
      if (inFlight) return joinFlight(inFlight, modules, ctx);
      const gen = nextGen++;
      const flightEpoch = epoch;
      let resolveFlight: (r: ClassifyResult) => void = () => {};
      const result = new Promise<ClassifyResult>((resolve) => {
        resolveFlight = resolve;
      });
      const flight: Flight = { key: '', gen, seen: new Set(), result };
      inFlight = flight;
      const finish = (out: ClassifyResult) => {
        resolveFlight(out);
        return out;
      };
      try {
        const decided = await decide(modules, ctx);
        if (decided.kind === 'fast') {
          flight.key = decided.result.key ?? '';
          if (flight.key) flight.seen.add(flight.key);
          return finish(decided.result);
        }
        flight.key = decided.key;
        flight.seen.add(decided.key);
        if (now() < holdUntil) {
          return finish({ verdict: null, tookScreenshot: false, appName: decided.appName, key: decided.key, error: 'vlm', gen });
        }
        const done = await runVlm(modules, ctx, decided.appName, decided.key);
        const usedUp = (done.tookMs ?? 0) >= ceilingMs() - 250;
        if (flightEpoch === epoch && usedUp && (done.error === 'vlm' || done.error === 'capture')) {
          holdUntil = now() + (power()?.chunkS ?? 15) * 1000;
        }
        return finish({ ...done, gen, fellBehind: flight.seen.size >= BEHIND_WINDOWS });
      } catch {
        return finish({
          verdict: null,
          tookScreenshot: false,
          appName: null,
          key: flight.key || null,
          gen,
          fellBehind: flight.seen.size >= BEHIND_WINDOWS,
          error: 'vlm',
        });
      } finally {
        if (inFlight === flight) inFlight = null;
      }
    },
  };
  return classifier;
}
