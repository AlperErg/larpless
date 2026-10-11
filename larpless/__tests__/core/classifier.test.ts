import type { ScreenVerdict } from '../../src/contracts/domain';
import type { ActiveWindow, ScreenSnapshot } from '../../src/contracts/native';
import { createClassifier, mockVerdictFromTitle, windowKey } from '../../src/core/classifier';
import type { ClassifierConfig } from '../../src/core/classifier';
import { fixtureModules } from '../../src/fixtures/data';
import { effectiveProfile, platformProfile } from '../../src/core/powerProfile';
import type { PowerSpec } from '../../src/core/powerProfile';

const CFG: ClassifierConfig = {
  USE_MOCK_CLASSIFIER: false,
  CACHE_TTL_MS: 120_000,
  CAPTURE: { maxWidth: 1280, jpegQuality: 0.7 },
};

const BIO_VERDICT: ScreenVerdict = { studying: true, moduleId: 'mod_biology', activity: 'Reading slides', confidence: 0.9, source: 'vlm' };

function setup(opts: { config?: Partial<ClassifierConfig>; verdict?: ScreenVerdict | null; getPower?: () => PowerSpec } = {}) {
  let win: ActiveWindow = { appName: 'Preview', bundleId: 'com.apple.Preview', windowTitle: 'BIO101 Lecture 4.pdf', isSelf: false };
  let t = 1_000_000;
  let holdWindows = 0;
  const windowReleasers: Array<(w: ActiveWindow) => void> = [];
  const capture = jest.fn(
    async (): Promise<ScreenSnapshot> => ({ ...win, jpegBase64: 'IMG', width: 1, height: 1, capturedAt: t }),
  );
  const classify = jest.fn(async () => (opts.verdict === undefined ? BIO_VERDICT : opts.verdict));
  const warmUp = jest.fn(async () => {});
  const unload = jest.fn(async () => {});
  const c = createClassifier({
    native: {
      screen: {
        getActiveWindow: () => {
          const snapshot = { ...win };
          if (holdWindows > 0) {
            holdWindows -= 1;
            return new Promise<ActiveWindow>((resolve) => {
              windowReleasers.push(() => resolve(snapshot));
            });
          }
          return Promise.resolve(snapshot);
        },
        capture,
      },
    },
    ollama: { classify, warmUp, unload },
    now: () => t,
    config: { ...CFG, ...opts.config },
    getPower: opts.getPower,
  });
  return {
    c,
    capture,
    classify,
    warmUp,
    unload,
    setWin: (w: Partial<ActiveWindow>) => {
      win = { ...win, ...w };
    },
    advance: (ms: number) => {
      t += ms;
    },
    holdWindow: () => {
      holdWindows += 1;
    },
    releaseWindow: () => {
      windowReleasers.shift()?.({ ...win });
    },
  };
}

const BIO_KEY = windowKey('Preview', 'BIO101 Lecture 4.pdf');
const tick = () => new Promise<void>((r) => setImmediate(() => r()));

