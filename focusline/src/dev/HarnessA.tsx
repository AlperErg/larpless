/**
 * WS-A dev harness: native capture (permissions, active window, screenshot, webcam).
 *
 * Calls the REAL facades (src/native/{screen,permissions,webcam}) directly, regardless of
 * config.USE_MOCK_NATIVE, so it always exercises the Swift modules.
 *
 * Headless runners (node scripts/js-eval.mjs 8082 "__FL.harness['A.xxx']()"):
 *   A                 full suite (status, active window timing, capture if granted, short webcam run if granted)
 *   A.perm            permission status
 *   A.window10        active window ×10 over 10 s
 *   A.capture         3 captures (cold + warm timings)
 *   A.webcam          webcam 8 s run summary
 *   A.webcamCycle     5× start/stop
 *   A.webcamWatch     20 s per-sample timeline (for "leave the frame" / "hold a phone up" checks)
 *   A.photo           capturePhoto() with the camera idle and with the 1 fps session running (sizes only)
 *
 * PRIVACY: results contain sizes, counts and timings only, never image data.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, NativeModules, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { config } from '../config';
import type {
  ActiveWindow,
  PermissionKind,
  ScreenSnapshot,
  Unsubscribe,
  WebcamSample,
} from '../contracts/native';
import { permissions } from '../native/permissions';
import { screen } from '../native/screen';
import { webcam } from '../native/webcam';
import { registerHarness } from './devGlobals';

/* ---------------------------------------------------------------- helpers */

const nowMs = (): number => {
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return p?.now ? p.now() : Date.now();
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const r1 = (n: number) => Math.round(n * 10) / 10;
const clip = (s: string | null, n = 80): string | null =>
  s == null ? null : s.length > n ? `${s.slice(0, n)}…` : s;
const errInfo = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return { code: x?.code ?? 'E_UNKNOWN', message: x?.message ?? String(e) };
};

function modulesPresent() {
  return {
    FLPermissions: !!NativeModules.FLPermissions,
    FLScreenCapture: !!NativeModules.FLScreenCapture,
    FLWebcam: !!NativeModules.FLWebcam,
  };
}

function describeWindow(w: ActiveWindow) {
  return { appName: w.appName, bundleId: w.bundleId, title: clip(w.windowTitle), isSelf: w.isSelf };
}

/* ---------------------------------------------------------------- checks */

async function permStatus() {
  if (!NativeModules.FLPermissions) return { error: 'FLPermissions missing' };
  return permissions.status();
}

async function activeWindowSeries(count: number, intervalMs: number) {
  const samples: Array<ReturnType<typeof describeWindow> & { ms: number }> = [];
  for (let i = 0; i < count; i++) {
    const t0 = nowMs();
    const w = await screen.getActiveWindow();
    samples.push({ ms: r1(nowMs() - t0), ...describeWindow(w) });
    if (i < count - 1) await sleep(intervalMs);
  }
  const ms = samples.map((s) => s.ms);
  return {
    count,
    jsRoundTripMs: { avg: r1(ms.reduce((a, b) => a + b, 0) / ms.length), max: Math.max(...ms) },
    samples,
  };
}

async function activeWindowTiming() {
  const series = await activeWindowSeries(10, 0);
  const native = await NativeModules.FLScreenCapture.benchActiveWindow(50);
  return {
    sample: series.samples[0],
    jsRoundTripMs: series.jsRoundTripMs,
    nativeMs: { avg: r1(native.avgMs), max: r1(native.maxMs), runs: native.runs },
  };
}

interface CaptureReport {
  ok: boolean;
  ms: number;
  width?: number;
  height?: number;
  base64Len?: number;
  approxKB?: number;
  appName?: string | null;
  isSelf?: boolean;
  code?: string;
  message?: string;
}

/** One capture; `keep` receives the snapshot for on-screen preview (UI only, never for runners). */
async function captureOnce(keep?: (s: ScreenSnapshot) => void): Promise<CaptureReport> {
  const t0 = nowMs();
  let snap: ScreenSnapshot | null = null;
  try {
    snap = await screen.capture(config.CAPTURE);
    const report: CaptureReport = {
      ok: true,
      ms: r1(nowMs() - t0),
      width: snap.width,
      height: snap.height,
      base64Len: snap.jpegBase64.length,
      approxKB: Math.round((snap.jpegBase64.length * 3) / 4 / 1024),
      appName: snap.appName,
      isSelf: snap.isSelf,
    };
    keep?.(snap);
    return report;
  } catch (e) {
    return { ok: false, ms: r1(nowMs() - t0), ...errInfo(e) };
  } finally {
    snap = null;
  }
}

