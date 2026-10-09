/**
 * Session runtime loop (PLAN.md §6). Wires the native facades, classifier, fuser, alerts, pomodoro
 * and db to the session store. Pure TS: everything is injected, time comes from `now()`.
 *
 * Chunk windows: a window starts at `windowStart` and closes at `windowStart + chunkS`; the next one
 * starts exactly there (no drift). Pauses and breaks shift the open window by their length, so no
 * partial chunk (and no screenshot) is taken when they start. `end()` finalises a partial chunk ≥ 10 s.
 *
 * PRIVACY: snapshots never pass through here (the classifier drops them); nothing image-like is logged.
 */
import type { Chunk, PomodoroPreset, SessionSummary, Settings, SoundId, StudyModule } from '../contracts/domain';
import type { NativeApis, PanelAction, PanelState, Unsubscribe, WebcamSample } from '../contracts/native';
import type { SessionStoreActions, SessionStoreState, StartOptions } from '../contracts/store';
import { evaluate, INITIAL_ALERT } from './alerts';
import type { AlertEffect, AlertState } from './alerts';
import { awayStats, fuseChunk } from './chunkFuser';
import type { Classifier } from './classifier';
import type { Db } from './db';
import { computeSummary } from './focus';
import { newId } from './ids';
import type { OllamaClient } from './ollama';
import { initPomodoro, isBreak, phaseDurationMs, remainingMs, resumeWith, skip, tick as pomoTick, toggle } from './pomodoro';
import type { PomodoroEvent } from './pomodoro';
import { startDemo } from './demoMode';
import type { DemoHandle } from './demoMode';

export const TICK_MS = 1000;
/** Webcam samples kept for the open chunk window (ring buffer). */
export const SAMPLE_BUFFER = 120;
/** end(): the open window is turned into a chunk only if it's at least this long. */
export const MIN_PARTIAL_CHUNK_S = 10;
/** Pomodoro breaks duck the ambient sound to this factor. */
export const BREAK_DUCK = 0.3;

export interface StoreApi {
  getState(): SessionStoreState;
  setState(patch: Partial<SessionStoreState>): void;
}

export interface ControllerConfig {
  CHUNK_S: number;
  DEMO_CHUNK_S: number;
  WEBCAM_FPS: number;
}