describe('classifier', () => {
  it('VLM path: takes exactly one screenshot and returns the verdict', async () => {
    const s = setup();
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r).toMatchObject({ verdict: BIO_VERDICT, tookScreenshot: true, appName: 'Preview', key: BIO_KEY, fellBehind: false });
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(s.capture).toHaveBeenCalledWith(CFG.CAPTURE);
    expect(s.classify).toHaveBeenCalledTimes(1);
  });

  it('getPower chooses the screenshot size and the Ollama keep_alive', async () => {
    const captureOpts = { maxWidth: 768, jpegQuality: 0.5 };
    const s = setup({
      getPower: () => ({
        id: 'eco',
        chunkS: 30,
        liveSettleMs: 3_000,
        capture: captureOpts,
        cacheTtlMs: 180_000,
        keepAlive: '5m',
        classifyTimeoutMs: 30_000,
      }),
    });
    await s.c.classifyCurrent(fixtureModules);
    expect(s.capture).toHaveBeenCalledWith(captureOpts);
    expect(s.classify).toHaveBeenCalledWith(expect.anything(), fixtureModules, { timeoutMs: 30_000, keepAlive: '5m' });
  });

  it('rules path: no screenshot, rule verdict', async () => {
    const s = setup();
    s.setWin({ appName: 'Safari', windowTitle: 'Instagram' });
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r.tookScreenshot).toBe(false);
    expect(r.verdict).toEqual({ studying: false, moduleId: null, activity: 'Instagram', confidence: 1, source: 'rule' });
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.classify).not.toHaveBeenCalled();
  });

  it('cache path: same app + title within the TTL reuses the VLM verdict without a screenshot', async () => {
    const s = setup();
    await s.c.classifyCurrent(fixtureModules);
    s.advance(60_000);
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r.tookScreenshot).toBe(false);
    expect(r.verdict).toEqual({ ...BIO_VERDICT, source: 'cache' });
    expect(s.capture).toHaveBeenCalledTimes(1);

    // TTL expired → VLM again.
    s.advance(60_000);
    const r2 = await s.c.classifyCurrent(fixtureModules);
    expect(r2.tookScreenshot).toBe(true);
    expect(s.capture).toHaveBeenCalledTimes(2);

    // Different title → VLM again.
    s.setWin({ windowTitle: 'Other.pdf' });
    expect((await s.c.classifyCurrent(fixtureModules)).tookScreenshot).toBe(true);
    expect(s.capture).toHaveBeenCalledTimes(3);
  });

  it('does not cache when the window title is unknown', async () => {
    const s = setup();
    s.setWin({ windowTitle: null });
    await s.c.classifyCurrent(fixtureModules);
    await s.c.classifyCurrent(fixtureModules);
    expect(s.capture).toHaveBeenCalledTimes(2);
  });

  it('isSelf: reuses the previous verdict, or null when there is none; no screenshot', async () => {
    const s = setup();
    s.setWin({ appName: 'LarpLess', windowTitle: 'LarpLess', isSelf: true });
    expect(await s.c.classifyCurrent(fixtureModules)).toEqual({ verdict: null, tookScreenshot: false, appName: null, key: null });
    s.setWin({ appName: 'Preview', windowTitle: 'BIO101 Lecture 4.pdf', isSelf: false });
    await s.c.classifyCurrent(fixtureModules);
    s.setWin({ appName: 'LarpLess', windowTitle: 'LarpLess', isSelf: true });
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r).toEqual({ verdict: { ...BIO_VERDICT, source: 'cache' }, tookScreenshot: false, appName: 'Preview', key: BIO_KEY });
    expect(s.capture).toHaveBeenCalledTimes(1);

    s.c.reset();
    expect((await s.c.classifyCurrent(fixtureModules)).verdict).toBeNull();
  });

  it('single flight, same window: a second call waits and shares the verdict without a screenshot', async () => {
    let release: (v: ScreenVerdict) => void = () => {};
    const s = setup();
    s.classify.mockImplementationOnce(() => new Promise<ScreenVerdict>((res) => (release = res)));
    const first = s.c.classifyCurrent(fixtureModules);
    await tick();
    const second = s.c.classifyCurrent(fixtureModules);
    await tick();
    release(BIO_VERDICT);
    expect(await first).toMatchObject({ verdict: BIO_VERDICT, tookScreenshot: true, appName: 'Preview', key: BIO_KEY });
    expect(await second).toMatchObject({ verdict: { ...BIO_VERDICT, source: 'cache' }, tookScreenshot: false, appName: 'Preview', key: BIO_KEY });
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(s.classify).toHaveBeenCalledTimes(1);
  });

  it('single flight, other window: waits for the running call, then classifies its own window', async () => {
    let release: (v: ScreenVerdict) => void = () => {};
    const s = setup();
    s.classify.mockImplementationOnce(() => new Promise<ScreenVerdict>((res) => (release = res)));
    const first = s.c.classifyCurrent(fixtureModules);
    await tick();
    s.setWin({ windowTitle: 'MATH201 Problem set 3.pdf' });
    const second = s.c.classifyCurrent(fixtureModules);
    await tick();
    expect(s.capture).toHaveBeenCalledTimes(1); // waits, no parallel VLM call
    release(BIO_VERDICT);
    // The first result still describes the window it captured, so a caller can tell it's stale.
    expect((await first).key).toBe(BIO_KEY);
    const r2 = await second;
    expect(r2).toMatchObject({ tookScreenshot: true, key: windowKey('Preview', 'MATH201 Problem set 3.pdf') });
    expect(s.capture).toHaveBeenCalledTimes(2);
  });

  it('three windows during one call: one follow-up shot of the last, and the call fell behind', async () => {
    let release: (v: ScreenVerdict) => void = () => {};
    const s = setup();
    s.classify.mockImplementationOnce(() => new Promise<ScreenVerdict>((res) => (release = res)));
    const first = s.c.classifyCurrent(fixtureModules);
    await tick();
    s.setWin({ windowTitle: 'MATH201 Problem set 3.pdf' });
    const second = s.c.classifyCurrent(fixtureModules);
    await tick();
    s.setWin({ windowTitle: 'Other.pdf' });
    const third = s.c.classifyCurrent(fixtureModules);
    await tick();
    expect(s.capture).toHaveBeenCalledTimes(1);
    s.setWin({ windowTitle: 'FINAL notes.pdf' });
    release(BIO_VERDICT);
    expect((await first).key).toBe(BIO_KEY);
    expect((await first).fellBehind).toBe(true);
    const finalKey = windowKey('Preview', 'FINAL notes.pdf');
    // The follow-up keeps its own gen, so a later slow shot can step down again.
    expect(await second).toMatchObject({ tookScreenshot: true, key: finalKey, fellBehind: false });
    expect(await third).toMatchObject({ tookScreenshot: false, key: finalKey });
    expect(s.capture).toHaveBeenCalledTimes(2);
    expect(s.classify).toHaveBeenCalledTimes(2);
  });

  it('single flight, other window that is cached by then: no second screenshot', async () => {
    let release: (v: ScreenVerdict) => void = () => {};
    const s = setup();
    await s.c.classifyCurrent(fixtureModules); // BIO cached
    s.setWin({ windowTitle: 'Other.pdf' });
    s.classify.mockImplementationOnce(() => new Promise<ScreenVerdict>((res) => (release = res)));
    const first = s.c.classifyCurrent(fixtureModules);
    await tick();
    s.setWin({ windowTitle: 'BIO101 Lecture 4.pdf' });
    const second = s.c.classifyCurrent(fixtureModules);
    expect(await second).toMatchObject({ tookScreenshot: false, key: BIO_KEY, verdict: { source: 'cache' } });
    release(BIO_VERDICT);
    await first;
    expect(s.capture).toHaveBeenCalledTimes(2);
  });

  it('warmUp and unload delegate to Ollama, except with the mock classifier (tests never reach Ollama)', async () => {
    const s = setup();
    await s.c.warmUp(fixtureModules);
    await s.c.unload();
    expect(s.warmUp).toHaveBeenCalledWith(fixtureModules);
    expect(s.unload).toHaveBeenCalledTimes(1);
    const m = setup({ config: { USE_MOCK_CLASSIFIER: true } });
    await m.c.warmUp(fixtureModules);
    await m.c.unload();
    expect(m.warmUp).not.toHaveBeenCalled();
    expect(m.unload).not.toHaveBeenCalled();
  });

  it('VLM failure → null verdict with error vlm (screenshot was taken)', async () => {
    const s = setup({ verdict: null });
    expect(await s.c.classifyCurrent(fixtureModules)).toMatchObject({ verdict: null, tookScreenshot: true, appName: 'Preview', key: BIO_KEY, error: 'vlm' });
  });

  it('capture rejects: E_PERMISSION → permission, other → capture; not counted as a screenshot', async () => {
    const s = setup();
    s.capture.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'E_PERMISSION' }));
    expect(await s.c.classifyCurrent(fixtureModules)).toMatchObject({ verdict: null, tookScreenshot: false, appName: 'Preview', key: BIO_KEY, error: 'permission' });
    s.capture.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'E_CAPTURE' }));
    expect((await s.c.classifyCurrent(fixtureModules)).error).toBe('capture');
    expect(s.classify).not.toHaveBeenCalled();
  });

  it('USE_MOCK_CLASSIFIER: verdict from the window title, Ollama never called', async () => {
    const s = setup({ config: { USE_MOCK_CLASSIFIER: true } });
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r.verdict).toMatchObject({ studying: true, moduleId: 'mod_biology', source: 'vlm' });
    expect(r.tookScreenshot).toBe(true);
    expect(s.classify).not.toHaveBeenCalled();
  });

  it('mockVerdictFromTitle matches names, keywords and keyword stems', () => {
    expect(mockVerdictFromTitle('Preview', 'MATH201 Problem set 3.pdf', fixtureModules).moduleId).toBe('mod_maths');
    expect(mockVerdictFromTitle('Safari', 'Integration by parts – YouTube', fixtureModules).moduleId).toBe('mod_maths');
    expect(mockVerdictFromTitle('Notes', 'History essay draft', fixtureModules).moduleId).toBe('mod_history');
    const no = mockVerdictFromTitle('Safari', 'Some music video', fixtureModules);
    expect(no).toMatchObject({ studying: false, moduleId: null });
    expect(mockVerdictFromTitle('Finder', null, fixtureModules)).toMatchObject({ studying: false, activity: 'Finder' });
  });

  it('a window query that resolves after the in-flight call still shares that capture', async () => {
    let release: (v: ScreenVerdict) => void = () => {};
    const s = setup();
    s.classify.mockImplementationOnce(() => new Promise<ScreenVerdict>((res) => (release = res)));
    const first = s.c.classifyCurrent(fixtureModules);
    await tick();
    s.holdWindow();
    const second = s.c.classifyCurrent(fixtureModules);
    await tick();
    release(BIO_VERDICT);
    await first;
    expect(s.capture).toHaveBeenCalledTimes(1);
    s.releaseWindow();
    await second;
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(s.classify).toHaveBeenCalledTimes(1);
  });

  it('keeps the TTL from when the verdict was cached, so a longer profile cannot extend it', async () => {
    let ttl = 1_000;
    const spec = (): PowerSpec => ({
      id: 'high',
      chunkS: 10,
      liveSettleMs: 1_000,
      capture: CFG.CAPTURE,
      cacheTtlMs: ttl,
      keepAlive: '30m',
      classifyTimeoutMs: 30_000,
    });
    const s = setup({ getPower: spec });
    await s.c.classifyCurrent(fixtureModules);
    ttl = 100_000;
    s.advance(2_000);
    expect((await s.c.classifyCurrent(fixtureModules)).tookScreenshot).toBe(true);
    expect(s.capture).toHaveBeenCalledTimes(2);
  });

  it('after a timeout, the next vision call waits out a chunk instead of capturing again', async () => {
    const s = setup({
      getPower: () => ({
        id: 'high',
        chunkS: 10,
        liveSettleMs: 1_000,
        capture: CFG.CAPTURE,
        cacheTtlMs: 120_000,
        keepAlive: '30m',
        classifyTimeoutMs: 30_000,
      }),
    });
    s.classify.mockImplementationOnce(async () => {
      s.advance(30_000);
      return null;
    });
    expect((await s.c.classifyCurrent(fixtureModules)).error).toBe('vlm');
    await s.c.classifyCurrent(fixtureModules);
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(s.classify).toHaveBeenCalledTimes(1);
    s.advance(10_000);
    expect((await s.c.classifyCurrent(fixtureModules)).tookScreenshot).toBe(true);
    expect(s.capture).toHaveBeenCalledTimes(2);
  });

  it('reset clears a timeout hold so the next session can classify immediately', async () => {
    const s = setup({
      getPower: () => ({
        id: 'high',
        chunkS: 10,
        liveSettleMs: 1_000,
        capture: CFG.CAPTURE,
        cacheTtlMs: 120_000,
        keepAlive: '30m',
        classifyTimeoutMs: 30_000,
      }),
    });
    s.classify.mockImplementationOnce(async () => {
      s.advance(30_000);
      return null;
    });
    expect((await s.c.classifyCurrent(fixtureModules)).error).toBe('vlm');
    s.c.reset();
    expect((await s.c.classifyCurrent(fixtureModules)).tookScreenshot).toBe(true);
    expect(s.capture).toHaveBeenCalledTimes(2);
  });

  it('a timeout that finishes after reset does not hold the next session', async () => {
    let release: () => void = () => {};
    const s = setup({
      getPower: () => ({
        id: 'high',
        chunkS: 10,
        liveSettleMs: 1_000,
        capture: CFG.CAPTURE,
        cacheTtlMs: 120_000,
        keepAlive: '30m',
        classifyTimeoutMs: 30_000,
      }),
    });
    s.classify.mockImplementationOnce(
      () =>
        new Promise((res) => {
          release = () => {
            s.advance(30_000);
            res(null);
          };
        }),
    );
    const first = s.c.classifyCurrent(fixtureModules);
    await tick();
    s.c.reset();
    release();
    await first;
    expect((await s.c.classifyCurrent(fixtureModules)).tookScreenshot).toBe(true);
    expect(s.capture).toHaveBeenCalledTimes(2);
  });

  it('a screenshot that uses the whole ceiling does not call the model', async () => {
    const s = setup({
      getPower: () => ({
        id: 'high',
        chunkS: 10,
        liveSettleMs: 1_000,
        capture: CFG.CAPTURE,
        cacheTtlMs: 120_000,
        keepAlive: '30m',
        classifyTimeoutMs: 30_000,
      }),
    });
    s.capture.mockImplementationOnce(async () => {
      s.advance(30_000);
      return {
        appName: 'Preview',
        bundleId: 'com.apple.Preview',
        windowTitle: 'BIO101 Lecture 4.pdf',
        isSelf: false,
        jpegBase64: 'IMG',
        width: 1,
        height: 1,
        capturedAt: 0,
      };
    });
    expect((await s.c.classifyCurrent(fixtureModules)).error).toBe('capture');
    expect(s.classify).not.toHaveBeenCalled();
    await s.c.classifyCurrent(fixtureModules);
    expect(s.capture).toHaveBeenCalledTimes(1);
  });

  it('a slow screenshot leaves the model only the time remaining in the ceiling', async () => {
    const s = setup({
      getPower: () => ({
        id: 'high',
        chunkS: 10,
        liveSettleMs: 1_000,
        capture: CFG.CAPTURE,
        cacheTtlMs: 120_000,
        keepAlive: '30m',
        classifyTimeoutMs: 30_000,
      }),
    });
    s.capture.mockImplementationOnce(async () => {
      s.advance(20_000);
      return {
        appName: 'Preview',
        bundleId: 'com.apple.Preview',
        windowTitle: 'BIO101 Lecture 4.pdf',
        isSelf: false,
        jpegBase64: 'IMG',
        width: 1,
        height: 1,
        capturedAt: 0,
      };
    });
    await s.c.classifyCurrent(fixtureModules);
    expect(s.classify).toHaveBeenCalledWith(expect.anything(), fixtureModules, { timeoutMs: 10_000, keepAlive: '30m' });
  });

  it('Windows eco: a 40 s check fits the 45 s ceiling, keeps its verdict and does not hold the next call', async () => {
    const s = setup({ getPower: () => platformProfile(effectiveProfile('eco'), 'windows') });
    s.classify.mockImplementationOnce(async () => {
      s.advance(40_000);
      return BIO_VERDICT;
    });
    expect((await s.c.classifyCurrent(fixtureModules)).verdict).toEqual(BIO_VERDICT);
    expect(s.classify).toHaveBeenCalledWith(expect.anything(), fixtureModules, { timeoutMs: 45_000, keepAlive: '5m' });
    s.setWin({ windowTitle: 'Notes' });
    expect((await s.c.classifyCurrent(fixtureModules)).tookScreenshot).toBe(true);
    expect(s.capture).toHaveBeenCalledTimes(2);
  });

  it('privacy: never logs the snapshot or image data on any path', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((k) => jest.spyOn(console, k).mockImplementation(() => {}));
    try {
      const s = setup();
      await s.c.classifyCurrent(fixtureModules); // vlm
      await s.c.classifyCurrent(fixtureModules); // cache
      s.setWin({ windowTitle: 'Instagram' });
      await s.c.classifyCurrent(fixtureModules); // rule
      s.setWin({ windowTitle: 'x', isSelf: true });
      await s.c.classifyCurrent(fixtureModules); // isSelf
      const all = spies.flatMap((sp) => sp.mock.calls.flat().map((a) => (typeof a === 'string' ? a : JSON.stringify(a))));
      expect(all.join('\n')).not.toContain('IMG');
    } finally {
      spies.forEach((sp) => sp.mockRestore());
    }
  });
});

