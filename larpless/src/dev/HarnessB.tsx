/**
 * Harness B (WS-B): exercises the REAL Swift shell modules (panel, notifications, sound, app shell),
 * regardless of config.USE_MOCK_NATIVE. Imports the facades directly, never src/native/index.
 *
 * Headless runners (node scripts/js-eval.mjs 8083 "__FL.harness.<name>()"):
 *   B            everything quick (Sprint 1 + Sprint 2), leaves the panel hidden and sound off
 *   Bpanel       floating panel checks          Bnotif   notification checks
 *   BnotifRequest  asks for notification permission once (10 s timeout; needs a human click)
 *   BtimerStart / BtimerCheck   panel timer keeps counting with no update() for >= 60 s
 *   Bsound / Bshell / BdriftStart / BdriftCheck   (Sprint 2)
 * Ad-hoc access: globalThis.__FLB.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SoundId } from '../contracts/domain';
import type {
  ChimeKind,
  MenuCommand,
  PanelAction,
  PanelState,
} from '../contracts/native';
import { panel, panelDebug } from '../native/panel';
import { notifications, notificationsDebug } from '../native/notifications';
import { sound, soundDebug, type SoundMeter } from '../native/sound';
import { appShell, appShellDebug } from '../native/appShell';
import { registerHarness } from './devGlobals';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, sleep(ms).then(() => fallback)]);
}

/* ------------------------------------------------------------------ event log */

interface LogEntry {
  t: number;
  kind: 'panel' | 'menu' | 'info';
  body: unknown;
}
const eventLog: LogEntry[] = [];
const logSubscribers = new Set<() => void>();
let unsubPanel: (() => void) | null = null;
let unsubMenu: (() => void) | null = null;

function pushLog(kind: LogEntry['kind'], body: unknown) {
  eventLog.push({ t: Date.now(), kind, body });
  if (eventLog.length > 200) eventLog.shift();
  logSubscribers.forEach(f => f());
}

function ensureListeners() {
  if (!unsubPanel && panelDebug.available()) {
    unsubPanel = panel.onAction((a: PanelAction) => pushLog('panel', a));
  }
  if (!unsubMenu && appShellDebug.available()) {
    unsubMenu = appShell.onMenuCommand((c: MenuCommand) => pushLog('menu', c));
  }
}

/* ------------------------------------------------------------------ demo panel states */

type DemoName = 'studying' | 'distracted' | 'away' | 'break' | 'paused';
const DEMO_ORDER: DemoName[] = [
  'studying',
  'distracted',
  'away',
  'break',
  'paused',
];

/** Harness-side timer so the panel clock stays continuous while cycling states. */
const clock = { baseS: 0, runningSinceMs: null as number | null };
const soundState: PanelState['sound'] = { id: 'off', volume: 0.5 };

function clockElapsed(now: number) {
  return (
    clock.baseS +
    (clock.runningSinceMs != null ? (now - clock.runningSinceMs) / 1000 : 0)
  );
}
function clockRun(now: number) {
  if (clock.runningSinceMs == null) clock.runningSinceMs = now;
}
function clockFreeze(now: number) {
  clock.baseS = clockElapsed(now);
  clock.runningSinceMs = null;
}

function demoState(
  name: DemoName,
  now = Date.now(),
  extra: Partial<PanelState> = {},
): PanelState {
  const common = {
    sound: { ...soundState },
    pulse: false,
    flash: null,
    pomodoro: null,
  };
  let s: PanelState;
  switch (name) {
    case 'studying':
      clockRun(now);
      s = {
        ...common,
        status: 'studying',
        title: 'Biology',
        subtitle: 'Reading cell division slides',
        tint: 'green',
        timer: { ...clock },
      };
      break;
    case 'distracted':
      clockRun(now);
      s = {
        ...common,
        status: 'distracted',
        title: 'Distracted',
        subtitle: 'Instagram',
        tint: 'red',
        pulse: true,
        timer: { ...clock },
      };
      break;
    case 'away':
      clockRun(now);
      s = {
        ...common,
        status: 'away',
        title: 'Away',
        subtitle: null,
        tint: 'gray',
        timer: { ...clock },
      };
      break;
    case 'break':
      clockFreeze(now);
      s = {
        ...common,
        status: 'break',
        title: 'Break',
        subtitle: 'Round 2 of 4',
        tint: 'blue',
        timer: { ...clock },
        pomodoro: {
          phase: 'break',
          round: 2,
          rounds: 4,
          phaseEndsAtMs: now + 5 * 60_000,
        },
      };
      break;
    case 'paused':
    default:
      clockFreeze(now);
      s = {
        ...common,
        status: 'paused',
        title: 'Paused',
        subtitle: null,
        tint: 'gray',
        timer: { ...clock },
      };
      break;
  }
  return { ...s, ...extra };
}

/* ------------------------------------------------------------------ helpers */

type Rgb = [number, number, number];
const dist = (a: Rgb, b: Rgb) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

async function sampleBg(count: number, gapMs: number): Promise<Rgb[]> {
  const out: Rgb[] = [];
  for (let i = 0; i < count; i++) {
    const r = (await panelDebug.sampleBg()) as { ok: boolean; rgb?: Rgb };
    if (r.ok && r.rgb) out.push(r.rgb);
    if (gapMs > 0) await sleep(gapMs);
  }
  return out;
}

