import type { ScreenVerdict } from '../../src/contracts/domain';
import type { ActiveWindow, ScreenSnapshot } from '../../src/contracts/native';
import { createClassifier, mockVerdictFromTitle } from '../../src/core/classifier';
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
  const c = createClassifier({
    native: { screen: { getActiveWindow: async () => ({ ...win }), capture } },
    ollama: { classify },
    now: () => t,
    config: { ...CFG, ...opts.config },
  });
  return {
    c,
    capture,
    classify,
    setWin: (w: Partial<ActiveWindow>) => {
      win = { ...win, ...w };
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('classifier', () => {
  it('VLM path: takes exactly one screenshot and returns the verdict', async () => {
    const s = setup();
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r).toEqual({ verdict: BIO_VERDICT, tookScreenshot: true, appName: 'Preview' });
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
    s.setWin({ appName: 'Focusline', windowTitle: 'Focusline', isSelf: true });
    expect(await s.c.classifyCurrent(fixtureModules)).toEqual({ verdict: null, tookScreenshot: false, appName: null });
    s.setWin({ appName: 'Preview', windowTitle: 'BIO101 Lecture 4.pdf', isSelf: false });
    await s.c.classifyCurrent(fixtureModules);
    s.setWin({ appName: 'Focusline', windowTitle: 'Focusline', isSelf: true });
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r).toEqual({ verdict: { ...BIO_VERDICT, source: 'cache' }, tookScreenshot: false, appName: 'Preview' });
    expect(s.capture).toHaveBeenCalledTimes(1);

    s.c.reset();
    expect((await s.c.classifyCurrent(fixtureModules)).verdict).toBeNull();
  });

  it('single flight: a second call while the VLM is busy returns null without a screenshot', async () => {
    let release: (v: ScreenVerdict) => void = () => {};
    const s = setup();
    s.classify.mockImplementationOnce(() => new Promise<ScreenVerdict>((res) => (release = res)));
    const first = s.c.classifyCurrent(fixtureModules);
    await new Promise<void>((r) => setImmediate(() => r()));
    s.setWin({ windowTitle: 'Something else' });
    const second = await s.c.classifyCurrent(fixtureModules);
    expect(second).toEqual({ verdict: null, tookScreenshot: false, appName: 'Preview', error: 'busy' });
    release(BIO_VERDICT);
    expect((await first).verdict).toEqual(BIO_VERDICT);
    expect(s.capture).toHaveBeenCalledTimes(1);
    // Free again afterwards.
    expect((await s.c.classifyCurrent(fixtureModules)).tookScreenshot).toBe(true);
  });

  it('VLM failure → null verdict with error vlm (screenshot was taken)', async () => {
    const s = setup({ verdict: null });
    expect(await s.c.classifyCurrent(fixtureModules)).toEqual({ verdict: null, tookScreenshot: true, appName: 'Preview', error: 'vlm' });
  });

  it('capture rejects: E_PERMISSION → permission, other → capture; not counted as a screenshot', async () => {
    const s = setup();
    s.capture.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'E_PERMISSION' }));
    expect(await s.c.classifyCurrent(fixtureModules)).toEqual({ verdict: null, tookScreenshot: false, appName: 'Preview', error: 'permission' });
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
});
