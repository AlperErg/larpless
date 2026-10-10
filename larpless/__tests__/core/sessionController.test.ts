import { DEFAULT_SETTINGS } from '../../src/config';
import type { Settings } from '../../src/contracts/domain';
import type { NativeApis, PanelAction, PanelState } from '../../src/contracts/native';
import type { SessionStoreState } from '../../src/contracts/store';
import { createClassifier } from '../../src/core/classifier';
import { createDb, createMemoryKv } from '../../src/core/db';
import { createSessionController, toPanelState } from '../../src/core/sessionController';
import type { StoreApi } from '../../src/core/sessionController';
import { fixtureChunks, fixtureModules, fixtureStates } from '../../src/fixtures/data';
import { mockApis } from '../../src/native/mock';
import { resetMockScreen } from '../../src/native/mock/screen';

const INITIAL: SessionStoreState = {
  status: 'idle',
  session: null,
  timer: { baseS: 0, runningSinceMs: null },
  chunks: [],
  current: null,
  webcam: { enabled: true, personPresent: true, phoneVisible: false },
  privacy: { framesAnalysed: 0, checksWithoutScreenshot: 0, framesStored: 0 },
  pomodoro: null,
  alert: { level: 0, distractedSinceMs: null },
  sound: { id: 'off', volume: 0.5 },
  ollama: { status: 'unknown', model: 'qwen3-vl:4b' },
  lastSummary: null,
};

const T0 = new Date(2026, 9, 9, 14, 0, 0).getTime();

function setup(opts: { settings?: Partial<Settings>; native?: Partial<NativeApis> } = {}) {
  let state: SessionStoreState = { ...INITIAL };
  const store: StoreApi = {
    getState: () => state,
    setState: (p) => {
      state = { ...state, ...p };
    },
  };
  let settings: Settings = { ...DEFAULT_SETTINGS, onboarded: true, ...opts.settings };
  const panelUpdates: PanelState[] = [];
  let panelAction: ((a: PanelAction) => void) | null = null;

  const capture = jest.fn(mockApis.screen.capture);
  const webcamStart = jest.fn(mockApis.webcam.start);
  const webcamStop = jest.fn(mockApis.webcam.stop);
  const native: NativeApis = {
    ...mockApis,
    screen: { getActiveWindow: mockApis.screen.getActiveWindow, capture },
    webcam: { ...mockApis.webcam, start: webcamStart, stop: webcamStop },
    panel: {
      show: jest.fn(async () => {}),
      hide: jest.fn(async () => {}),
      update: jest.fn((s: PanelState) => {
        panelUpdates.push(s);
      }),
      onAction: jest.fn((cb) => {
        panelAction = cb;
        return () => {
          panelAction = null;
        };
      }),
    },
    notifications: { requestPermission: jest.fn(async () => 'granted' as const), post: jest.fn(async () => {}) },
    sound: { play: jest.fn(async () => {}), setVolume: jest.fn(), duck: jest.fn(), chime: jest.fn() },
    appShell: { beginSessionActivity: jest.fn(), endSessionActivity: jest.fn(), bringToFront: jest.fn(), onMenuCommand: () => () => {} },
    ...opts.native,
  };
  const db = createDb(createMemoryKv());
  const ollama = { classify: jest.fn(async () => null), checkHealth: jest.fn(async () => 'ok' as const), unload: jest.fn(async () => {}) };
  const classifier = createClassifier({
    native,
    ollama,
    now: () => Date.now(),
    config: { USE_MOCK_CLASSIFIER: true, CACHE_TTL_MS: 120_000, CAPTURE: { maxWidth: 1280, jpegQuality: 0.7 } },
  });
  const saved: string[] = [];
  const ctrl = createSessionController({
    native,
    db,
    store,
    getModules: () => fixtureModules,
    getSettings: () => settings,
    classifier,
    ollama,
    now: () => Date.now(),
    config: { CHUNK_S: 30, DEMO_CHUNK_S: 10, WEBCAM_FPS: 1 },
    onSessionSaved: (s) => saved.push(s.id),
    demoChunks: fixtureChunks,
    demoIntervalMs: 2000,
    log: () => {},
  });
  return {
    ctrl,
    native,
    db,
    ollama,
    capture,
    webcamStart,
    webcamStop,
    panelUpdates,
    saved,
    get state() {
      return state;
    },
    sendPanel: (a: PanelAction) => panelAction?.(a),
    setSettings: (p: Partial<Settings>) => {
      settings = { ...settings, ...p };
    },
  };
}