async function ocr(): Promise<string> {
  const r = (await panelDebug.renderText()) as { text?: string[] };
  return (r.text ?? []).join(' | ');
}

const PANEL_BUTTONS: { id: string; expect: (a: PanelAction) => boolean }[] = [
  { id: 'pause', expect: a => a.type === 'pause' },
  { id: 'end', expect: a => a.type === 'end' },
  { id: 'openMain', expect: a => a.type === 'openMain' },
  { id: 'pomodoroToggle', expect: a => a.type === 'pomodoroToggle' },
  { id: 'pomodoroSkip', expect: a => a.type === 'pomodoroSkip' },
  {
    id: 'preset:25/5',
    expect: a => a.type === 'pomodoroPreset' && a.preset === '25/5',
  },
  {
    id: 'preset:50/10',
    expect: a => a.type === 'pomodoroPreset' && a.preset === '50/10',
  },
  { id: 'sound:pink', expect: a => a.type === 'sound' && a.id === 'pink' },
  { id: 'sound:off', expect: a => a.type === 'sound' && a.id === 'off' },
  {
    id: 'volume',
    expect: a => a.type === 'volume' && a.value > 0.3 && a.value < 0.7,
  },
];

/* ------------------------------------------------------------------ Sprint 1: panel */

async function runPanelChecks(): Promise<Record<string, unknown>> {
  if (!panelDebug.available())
    return { pass: false, error: 'FLFloatingPanel native module missing' };
  ensureListeners();
  const r: Record<string, unknown> = {};
  const checks: Record<string, boolean> = {};
  try {
    clock.baseS = 0;
    clock.runningSinceMs = null;
    panel.update(demoState('studying'));
    await panel.show();
    await sleep(700);

    // 1. Floating, all Spaces, full-screen auxiliary, non-activating
    const info = await panelDebug.info();
    r.window = {
      visible: info.visible,
      level: info.level,
      floatingLevel: info.floatingLevel,
      canJoinAllSpaces: info.canJoinAllSpaces,
      fullScreenAuxiliary: info.fullScreenAuxiliary,
      nonactivatingPanel: info.nonactivatingPanel,
      hidesOnDeactivate: info.hidesOnDeactivate,
      canBecomeKey: info.canBecomeKey,
      acceptsFirstMouse: info.acceptsFirstMouse,
      atDefaultTopRight: info.atDefaultTopRight,
      occlusionVisible: info.occlusionVisible,
      frame: info.frame,
      fonts: info.fonts,
    };
    checks.floats =
      info.visible === true &&
      (info.level as number) >= (info.floatingLevel as number) &&
      info.canJoinAllSpaces === true &&
      info.fullScreenAuxiliary === true &&
      info.nonactivatingPanel === true &&
      info.hidesOnDeactivate === false &&
      info.acceptsFirstMouse === true;
    checks.fonts = (info.fonts as { serif: boolean }).serif === true;

    // 2. Rendered text (OCR of the live view)
    r.ocrStudying = await ocr();
    checks.renders =
      /Studying/.test(r.ocrStudying as string) &&
      /Biology/.test(r.ocrStudying as string);

    // 3. Drag (same handler the SwiftUI drag gesture feeds), remembered across hide/show
    const drag = (await panelDebug.drag(-100, -50)) as {
      before: { x: number; y: number };
      after: { x: number; y: number };
    };
    r.drag = drag;
    checks.drag =
      Math.abs(drag.after.x - drag.before.x + 100) < 1 &&
      Math.abs(drag.after.y - drag.before.y + 50) < 1;
    await panel.hide();
    await panel.show();
    const reshown = (await panelDebug.info()).frame as { x: number; y: number };
    checks.dragRemembered =
      Math.abs(reshown.x - drag.after.x) < 1 &&
      Math.abs(reshown.y - drag.after.y) < 1;

    // 4. Hover hub + synthesized clicks while another app is focused
    panelDebug.setHover(true);
    await sleep(450);
    const hub = await panelDebug.info();
    r.hubButtons = hub.buttonIds;
    checks.hubShows =
      hub.hubVisible === true &&
      PANEL_BUTTONS.every(b => (hub.buttonIds as string[]).includes(b.id));
    const deact = await panelDebug.deactivateApp();
    r.deactivated = deact;
    const clicks: Record<string, unknown> = {};
    let allClicked = true;
    let neverActivated = true;
    for (const b of PANEL_BUTTONS) {
      const before = eventLog.length;
      const c = (await panelDebug.click(b.id)) as {
        ok: boolean;
        appIsActiveAfter?: boolean;
      };
      await sleep(150);
      const got = eventLog
        .slice(before)
        .filter(e => e.kind === 'panel')
        .map(e => e.body as PanelAction);
      const ok = c.ok && got.length === 1 && b.expect(got[0]);
      allClicked = allClicked && ok;
      if (c.appIsActiveAfter) neverActivated = false;
      clicks[b.id] = { ok, events: got, appActiveAfter: c.appIsActiveAfter };
    }
    r.clicks = clicks;
    checks.hubClicksEmit = allClicked;
    checks.clicksDontActivate = deact.appIsActive === false && neverActivated;

    // 5. Hub hides 600 ms after the mouse leaves
    panelDebug.setHover(false);
    await sleep(300);
    const still = (await panelDebug.info()).hubVisible;
    await sleep(700);
    const gone = (await panelDebug.info()).hubVisible;
    checks.hubHidesAfterDelay = still === true && gone === false;

    // 6. Tint animation (green → red over ~300 ms)
    panel.update(demoState('studying'));
    await sleep(500);
    const green = (await sampleBg(1, 0))[0];
    panel.update(demoState('distracted', Date.now(), { pulse: false }));
    const series = await sampleBg(14, 25);
    await sleep(400);
    const red = (await sampleBg(1, 0))[0];
    const intermediate = series.filter(
      c => dist(c, green) > 3 && dist(c, red) > 3,
    );
    r.tint = { green, red, series, intermediateFrames: intermediate.length };
    checks.tintAnimates = dist(green, red) > 8 && intermediate.length >= 1;

    // 7. Pulse (bg breathes while pulse == true)
    panel.update(demoState('distracted'));
    await sleep(100);
    const pulseSeries = await sampleBg(16, 80);
    const greens = pulseSeries.map(c => c[1]);
    r.pulse = {
      min: Math.min(...greens),
      max: Math.max(...greens),
      n: pulseSeries.length,
    };
    checks.pulse = Math.max(...greens) - Math.min(...greens) >= 4;

    // 8. Flash: once per change to 'backOnTrack', 1.2 s
    const f0 = (await panelDebug.info()).flashCount as number;
    panel.update(demoState('studying', Date.now(), { flash: 'backOnTrack' }));
    await sleep(350);
    const during = await panelDebug.info();
    const flashText = await ocr();
    panel.update(demoState('studying', Date.now(), { flash: 'backOnTrack' })); // unchanged → no new flash
    await sleep(1300);
    const after = await panelDebug.info();
    panel.update(demoState('studying', Date.now(), { flash: null }));
    await sleep(50);
    panel.update(demoState('studying', Date.now(), { flash: 'backOnTrack' })); // changed again → flashes again
    await sleep(200);
    const again = await panelDebug.info();
    r.flash = {
      flashText,
      duringVisible: during.flashVisible,
      afterVisible: after.flashVisible,
      counts: [f0, during.flashCount, after.flashCount, again.flashCount],
    };
    checks.flash =
      during.flashVisible === true &&
      /Back on track/i.test(flashText) &&
      after.flashVisible === false &&
      during.flashCount === f0 + 1 &&
      after.flashCount === f0 + 1 &&
      again.flashCount === f0 + 2;
    await sleep(1300);

    // 9. Every demo state renders its pill
    const pills: Record<string, string> = {};
    for (const name of DEMO_ORDER) {
      panel.update(demoState(name));
      await sleep(450);
      pills[name] = await ocr();
    }
    r.pills = pills;
    checks.pills =
      /Studying/.test(pills.studying) &&
      /Instagram/.test(pills.distracted) &&
      /Away/.test(pills.away) &&
      /Break/.test(pills.break) &&
      /left/.test(pills.break) &&
      /Round 2 of 4/.test(pills.break) &&
      /Paused/.test(pills.paused);

    // Put it back where it was
    await panelDebug.drag(100, 50);
  } catch (e) {
    r.error = String(e);
  } finally {
    panelDebug.setHover(false);
    await panel.hide();
    await sleep(200);
    r.hiddenAtEnd = (await panelDebug.info()).visible === false;
  }
  r.checks = checks;
  r.pass = !r.error && Object.values(checks).every(Boolean);
  return r;
}

