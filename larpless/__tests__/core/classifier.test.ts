import type { ScreenVerdict } from '../../src/contracts/domain';
import type { ActiveWindow, ScreenSnapshot } from '../../src/contracts/native';
import { createClassifier, guessStudy, mockVerdictFromTitle, TITLE_CHECK_MIN_CONFIDENCE, windowKey } from '../../src/core/classifier';
import { config } from '../../src/config';
import type { ClassifierConfig } from '../../src/core/classifier';
import { fixtureModules } from '../../src/fixtures/data';
import type { PowerSpec } from '../../src/core/powerProfile';

const CFG: ClassifierConfig = {
  USE_MOCK_CLASSIFIER: false,
  CACHE_TTL_MS: 120_000,
  CAPTURE: { maxWidth: 1280, jpegQuality: 0.7 },
};

const BIO_VERDICT: ScreenVerdict = { studying: true, moduleId: 'mod_biology', activity: 'Reading slides', confidence: 0.9, source: 'vlm' };

function setup(opts: {
  config?: Partial<ClassifierConfig>;
  verdict?: ScreenVerdict | null;
  getPower?: () => PowerSpec;
  classifyTitle?: (appName: string | null, windowTitle: string | null) => Promise<ScreenVerdict | null>;
} = {}) {
  let win: ActiveWindow = { appName: 'Preview', bundleId: 'com.apple.Preview', windowTitle: 'BIO101 Lecture 4.pdf', isSelf: false };
  let t = 1_000_000;
  let holdWindows = 0;
  const windowReleasers: Array<(w: ActiveWindow) => void> = [];
  const capture = jest.fn(
    async (): Promise<ScreenSnapshot> => ({ ...win, jpegBase64: 'IMG', width: 1, height: 1, capturedAt: t }),
  );
  const classify = jest.fn(async () => (opts.verdict === undefined ? BIO_VERDICT : opts.verdict));
  const classifyTitle = jest.fn(async (appName: string | null, windowTitle: string | null) =>
    opts.classifyTitle ? opts.classifyTitle(appName, windowTitle) : null,
  );
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
    ollama: { classify, classifyTitle, warmUp, unload },
    now: () => t,
    config: { ...CFG, ...opts.config },
    getPower: opts.getPower,
  });
  return {
    c,
    capture,
    classify,
    classifyTitle,
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
  it('title check is off by default', () => {
    expect(config.TITLE_CHECK).toBe(false);
    expect(TITLE_CHECK_MIN_CONFIDENCE).toBe(0.6);
  });

  it('a confident studying title check skips the screenshot', async () => {
    const s = setup({
      config: { TITLE_CHECK: true },
      classifyTitle: async () => ({ studying: true, moduleId: 'mod_biology', activity: '', confidence: 0.8, source: 'vlm' }),
    });
    s.setWin({ appName: 'Chrome', windowTitle: 'Mitosis - Wikipedia', bundleId: 'chrome' });
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(r.tookScreenshot).toBe(false);
    expect(r.verdict).toMatchObject({ studying: true, moduleId: 'mod_biology', source: 'title', confidence: 0.8 });
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.classify).not.toHaveBeenCalled();
    expect(s.classifyTitle).toHaveBeenCalledTimes(1);
  });

  it('a confident "Not study" title check still looks at the screen', async () => {
    const s = setup({
      config: { TITLE_CHECK: true },
      classifyTitle: async () => ({ studying: false, moduleId: null, activity: 'Checking email', confidence: 0.9, source: 'vlm' }),
    });
    s.setWin({ appName: 'Cursor', windowTitle: 'classifier.ts - notion-hackathon', bundleId: 'cursor' });
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(s.classifyTitle).toHaveBeenCalledTimes(1);
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(r.tookScreenshot).toBe(true);
    expect(r.verdict?.source).toBe('vlm');
  });

  it('a weak title check falls through to the vision model', async () => {
    const s = setup({
      config: { TITLE_CHECK: true },
      classifyTitle: async () => ({ studying: false, moduleId: null, activity: 'Browsing', confidence: 0.4, source: 'vlm' }),
    });
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(s.classifyTitle).toHaveBeenCalledTimes(1);
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(r.tookScreenshot).toBe(true);
    expect(r.verdict?.source).toBe('vlm');
  });

  it('with the title check off, classifyTitle is never called', async () => {
    const s = setup();
    await s.c.classifyCurrent(fixtureModules);
    expect(s.classifyTitle).not.toHaveBeenCalled();
    expect(s.capture).toHaveBeenCalledTimes(1);
  });

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

  it('an unsure or simulation verdict is a subject guess, not distracted', async () => {
    const s = setup({
      verdict: { studying: false, moduleId: null, activity: 'simulation', confidence: 0.9, source: 'vlm' },
    });
    const arch = { id: 'lib_computer_architecture', name: 'Computer Architecture', color: 'blue' as const, keywords: ['processor', 'pipeline'] };
    s.setWin({ appName: 'Java', windowTitle: 'Behavioral Simulation' });
    const guessed = await s.c.classifyCurrent([...fixtureModules, arch]);
    expect(guessed.verdict).toEqual({
      studying: true,
      moduleId: 'lib_computer_architecture',
      activity: 'simulation',
      confidence: 0.55,
      source: 'vlm',
    });
    expect(s.capture).toHaveBeenCalledTimes(1);

    const sure = guessStudy(
      { studying: false, moduleId: null, activity: 'Playing a game', confidence: 0.93, source: 'vlm' },
      [...fixtureModules, arch],
      'Steam',
      'Library',
    );
    expect(sure).toMatchObject({ studying: false, activity: 'Playing a game' });

    const unsure = guessStudy(
      { studying: false, moduleId: null, activity: 'Browsing', confidence: 0.4, source: 'vlm' },
      [...fixtureModules, { id: 'lib_coding', name: 'Coding', color: 'purple', keywords: ['python'] }],
      'Chrome',
      'New Tab',
    );
    expect(unsure).toMatchObject({ studying: true, moduleId: 'lib_coding', confidence: 0.4 });
  });

  it('WhatsApp labeled online shopping is a guess, and a real shop still is not', () => {
    const coding = { id: 'lib_coding', name: 'Coding', color: 'purple' as const, keywords: ['python'] };
    const modules = [...fixtureModules, coding];
    const chat = guessStudy(
      { studying: false, moduleId: null, activity: 'Online shopping', confidence: 0.96, source: 'vlm' },
      modules,
      'WhatsApp',
      'Alex',
    );
    expect(chat).toMatchObject({ studying: true, moduleId: 'lib_coding', activity: '' });

    const project = guessStudy(
      { studying: false, moduleId: null, activity: 'Messaging', confidence: 0.95, source: 'vlm' },
      modules,
      'WhatsApp',
      'Group project',
    );
    expect(project).toMatchObject({ studying: true, moduleId: 'lib_coding' });

    const diagrams = guessStudy(
      { studying: false, moduleId: null, activity: 'Online chatting', confidence: 0.96, source: 'vlm' },
      [
        ...modules,
        { id: 'lib_business', name: 'Business', color: 'orange', keywords: ['management'] },
        { id: 'lib_information_management', name: 'Information Management', color: 'blue', keywords: ['info management', 'class diagram', 'use case'] },
      ],
      'WhatsApp',
      'info management project',
    );
    expect(diagrams).toMatchObject({ studying: true, moduleId: 'lib_information_management', activity: '' });

    const unread = guessStudy(
      { studying: false, moduleId: null, activity: 'Messaging', confidence: 0.96, source: 'vlm' },
      modules,
      'WhatsApp',
      'Alex',
    );
    expect(unread).toMatchObject({ studying: true, moduleId: 'lib_coding', activity: '' });

    const plans = guessStudy(
      { studying: false, moduleId: null, activity: 'Planning dinner', confidence: 0.96, source: 'vlm' },
      modules,
      'WhatsApp',
      'Alex',
    );
    expect(plans).toMatchObject({ studying: false, activity: 'Planning dinner' });

    const assistant = guessStudy(
      { studying: false, moduleId: null, activity: 'Messaging', confidence: 0.95, source: 'vlm' },
      [
        ...modules,
        { id: 'lib_discrete_maths', name: 'Discrete Maths', color: 'yellow', keywords: ['injective', 'proof', 'set theory'] },
      ],
      'ChatGPT',
      'ChatGPT',
    );
    expect(assistant).toMatchObject({ studying: true, activity: '' });

    const exam = guessStudy(
      { studying: false, moduleId: null, activity: 'Messaging', confidence: 0.95, source: 'vlm' },
      [
        ...modules,
        { id: 'lib_discrete_maths', name: 'Discrete Maths', color: 'yellow', keywords: ['injective', 'proof', 'set theory'] },
      ],
      'Chrome',
      'injective functions - ChatGPT',
    );
    expect(exam).toMatchObject({ studying: true, moduleId: 'lib_discrete_maths', activity: '' });

    const shop = guessStudy(
      { studying: false, moduleId: null, activity: 'Online shopping', confidence: 0.96, source: 'vlm' },
      modules,
      'Safari',
      'Amazon.com: Shopping Cart',
    );
    expect(shop).toMatchObject({ studying: false, activity: 'Online shopping' });
  });

  it('a virtual machine is a lab unless a game or feed runs inside it', () => {
    const coding = { id: 'lib_coding', name: 'Coding', color: 'purple' as const, keywords: ['python'] };
    const os = { id: 'lib_os', name: 'Operating Systems', color: 'blue' as const, keywords: ['kernel', 'scheduling'] };
    const modules = [...fixtureModules, coding, os];
    const vm = guessStudy(
      { studying: false, moduleId: null, activity: 'Using a virtual machine', confidence: 0.95, source: 'vlm' },
      modules,
      'UTM',
      'Ubuntu 24.04',
    );
    expect(vm).toMatchObject({ studying: true, moduleId: 'lib_os', activity: '' });

    const noOs = guessStudy(
      { studying: false, moduleId: null, activity: 'Desktop', confidence: 0.9, source: 'vlm' },
      [...fixtureModules, coding],
      'VirtualBox VM',
      'Windows 11',
    );
    expect(noOs).toMatchObject({ studying: true, moduleId: 'lib_coding' });

    const game = guessStudy(
      { studying: false, moduleId: null, activity: 'Playing a game', confidence: 0.95, source: 'vlm' },
      modules,
      'Parallels Desktop',
      'Windows 11',
    );
    expect(game).toMatchObject({ studying: false, activity: 'Playing a game' });
  });

  it('WhatsApp is looked at before it can be called distracted', async () => {
    const s = setup();
    s.setWin({ appName: 'WhatsApp', windowTitle: 'Group project' });
    const r = await s.c.classifyCurrent(fixtureModules);
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(s.classify).toHaveBeenCalledTimes(1);
    expect(r.verdict?.source).not.toBe('rule');
  });

  it('Vivado is studying even after the model cached it as simulation', async () => {
    const s = setup({
      verdict: { studying: false, moduleId: null, activity: 'simulation', confidence: 0.9, source: 'vlm' },
    });
    s.setWin({ appName: 'Vivado', windowTitle: 'sim_1 - Behavioral Simulation - Vivado 2024.1' });
    // No Digital Logic module yet, so the tool rule cannot name it. "simulation" is still a study guess.
    const missed = await s.c.classifyCurrent(fixtureModules);
    expect(missed.verdict).toMatchObject({ studying: true, moduleId: 'mod_biology', activity: 'simulation', confidence: 0.55 });
    expect(s.classify).toHaveBeenCalledTimes(1);

    const modules = [
      ...fixtureModules,
      { id: 'lib_digital_logic', name: 'Digital Logic', color: 'yellow' as const, keywords: ['Vivado', 'Verilog'] },
    ];
    s.advance(1_000);
    const r = await s.c.classifyCurrent(modules);
    expect(r.tookScreenshot).toBe(false);
    expect(r.verdict).toEqual({
      studying: true,
      moduleId: 'lib_digital_logic',
      activity: 'Vivado',
      confidence: 1,
      source: 'rule',
    });
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(s.classify).toHaveBeenCalledTimes(1);
  });

  it('a distraction in the title still beats a study-tool name', async () => {
    const s = setup();
    s.setWin({ appName: 'Safari', windowTitle: 'reddit.com/r/vivado' });
    const r = await s.c.classifyCurrent([
      { id: 'lib_digital_logic', name: 'Digital Logic', color: 'yellow', keywords: ['Vivado'] },
    ]);
    expect(r.verdict).toMatchObject({ studying: false, activity: 'Reddit', source: 'rule' });
    expect(s.capture).not.toHaveBeenCalled();
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