async function captureSeries(n: number) {
  const runs: CaptureReport[] = [];
  for (let i = 0; i < n; i++) {
    runs.push(await captureOnce());
    if (!runs[i].ok) break;
  }
  const warm = runs.slice(1).filter((x) => x.ok).map((x) => x.ms);
  return {
    runs,
    coldMs: runs[0]?.ms ?? null,
    warmAvgMs: warm.length ? r1(warm.reduce((a, b) => a + b, 0) / warm.length) : null,
  };
}

function summariseSamples(samples: WebcamSample[], durationS: number) {
  const n = samples.length;
  const gaps = samples.slice(1).map((s, i) => s.t - samples[i].t);
  return {
    samples: n,
    perSec: r1(n / Math.max(0.001, durationS)),
    meanGapMs: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    presentCount: samples.filter((s) => s.personPresent).length,
    phoneCount: samples.filter((s) => s.phoneVisible).length,
    maxPhoneScore: n ? Math.round(Math.max(...samples.map((s) => s.phoneScore)) * 1000) / 1000 : 0,
    last: n ? samples[n - 1] : null,
  };
}

async function webcamRun(seconds: number) {
  if (!NativeModules.FLWebcam) return { ok: false, error: 'FLWebcam missing' };
  const samples: WebcamSample[] = [];
  let unsub: Unsubscribe | null = null;
  const t0 = nowMs();
  let startMs = 0;
  try {
    unsub = webcam.onSample((s) => samples.push(s));
    await webcam.start({ fps: config.WEBCAM_FPS });
    startMs = r1(nowMs() - t0);
    await sleep(seconds * 1000);
  } catch (e) {
    return { ok: false, ...errInfo(e) };
  } finally {
    unsub?.();
    await webcam.stop().catch(() => undefined);
  }
  return { ok: true, startMs, seconds, ...summariseSamples(samples, seconds) };
}

/**
 * Per-sample timeline for human-in-the-loop checks (step out of frame / hold a phone up while it runs).
 * One char per sample: P present, F present + phone, . absent, f absent + phone.
 */
async function webcamWatch(seconds: number) {
  if (!NativeModules.FLWebcam) return { ok: false, error: 'FLWebcam missing' };
  const samples: WebcamSample[] = [];
  let unsub: Unsubscribe | null = null;
  try {
    unsub = webcam.onSample((s) => samples.push(s));
    await webcam.start({ fps: config.WEBCAM_FPS });
    await sleep(seconds * 1000);
  } catch (e) {
    return { ok: false, ...errInfo(e) };
  } finally {
    unsub?.();
    await webcam.stop().catch(() => undefined);
  }
  const t0 = samples[0]?.t ?? 0;
  const timeline = samples
    .map((s) => (s.personPresent ? (s.phoneVisible ? 'F' : 'P') : s.phoneVisible ? 'f' : '.'))
    .join('');
  const changes = samples
    .map((s, i) => ({ s, prev: samples[i - 1] }))
    .filter(({ s, prev }) => !prev || prev.personPresent !== s.personPresent || prev.phoneVisible !== s.phoneVisible)
    .map(({ s }) => ({
      atS: r1((s.t - t0) / 1000),
      present: s.personPresent,
      phone: s.phoneVisible,
      score: Math.round(s.phoneScore * 100) / 100,
    }));
  return { ok: true, seconds, timeline, changes, ...summariseSamples(samples, seconds), last: undefined };
}