/* ------------------------------------------------------------------ Sprint 1: timer without updates */

let timerTest: { t0: number; updates0: number } | null = null;

async function timerStart(): Promise<unknown> {
  ensureListeners();
  clock.baseS = 0;
  clock.runningSinceMs = null;
  const now = Date.now();
  panel.update(demoState('studying', now));
  await panel.show();
  await sleep(300);
  const info = await panelDebug.info();
  timerTest = { t0: now, updates0: info.updateCount as number };
  return {
    started: true,
    t0: now,
    note: 'call __FL.harness.BtimerCheck() after >= 60 s',
  };
}

async function timerCheck(): Promise<unknown> {
  if (!timerTest) return { pass: false, error: 'BtimerStart not run' };
  const info = await panelDebug.info();
  const text = await ocr();
  const now = Date.now();
  const expectedS = Math.floor((now - timerTest.t0) / 1000);
  const rendered = info.rendered as {
    timer: string;
    ageMs: number;
    count: number;
  };
  const toS = (s: string) =>
    s
      .split(':')
      .map(Number)
      .reduce((acc, p) => acc * 60 + p, 0);
  const renderedS = toS(rendered.timer);
  const ocrMatch = text.match(/(\d+:)?\d{2}:\d{2}/);
  const ocrS = ocrMatch ? toS(ocrMatch[0]) : -1;
  const result = {
    elapsedRealS: (now - timerTest.t0) / 1000,
    expectedS,
    renderedTimer: rendered.timer,
    renderedAgeMs: rendered.ageMs,
    ocrTimer: ocrMatch ? ocrMatch[0] : null,
    updatesDuringTest: (info.updateCount as number) - timerTest.updates0,
    pass:
      now - timerTest.t0 >= 60_000 &&
      (info.updateCount as number) === timerTest.updates0 &&
      Math.abs(renderedS - expectedS) <= 1 &&
      Math.abs(ocrS - expectedS) <= 1 &&
      rendered.ageMs < 1500,
  };
  await panel.hide();
  timerTest = null;
  return result;
}

/* ------------------------------------------------------------------ Sprint 1: notifications */