describe('classifier: TITLE_FIRST (Windows)', () => {
  const TITLE_BIO: ScreenVerdict = { studying: true, moduleId: 'mod_biology', activity: '', confidence: 0.7, source: 'title' };

  it('a module keyword in the title answers without a screenshot or the model', async () => {
    const s = setup({ config: { TITLE_FIRST: true } });
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r).toEqual({ verdict: TITLE_BIO, tookScreenshot: false, appName: 'Preview', key: BIO_KEY });
    expect(r).not.toHaveProperty('gen');
    expect(r).not.toHaveProperty('tookMs');
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.classify).not.toHaveBeenCalled();
    // Title hits are not cached: the same window matches again (still source 'title').
    expect((await s.c.classifyCurrent(fixtureModules)).verdict).toEqual(TITLE_BIO);
    expect(s.capture).not.toHaveBeenCalled();
  });

  it('no keyword in the title → VLM', async () => {
    const s = setup({ config: { TITLE_FIRST: true } });
    s.setWin({ windowTitle: 'Some music video' });
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r).toMatchObject({ verdict: BIO_VERDICT, tookScreenshot: true });
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(s.classify).toHaveBeenCalledTimes(1);
  });

  it('unknown title → VLM', async () => {
    const s = setup({ config: { TITLE_FIRST: true } });
    s.setWin({ windowTitle: null });
    expect((await s.c.classifyCurrent(fixtureModules)).tookScreenshot).toBe(true);
    expect(s.classify).toHaveBeenCalledTimes(1);
  });

  it('a distraction rule beats a module keyword', async () => {
    const s = setup({ config: { TITLE_FIRST: true } });
    s.setWin({ appName: 'Safari', windowTitle: 'BIO101 cell memes • Instagram' });
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r.verdict).toEqual({ studying: false, moduleId: null, activity: 'Instagram', confidence: 1, source: 'rule' });
    expect(s.capture).not.toHaveBeenCalled();
  });

  it('a cached VLM verdict beats a module keyword', async () => {
    const HIST: ScreenVerdict = { ...BIO_VERDICT, moduleId: 'mod_history' };
    const s = setup({ config: { TITLE_FIRST: true }, verdict: HIST });
    // No modules → no title match, so the VLM classifies (and caches) this window.
    expect((await s.c.classifyCurrent([])).verdict).toEqual(HIST);
    s.advance(10_000);
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r).toMatchObject({ verdict: { ...HIST, source: 'cache' }, tookScreenshot: false });
    expect(s.capture).toHaveBeenCalledTimes(1);
  });

  it('isSelf after a title hit reuses it as cache, with the hit window', async () => {
    const s = setup({ config: { TITLE_FIRST: true } });
    await s.c.classifyCurrent(fixtureModules);
    s.setWin({ appName: 'LarpLess', windowTitle: 'LarpLess', isSelf: true });
    expect(await s.c.classifyCurrent(fixtureModules)).toEqual({
      verdict: { ...TITLE_BIO, source: 'cache' },
      tookScreenshot: false,
      appName: 'Preview',
      key: BIO_KEY,
    });
    expect(s.capture).not.toHaveBeenCalled();
  });

  it('a call during a running VLM flight answers from its title without waiting', async () => {
    let release: (v: ScreenVerdict) => void = () => {};
    const s = setup({ config: { TITLE_FIRST: true } });
    s.setWin({ windowTitle: 'Other.pdf' });
    s.classify.mockImplementationOnce(() => new Promise<ScreenVerdict>((res) => (release = res)));
    let firstDone = false;
    const first = s.c.classifyCurrent(fixtureModules).then((r) => {
      firstDone = true;
      return r;
    });
    await tick();
    s.setWin({ windowTitle: 'MATH201 Problem set 3.pdf' });
    const second = await s.c.classifyCurrent(fixtureModules);
    expect(firstDone).toBe(false);
    expect(second).toEqual({
      verdict: { studying: true, moduleId: 'mod_maths', activity: '', confidence: 0.7, source: 'title' },
      tookScreenshot: false,
      appName: 'Preview',
      key: windowKey('Preview', 'MATH201 Problem set 3.pdf'),
    });
    expect(s.capture).toHaveBeenCalledTimes(1);
    release(BIO_VERDICT);
    expect(await first).toMatchObject({ tookScreenshot: true, key: windowKey('Preview', 'Other.pdf') });
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(s.classify).toHaveBeenCalledTimes(1);
  });

  it('flag off (Mac): the same title goes to the VLM', async () => {
    for (const config of [{}, { TITLE_FIRST: false }]) {
      const s = setup({ config });
      const r = await s.c.classifyCurrent(fixtureModules);
      expect(r).toMatchObject({ verdict: BIO_VERDICT, tookScreenshot: true });
      expect(s.capture).toHaveBeenCalledTimes(1);
      expect(s.classify).toHaveBeenCalledTimes(1);
    }
  });
});
