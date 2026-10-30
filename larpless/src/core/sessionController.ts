/**
 * Session runtime loop (PLAN.md §6). Wires the native facades, classifier, fuser, alerts, pomodoro
 * and db to the session store. Pure TS: everything is injected, time comes from `now()`.
 *
 * Chunk windows: a window starts at `windowStart` and closes one power-profile chunk later; the next
 * one starts exactly there (no drift). A mid-session step-down lengthens the open window. Pauses and
 * breaks shift it by their length, so no partial chunk (and no screenshot) is taken when they start.
 * `end()` finalises a partial chunk ≥ 10 s.
 *
 * Live state: between chunk closes the panel follows what's happening now. Every tick reads the
 * frontmost window (no screenshot); once a new window has been frontmost for the profile's settle
 * time it is classified straight away, and webcam samples drive away/phone (liveWebcam). The chunk
 * closing later reuses that verdict from the classifier cache. Stored chunks and alerts keep their
 * chunk rules. A vision call slower than the chunk, or one that three windows arrived during, steps
 * the session down one profile until it ends.
 *
 * PRIVACY: snapshots never pass through here (the classifier drops them); nothing image-like is logged.
 */
import type { Chunk, PomodoroPreset, SessionSummary, Settings, SoundId, StudyModule } from '../contracts/domain';
import type { NativeApis, PanelAction, PanelState, PermissionKind, Unsubscribe, WebcamSample } from '../contracts/native';
import type { CurrentCheck, SessionStoreActions, SessionStoreState, StartOptions } from '../contracts/store';
import { evaluate, INITIAL_ALERT } from './alerts';
import type { AlertEffect, AlertState } from './alerts';
import { AWAY_ACTIVITY, awayStats, fuseChunk, labelFromVerdict, LIVE_SAMPLES, liveWebcam, PHONE_ACTIVITY } from './chunkFuser';
import { windowKey } from './classifier';
import type { Classifier, ClassifyResult } from './classifier';
import type { Db } from './db';
import { computeSummary } from './focus';
import { newId } from './ids';
import type { OllamaClient } from './ollama';
import { freeze, initPomodoro, isBreak, phaseDurationMs, skip, thaw, tick as pomoTick, toggle } from './pomodoro';
import { effectiveProfile, resetSessionProfile, stepSessionProfile } from './powerProfile';
import type { PomodoroEvent } from './pomodoro';
import { startDemo } from './demoMode';
import type { DemoHandle } from './demoMode';

export const TICK_MS = 1000;
/**
 * A gap between ticks longer than this means the computer slept (timers don't fire while it does). The
 * session is then treated as paused from the last tick, so sleep never counts as study time and the
 * chunk windows that came due during it are not closed with whatever is frontmost on wake.
 */
export const SLEEP_GAP_MS = 30_000;
/** Webcam samples kept for the open chunk window (ring buffer). */
export const SAMPLE_BUFFER = 120;
/** end(): the open window is turned into a chunk only if it's at least this long. */
export const MIN_PARTIAL_CHUNK_S = 10;
/** Pomodoro breaks duck the ambient sound to this factor. */
export const BREAK_DUCK = 0.3;

type LiveLabel = Pick<CurrentCheck, 'kind' | 'moduleId' | 'activity' | 'appName'>;

const screenLabel = (r: ClassifyResult): LiveLabel => {
  const { kind, moduleId, activity } = labelFromVerdict(r.verdict);
  return { kind, moduleId, activity, appName: r.appName };
};

export interface StoreApi {
  getState(): SessionStoreState;
  setState(patch: Partial<SessionStoreState>): void;
}

export interface ControllerConfig {
  WEBCAM_FPS: number;
}

export interface SessionControllerDeps {
  native: NativeApis;
  db: Db;
  store: StoreApi;
  /** Every subject, for names (panel, alerts, summaries), including ones turned off. */
  getModules(): StudyModule[];
  /** The subjects the classifier may pick. Defaults to getModules(). */
  getDetectModules?(): StudyModule[];
  getSettings(): Settings;
  classifier: Pick<Classifier, 'classifyCurrent' | 'reset' | 'warmUp' | 'unload'>;
  ollama: Pick<OllamaClient, 'checkHealth'>;
  /** Runs before the warm-up of a real session: starts Ollama, or restarts it without its prompt cache. */
  prepareOllama?(): Promise<unknown>;
  now(): number;
  config: ControllerConfig;
  /** Called after a summary is saved (end, relabel) so the app store can refresh its session list. */
  onSessionSaved?(summary: SessionSummary): void;
  /** Demo replay source (fixtureChunks in the app). */
  demoChunks?: readonly Chunk[];
  /** Demo replay speed: one chunk per this many ms (default 2000). */
  demoIntervalMs?: number;
  log?(line: string): void;
}