async function runNotificationChecks(): Promise<Record<string, unknown>> {
  if (!notificationsDebug.available())
    return { pass: false, error: 'FLNotifications native module missing' };
  const r: Record<string, unknown> = {};
  const st = await notificationsDebug.status();
  r.status0 = {
    authorization: st.authorization,
    alertSetting: st.alertSetting,
    alertStyle: st.alertStyle,
    delegateInstalled: st.delegateInstalled,
  };
  if (st.authorization !== 'authorized' && st.authorization !== 'provisional') {
    r.pass = false;
    r.blocked =
      'permission: run __FL.harness.BnotifRequest() and have a human click Allow (System Settings › Notifications › LarpLess)';
    return r;
  }
  const stamp = Date.now();
  // Foreground: LarpLess active → willPresent must fire (banner while in front)
  const act = await panelDebug.activateApp();
  const fgId = `flb-fg-${stamp}`;
  await notifications.post({
    id: fgId,
    title: 'LarpLess harness',
    body: 'Foreground banner check',
    sound: false,
  });
  await sleep(800);
  const s1 = await notificationsDebug.status();
  r.foreground = {
    appWasActive: act.appIsActive,
    delivered: s1.deliveredIds.includes(fgId),
    willPresentDelta: s1.willPresentCount - st.willPresentCount,
    lastPresentedId: s1.lastPresentedId,
  };
  // Background: another app focused → delivered by the system without willPresent
  const deact = await panelDebug.deactivateApp();
  const bgId = `flb-bg-${stamp}`;
  await notifications.post({
    id: bgId,
    title: 'LarpLess harness',
    body: 'Background banner check',
    sound: false,
  });
  await sleep(800);
  const s2 = await notificationsDebug.status();
  r.background = {
    appWasActive: deact.appIsActive,
    delivered: s2.deliveredIds.includes(bgId),
    willPresentDelta: s2.willPresentCount - s1.willPresentCount,
  };
  const checks = {
    delegate: s2.delegateInstalled,
    foregroundBanner:
      act.appIsActive === true &&
      s1.deliveredIds.includes(fgId) &&
      s1.lastPresentedId === fgId,
    backgroundBanner:
      deact.appIsActive === false && s2.deliveredIds.includes(bgId),
    alertStyleBanner: s2.alertStyle !== 'none',
  };
  r.checks = checks;
  r.pass = Object.values(checks).every(Boolean);
  await sleep(3000);
  notificationsDebug.clear('flb-');
  return r;
}

async function requestNotificationPermission(): Promise<unknown> {
  const before = await notificationsDebug.status();
  const result = await withTimeout<string>(
    notifications.requestPermission(),
    10_000,
    'timeout (prompt still open?)',
  );
  const after = await notificationsDebug.status();
  return { before: before.authorization, result, after: after.authorization };
}

/* ------------------------------------------------------------------ Sprint 2: sound */

type Row = [number, number, number]; // [tMs, rms, maxSampleStep]
const rowsOf = (m: SoundMeter, key: string): Row[] => m.rows?.[key] ?? [];
function avgRms(rows: Row[], from: number, to: number): number {
  const sel = rows.filter(x => x[0] >= from && x[0] <= to);
  return sel.length ? sel.reduce((a, x) => a + x[1], 0) / sel.length : 0;
}
/** ms after `start` until the envelope first crosses `level` (upwards if rising, downwards otherwise). */
function crossMs(
  rows: Row[],
  start: number,
  level: number,
  rising: boolean,
): number {
  const hit = rows.find(
    x => x[0] >= start && (rising ? x[1] >= level : x[1] <= level),
  );
  return hit ? Math.round(hit[0] - start) : -1;
}
function maxRelStep(
  rows: Row[],
  from: number,
  to: number,
  ref: number,
): number {
  const sel = rows.filter(x => x[0] >= from && x[0] <= to);
  let m = 0;
  for (let i = 1; i < sel.length; i++)
    m = Math.max(m, Math.abs(sel[i][1] - sel[i - 1][1]));
  return ref > 0 ? Math.round((m / ref) * 100) / 100 : 0;
}
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