const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  resetMockScreen();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('toPanelState', () => {
  const mods = fixtureModules;
  it('maps running subject / distracted / away / unknown / starting', () => {
    const running = fixtureStates.running as SessionStoreState;
    expect(toPanelState(running, mods)).toMatchObject({ status: 'studying', title: 'Maths', subtitle: 'Working on MATH201 problem set', tint: 'green', pulse: false, flash: null });
    const base = { ...running };
    const cur = (kind: SessionStoreState['current'] extends infer C ? (C extends { kind: infer K } ? K : never) : never, activity = '') => ({ kind, moduleId: null, activity, appName: null, at: 0 });
    expect(toPanelState({ ...base, current: cur('distracted', 'Instagram'), alert: { level: 3, distractedSinceMs: 0 } }, mods)).toMatchObject({ status: 'distracted', title: 'Distracted', subtitle: 'Instagram', tint: 'red', pulse: true });
    expect(toPanelState({ ...base, current: cur('away') }, mods)).toMatchObject({ status: 'away', title: 'Away', tint: 'gray' });
    expect(toPanelState({ ...base, current: cur('unknown') }, mods)).toMatchObject({ status: 'studying', tint: 'gray' });
    expect(toPanelState({ ...base, current: cur('starting') }, mods)).toMatchObject({ status: 'studying', subtitle: 'Starting…' });
    expect(toPanelState(running, mods).pomodoro).toEqual({ phase: 'focus', round: 1, rounds: 4, phaseEndsAtMs: running.pomodoro!.phaseEndsAtMs });
    expect(toPanelState(running, mods, 'backOnTrack').flash).toBe('backOnTrack');
  });

  it('maps break / paused / idle', () => {
    expect(toPanelState(fixtureStates.break as SessionStoreState, fixtureModules)).toMatchObject({ status: 'break', title: 'Break', subtitle: 'Round 1 of 4', tint: 'blue', timer: { runningSinceMs: null } });
    expect(toPanelState({ ...(fixtureStates.running as SessionStoreState), status: 'paused' }, fixtureModules)).toMatchObject({ status: 'paused', title: 'Paused', tint: 'gray' });
    expect(toPanelState(INITIAL, fixtureModules)).toMatchObject({ status: 'idle', tint: 'gray', pomodoro: null });
  });
});