/** Phase 2 live photo: sizes and timing only. `withSession` runs it while the 1 fps session is active. */
async function photoOnce(withSession: boolean) {
  if (!NativeModules.FLWebcam) return { ok: false, error: 'FLWebcam missing' };
  let photo: { jpegBase64: string; width: number; height: number } | null = null;
  let samplesAfter = 0;
  const unsub = webcam.onSample(() => {
    samplesAfter++;
  });
  const t0 = nowMs();
  try {
    if (withSession) {
      await webcam.start({ fps: config.WEBCAM_FPS });
      await sleep(1500);
    }
    const t1 = nowMs();
    photo = await webcam.capturePhoto();
    const ms = r1(nowMs() - t1);
    samplesAfter = 0;
    if (withSession) await sleep(2500); // analysis must resume after the photo
    return {
      ok: true,
      withSession,
      ms,
      totalMs: r1(nowMs() - t0),
      width: photo.width,
      height: photo.height,
      base64Len: photo.jpegBase64.length,
      samplesAfterPhoto: withSession ? samplesAfter : null,
    };
  } catch (e) {
    return { ok: false, withSession, ...errInfo(e) };
  } finally {
    photo = null;
    unsub();
    if (withSession) await webcam.stop().catch(() => undefined);
  }
}

async function webcamCycle(times: number) {
  if (!NativeModules.FLWebcam) return { ok: false, error: 'FLWebcam missing' };
  let events = 0;
  const errors: Array<{ i: number; code: string }> = [];
  const unsub = webcam.onSample(() => {
    events++;
  });
  try {
    for (let i = 0; i < times; i++) {
      try {
        await webcam.start({ fps: config.WEBCAM_FPS });
        await sleep(1500);
        await webcam.stop();
        await sleep(300);
      } catch (e) {
        errors.push({ i, code: errInfo(e).code });
      }
    }
    // Double stop and stop-before-start must be harmless.
    await webcam.stop();
    await webcam.stop();
  } finally {
    unsub();
  }
  return { ok: errors.length === 0, cycles: times, events, errors };
}

async function runAll() {
  const out: Record<string, unknown> = {
    useMockNative: config.USE_MOCK_NATIVE,
    modules: modulesPresent(),
  };
  const perm = (await permStatus()) as Record<PermissionKind, string> | { error: string };
  out.permissions = perm;
  if (NativeModules.FLScreenCapture) {
    out.activeWindow = await activeWindowTiming();
    const screenGranted = 'screen' in perm && perm.screen === 'granted';
    out.capture = screenGranted ? await captureSeries(3) : { skipped: 'blocked: permission (screen)' };
  }
  const camGranted = 'camera' in perm && perm.camera === 'granted';
  out.webcam = camGranted ? await webcamRun(5) : { skipped: 'blocked: permission (camera)' };
  return out;
}

registerHarness('A', runAll);
registerHarness('A.perm', permStatus);
registerHarness('A.window10', () => activeWindowSeries(10, 1000));
registerHarness('A.capture', () => captureSeries(3));
registerHarness('A.webcam', () => webcamRun(8));
registerHarness('A.webcamCycle', () => webcamCycle(5));
registerHarness('A.webcamWatch', () => webcamWatch(20));
registerHarness('A.photo', async () => ({ idle: await photoOnce(false), running: await photoOnce(true) }));