async function runSoundChecks(): Promise<Record<string, unknown>> {
  if (!soundDebug.available())
    return { pass: false, error: 'FLSound native module missing' };
  const r: Record<string, unknown> = {};
  const checks: Record<string, boolean> = {};
  soundDebug.setMuted(true); // speakers silent; voices still run and are metered through taps
  try {
    sound.setVolume(0.5);
    sound.duck(1, 0);
    await sound.play('off', 0);
    await sleep(150);

    // 1. white → pink → brown → off, 400 ms crossfades
    const order: SoundId[] = ['white', 'pink', 'brown', 'off'];
    const meterP = soundDebug.meter(4300);
    const t0 = Date.now();
    const marks: number[] = [];
    for (const id of order) {
      await sleep(
        id === 'white' ? 200 : 1000 - ((Date.now() - t0 - 200) % 1000),
      );
      marks.push(Date.now() - t0);
      await sound.play(id, 400);
    }
    const m = await meterP;
    const noises: Record<string, unknown> = {};
    let allPlay = true;
    let allFade = true;
    let allSmooth = true;
    for (let i = 0; i < 3; i++) {
      const key = order[i];
      const rows = rowsOf(m, key);
      const start = marks[i];
      const end = marks[i + 1];
      const plateau = avgRms(rows, start + 550, end - 30);
      const fadeIn = crossMs(rows, start, plateau * 0.9, true);
      const fadeOut = crossMs(rows, end, plateau * 0.1, false);
      const step = maxRelStep(rows, start - 100, end + 700, plateau);
      noises[key] = {
        plateauRms: round4(plateau),
        fadeInMs: fadeIn,
        fadeOutMs: fadeOut,
        maxStepRel: step,
        rows: rows.length,
      };
      allPlay = allPlay && plateau > 0.01;
      allFade =
        allFade &&
        fadeIn >= 150 &&
        fadeIn <= 750 &&
        fadeOut >= 150 &&
        fadeOut <= 750;
      // ~100 ms meter rows: a 400 ms fade alone moves ~0.3-0.45 per row; a pop would be ~1.0.
      allSmooth = allSmooth && step < 0.7;
    }
    const afterFades = await soundDebug.state();
    r.noises = noises;
    r.marksMs = marks;
    r.maxGainStepRel = afterFades.maxGainStepRel;
    checks.noisesPlay = allPlay;
    checks.crossfade400 = allFade;
    // No pops: every 400 ms fade moves in small steps (≤ 12 % of its span per ~16 ms tick), and the
    // metered envelope never jumps by more than a fade step.
    checks.noPops = allSmooth && afterFades.maxGainStepRel <= 0.12;

    // 2. Keeps playing in the background
    const deact = await panelDebug.deactivateApp();
    await sound.play('brown', 300);
    await sleep(700);
    const bg = await soundDebug.meter(600);
    const st = await soundDebug.state();
    const bgRms = avgRms(rowsOf(bg, 'brown'), 0, 600);
    r.background = {
      appIsActive: deact.appIsActive,
      engineRunning: st.engineRunning,
      brownRms: round4(bgRms),
    };
    checks.background =
      deact.appIsActive === false && st.engineRunning && bgRms > 0.01;

    // 3. duck(0.3) / duck(1)
    const duckP = soundDebug.meter(2100);
    const d0 = Date.now();
    await sleep(300);
    const duckAt = Date.now() - d0;
    sound.duck(0.3, 400);
    await sleep(800);
    const restoreAt = Date.now() - d0;
    sound.duck(1, 400);
    const dm = await duckP;
    const drows = rowsOf(dm, 'brown');
    const base = avgRms(drows, 0, duckAt - 20);
    const ducked = avgRms(drows, duckAt + 500, restoreAt - 20);
    const restored = avgRms(drows, restoreAt + 550, 2100);
    r.duck = {
      base: round4(base),
      ducked: round4(ducked),
      restored: round4(restored),
      ratio: round4(ducked / base),
      restoredRatio: round4(restored / base),
    };
    checks.duck =
      base > 0.01 &&
      ducked / base > 0.2 &&
      ducked / base < 0.42 &&
      restored / base > 0.8 &&
      restored / base < 1.25;

    // 4. Chimes (noise off so the chime player is isolated)
    await sound.play('off', 200);
    await sleep(400);
    const chimeP = soundDebug.meter(3000);
    const c0 = Date.now();
    const kinds: ChimeKind[] = ['soft', 'phase', 'back'];
    const chimeMarks: number[] = [];
    for (const k of kinds) {
      await sleep(k === 'soft' ? 100 : 950 - ((Date.now() - c0 - 100) % 950));
      chimeMarks.push(Date.now() - c0);
      sound.chime(k);
    }
    const cm = await chimeP;
    const crow = rowsOf(cm, 'chime');
    const bursts: {
      startMs: number;
      endMs: number;
      peakRms: number;
      maxStep: number;
    }[] = [];
    let cur: {
      startMs: number;
      endMs: number;
      peakRms: number;
      maxStep: number;
    } | null = null;
    for (const [t, rms, step] of crow) {
      if (rms > 0.005) {
        if (!cur) cur = { startMs: t, endMs: t, peakRms: rms, maxStep: step };
        cur.endMs = t;
        cur.peakRms = Math.max(cur.peakRms, rms);
        cur.maxStep = Math.max(cur.maxStep, step);
      } else if (cur) {
        bursts.push(cur);
        cur = null;
      }
    }
    if (cur) bursts.push(cur);
    r.chimes = {
      marksMs: chimeMarks,
      bursts: bursts.map(b => ({
        ...b,
        peakRms: round4(b.peakRms),
        maxStep: round4(b.maxStep),
      })),
    };
    checks.chimes =
      bursts.length === 3 &&
      bursts.every(b => b.peakRms > 0.02 && b.maxStep < 0.12);

    // 5. 'off' fades out and the engine idles
    await sleep(1200);
    const idle = await soundDebug.state();
    r.idle = {
      currentId: idle.currentId,
      engineRunning: idle.engineRunning,
      gains: idle.gains,
    };
    checks.offIdles = idle.currentId === 'off' && idle.engineRunning === false;

    // 6. rain/cafe fall back to brown noise (no bundled loops)
    await sound.play('rain', 0);
    await sleep(100);
    const rain = await soundDebug.state();
    await sound.play('off', 0);
    r.rain = { voice: rain.voice, loops: rain.loops };
    checks.rainFallback = rain.loops.includes('rain')
      ? rain.voice === 'rain'
      : rain.voice === 'brown';
  } catch (e) {
    r.error = String(e);
  } finally {
    await sound.play('off', 0).catch(() => undefined);
    sound.duck(1, 0);
    await sleep(500);
    soundDebug.setMuted(false);
  }
  r.checks = checks;
  r.pass = !r.error && Object.values(checks).every(Boolean);
  return r;
}

