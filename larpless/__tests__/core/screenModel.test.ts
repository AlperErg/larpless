import type { ScreenVerdict, StudyModule } from '../../src/contracts/domain';
import type { ActiveWindow, ScreenModelApi, ScreenModelScores } from '../../src/contracts/native';
import { createClassifier } from '../../src/core/classifier';
import {
  EMBED_NOT_STUDY_CONFIDENCE,
  FALLBACK_CONFIDENCE,
  fuseScores,
  MIN_CONFIDENCE,
  MIN_NOT_STUDY_CONFIDENCE,
  MIN_OCR_CHARS,
  SCREEN_MODEL_FILES,
  createScreenModelStep,
  screenModelTexts,
} from '../../src/core/screenModel';
import type { ScreenModelResult, ScreenModelStep } from '../../src/core/screenModel';

const MODULES: StudyModule[] = [
  { id: 'lib_calculus', name: 'Calculus', color: 'blue', keywords: ['derivative', 'integral'] },
  { id: 'lib_history', name: 'History', color: 'orange', keywords: ['revolution'] },
  { id: 'mod_econ214', name: 'ECON 214', color: 'green', keywords: ['elasticity'] },
];

/** Image logits for the fixed prompts plus text cosines, shaped like FLScreenModel's answer. */
function scores(over: Partial<ScreenModelScores> = {}): ScreenModelScores {
  return {
    appName: 'Edge',
    bundleId: 'msedge.exe',
    windowTitle: 'Integration by parts',
    isSelf: false,
    width: 1024,
    height: 640,
    capturedAt: 1,
    image: { lib_calculus: -2, lib_history: -9, 'study:0': -3, 'distract:0': -12, 'distract:1': -13 },
    text: { lib_calculus: 0.6, lib_history: 0.1, mod_econ214: 0.05, 'distract:0': 0.05 },
    keywords: null,
    ocrChars: 400,
    timings: { captureMs: 30, ocrMs: 120, imageMs: 200, textMs: 25 },
    ...over,
  };
}

describe('fuseScores', () => {
  it('picks the subject both image and text agree on', () => {
    const v = fuseScores(scores(), MODULES)!;
    expect(v).toMatchObject({ studying: true, moduleId: 'lib_calculus', source: 'embed' });
    expect(v.confidence).toBeGreaterThan(0.5);
  });

  it('calls a distraction "not study" when the distraction prompts win', () => {
    const v = fuseScores(
      scores({ image: { lib_calculus: -12, lib_history: -12, 'study:0': -11, 'distract:0': -2 }, text: { lib_calculus: 0.1, 'distract:0': 0.5 } }),
      MODULES,
    )!;
    expect(v).toMatchObject({ studying: false, moduleId: null, source: 'embed' });
  });

  it('chooses a custom course from its text and keywords (it has no image prompt)', () => {
    const v = fuseScores(
      scores({
        image: { lib_calculus: -2, lib_history: -2.2, 'study:0': -3, 'distract:0': -12 },
        text: { lib_calculus: 0.1, lib_history: 0.1, mod_econ214: 0.7, 'distract:0': 0.05 },
        keywords: { lib_calculus: 0, lib_history: 0, mod_econ214: 2 },
      }),
      MODULES,
    )!;
    expect(v.moduleId).toBe('mod_econ214');
  });

  it('lets keyword hits overturn a close image and text call', () => {
    const close = { image: { lib_calculus: -2, lib_history: -2.1, 'study:0': -3, 'distract:0': -12 }, text: { lib_calculus: 0.31, lib_history: 0.3, mod_econ214: 0, 'distract:0': 0 } };
    expect(fuseScores(scores(close), MODULES)!.moduleId).toBe('lib_calculus');
    expect(fuseScores(scores({ ...close, keywords: { lib_calculus: 0, lib_history: 3, mod_econ214: 0 } }), MODULES)!.moduleId).toBe('lib_history');
  });

  it('ignores thin OCR text and uses the image only', () => {
    const v = fuseScores(
      scores({ ocrChars: MIN_OCR_CHARS - 1, text: { lib_calculus: 0, lib_history: 0.9, mod_econ214: 0, 'distract:0': 0 } }),
      MODULES,
    )!;
    expect(v.moduleId).toBe('lib_calculus');
  });

  it('returns null when no module has an image prompt and there is no text', () => {
    expect(fuseScores(scores({ text: null }), [MODULES[2]])).toBeNull();
  });
});

describe('screenModelTexts', () => {
  it('describes every module and the distractions, never anything from the screen', () => {
    const texts = screenModelTexts(MODULES);
    expect(texts[0]).toEqual({ id: 'lib_calculus', text: 'Calculus: derivative, integral', keywords: ['derivative', 'integral', 'Calculus'] });
    expect(texts.filter((t) => t.id.startsWith('distract:')).length).toBeGreaterThan(0);
  });
});