export interface SessionControllerDeps {
  native: NativeApis;
  db: Db;
  store: StoreApi;
  getModules(): StudyModule[];
  getSettings(): Settings;
  classifier: Pick<Classifier, 'classifyCurrent' | 'reset'>;
  ollama: Pick<OllamaClient, 'checkHealth'>;
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
  s: Pick<SessionStoreState, 'status' | 'timer' | 'current' | 'pomodoro' | 'sound' | 'alert'>,
  modules: readonly Pick<StudyModule, 'id' | 'name'>[],
  flash: PanelState['flash'] = null,
): PanelState {
  const pomodoro = s.pomodoro?.enabled
    ? { phase: s.pomodoro.phase, round: s.pomodoro.round, rounds: s.pomodoro.roundsBeforeLong, phaseEndsAtMs: s.pomodoro.phaseEndsAtMs }
    : null;
  const base = { timer: { ...s.timer }, pomodoro, sound: { ...s.sound }, pulse: false, flash };

  switch (s.status) {
    case 'idle':
    case 'ended':
      return { ...base, status: 'idle', title: 'LarpLess', subtitle: null, tint: 'gray', flash: null };
    case 'paused':
      return { ...base, status: 'paused', title: 'Paused', subtitle: null, tint: 'gray' };
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
        return { ...base, status: 'distracted', title: 'Distracted', subtitle: sub(c.activity), tint: 'red', pulse: s.alert.level === 3 };
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

  let sessionId: string | null = null;
  let demo = false;
  let ending: Promise<SessionSummary | null> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let demoHandle: DemoHandle | null = null;
  let unsubSample: Unsubscribe | null = null;
  let unsubAction: Unsubscribe | null = null;
  let webcamRunning = false;
  let windowSamples: WebcamSample[] = [];
  let windowStart = 0;
  let chunkS = config.CHUNK_S;
  let chunkIndex = 0;
  let suspendedAt: number | null = null; // pause or break start
  let pomoRemaining: number | null = null; // pomodoro time left when paused
  let alertState: AlertState = INITIAL_ALERT;
  let permissionNotified = false;
  let flash: PanelState['flash'] = null;
  let lastPanel: string | null = null;
  const pending = new Set<Promise<void>>();

  const isActive = () => sessionId !== null && ['running', 'paused', 'break'].includes(get().status);

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
    if (!webcamRunning) return;
    webcamRunning = false;
    native.webcam.stop().catch(noop);
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
    set({
      chunks,
      current: { kind: chunk.kind, moduleId: chunk.moduleId, activity: chunk.activity, appName: chunk.appName, at: now() },
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
    const modules = deps.getModules();
    let verdict = null;
    let appName: string | null = null;
    let tookScreenshot = false;
    // 1. Away (webcam) → no screenshot at all.
    if (!awayStats(samples).away) {
      const r = await deps.classifier.classifyCurrent(modules);
      verdict = r.verdict;
      appName = r.appName;
      tookScreenshot = r.tookScreenshot;
      if (r.error === 'permission' && !permissionNotified) {
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
    }
    if (sid !== sessionId) return;
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

  function onTick() {
    if (!sessionId || ending) return;
    const t = now();
    // Close due chunk windows first, so a focus phase ending on a boundary keeps its last chunk.
    if (!demo && get().status === 'running') {
      while (t >= windowStart + chunkS * 1000) closeWindow(windowStart + chunkS * 1000);
    }
    const st = get();
    if (st.pomodoro?.enabled && (st.status === 'running' || st.status === 'break')) {
      const r = pomoTick(st.pomodoro, t);
      if (r.event) onPhaseChange(r.state, r.event, t);
    }
    pushPanel();
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
    stopWebcam();
    unsubSample?.();
    unsubSample = null;
  }

  /* ---------- actions ---------- */

  const controller: SessionController = {
    async start(opts: StartOptions) {
      if (isActive() || ending) return;
      const t = now();
      const settings = deps.getSettings();
      demo = !!opts.demo;
      chunkS = demo ? config.CHUNK_S : settings.demoFast ? config.DEMO_CHUNK_S : config.CHUNK_S;
      const sid = newId('ses', t);
      sessionId = sid;
      deps.classifier.reset();
      alertState = INITIAL_ALERT;
      permissionNotified = false;
      flash = null;
      lastPanel = null;
      windowSamples = [];
      windowStart = t;
      chunkIndex = 0;
      suspendedAt = null;
      pomoRemaining = null;
      // The preset the user picked is the length they get. demoFast only shortens checks and alerts.
      const preset: PomodoroPreset | null = opts.pomodoro === 'off' ? null : opts.pomodoro;

      set({
        status: 'running',
        session: { id: sid, startedAt: t, endedAt: null },
        timer: { baseS: 0, runningSinceMs: demo ? null : t },
        chunks: [],
        current: { kind: 'starting', moduleId: null, activity: '', appName: null, at: t },
        webcam: { enabled: !demo && settings.webcamEnabled, personPresent: true, phoneVisible: false },
        privacy: { framesAnalysed: 0, checksWithoutScreenshot: 0, framesStored: 0 },
        pomodoro: preset ? initPomodoro(preset, t) : null,
        alert: { level: 0, distractedSinceMs: null },
        sound: { id: settings.defaultSound, volume: settings.volume },
        lastSummary: null,
      });

      native.appShell.beginSessionActivity();
      unsubAction = native.panel.onAction((a) => controller.handlePanelAction(a));
      await startWebcam();
      if (sessionId !== sid) return;
      await native.panel.show().catch(noop);
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
      if (!sessionId || get().status !== 'running') return;
      const t = now();
      suspendedAt = t;
      freezeTimer(t);
      const p = get().pomodoro;
      pomoRemaining = p?.enabled ? remainingMs(p, t) : null;
      stopWebcam();
      set({ status: 'paused' });
      pushPanel();
    },

    resume() {
      if (!sessionId || get().status !== 'paused') return;
      const t = now();
      if (suspendedAt !== null) windowStart += t - suspendedAt;
      suspendedAt = null;
      windowSamples = [];
      if (!demo) runTimer(t);
      const p = get().pomodoro;
      if (p?.enabled && pomoRemaining !== null) set({ pomodoro: resumeWith(p, t, pomoRemaining) });
      pomoRemaining = null;
      set({ status: 'running' });
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
        native.panel.hide().catch(noop);
        native.sound.play('off').catch(noop);
        native.sound.duck(1);
        native.appShell.endSessionActivity();
        sessionId = null;
        alertState = INITIAL_ALERT;
        set({
          status: 'ended',
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
        set({ pomodoro: next });
        if (st.status === 'paused') pomoRemaining = remainingMs(next, t);
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
      set({ pomodoro: next });
      if (st.status === 'break') leaveBreak(t);
      if (st.status === 'paused') pomoRemaining = remainingMs(next, t);
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
    },
  };

  return controller;
}