/* ------------------------------------------------------------------ Sprint 2: app shell */

async function runShellChecks(): Promise<Record<string, unknown>> {
  if (!appShellDebug.available())
    return { pass: false, error: 'FLAppShell native module missing' };
  ensureListeners();
  const r: Record<string, unknown> = {};
  const checks: Record<string, boolean> = {};
  try {
    const info = await appShellDebug.info();
    r.menu = info.menu;
    checks.menuInstalled =
      info.menu.length === 3 &&
      info.menu.every(i => i.cmdModifier && i.enabled) &&
      info.menu.map(i => i.key).join(',') === 'k,return,.';

    // ⌘K / ⌘↩ / ⌘. with the main window focused
    const act = await panelDebug.activateApp();
    await sleep(200);
    const keys: { key: 'k' | 'return' | 'period'; expect: MenuCommand }[] = [
      { key: 'k', expect: 'commandPalette' },
      { key: 'return', expect: 'startSession' },
      { key: 'period', expect: 'endSession' },
    ];
    const got: Record<string, unknown> = {};
    let allKeys = true;
    for (const k of keys) {
      const before = eventLog.length;
      const res = await appShellDebug.key(k.key);
      await sleep(300);
      const ev = eventLog
        .slice(before)
        .filter(e => e.kind === 'menu')
        .map(e => e.body);
      const ok = ev.length === 1 && ev[0] === k.expect;
      allKeys = allKeys && ok;
      got[k.key] = { ok, events: ev, mainWindowWasKey: res.mainWindowWasKey };
    }
    r.keys = { appWasActive: act.appIsActive, results: got };
    checks.menuShortcuts = act.appIsActive === true && allKeys;

    // App Nap activity token
    appShell.beginSessionActivity();
    appShell.beginSessionActivity(); // idempotent
    await sleep(100);
    const on = await appShellDebug.info();
    appShell.endSessionActivity();
    await sleep(100);
    const off = await appShellDebug.info();
    r.activity = { on: on.activityActive, off: off.activityActive };
    checks.activityToken =
      on.activityActive === true && off.activityActive === false;

    // bringToFront from the background
    await panelDebug.deactivateApp();
    appShell.bringToFront();
    await sleep(700);
    const front = await appShellDebug.info();
    r.bringToFront = {
      appIsActive: front.appIsActive,
      mainWindowKey: front.mainWindowKey,
    };
    checks.bringToFront = front.appIsActive && front.mainWindowKey;
  } catch (e) {
    r.error = String(e);
  } finally {
    // Hand focus back to whatever the human was using.
    await panelDebug.deactivateApp().catch(() => undefined);
  }
  r.checks = checks;
  r.pass = !r.error && Object.values(checks).every(Boolean);
  return r;
}

/* ------------------------------------------------------------------ Sprint 2: App Nap drift */

type DriftMode = 'activity' | 'control' | 'foreground';
interface DriftRun {
  mode: DriftMode;
  durationS: number;
  t0: number;
  ticks: number[];
  handle: ReturnType<typeof setInterval> | null;
  result: Record<string, unknown> | null;
}
let drift: DriftRun | null = null;
const driftHistory: Record<string, unknown>[] = [];

async function finishDrift(d: DriftRun) {
  const lateness = d.ticks.map((t, i) => t - (d.t0 + (i + 1) * 1000));
  const gaps = d.ticks.map((t, i) => t - (i === 0 ? d.t0 : d.ticks[i - 1]));
  const info = await appShellDebug.info();
  if (d.mode === 'activity') appShell.endSessionActivity();
  const unhide =
    d.mode === 'foreground'
      ? { appIsHidden: false }
      : await appShellDebug.setHidden(false);
  const expectedTicks = d.durationS;
  const maxGap = Math.max(...gaps);
  const avgGap = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  const endDrift = lateness[lateness.length - 1] ?? 0;
  const baseline = driftHistory.find(h => h.mode === 'foreground') as
    | { avgGapMs: number }
    | undefined;
  // "On time" = not throttled by App Nap: no tick more than 1.5 s after the previous one and an average
  // period under 1.1 s. (RN re-arms repeating timers from the fire time and its display link slows while
  // the window is hidden, so a hidden app slips ~50 ms/tick even without App Nap; see baselineAvgGapMs.)
  const avgLimit = 1100;
  d.result = {
    mode: d.mode,
    durationS: d.durationS,
    ticks: d.ticks.length,
    expectedTicks,
    maxGapMs: maxGap,
    minGapMs: Math.min(...gaps),
    avgGapMs: Math.round(avgGap),
    avgGapLimitMs: avgLimit,
    baselineAvgGapMs: baseline ? baseline.avgGapMs : null,
    gapsOver1100: gaps.filter(g => g > 1100).length,
    gapsOver2000: gaps.filter(g => g > 2000).length,
    endDriftMs: endDrift,
    activityWasActive: info.activityActive,
    appWasHidden: info.appIsHidden,
    unhidden: !unhide.appIsHidden,
    pass: maxGap < 1500 && avgGap <= avgLimit,
  };
  driftHistory.push(d.result);
  pushLog('info', { drift: d.result });
}

/**
 * 'activity': beginSessionActivity + LarpLess hidden (background) — the acceptance run.
 * 'control': same without the activity (shows what App Nap does). 'foreground': visible app, RN baseline.
 */
