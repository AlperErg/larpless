import type { ScreenVerdict } from '../../src/contracts/domain';
import type { ActiveWindow, ScreenSnapshot } from '../../src/contracts/native';
import { createClassifier, mockVerdictFromTitle, windowKey } from '../../src/core/classifier';
import type { ClassifierConfig } from '../../src/core/classifier';
import { fixtureModules } from '../../src/fixtures/data';

const CFG: ClassifierConfig = {
  USE_MOCK_CLASSIFIER: false,
  CACHE_TTL_MS: 120_000,
  CAPTURE: { maxWidth: 1280, jpegQuality: 0.7 },
};

const BIO_VERDICT: ScreenVerdict = { studying: true, moduleId: 'mod_biology', activity: 'Reading slides', confidence: 0.9, source: 'vlm' };

function setup(opts: { config?: Partial<ClassifierConfig>; verdict?: ScreenVerdict | null } = {}) {
  let win: ActiveWindow = { appName: 'Preview', bundleId: 'com.apple.Preview', windowTitle: 'BIO101 Lecture 4.pdf', isSelf: false };
  let t = 1_000_000;
  const capture = jest.fn(
    async (): Promise<ScreenSnapshot> => ({ ...win, jpegBase64: 'IMG', width: 1, height: 1, capturedAt: t }),
  );
  const classify = jest.fn(async () => (opts.verdict === undefined ? BIO_VERDICT : opts.verdict));
  const warmUp = jest.fn(async () => {});
  const unload = jest.fn(async () => {});
  const c = createClassifier({
    native: { screen: { getActiveWindow: async () => ({ ...win }), capture } },
    ollama: { classify, warmUp, unload },
    now: () => t,
    config: { ...CFG, ...opts.config },
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
  };
}

const BIO_KEY = windowKey('Preview', 'BIO101 Lecture 4.pdf');
const tick = () => new Promise<void>((r) => setImmediate(() => r()));

describe('classifier', () => {
  it('VLM path: takes exactly one screenshot and returns the verdict', async () => {
    const s = setup();
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r).toEqual({ verdict: BIO_VERDICT, tookScreenshot: true, appName: 'Preview', key: BIO_KEY });
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(s.capture).toHaveBeenCalledWith(CFG.CAPTURE);
    expect(s.classify).toHaveBeenCalledTimes(1);
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
    expect(await first).toEqual({ verdict: BIO_VERDICT, tookScreenshot: true, appName: 'Preview', key: BIO_KEY });
    expect(await second).toEqual({ verdict: { ...BIO_VERDICT, source: 'cache' }, tookScreenshot: false, appName: 'Preview', key: BIO_KEY });
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
    expect(await s.c.classifyCurrent(fixtureModules)).toEqual({ verdict: null, tookScreenshot: true, appName: 'Preview', key: BIO_KEY, error: 'vlm' });
  });

  it('capture rejects: E_PERMISSION → permission, other → capture; not counted as a screenshot', async () => {
    const s = setup();
    s.capture.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'E_PERMISSION' }));
    expect(await s.c.classifyCurrent(fixtureModules)).toEqual({ verdict: null, tookScreenshot: false, appName: 'Preview', key: BIO_KEY, error: 'permission' });
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