describe('createScreenModelStep', () => {
  function api(over: Partial<ScreenModelApi> = {}): ScreenModelApi {
    return {
      status: jest.fn(async () => ({ supported: true, installed: true, missing: [], loaded: false })),
      download: jest.fn(async () => {}),
      cancelDownload: jest.fn(async () => {}),
      onProgress: () => () => {},
      classify: jest.fn(async () => scores()),
      unload: jest.fn(async () => {}),
      ...over,
    };
  }

  it('checks the pinned files once installed, and rechecks a missing model at most once a minute', async () => {
    let t = 0;
    const status = jest.fn(async () => ({ supported: true, installed: false, missing: ['minilm.onnx'], loaded: false }));
    const step = createScreenModelStep({ api: api({ status }), now: () => t, log: () => {} });
    expect(await step.ready()).toBe(false);
    expect(status).toHaveBeenCalledWith(SCREEN_MODEL_FILES);
    t += 30_000;
    expect(await step.ready()).toBe(false);
    expect(status).toHaveBeenCalledTimes(1);
    t += 31_000;
    await step.ready();
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('is never ready where the module is unsupported', async () => {
    const step = createScreenModelStep({
      api: api({ status: async () => ({ supported: false, installed: true, missing: [], loaded: false }) }),
      now: () => 0,
      log: () => {},
    });
    expect(await step.ready()).toBe(false);
  });

  it('logs timings and the label, never the window title', async () => {
    const lines: string[] = [];
    const step = createScreenModelStep({ api: api(), now: () => 0, log: (l) => lines.push(l) });
    const r = await step.classify(MODULES, { maxWidth: 1024 });
    expect(r.verdict?.moduleId).toBe('lib_calculus');
    expect(lines.join('\n')).toContain('Calculus');
    expect(lines.join('\n')).not.toContain('Integration by parts');
  });
});

describe('classifier with the screen model', () => {
  const VLM: ScreenVerdict = { studying: true, moduleId: 'lib_history', activity: '', confidence: 0.9, source: 'vlm' };
  const win: ActiveWindow = { appName: 'Edge', bundleId: 'msedge.exe', windowTitle: 'Integration by parts', isSelf: false };

  function setup(
    result: Partial<ScreenModelResult> | Error,
    opts: { ready?: boolean; vlm?: ScreenVerdict | null; only?: boolean | (() => boolean) } = {},
  ) {
    const capture = jest.fn(async () => ({ ...win, jpegBase64: 'IMG', width: 1, height: 1, capturedAt: 0 }));
    const classify = jest.fn(async () => (opts.vlm === undefined ? VLM : opts.vlm));
    const step: ScreenModelStep = {
      ready: jest.fn(async () => opts.ready ?? true),
      classify: jest.fn(async () => {
        if (result instanceof Error) throw result;
        return { verdict: null, window: win, ocrChars: 400, tookMs: 300, ...result };
      }),
      unload: jest.fn(async () => {}),
    };
    const ollama = { classify, warmUp: jest.fn(async () => {}), unload: jest.fn(async () => {}) };
    const c = createClassifier({
      native: { screen: { getActiveWindow: async () => win, capture } },
      ollama,
      now: () => 0,
      config: { USE_MOCK_CLASSIFIER: false, CACHE_TTL_MS: 120_000, CAPTURE: { maxWidth: 1024, jpegQuality: 0.6 } },
      screenModel: step,
      screenModelOnly: typeof opts.only === 'function' ? opts.only : () => opts.only === true,
    });
    return { c, capture, classify, step, ollama };
  }

  const embed = (confidence: number): ScreenVerdict => ({ studying: true, moduleId: 'lib_calculus', activity: '', confidence, source: 'embed' });

  it('answers from the screen model when it is confident: no JPEG, no Ollama', async () => {
    const { c, capture, classify } = setup({ verdict: embed(0.8) });
    const r = await c.classifyCurrent(MODULES);
    expect(r.verdict).toMatchObject({ moduleId: 'lib_calculus', source: 'embed' });
    expect(r.tookScreenshot).toBe(true);
    expect(capture).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it('caches a confident answer like a VLM one', async () => {
    const { c, step } = setup({ verdict: embed(0.8) });
    await c.classifyCurrent(MODULES);
    const again = await c.classifyCurrent(MODULES);
    expect(again.verdict?.source).toBe('cache');
    expect(step.classify).toHaveBeenCalledTimes(1);
  });

  it('asks Ollama when the screen model is unsure', async () => {
    const { c, classify } = setup({ verdict: embed(MIN_CONFIDENCE - 0.05) });
    const r = await c.classifyCurrent(MODULES);
    expect(classify).toHaveBeenCalled();
    expect(r.verdict).toMatchObject({ moduleId: 'lib_history', source: 'vlm' });
  });

  const notStudy = (confidence: number): ScreenVerdict => ({ studying: false, moduleId: null, activity: '', confidence, source: 'embed' });

  it('has Ollama check a "not study" call that is not clearly sure', async () => {
    // 1 - P(study) is never below 0.5, so the study bar alone would let every distraction call through.
    const { c, classify } = setup({ verdict: notStudy(MIN_NOT_STUDY_CONFIDENCE - 0.1) });
    const r = await c.classifyCurrent(MODULES);
    expect(classify).toHaveBeenCalled();
    expect(r.verdict).toMatchObject({ studying: true, source: 'vlm' });
  });

  it('trusts a clear "not study" call without Ollama', async () => {
    const { c, capture, classify } = setup({ verdict: notStudy(MIN_NOT_STUDY_CONFIDENCE + 0.05) });
    const r = await c.classifyCurrent(MODULES);
    expect(r.verdict).toMatchObject({ studying: false, source: 'embed' });
    expect(capture).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it('keeps an unsure verdict when Ollama cannot answer either', async () => {
    const { c } = setup({ verdict: embed(FALLBACK_CONFIDENCE + 0.05) }, { vlm: null });
    const r = await c.classifyCurrent(MODULES);
    expect(r.verdict).toMatchObject({ moduleId: 'lib_calculus', source: 'embed' });
    expect(r.error).toBeUndefined();
  });

  it('falls back to Ollama when the model is not installed or fails', async () => {
    const notReady = setup({ verdict: embed(0.9) }, { ready: false });
    expect((await notReady.c.classifyCurrent(MODULES)).verdict?.source).toBe('vlm');
    expect(notReady.step.classify).not.toHaveBeenCalled();

    const failing = setup(new Error('E_MODEL'));
    expect((await failing.c.classifyCurrent(MODULES)).verdict?.source).toBe('vlm');
  });

  it('unloads both models at session end', async () => {
    const { c, step } = setup({ verdict: embed(0.8) });
    await c.unload();
    expect(step.unload).toHaveBeenCalled();
  });

  describe("'embed' mode (screen model only)", () => {
    it('uses an unsure study verdict as final: no JPEG, no Ollama', async () => {
      const { c, capture, classify } = setup({ verdict: embed(MIN_CONFIDENCE - 0.15) }, { only: true });
      const r = await c.classifyCurrent(MODULES);
      expect(r.verdict).toMatchObject({ studying: true, moduleId: 'lib_calculus', source: 'embed' });
      expect(capture).not.toHaveBeenCalled();
      expect(classify).not.toHaveBeenCalled();
    });

    it(`trusts "not study" from ${EMBED_NOT_STUDY_CONFIDENCE}, below the hybrid bar`, async () => {
      expect(EMBED_NOT_STUDY_CONFIDENCE).toBeLessThan(MIN_NOT_STUDY_CONFIDENCE);
      const { c, classify } = setup({ verdict: notStudy(EMBED_NOT_STUDY_CONFIDENCE + 0.02) }, { only: true });
      expect((await c.classifyCurrent(MODULES)).verdict).toMatchObject({ studying: false, source: 'embed' });
      expect(classify).not.toHaveBeenCalled();
    });

    it('turns a borderline "not study" into unknown (no alert, not an error), still without Ollama', async () => {
      const { c, capture, classify } = setup({ verdict: notStudy(EMBED_NOT_STUDY_CONFIDENCE - 0.05) }, { only: true });
      const r = await c.classifyCurrent(MODULES);
      expect(r.verdict).toBeNull();
      expect(r.error).toBeUndefined();
      expect(capture).not.toHaveBeenCalled();
      expect(classify).not.toHaveBeenCalled();
    });

    it('reads the mode on every call, so a settings change applies to the next check', async () => {
      let only = true;
      const { c, classify } = setup({ verdict: embed(MIN_CONFIDENCE - 0.1) }, { only: () => only });
      expect((await c.classifyCurrent(MODULES)).verdict?.source).toBe('embed');
      expect(classify).not.toHaveBeenCalled();
      c.reset();
      only = false;
      expect((await c.classifyCurrent(MODULES)).verdict?.source).toBe('vlm');
    });

    it('gives `unknown` instead of asking Ollama when the model is missing or fails', async () => {
      const notReady = setup({ verdict: embed(0.9) }, { ready: false, only: true });
      const r = await notReady.c.classifyCurrent(MODULES);
      expect(r).toMatchObject({ verdict: null, error: 'vlm', tookScreenshot: false });
      expect(notReady.capture).not.toHaveBeenCalled();
      expect(notReady.classify).not.toHaveBeenCalled();

      const failing = setup(new Error('E_MODEL'), { only: true });
      expect((await failing.c.classifyCurrent(MODULES)).verdict).toBeNull();
      expect(failing.classify).not.toHaveBeenCalled();
    });

    it('never warms up Ollama, but still unloads both (the mode may have changed mid-session)', async () => {
      const { c, ollama, step } = setup({ verdict: embed(0.8) }, { only: true });
      await c.warmUp(MODULES);
      await c.unload();
      expect(ollama.warmUp).not.toHaveBeenCalled();
      expect(ollama.unload).toHaveBeenCalled();
      expect(step.unload).toHaveBeenCalled();
    });
  });
});