async function driftStart(
  mode: DriftMode = 'activity',
  durationS = 120,
): Promise<unknown> {
  if (drift && !drift.result)
    return { error: 'a drift run is already in progress', mode: drift.mode };
  if (mode === 'activity') appShell.beginSessionActivity();
  await panel.hide();
  const hidden =
    mode === 'foreground' ? null : await appShellDebug.setHidden(true);
  const d: DriftRun = {
    mode,
    durationS,
    t0: Date.now(),
    ticks: [],
    handle: null,
    result: null,
  };
  d.handle = setInterval(() => {
    const now = Date.now();
    d.ticks.push(now);
    if (now - d.t0 >= durationS * 1000 - 50) {
      if (d.handle) clearInterval(d.handle);
      d.handle = null;
      finishDrift(d).catch(e => {
        d.result = { error: String(e) };
      });
    }
  }, 1000);
  drift = d;
  return {
    started: true,
    mode,
    durationS,
    hidden,
    note: `call __FL.harness.BdriftCheck() after ${durationS} s`,
  };
}

async function driftCheck(): Promise<unknown> {
  if (!drift)
    return {
      error: 'no drift run (call BdriftStart / BdriftControlStart)',
      history: driftHistory,
    };
  if (!drift.result)
    return {
      running: true,
      mode: drift.mode,
      elapsedS: Math.round((Date.now() - drift.t0) / 1000),
      ticks: drift.ticks.length,
    };
  return { ...drift.result, history: driftHistory };
}

/* ------------------------------------------------------------------ registration */

const summarize = (x: Record<string, unknown>) => ({
  pass: x.pass,
  checks: x.checks,
  error: x.error,
  blocked: x.blocked,
});

/** Everything quick (~35 s). Leaves the panel hidden, sound off and focus handed back. */
async function runAll(): Promise<Record<string, unknown>> {
  const panelR = await runPanelChecks();
  const notifR = await runNotificationChecks();
  const soundR = await runSoundChecks();
  const shellR = await runShellChecks();
  return {
    pass: [panelR, notifR, soundR, shellR].every(x => x.pass === true),
    panel: summarize(panelR),
    notifications: summarize(notifR),
    sound: summarize(soundR),
    shell: summarize(shellR),
    drift: driftHistory,
  };
}

registerHarness('B', runAll);
registerHarness('Bpanel', runPanelChecks);
registerHarness('Bnotif', runNotificationChecks);
registerHarness('BnotifRequest', requestNotificationPermission);
registerHarness('BtimerStart', timerStart);
registerHarness('BtimerCheck', timerCheck);
registerHarness('Bsound', runSoundChecks);
registerHarness('Bshell', runShellChecks);
registerHarness('BdriftStart', () => driftStart('activity', 120));
registerHarness('BdriftControlStart', () => driftStart('control', 120));
registerHarness('BdriftBaselineStart', () => driftStart('foreground', 30));
registerHarness('BdriftCheck', driftCheck);

if (__DEV__) {
  (globalThis as Record<string, unknown>).__FLB = {
    panel,
    panelDebug,
    notifications,
    notificationsDebug,
    sound,
    soundDebug,
    appShell,
    appShellDebug,
    eventLog,
    demoState,
    ensureListeners,
    driftStart,
    driftCheck,
  };
}

/* ------------------------------------------------------------------ UI */

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const SOUND_IDS: SoundId[] = ['off', 'white', 'pink', 'brown', 'rain', 'cafe'];
const CHIMES: ChimeKind[] = ['soft', 'phase', 'back'];