describe('sessionController', () => {
  it('a 3-minute run produces 6 chunks; screenshots only on VLM calls', async () => {
    const h = setup();
    await h.ctrl.start({ pomodoro: 'off' });
    expect(h.state.status).toBe('running');
    expect(h.native.appShell.beginSessionActivity).toHaveBeenCalled();
    expect(h.native.panel.show).toHaveBeenCalled();
    expect(h.webcamStart).toHaveBeenCalledWith({ fps: 1 });

    await advance(180_000);
    const kinds = h.state.chunks.map((c) => `${c.kind}:${c.source}`);
    // Mock webcam: away 35–60 s and phone 80–90 s of every 120 s; mock screen: BIO ×2, MATH ×2, …
    expect(kinds).toEqual(['subject:vlm', 'away:webcam', 'distracted:webcam', 'subject:vlm', 'subject:cache', 'away:webcam']);
    expect(h.state.chunks.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(h.state.chunks.map((c) => c.startedAt - T0)).toEqual([0, 30_000, 60_000, 90_000, 120_000, 150_000]);
    expect(h.state.chunks[2].reason).toBe('phone');

    // framesAnalysed only counts real captures: away, phone-with-cache, cache and rule chunks don't.
    expect(h.capture).toHaveBeenCalledTimes(2);
    expect(h.state.privacy).toEqual({ framesAnalysed: 2, checksWithoutScreenshot: 4, framesStored: 0 });

    // Persisted as it goes; panel pushed only on change (far fewer than 180 ticks).
    expect(await h.db.getChunks(h.state.session!.id)).toHaveLength(6);
    expect(h.panelUpdates.length).toBeLessThan(30);
    expect(h.panelUpdates.at(-1)).toMatchObject({ status: 'away', title: 'Away', tint: 'gray' });
    expect(h.state.alert.level).toBe(0);
    await h.ctrl.end();
  });

  it('recovery after a distraction flashes "back on track" once', async () => {
    const h = setup();
    await h.ctrl.start({ pomodoro: 'off' });
    await advance(120_000); // chunk 2 = phone (distracted), chunk 3 = Maths
    const flashes = h.panelUpdates.filter((p) => p.flash === 'backOnTrack');
    expect(flashes).toHaveLength(1);
    expect(h.native.sound.chime).toHaveBeenCalledWith('back');
    await h.ctrl.end();
  });

  it('pause stops chunks, the timer and the webcam; resume continues without a partial chunk', async () => {
    const h = setup();
    await h.ctrl.start({ pomodoro: 'off' });
    await advance(45_000);
    expect(h.state.chunks).toHaveLength(1);
    h.ctrl.pause();
    expect(h.state.status).toBe('paused');
    expect(h.state.timer).toEqual({ baseS: 45, runningSinceMs: null });
    expect(h.webcamStop).toHaveBeenCalledTimes(1);
    const captures = h.capture.mock.calls.length;

    await advance(120_000);
    expect(h.state.chunks).toHaveLength(1);
    expect(h.capture.mock.calls.length).toBe(captures);

    h.ctrl.resume();
    expect(h.state.timer).toEqual({ baseS: 45, runningSinceMs: T0 + 165_000 });
    expect(h.webcamStart).toHaveBeenCalledTimes(2);
    await advance(14_000);
    expect(h.state.chunks).toHaveLength(1);
    await advance(1_000); // 15 s left of the window that was open when pausing
    expect(h.state.chunks).toHaveLength(2);
    expect(h.state.chunks[1]).toMatchObject({ durationS: 30, startedAt: T0 + 150_000 });
    const s = await h.ctrl.end();
    expect(s!.totalS).toBe(60);
  });

  it('the pomodoro preset you pick is the length you get, even in demo fast mode', async () => {
    const h = setup({ settings: { demoFast: true } });
    await h.ctrl.start({ pomodoro: '25/5' });
    expect(h.state.pomodoro).toMatchObject({ preset: '25/5', phase: 'focus', phaseEndsAtMs: T0 + 25 * 60_000 });
    await h.ctrl.end();
  });

  it('a pomodoro break stops capture and the webcam, ducks sound, then focus resumes', async () => {
    const h = setup({ settings: { demoFast: true } });
    await h.ctrl.start({ pomodoro: 'demo' }); // 2 min focus / 1 min break, so the test doesn't wait 25 min
    expect(h.state.pomodoro).toMatchObject({ preset: 'demo', phase: 'focus' });
    await advance(120_000);
    expect(h.state.status).toBe('break');
    expect(h.state.chunks).toHaveLength(12); // 10 s chunks in demoFast
    expect(h.state.timer).toEqual({ baseS: 120, runningSinceMs: null });
    expect(h.native.sound.duck).toHaveBeenCalledWith(0.3);
    expect(h.native.sound.chime).toHaveBeenCalledWith('phase');
    expect(h.native.notifications.post).toHaveBeenCalledWith(expect.objectContaining({ title: 'Break time' }));
    expect(h.panelUpdates.at(-1)).toMatchObject({ status: 'break', tint: 'blue' });
    const frames = h.state.privacy.framesAnalysed;
    const captures = h.capture.mock.calls.length;
    const getWin = jest.spyOn(h.native.screen, 'getActiveWindow');

    await advance(59_000);
    expect(h.state.status).toBe('break');
    expect(h.state.chunks).toHaveLength(12);
    expect(h.state.privacy.framesAnalysed).toBe(frames);
    expect(h.capture.mock.calls.length).toBe(captures);
    expect(getWin).not.toHaveBeenCalled();
    expect(h.webcamStop).toHaveBeenCalled();

    await advance(1_000);
    expect(h.state.status).toBe('running');
    expect(h.state.pomodoro).toMatchObject({ phase: 'focus', round: 2, completed: 1 });
    expect(h.native.sound.duck).toHaveBeenLastCalledWith(1);
    await advance(10_000);
    expect(h.state.chunks).toHaveLength(13);
    await h.ctrl.end();
  });

  it('end saves a summary, tears everything down and clears all timers', async () => {
    const h = setup();
    await h.ctrl.start({ pomodoro: 'off' });
    await advance(100_000); // 3 chunks + a 10 s partial window
    const summary = await h.ctrl.end();
    expect(summary).not.toBeNull();
    expect(h.state.chunks).toHaveLength(4);
    expect(h.state.chunks[3].durationS).toBe(10);
    expect(summary!.totalS).toBe(100);
    expect(h.state.status).toBe('ended');
    expect(h.state.lastSummary).toEqual(summary);
    expect(h.state.session!.endedAt).toBe(T0 + 100_000);
    expect(await h.db.listSessions()).toEqual([summary]);
    expect(h.saved).toEqual([summary!.id]);
    expect(h.native.panel.hide).toHaveBeenCalled();
    expect(h.native.sound.play).toHaveBeenLastCalledWith('off');
    expect(h.native.appShell.endSessionActivity).toHaveBeenCalled();
    expect(h.webcamStop).toHaveBeenCalled();
    expect(h.ollama.unload).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    // A second end is a no-op.
    expect(await h.ctrl.end()).toBeNull();
    expect(h.ollama.unload).toHaveBeenCalledTimes(1);
  });

  it('a partial window under 10 s is dropped at end', async () => {
    const h = setup();
    await h.ctrl.start({ pomodoro: 'off' });
    await advance(39_000);
    await h.ctrl.end();
    expect(h.state.chunks).toHaveLength(1);
  });

  it('full session: start → chunks → level-2 alert → break → end → summary (mock native, demoFast)', async () => {
    const h = setup({ settings: { demoFast: true, webcamEnabled: false } });
    await h.ctrl.start({ pomodoro: 'demo' });
    // 10 s chunks; mock screen: BIO ×2, MATH ×2, Instagram ×2, YouTube ×2 …
    await advance(60_000);
    const alerts = (h.native.notifications.post as jest.Mock).mock.calls.map((c) => c[0].title);
    expect(alerts.some((t: string) => /You've been on Instagram for 20 s/.test(t))).toBe(true);
    expect(h.native.sound.chime).toHaveBeenCalledWith('soft');
    await advance(60_000);
    expect(h.state.status).toBe('break');
    expect(h.state.alert.level).toBe(0);
    const summary = await h.ctrl.end();
    expect(summary).toMatchObject({ totalS: 120, pomodoros: 1 });
    expect(summary!.breakdown.map((b) => b.key)).toEqual(['mod_biology', 'mod_maths', 'distracted']);
    expect(summary!.focusPct).toBeGreaterThan(0);
    expect(h.state.privacy.framesStored).toBe(0);
  });

  it('webcam.start rejects → webcam disabled, session carries on', async () => {
    const h = setup({});
    h.webcamStart.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'E_CAMERA' }));
    await h.ctrl.start({ pomodoro: 'off' });
    expect(h.state.webcam.enabled).toBe(false);
    expect(h.state.status).toBe('running');
    await advance(60_000);
    expect(h.state.chunks).toHaveLength(2);
    expect(h.state.chunks.every((c) => c.kind !== 'away')).toBe(true);
    await h.ctrl.end();
  });

  it('camera stops emitting mid-session → zero samples = presence unknown, never away', async () => {
    const h = setup();
    await h.ctrl.start({ pomodoro: 'off' });
    await advance(30_000);
    // Simulate the camera dying: the mock stops emitting (no error event).
    await mockApis.webcam.stop();
    await advance(60_000); // would be the away window (35–60 s) if samples kept coming
    expect(h.state.chunks.slice(1).map((c) => c.kind)).not.toContain('away');
    await h.ctrl.end();
  });

  it('capture E_PERMISSION → unknown chunk and a single permission notification', async () => {
    const h = setup({ settings: { webcamEnabled: false } });
    h.capture.mockRejectedValue(Object.assign(new Error('denied'), { code: 'E_PERMISSION' }));
    await h.ctrl.start({ pomodoro: 'off' });
    await advance(60_000);
    expect(h.state.chunks.map((c) => c.kind)).toEqual(['unknown', 'unknown']);
    const posts = (h.native.notifications.post as jest.Mock).mock.calls.filter((c) => c[0].title === 'Screen Recording permission needed');
    expect(posts).toHaveLength(1);
    expect(h.state.privacy.framesAnalysed).toBe(0);
    await h.ctrl.end();
  });

  it('panel actions map to store actions; openMain brings the app to front', async () => {
    const h = setup();
    await h.ctrl.start({ pomodoro: 'off' });
    h.sendPanel({ type: 'pause' });
    expect(h.state.status).toBe('paused');
    h.sendPanel({ type: 'resume' });
    expect(h.state.status).toBe('running');
    h.sendPanel({ type: 'sound', id: 'brown' });
    expect(h.state.sound.id).toBe('brown');
    expect(h.native.sound.play).toHaveBeenLastCalledWith('brown');
    h.sendPanel({ type: 'volume', value: 1.7 });
    expect(h.state.sound.volume).toBe(1);
    h.sendPanel({ type: 'pomodoroToggle' });
    expect(h.state.pomodoro).toMatchObject({ enabled: true, preset: '25/5' });
    h.sendPanel({ type: 'pomodoroPreset', preset: '50/10' });
    expect(h.state.pomodoro).toMatchObject({ enabled: true, preset: '50/10', phase: 'focus' });
    h.sendPanel({ type: 'pomodoroSkip' });
    expect(h.state.status).toBe('break');
    h.sendPanel({ type: 'pomodoroToggle' }); // disabling during a break resumes focus
    expect(h.state.status).toBe('running');
    expect(h.state.pomodoro?.enabled).toBe(false);
    h.sendPanel({ type: 'openMain' });
    expect(h.native.appShell.bringToFront).toHaveBeenCalled();
    h.sendPanel({ type: 'end' });
    await advance(0);
    expect(h.state.status).toBe('ended');
  });

  it('relabelChunk marks the chunk user, persists it and recomputes the summary', async () => {
    const h = setup();
    await h.ctrl.start({ pomodoro: 'off' });
    await advance(180_000);
    const before = await h.ctrl.end();
    const instagram = h.state.chunks.find((c) => c.kind === 'distracted')!;
    await h.ctrl.relabelChunk(instagram.id, { kind: 'subject', moduleId: 'mod_history', reason: null });
    const after = h.state.lastSummary!;
    expect(h.state.chunks.find((c) => c.id === instagram.id)).toMatchObject({ kind: 'subject', moduleId: 'mod_history', reason: null, source: 'user' });
    expect((await h.db.getChunks(instagram.sessionId)).find((c) => c.id === instagram.id)?.source).toBe('user');
    expect(after.focusPct).toBeGreaterThan(before!.focusPct);
    expect(after.breakdown.map((b) => b.key)).toContain('mod_history');
    expect((await h.db.listSessions())[0]).toEqual(after);
    expect(h.saved).toEqual([before!.id, before!.id]);
  });

  it('refreshOllama stores the health status and model', async () => {
    const h = setup();
    await h.ctrl.refreshOllama();
    expect(h.state.ollama).toEqual({ status: 'ok', model: 'qwen3-vl:4b' });
  });

  it('ignores a second start while running', async () => {
    const h = setup();
    await h.ctrl.start({ pomodoro: 'off' });
    const id = h.state.session!.id;
    await h.ctrl.start({ pomodoro: 'off' });
    expect(h.state.session!.id).toBe(id);
    await h.ctrl.end();
  });

  it('never logs image data', async () => {
    const spy = console.log as jest.Mock;
    spy.mockClear();
    const h = setup();
    await h.ctrl.start({ pomodoro: 'off' });
    await advance(120_000);
    await h.ctrl.end();
    const out = spy.mock.calls.flat().map(String).join('\n');
    expect(out).not.toContain('/9j/');
  });

  it('demo mode replays fixtureChunks through the same store/alerts/panel path, never touching screen or webcam', async () => {
    const h = setup();
    const getWin = jest.spyOn(h.native.screen, 'getActiveWindow');
    await h.ctrl.start({ pomodoro: 'off', demo: true });
    expect(h.state.status).toBe('running');
    expect(h.state.webcam.enabled).toBe(false);
    expect(h.state.timer).toEqual({ baseS: 0, runningSinceMs: null });

    await advance(2_000);
    expect(h.state.chunks).toHaveLength(1);
    expect(h.state.timer.baseS).toBe(30);
    expect(h.state.current).toMatchObject({ kind: 'subject', moduleId: 'mod_biology' });
    expect(h.panelUpdates.at(-1)).toMatchObject({ status: 'studying', title: 'Biology', timer: { baseS: 30, runningSinceMs: null } });

    // Chunks 12–15 are Instagram: 4 × 30 s → level 2 notification (strictness 2) through the real alerts.
    await advance(30_000);
    expect(h.state.chunks).toHaveLength(16);
    expect(h.state.alert.level).toBe(2);
    expect((h.native.notifications.post as jest.Mock).mock.calls.map((c) => c[0].title)).toContain("You've been on Instagram for 2 min");

    // Pause holds the replay.
    h.ctrl.pause();
    await advance(10_000);
    expect(h.state.chunks).toHaveLength(16);
    h.ctrl.resume();
    expect(h.state.timer.runningSinceMs).toBeNull();

    await advance(64_000);
    expect(h.state.chunks).toHaveLength(48);
    expect(h.state.privacy).toEqual({ framesAnalysed: fixtureChunks.filter((c) => c.source === 'vlm').length, checksWithoutScreenshot: fixtureChunks.filter((c) => c.source !== 'vlm').length, framesStored: 0 });

    const summary = await h.ctrl.end();
    expect(summary!.totalS).toBe(48 * 30);
    expect(summary!.focusS).toBe(fixtureChunks.filter((c) => c.kind === 'subject').length * 30);
    expect(getWin).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.webcamStart).not.toHaveBeenCalled();
    expect(h.ollama.unload).not.toHaveBeenCalled();
    expect(await h.db.getChunks(summary!.id)).toHaveLength(48);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('framesAnalysed does not increase on rule or cache paths', async () => {
    let title = 'Instagram';
    const win = async () => ({ appName: 'Safari', bundleId: 'com.apple.Safari', windowTitle: title, isSelf: false });
    const h = setup({ settings: { webcamEnabled: false } });
    h.native.screen.getActiveWindow = win;
    h.capture.mockImplementation(async () => ({ ...(await win()), jpegBase64: 'x', width: 1, height: 1, capturedAt: Date.now() }));
    await h.ctrl.start({ pomodoro: 'off' });
    await advance(90_000);
    expect(h.state.chunks.map((c) => c.source)).toEqual(['rule', 'rule', 'rule']);
    expect(h.state.privacy).toEqual({ framesAnalysed: 0, checksWithoutScreenshot: 3, framesStored: 0 });
    expect(h.capture).not.toHaveBeenCalled();

    title = 'BIO101 cell biology notes';
    await advance(90_000);
    expect(h.state.chunks.slice(3).map((c) => c.source)).toEqual(['vlm', 'cache', 'cache']);
    expect(h.state.privacy).toEqual({ framesAnalysed: 1, checksWithoutScreenshot: 5, framesStored: 0 });
    expect(h.capture).toHaveBeenCalledTimes(1);
    await h.ctrl.end();
  });
});