/* ---------------------------------------------------------------- UI */

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.buttonPressed]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function HarnessA() {
  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState<string>('—');
  const [preview, setPreview] = useState<string | null>(null);
  const [live, setLive] = useState<{ last: WebcamSample | null; perSec: number } | null>(null);
  const liveUnsub = useRef<Unsubscribe | null>(null);
  const liveTimes = useRef<number[]>([]);

  const run = useCallback(async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    try {
      const res = await fn();
      setOutput(`${name}\n${JSON.stringify(res, null, 2)}`);
    } catch (e) {
      setOutput(`${name}\nERROR ${JSON.stringify(errInfo(e))}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const onCapture = useCallback(() => {
    setPreview(null); // clear the previous image straight away
    run('capture', async () => {
      let uri: string | null = null;
      const report = await captureOnce((s) => {
        uri = `data:image/jpeg;base64,${s.jpegBase64}`;
      });
      setPreview(uri);
      uri = null;
      return report;
    });
  }, [run]);

  const stopLive = useCallback(async () => {
    liveUnsub.current?.();
    liveUnsub.current = null;
    liveTimes.current = [];
    await webcam.stop().catch(() => undefined);
    setLive(null);
  }, []);

  const startLive = useCallback(async () => {
    if (liveUnsub.current) return;
    liveUnsub.current = webcam.onSample((s) => {
      const t = Date.now();
      liveTimes.current = [...liveTimes.current.filter((x) => t - x < 5000), t];
      setLive({ last: s, perSec: r1(liveTimes.current.length / 5) });
    });
    try {
      await webcam.start({ fps: config.WEBCAM_FPS });
      setLive({ last: null, perSec: 0 });
      setOutput('webcam started');
    } catch (e) {
      setOutput(`webcam start\nERROR ${JSON.stringify(errInfo(e))}`);
      liveUnsub.current?.();
      liveUnsub.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      liveUnsub.current?.();
      liveUnsub.current = null;
    },
    [],
  );

  const mods = modulesPresent();
  const disabled = busy !== null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Harness A: native capture</Text>
      {config.USE_MOCK_NATIVE && (
        <Text style={styles.warn}>
          config.USE_MOCK_NATIVE is true: the app uses mocks, but this harness calls the real Swift modules.
        </Text>
      )}
      <Text style={styles.line}>
        Modules: FLPermissions {mods.FLPermissions ? 'ok' : 'MISSING'} · FLScreenCapture{' '}
        {mods.FLScreenCapture ? 'ok' : 'MISSING'} · FLWebcam {mods.FLWebcam ? 'ok' : 'MISSING'}
      </Text>

      <Text style={styles.section}>Permissions</Text>
      <View style={styles.row}>
        <Button label="Status" disabled={disabled} onPress={() => run('permissions.status', permStatus)} />
        <Button label="Request screen" disabled={disabled} onPress={() => run('request screen', () => permissions.request('screen'))} />
        <Button label="Request camera" disabled={disabled} onPress={() => run('request camera', () => permissions.request('camera'))} />
        <Button label="Settings: screen" disabled={disabled} onPress={() => run('openSettings screen', () => permissions.openSettings('screen'))} />
        <Button label="Settings: camera" disabled={disabled} onPress={() => run('openSettings camera', () => permissions.openSettings('camera'))} />
        <Button label="Relaunch" disabled={disabled} onPress={() => run('relaunch', () => permissions.relaunch())} />
      </View>

      <Text style={styles.section}>Screen</Text>
      <View style={styles.row}>
        <Button label="Active window ×10 over 10 s" disabled={disabled} onPress={() => run('active window ×10', () => activeWindowSeries(10, 1000))} />
        <Button label="Capture" disabled={disabled} onPress={onCapture} />
      </View>
      {preview && <Image source={{ uri: preview }} style={styles.preview} resizeMode="contain" />}

      <Text style={styles.section}>Webcam</Text>
      <View style={styles.row}>
        <Button label={live ? 'Stop webcam' : 'Start webcam'} disabled={disabled} onPress={live ? stopLive : startLive} />
        <Button label="5× start/stop" disabled={disabled || !!live} onPress={() => run('webcam cycle', () => webcamCycle(5))} />
      </View>
      {live && (
        <Text style={styles.mono}>
          present: {live.last ? String(live.last.personPresent) : '—'} · phone:{' '}
          {live.last ? String(live.last.phoneVisible) : '—'} · score:{' '}
          {live.last ? live.last.phoneScore.toFixed(2) : '—'} · samples/s: {live.perSec}
        </Text>
      )}

      <Text style={styles.section}>Output {busy ? `(running ${busy}…)` : ''}</Text>
      <Text style={styles.mono} selectable>
        {output}
      </Text>
    </ScrollView>
  );
}

export default HarnessA;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24 },
  title: { fontSize: 18, fontWeight: '600', color: 'black', marginBottom: 8 },
  warn: { fontSize: 13, color: 'darkorange', marginBottom: 8 },
  section: { fontSize: 15, fontWeight: '600', color: 'black', marginTop: 16, marginBottom: 6 },
  line: { fontSize: 13, color: 'dimgray' },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  button: {
    marginRight: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: 'royalblue',
  },
  buttonPressed: { opacity: 0.6 },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 13 },
  preview: { width: 320, height: 200, marginTop: 8, backgroundColor: 'whitesmoke' },
  mono: { fontFamily: 'Menlo', fontSize: 12, color: 'black' },
});