export function HarnessB() {
  const [, setTick] = useState(0);
  const [demoIndex, setDemoIndex] = useState(0);
  const [status, setStatus] = useState('');
  const [vol, setVol] = useState(0.5);

  useEffect(() => {
    ensureListeners();
    const f = () => setTick(t => t + 1);
    logSubscribers.add(f);
    return () => {
      logSubscribers.delete(f);
    };
  }, []);

  const run = useCallback(
    (label: string, p: () => Promise<unknown> | unknown) => {
      setStatus(`${label}…`);
      Promise.resolve()
        .then(p)
        .then(v =>
          setStatus(
            `${label}: ${
              v === undefined ? 'ok' : JSON.stringify(v).slice(0, 300)
            }`,
          ),
        )
        .catch(e => setStatus(`${label}: error ${String(e)}`));
    },
    [],
  );

  const changeVolume = (delta: number) => {
    const nv = Math.round(Math.min(1, Math.max(0, vol + delta)) * 10) / 10;
    setVol(nv);
    sound.setVolume(nv);
  };

  const cycle = () => {
    const name = DEMO_ORDER[demoIndex % DEMO_ORDER.length];
    setDemoIndex(i => i + 1);
    run(`state ${name}`, () => panel.update(demoState(name)));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Harness B (WS-B · native shell)</Text>
      <Text style={styles.small}>
        Real Swift modules, independent of USE_MOCK_NATIVE. {status}
      </Text>

      <Text style={styles.h2}>Floating panel</Text>
      <View style={styles.row}>
        <Btn label="Show" onPress={() => run('show', () => panel.show())} />
        <Btn label="Hide" onPress={() => run('hide', () => panel.hide())} />
        <Btn
          label={`Cycle state (next: ${
            DEMO_ORDER[demoIndex % DEMO_ORDER.length]
          })`}
          onPress={cycle}
        />
        <Btn
          label="Flash back on track"
          onPress={() =>
            run('flash', async () => {
              panel.update(demoState('studying', Date.now(), { flash: null }));
              await sleep(50);
              panel.update(
                demoState('studying', Date.now(), { flash: 'backOnTrack' }),
              );
            })
          }
        />
        <Btn
          label="Panel info"
          onPress={() => run('info', () => panelDebug.info())}
        />
      </View>

      <Text style={styles.h2}>Notifications</Text>
      <View style={styles.row}>
        <Btn
          label="Request permission"
          onPress={() =>
            run('permission', () => notifications.requestPermission())
          }
        />
        <Btn
          label="Post now"
          onPress={() =>
            run('post', () =>
              notifications.post({
                id: `flb-ui-${Date.now()}`,
                title: 'LarpLess',
                body: "You've been on Instagram for 2 min",
                sound: true,
              }),
            )
          }
        />
        <Btn
          label="Post in 5 s (switch apps)"
          onPress={() =>
            run('post in 5 s', async () => {
              await sleep(5000);
              await notifications.post({
                id: `flb-ui-${Date.now()}`,
                title: 'LarpLess',
                body: 'Back to Biology?',
                sound: true,
              });
            })
          }
        />
        <Btn
          label="Status"
          onPress={() => run('status', () => notificationsDebug.status())}
        />
      </View>

      <Text style={styles.h2}>Sound (audible)</Text>
      <View style={styles.row}>
        {SOUND_IDS.map(id => (
          <Btn
            key={id}
            label={id}
            onPress={() => run(`play ${id}`, () => sound.play(id))}
          />
        ))}
      </View>
      <View style={styles.row}>
        <Btn
          label={`Volume − (${vol.toFixed(1)})`}
          onPress={() => changeVolume(-0.1)}
        />
        <Btn label="Volume +" onPress={() => changeVolume(0.1)} />
        <Btn
          label="Duck 0.3"
          onPress={() => run('duck 0.3', () => sound.duck(0.3))}
        />
        <Btn
          label="Duck 1"
          onPress={() => run('duck 1', () => sound.duck(1))}
        />
        {CHIMES.map(k => (
          <Btn
            key={k}
            label={`Chime ${k}`}
            onPress={() => run(`chime ${k}`, () => sound.chime(k))}
          />
        ))}
        <Btn
          label="Sound state"
          onPress={() => run('sound state', () => soundDebug.state())}
        />
      </View>

      <Text style={styles.h2}>App shell</Text>
      <Text style={styles.small}>
        Menu: Session › Command Palette ⌘K · Start Session ⌘↩ · End Session ⌘.
        (events are logged below)
      </Text>
      <View style={styles.row}>
        <Btn
          label="Begin session activity"
          onPress={() =>
            run('begin activity', () => appShell.beginSessionActivity())
          }
        />
        <Btn
          label="End session activity"
          onPress={() =>
            run('end activity', () => appShell.endSessionActivity())
          }
        />
        <Btn
          label="Bring to front in 3 s"
          onPress={() =>
            run('bring to front', async () => {
              await sleep(3000);
              appShell.bringToFront();
            })
          }
        />
        <Btn
          label="Shell info"
          onPress={() => run('shell info', () => appShellDebug.info())}
        />
      </View>
      <View style={styles.row}>
        <Btn
          label="Drift 30 s foreground (baseline)"
          onPress={() => run('drift', () => driftStart('foreground', 30))}
        />
        <Btn
          label="Drift 2 min hidden + activity"
          onPress={() => run('drift', () => driftStart('activity', 120))}
        />
        <Btn
          label="Drift 2 min hidden, no activity"
          onPress={() => run('drift', () => driftStart('control', 120))}
        />
        <Btn label="Drift result" onPress={() => run('drift', driftCheck)} />
      </View>
      {driftHistory.map((h, i) => (
        <Text key={`drift-${i}`} style={styles.mono}>
          drift {String(h.mode)}: ticks {String(h.ticks)}/
          {String(h.expectedTicks)} · avg gap {String(h.avgGapMs)} ms · max gap{' '}
          {String(h.maxGapMs)} ms · end drift {String(h.endDriftMs)} ms ·{' '}
          {h.pass ? 'PASS' : 'FAIL'}
        </Text>
      ))}

      <Text style={styles.h2}>Automated</Text>
      <View style={styles.row}>
        <Btn label="Run all (B)" onPress={() => run('B', runAll)} />
      </View>

      <Text style={styles.h2}>Events ({eventLog.length})</Text>
      {eventLog
        .slice(-25)
        .reverse()
        .map((e, i) => (
          <Text key={`${e.t}-${i}`} style={styles.mono}>
            {new Date(e.t).toLocaleTimeString()} {e.kind}{' '}
            {JSON.stringify(e.body)}
          </Text>
        ))}
    </ScrollView>
  );
}

export default HarnessB;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24 },
  title: { fontSize: 18, fontWeight: '600', color: 'black' },
  h2: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 6,
    color: 'black',
  },
  small: { fontSize: 12, color: 'dimgray', marginTop: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: 'whitesmoke',
    marginRight: 6,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'lightgray',
  },
  btnPressed: { opacity: 0.6 },
  btnText: { fontSize: 12, color: 'black' },
  mono: { fontFamily: 'Menlo', fontSize: 11, color: 'dimgray' },
});