export interface SessionController extends SessionStoreActions {
  handlePanelAction(a: PanelAction): void;
  setPomodoroPreset(preset: PomodoroPreset): void;
  /** Clear every timer and subscription (tests, hot reload). */
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Panel state (pure)                                                  */
/* ------------------------------------------------------------------ */

export function toPanelState(
  s: Pick<SessionStoreState, 'status' | 'timer' | 'current' | 'pomodoro' | 'sound' | 'alert'> & { pausedForSleep?: boolean },
  modules: readonly Pick<StudyModule, 'id' | 'name'>[],
  flash: PanelState['flash'] = null,
): PanelState {
  const pomodoro = s.pomodoro?.enabled
    ? {
        phase: s.pomodoro.phase,
        round: s.pomodoro.round,
        rounds: s.pomodoro.roundsBeforeLong,
        phaseEndsAtMs: s.pomodoro.phaseEndsAtMs,
        pausedRemainingMs: s.status === 'paused' ? s.pomodoro.pausedRemainingMs ?? null : null,
      }
    : null;
  const base = { timer: { ...s.timer }, pomodoro, sound: { ...s.sound }, pulse: false, flash };

  switch (s.status) {
    case 'idle':
    case 'ended':
      return { ...base, status: 'idle', title: 'LarpLess', subtitle: null, tint: 'gray', flash: null };
    case 'paused':
      return { ...base, status: 'paused', title: 'Paused', subtitle: s.pausedForSleep ? 'During sleep' : null, tint: 'gray' };
    case 'break':
      return {
        ...base,
        status: 'break',
        title: s.pomodoro?.phase === 'longBreak' ? 'Long break' : 'Break',
        subtitle: pomodoro ? `Round ${pomodoro.round} of ${pomodoro.rounds}` : null,
        tint: 'blue',
      };
    case 'running': {
      const c = s.current;
      const sub = (x: string | undefined | null) => (x && x.trim() ? x : null);
      if (c?.kind === 'subject') {
        const name = modules.find((m) => m.id === c.moduleId)?.name ?? 'Studying';
        return { ...base, status: 'studying', title: name, subtitle: sub(c.activity), tint: 'green' };
      }
      if (c?.kind === 'distracted') {
        // A short reason ("Checking email"), or the app name when the model didn't give one.
        return { ...base, status: 'distracted', title: 'Distracted', subtitle: sub(c.activity) ?? sub(c.appName), tint: 'red', pulse: s.alert.level === 3 };
      }
      if (c?.kind === 'away') return { ...base, status: 'away', title: 'Away', subtitle: null, tint: 'gray' };
      if (c?.kind === 'unknown') return { ...base, status: 'studying', title: 'Focus', subtitle: 'Checking…', tint: 'gray' };
      return { ...base, status: 'studying', title: 'Focus', subtitle: 'Starting…', tint: 'green' };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Controller                                                          */
/* ------------------------------------------------------------------ */

const noop = () => {};

export function createSessionController(deps: SessionControllerDeps): SessionController {
  const { native, db, store, now, config } = deps;
  const log = deps.log ?? ((line: string) => console.log(line));
  const get = () => store.getState();
  const set = (p: Partial<SessionStoreState>) => store.setState(p);
  const detectModules = () => (deps.getDetectModules ?? deps.getModules)();

  let sessionId: string | null = null;
  let sessionStartedAt = 0;
  let demo = false;
  let ending: Promise<SessionSummary | null> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let demoHandle: DemoHandle | null = null;
  let unsubSample: Unsubscribe | null = null;
  let unsubAction: Unsubscribe | null = null;
  let unsubSleep: Unsubscribe | null = null;
  let lastTickAt = 0;
  let webcamRunning = false;
  let windowSamples: WebcamSample[] = [];
  let windowStart = 0;
  let chunkIndex = 0;
  /** Vision-call id we already stepped down for, so the owner and a waiter don't both step. */
  let steppedGen = 0;
  let suspendedAt: number | null = null; // pause or break start
  let alertState: AlertState = INITIAL_ALERT;
  let permissionNotified = false;
  let flash: PanelState['flash'] = null;
  let lastPanel: string | null = null;
  const pending = new Set<Promise<void>>();
  // Live state (not used in demo). Window keys hold titles: memory only, never stored or logged.
  let recentSamples: WebcamSample[] = [];
  let camLive: 'away' | 'phone' | null = null;
  let screenNow: LiveLabel | null = null; // latest screen label, from a live check or a chunk close
  let seenKey: string | null = null; // frontmost window at the last tick
  let seenSince = 0;
  let checkedKey: string | null = null; // window the last live check was started for
  let probing = false;

  const isActive = () => sessionId !== null && ['running', 'paused', 'break'].includes(get().status);
  const chunkSeconds = () => effectiveProfile(deps.getSettings().powerProfile).chunkS;
  const settleMs = () => effectiveProfile(deps.getSettings().powerProfile).liveSettleMs;

  function considerStepDown(sid: string, r: ClassifyResult) {
    // Only the session that started the call may step. A dispose, a new start, or an end
    // that has already begun must not pick up a result from an older call.
    if (ending || sid !== sessionId) return;
    // A result inherited from a call that began before this session must not step it.
    if (r.tookMs != null && now() - r.tookMs < sessionStartedAt) return;
    if (r.gen == null || r.gen === steppedGen) return;
    const spec = effectiveProfile(deps.getSettings().powerProfile);
    const slow = (r.tookMs ?? 0) > spec.chunkS * 1000;
    if (!slow && !r.fellBehind) return;
    steppedGen = r.gen;
    const next = stepSessionProfile(spec.id);
    if (next !== spec.id) log(`[session] power profile ${spec.id} → ${next}`);
  }

  /* ---------- timer ---------- */

  const elapsedS = (t: number) => {
    const { baseS, runningSinceMs } = get().timer;
    return baseS + (runningSinceMs !== null ? Math.max(0, t - runningSinceMs) / 1000 : 0);
  };
  const freezeTimer = (t: number) => set({ timer: { baseS: elapsedS(t), runningSinceMs: null } });
  const runTimer = (t: number) => set({ timer: { baseS: get().timer.baseS, runningSinceMs: t } });

  /* ---------- panel ---------- */

  function pushPanel(force = false) {
    if (!sessionId) return;
    const ps = toPanelState(get(), deps.getModules(), flash);
    const key = JSON.stringify(ps);
    if (!force && key === lastPanel) return;
    lastPanel = key;
    native.panel.update(ps);
    native.panel.ensureVisible().catch(noop);
  }

  /* ---------- webcam ---------- */

  function onSample(s: WebcamSample) {
    if (!webcamRunning) return;
    windowSamples.push(s);
    if (windowSamples.length > SAMPLE_BUFFER) windowSamples.splice(0, windowSamples.length - SAMPLE_BUFFER);
    const w = get().webcam;
    if (w.personPresent !== s.personPresent || w.phoneVisible !== s.phoneVisible) {
      set({ webcam: { ...w, personPresent: s.personPresent, phoneVisible: s.phoneVisible } });
    }
    recentSamples.push(s);
    if (recentSamples.length > LIVE_SAMPLES) recentSamples.shift();
    const cam = liveWebcam(recentSamples);
    if (cam !== camLive) {
      camLive = cam;
      showLive();
    }
  }

  function notifyScreenPermission() {
    if (permissionNotified) return;
    permissionNotified = true;
    native.notifications
      .post({
        id: 'fl-screen-permission',
        title: 'Screen Recording permission needed',
        body: 'Allow LarpLess in System Settings → Privacy & Security → Screen Recording, then relaunch.',
        sound: false,
      })
      .catch(noop);
  }

  /**
   * Screen Recording and camera status are two instant system lookups. They run beside start,
   * never before it, so the timer and panel don't wait; a missing one shows up a moment later.
   */
  function checkPermissions(sid: string, wantCamera: boolean) {
    native.permissions
      .status()
      .then((p) => {
        if (sid !== sessionId) return;
        const missing: PermissionKind[] = [];
        if (p.screen !== 'granted') missing.push('screen');
        if (wantCamera && p.camera !== 'granted') missing.push('camera');
        if (!missing.length) return;
        set({ missingPermissions: missing });
        if (missing.includes('screen')) notifyScreenPermission();
        else {
          native.notifications
            .post({
              id: 'fl-camera-permission',
              title: 'Camera permission needed',
              body: 'This session runs without the webcam. Allow LarpLess in System Settings → Privacy & Security → Camera.',
              sound: false,
            })
            .catch(noop);
        }
      })
      .catch(noop);
  }

  async function startWebcam(): Promise<void> {
    if (demo || webcamRunning || !get().webcam.enabled) return;
    if (!unsubSample) unsubSample = native.webcam.onSample(onSample);
    webcamRunning = true;
    try {
      await native.webcam.start({ fps: config.WEBCAM_FPS });
    } catch (e) {
      webcamRunning = false;
      log(`[session] webcam unavailable (${(e as { code?: string })?.code ?? 'error'}), continuing without it`);
      set({ webcam: { enabled: false, personPresent: true, phoneVisible: false } });
      pushPanel();
    }
  }

  function stopWebcam() {
    recentSamples = [];
    camLive = null;
    if (!webcamRunning) return;
    webcamRunning = false;
    native.webcam.stop().catch(noop);
  }

  /* ---------- live state ---------- */

  /** What the panel should show now: webcam away/phone first, else the latest screen label. */
  function liveLabel(): LiveLabel | null {
    if (camLive === 'away') return { kind: 'away', moduleId: null, activity: AWAY_ACTIVITY, appName: null };
    if (camLive === 'phone') return { kind: 'distracted', moduleId: null, activity: PHONE_ACTIVITY, appName: screenNow?.appName ?? null };
    return screenNow;
  }

  function showLive() {
    if (demo || !sessionId || get().status !== 'running') return;
    const next = liveLabel();
    if (!next) return;
    const cur = get().current;
    if (cur && cur.kind === next.kind && cur.moduleId === next.moduleId && cur.activity === next.activity && cur.appName === next.appName) {
      return;
    }
    set({ current: { ...next, at: now() } });
    pushPanel();
  }

  /** Forget which window was seen/checked, so the next ticks check the frontmost window again. */
  function resetWindowWatch() {
    seenKey = null;
    checkedKey = null;
  }

  function track(p: Promise<void>, what: string) {
    const q: Promise<void> = p
      .catch((e) => log(`[session] ${what} failed: ${(e as Error)?.message ?? 'error'}`))
      .finally(() => pending.delete(q));
    pending.add(q);
  }

  /** Tick: classify the frontmost window once it has settled. No screenshot unless the VLM is needed. */
  function probeWindow() {
    if (demo || probing || ending || !sessionId || get().status !== 'running' || camLive === 'away') return;
    const sid = sessionId;
    probing = true;
    native.screen
      .getActiveWindow()
      .then((win) => {
        if (ending || sid !== sessionId || win.isSelf) return;
        const t = now();
        const key = windowKey(win.appName ?? null, win.windowTitle);
        if (key !== seenKey) {
          seenKey = key;
          seenSince = t;
          return;
        }
        if (key === checkedKey || t - seenSince < settleMs()) return;
        checkedKey = key;
        track(liveCheck(sid), 'live check');
      })
      .catch(noop)
      .finally(() => {
        probing = false;
      });
  }

  async function liveCheck(sid: string) {
    const r = await deps.classifier.classifyCurrent(detectModules());
    considerStepDown(sid, r);
    if (sid !== sessionId || ending) return;
    if (r.tookScreenshot) {
      const p = get().privacy;
      set({ privacy: { ...p, framesAnalysed: p.framesAnalysed + 1 } });
    }
    // Paused, away, a different window, or no verdict: drop it. Clear checkedKey so the
    // same window can be tried again; a failure waits out a fresh settle instead of every tick.
    const stale = r.key !== null && r.key !== seenKey;
    const failed = !r.verdict;
    if (get().status !== 'running' || camLive === 'away' || stale || failed) {
      if (stale || failed || camLive === 'away') checkedKey = null;
      if (failed && !stale) seenSince = now();
      return;
    }
    screenNow = screenLabel(r);
    showLive();
  }

  /* ---------- chunks ---------- */

  function applyEffects(effects: AlertEffect[], chunk: Chunk, settings: Settings) {
    for (const e of effects) {
      if (e.type === 'notify') {
        native.notifications
          .post({ id: `fl-alert-${chunk.sessionId}-${chunk.index}`, title: e.title, body: e.body, sound: settings.soundsEnabled })
          .catch(noop);
      } else if (e.type === 'chime') {
        native.sound.chime(e.kind);
      } else if (e.type === 'flash') {
        flash = 'backOnTrack';
      }
      // tint and pulse are derived from the store in toPanelState.
    }
  }

  /** Store update, alerts, panel and db for one finished chunk (also used by demo replay). */
  async function applyChunk(chunk: Chunk, tookScreenshot: boolean): Promise<void> {
    if (chunk.sessionId !== sessionId) return;
    const st = get();
    const settings = deps.getSettings();
    const modules = deps.getModules();
    const chunks = [...st.chunks.filter((c) => c.id !== chunk.id), chunk].sort((a, b) => a.index - b.index);
    flash = null;
    if (st.status === 'running' && !ending) {
      const r = evaluate(alertState, chunk, settings, chunk.startedAt + chunk.durationS * 1000, modules);
      alertState = r.next;
      applyEffects(r.effects, chunk, settings);
    }
    const live = demo ? null : liveLabel();
    set({
      chunks,
      current: live
        ? { ...live, at: now() }
        : { kind: chunk.kind, moduleId: chunk.moduleId, activity: chunk.activity, appName: chunk.appName, at: now() },
      privacy: {
        framesAnalysed: st.privacy.framesAnalysed + (tookScreenshot ? 1 : 0),
        checksWithoutScreenshot: st.privacy.checksWithoutScreenshot + (tookScreenshot ? 0 : 1),
        framesStored: 0,
      },
      alert: { level: alertState.level, distractedSinceMs: alertState.distractedSinceMs },
    });
    pushPanel();
    try {
      await db.appendChunk(chunk);
    } catch {
      log('[session] appendChunk failed');
    }
  }

  async function processChunk(sid: string, index: number, start: number, end: number, samples: WebcamSample[]) {
    const durationS = Math.round((end - start) / 1000);
    let verdict = null;
    let appName: string | null = null;
    let tookScreenshot = false;
    let screen: LiveLabel | null = null;
    // 1. Away (webcam) → no screenshot at all.
    if (!awayStats(samples).away) {
      const r = await deps.classifier.classifyCurrent(detectModules());
      considerStepDown(sid, r);
      verdict = r.verdict;
      appName = r.appName;
      tookScreenshot = r.tookScreenshot;
      // Keep a newer live label if the window changed while this check ran.
      if (seenKey === null || r.key === null || r.key === seenKey) screen = screenLabel(r);
      if (r.error === 'permission') notifyScreenPermission();
    }
    if (sid !== sessionId) return;
    if (screen) screenNow = screen;
    const chunk = fuseChunk({ sessionId: sid, index, startedAt: start, durationS, samples, verdict, appName });
    await applyChunk(chunk, tookScreenshot);
  }

  function closeWindow(end: number) {
    const sid = sessionId!;
    const start = windowStart;
    const samples = windowSamples;
    windowSamples = [];
    windowStart = end;
    const index = chunkIndex++;
    const p: Promise<void> = processChunk(sid, index, start, end, samples)
      .catch((e) => log(`[session] chunk ${index} failed: ${(e as Error)?.message ?? 'error'}`))
      .finally(() => pending.delete(p));
    pending.add(p);
  }

  /* ---------- pomodoro / breaks ---------- */

  function enterBreak(t: number) {
    suspendedAt = t;
    freezeTimer(t);
    stopWebcam();
    native.sound.duck(BREAK_DUCK);
    alertState = { ...INITIAL_ALERT, lastSubjectName: alertState.lastSubjectName };
    set({ status: 'break', alert: { level: 0, distractedSinceMs: null } });
  }

  function leaveBreak(t: number) {
    if (suspendedAt !== null) windowStart += t - suspendedAt;
    suspendedAt = null;
    windowSamples = [];
    resetWindowWatch();
    runTimer(t);
    native.sound.duck(1);
    set({ status: 'running' });
    startWebcam();
  }

  function onPhaseChange(next: NonNullable<SessionStoreState['pomodoro']>, event: PomodoroEvent, t: number) {
    set({ pomodoro: next });
    if (!event) return;
    const settings = deps.getSettings();
    const status = get().status;
    const toBreak = isBreak(event.to);
    if (toBreak && status === 'running') enterBreak(t);
    else if (!toBreak && status === 'break') leaveBreak(t);
    if (event.from === event.to) return;
    const mins = Math.round(phaseDurationMs(next.preset, next.phase) / 60_000);
    native.notifications
      .post(
        toBreak
          ? {
              id: `fl-pomo-${sessionId}-${next.completed}-${next.phase}`,
              title: next.phase === 'longBreak' ? 'Long break' : 'Break time',
              body: `${mins} min. LarpLess stops looking until focus resumes.`,
              sound: settings.soundsEnabled,
            }
          : {
              id: `fl-pomo-${sessionId}-${next.completed}-focus-${next.round}`,
              title: 'Back to focus',
              body: `Round ${next.round} of ${next.roundsBeforeLong} · ${mins} min`,
              sound: settings.soundsEnabled,
            },
      )
      .catch(noop);
    if (settings.soundsEnabled) native.sound.chime('phase');
  }

  function fallbackPreset(): PomodoroPreset {
    const s = deps.getSettings();
    return s.pomodoroDefault !== 'off' ? s.pomodoroDefault : '25/5';
  }

  /* ---------- tick ---------- */

  /** Pauses as of `t`. `forSleep` marks a pause the computer's sleep caused, not the user. */
  function pauseAt(t: number, forSleep: boolean) {
    if (!sessionId || get().status !== 'running') return;
    suspendedAt = t;
    freezeTimer(t);
    const p = get().pomodoro;
    if (p?.enabled) set({ pomodoro: freeze(p, t) });
    stopWebcam();
    set({ status: 'paused', pausedForSleep: forSleep });
    pushPanel();
  }

  function onTick() {
    if (!sessionId || ending) return;
    const t = now();
    const since = lastTickAt;
    lastTickAt = t;
    if (!demo && get().status === 'running' && t - since > SLEEP_GAP_MS) {
      log(`[session] no tick for ${Math.round((t - since) / 1000)} s (asleep): paused from the last tick`);
      pauseAt(since, true);
      return;
    }
    // Close due chunk windows first, so a focus phase ending on a boundary keeps its last chunk.
    if (!demo && get().status === 'running') {
      const chunkMs = chunkSeconds() * 1000;
      while (t >= windowStart + chunkMs) closeWindow(windowStart + chunkMs);
      probeWindow();
    }
    const st = get();
    if (st.pomodoro?.enabled && (st.status === 'running' || st.status === 'break')) {
      const r = pomoTick(st.pomodoro, t);
      if (r.event) onPhaseChange(r.state, r.event, t);
    }
    pushPanel();
    // Spotify quitting can drop the layered timer without a study-state change. Put it back on the work area.
    native.panel.ensureVisible().catch(noop);
  }

  function clearTimers() {
    if (tickTimer !== null) clearInterval(tickTimer);
    tickTimer = null;
    demoHandle?.stop();
    demoHandle = null;
  }

  function teardownNative() {
    unsubAction?.();
    unsubAction = null;
    unsubSleep?.();
    unsubSleep = null;
    stopWebcam();
    unsubSample?.();
    unsubSample = null;
  }

  /* ---------- actions ---------- */

  const controller: SessionController = {
    async start(opts: StartOptions) {
      if (isActive() || ending) return;
      const t = now();
      sessionStartedAt = t;
      const settings = deps.getSettings();
      demo = !!opts.demo;
      resetSessionProfile();
      steppedGen = 0;
      const sid = newId('ses', t);
      sessionId = sid;
      deps.classifier.reset();
      alertState = INITIAL_ALERT;
      permissionNotified = false;
      flash = null;
      lastPanel = null;
      windowSamples = [];
      windowStart = t;
      lastTickAt = t;
      chunkIndex = 0;
      suspendedAt = null;
      recentSamples = [];
      camLive = null;
      screenNow = null;
      resetWindowWatch();
      // The preset the user picked is the length they get. demoFast only shortens alerts.
      const preset: PomodoroPreset | null = opts.pomodoro === 'off' ? null : opts.pomodoro;

      set({
        status: 'running',
        pausedForSleep: false,
        session: { id: sid, startedAt: t, endedAt: null },
        timer: { baseS: 0, runningSinceMs: demo ? null : t },
        chunks: [],
        current: { kind: 'starting', moduleId: null, activity: '', appName: null, at: t },
        webcam: { enabled: !demo && settings.webcamEnabled, personPresent: true, phoneVisible: false },
        missingPermissions: [],
        privacy: { framesAnalysed: 0, checksWithoutScreenshot: 0, framesStored: 0 },
        pomodoro: preset ? initPomodoro(preset, t) : null,
        alert: { level: 0, distractedSinceMs: null },
        sound: { id: settings.defaultSound, volume: settings.volume },
        lastSummary: null,
      });

      // Get Ollama up (without its prompt cache), then load the model and its system prompt now, so the
      // first check doesn't pay for it. A session that ended meanwhile skips the warm-up.
      if (!demo) {
        checkPermissions(sid, settings.webcamEnabled);
        (deps.prepareOllama?.() ?? Promise.resolve())
          .catch(noop)
          .then(() => (sessionId === sid ? deps.classifier.warmUp(detectModules()) : undefined))
          .catch(noop);
      }
      native.appShell.beginSessionActivity();
      unsubAction = native.panel.onAction((a) => controller.handlePanelAction(a));
      if (!demo) unsubSleep = native.appShell.onSystemSleep(() => pauseAt(now(), true));
      // Show the timer immediately; do not block on webcam (camera open can hang or fail on Windows).
      native.panel.show().catch(noop);
      await startWebcam();
      if (sessionId !== sid) return;
      await native.panel.ensureVisible().catch(noop);
      native.sound.setVolume(settings.volume);
      native.sound.play(settings.defaultSound).catch(noop);
      tickTimer = setInterval(onTick, TICK_MS);
      if (demo) {
        demoHandle = startDemo({
          chunks: deps.demoChunks ?? [],
          sessionId: sid,
          startedAt: t,
          intervalMs: deps.demoIntervalMs,
          canAdvance: () => sessionId === sid && get().status === 'running' && !ending,
          onChunk: (chunk) => {
            set({ timer: { baseS: get().timer.baseS + chunk.durationS, runningSinceMs: null } });
            applyChunk(chunk, chunk.source === 'vlm').catch(noop);
          },
        });
      }
      pushPanel(true);
    },

    pause() {
      pauseAt(now(), false);
    },

    resume() {
      if (!sessionId || get().status !== 'paused') return;
      const t = now();
      if (suspendedAt !== null) windowStart += t - suspendedAt;
      suspendedAt = null;
      windowSamples = [];
      resetWindowWatch();
      if (!demo) runTimer(t);
      const p = get().pomodoro;
      if (p) set({ pomodoro: thaw(p, t) });
      lastTickAt = t;
      set({ status: 'running', pausedForSleep: false });
      startWebcam();
      pushPanel();
    },

    end() {
      if (ending) return ending;
      if (!sessionId) return Promise.resolve(null);
      const sid = sessionId;
      ending = (async () => {
        const t = now();
        clearTimers();
        if (!demo && get().status === 'running' && t - windowStart >= MIN_PARTIAL_CHUNK_S * 1000) closeWindow(t);
        await Promise.allSettled([...pending]);
        resetSessionProfile();
        const tEnd = now();
        const st = get();
        const baseS = demo ? st.timer.baseS : elapsedS(tEnd);
        const summary = computeSummary(
          { id: sid, startedAt: st.session?.startedAt ?? t, endedAt: tEnd },
          st.chunks,
          deps.getModules(),
          st.pomodoro?.completed ?? 0,
          baseS,
        );
        try {
          await db.saveSession(summary);
        } catch {
          log('[session] saveSession failed');
        }
        teardownNative();
        // Drop the model, then quit Ollama if LarpLess opened it, so it doesn't keep the weights until
        // keep_alive. Native code skips an Ollama the user started. Demo never loaded it. Closing the app
        // quits it from native code too, because this JS may already be gone by then.
        if (!demo) {
          await deps.classifier.unload().catch(noop);
          // FLOllama quits and waits; the app shell's stopOllama() is the fire-and-forget fallback.
          await native.ollamaHost.quit().catch(noop);
          native.appShell.stopOllama();
        }
        native.panel.hide().catch(noop);
        native.sound.play('off').catch(noop);
        native.sound.duck(1);
        native.appShell.endSessionActivity();
        sessionId = null;
        alertState = INITIAL_ALERT;
        set({
          status: 'ended',
          pausedForSleep: false,
          session: st.session ? { ...st.session, endedAt: tEnd } : null,
          timer: { baseS: Math.round(baseS), runningSinceMs: null },
          alert: { level: 0, distractedSinceMs: null },
          lastSummary: summary,
        });
        deps.onSessionSaved?.(summary);
        return summary;
      })();
      return ending.finally(() => {
        ending = null;
      });
    },

    async relabelChunk(chunkId, patch) {
      const st = get();
      const c = st.chunks.find((x) => x.id === chunkId);
      if (!c) return;
      const kind = patch.kind === 'subject' && !patch.moduleId ? 'unknown' : patch.kind;
      const updated: Chunk = {
        ...c,
        kind,
        moduleId: kind === 'subject' ? patch.moduleId : null,
        reason: kind === 'distracted' ? patch.reason ?? 'screen' : null,
        confidence: 1,
        source: 'user',
      };
      const chunks = st.chunks.map((x) => (x.id === chunkId ? updated : x));
      set({ chunks });
      try {
        await db.updateChunk(updated);
      } catch {
        log('[session] updateChunk failed');
      }
      const last = get().lastSummary;
      if (last && last.id === updated.sessionId) {
        const summary = computeSummary(
          { id: last.id, startedAt: last.startedAt, endedAt: last.endedAt },
          chunks,
          deps.getModules(),
          last.pomodoros,
          last.totalS,
        );
        set({ lastSummary: summary });
        try {
          await db.saveSession(summary);
        } catch {
          log('[session] saveSession failed');
        }
        deps.onSessionSaved?.(summary);
      }
    },

    setSound(id: SoundId) {
      set({ sound: { ...get().sound, id } });
      native.sound.play(id).catch(noop);
      pushPanel();
    },

    setVolume(v: number) {
      const volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
      set({ sound: { ...get().sound, volume } });
      native.sound.setVolume(volume);
      pushPanel();
    },

    togglePomodoro() {
      if (!isActive()) return;
      const t = now();
      const st = get();
      if (st.pomodoro?.enabled) {
        set({ pomodoro: toggle(st.pomodoro, t) });
        if (st.status === 'break') leaveBreak(t);
      } else {
        const next = toggle(st.pomodoro, t, fallbackPreset());
        set({ pomodoro: st.status === 'paused' ? freeze(next, t) : next });
      }
      pushPanel();
    },

    skipPomodoroPhase() {
      if (!isActive()) return;
      const st = get();
      if (!st.pomodoro?.enabled || st.status === 'paused') return;
      const t = now();
      const r = skip(st.pomodoro, t);
      onPhaseChange(r.state, r.event, t);
      pushPanel();
    },

    setPomodoroPreset(preset: PomodoroPreset) {
      if (!isActive()) return;
      const t = now();
      const st = get();
      const next = initPomodoro(preset, t, st.pomodoro?.completed ?? 0);
      set({ pomodoro: st.status === 'paused' ? freeze(next, t) : next });
      if (st.status === 'break') leaveBreak(t);
      pushPanel();
    },

    async refreshOllama() {
      const model = deps.getSettings().model;
      const status = await deps.ollama.checkHealth();
      set({ ollama: { status, model } });
    },

    handlePanelAction(a: PanelAction) {
      switch (a.type) {
        case 'pause':
          return controller.pause();
        case 'resume':
          return controller.resume();
        case 'end':
          controller.end().catch(noop);
          return;
        case 'pomodoroToggle':
          return controller.togglePomodoro();
        case 'pomodoroSkip':
          return controller.skipPomodoroPhase();
        case 'pomodoroPreset':
          return controller.setPomodoroPreset(a.preset);
        case 'sound':
          return controller.setSound(a.id);
        case 'volume':
          return controller.setVolume(a.value);
        case 'openMain':
          native.appShell.bringToFront();
          return;
      }
    },

    dispose() {
      clearTimers();
      teardownNative();
      sessionId = null;
      resetSessionProfile();
    },
  };

  return controller;
}
