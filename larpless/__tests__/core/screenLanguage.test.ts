import type { ScreenModelApi, ScreenModelScores } from '../../src/contracts/native';
import { cleanSettings } from '../../src/core/db';
import { buildSystem } from '../../src/core/prompt';
import { localizeModules, OCR_LANGUAGE, ocrLanguageMissing, screenLanguageHint } from '../../src/core/screenLanguage';
import { createScreenModelStep, SCREEN_MODEL_FILES, screenModelTexts, TEXT_DISTRACTIONS } from '../../src/core/screenModel';
import { ENGLISH_COURSE_CODES, SUBJECT_KEYWORDS_ES, TEXT_DISTRACTIONS_ES } from '../../src/core/subjectKeywords.es';
import { LIBRARY_MODULES, librarySubjectId } from '../../src/core/subjectLibrary';

const lib = (name: string) => LIBRARY_MODULES.find((m) => m.name === name)!;
const course = { id: 'mod_thesis', name: 'Thesis', color: 'purple' as const, keywords: ['LaTeX', 'BIO'] };

describe('localizeModules', () => {
  it('leaves everything alone in English', () => {
    const mods = [lib('Biology'), course];
    expect(localizeModules(mods, 'en')).toBe(mods);
  });

  it('puts the Spanish name and keywords first, keeps English jargon, and drops English course codes', () => {
    const [bio] = localizeModules([lib('Biology')], 'es');
    expect(bio.id).toBe(librarySubjectId('Biology'));
    expect(bio.name).toBe('Biology'); // verdicts, chunks and the UI keep the English name
    expect(bio.keywords.slice(0, 3)).toEqual(['Biología', 'célula', 'mitosis']);
    expect(bio.keywords).toContain('DNA');
    expect(bio.keywords).not.toContain('BIO');
    expect(lib('Biology').keywords).toContain('BIO'); // the library itself is not changed
  });

  it("never touches the user's own courses", () => {
    expect(localizeModules([course], 'es')).toEqual([course]);
  });

  it('every English course code is a real library keyword', () => {
    const all = new Set(LIBRARY_MODULES.flatMap((m) => m.keywords));
    expect([...ENGLISH_COURSE_CODES].filter((c) => !all.has(c))).toEqual([]);
  });
});

describe('screen model inputs', () => {
  it('adds the Spanish text distractions only for Spanish', () => {
    const count = (lang: 'en' | 'es') => screenModelTexts([lib('Law')], lang).filter((t) => t.id.startsWith('distract:')).length;
    expect(count('en')).toBe(TEXT_DISTRACTIONS.length);
    expect(count('es')).toBe(TEXT_DISTRACTIONS.length + TEXT_DISTRACTIONS_ES.length);
  });

  it('sends the OCR language for the setting, English by default', async () => {
    const scores = {
      image: { 'distract:0': -10, 'study:0': 5 },
      text: null,
      keywords: null,
      ocrChars: 0,
      appName: 'Preview',
      bundleId: null,
      windowTitle: null,
      isSelf: false,
      width: 1,
      height: 1,
      capturedAt: 0,
      timings: { captureMs: 0, ocrMs: 0, imageMs: 0, textMs: 0 },
    } as unknown as ScreenModelScores;
    const classify = jest.fn(async () => scores);
    const api = { classify } as unknown as ScreenModelApi;
    let lang: 'en' | 'es' = 'en';
    const step = createScreenModelStep({ api, now: () => 0, language: () => lang, log: () => {} });
    await step.classify([lib('Law')], { maxWidth: 1024 });
    lang = 'es';
    await step.classify(localizeModules([lib('Law')], 'es'), { maxWidth: 1024 });
    const inputs = (classify.mock.calls as unknown as [{ ocrLanguage: string; texts: { id: string; keywords?: string[] }[] }][]).map(([i]) => i);
    expect(inputs.map((i) => i.ocrLanguage)).toEqual([OCR_LANGUAGE.en, OCR_LANGUAGE.es]);
    expect(inputs[1].texts[0].keywords).toEqual(expect.arrayContaining(['Derecho', 'jurisprudencia']));
    const noLang = createScreenModelStep({ api, now: () => 0, log: () => {} });
    await noLang.classify([lib('Law')], { maxWidth: 1024 });
    expect((classify.mock.calls[2] as unknown as [{ ocrLanguage: string }])[0].ocrLanguage).toBe('en-US');
  });
});

describe('model files', () => {
  it('one multilingual text model for every screen language, so switching never downloads anything', () => {
    expect(SCREEN_MODEL_FILES.map((f) => f.name)).toEqual(['siglip2-vision.onnx', 'minilm-ml.onnx', 'minilm-ml-vocab.txt']);
    for (const f of SCREEN_MODEL_FILES) {
      expect(f.url.startsWith('https://huggingface.co/')).toBe(true);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('downloads the vocabulary as unigram.json from the same pinned commit as the text model', () => {
    // FLScreenModel.h accepts minilm-ml-vocab.txt only from a URL ending in /unigram.json, and converts it.
    const byName = new Map(SCREEN_MODEL_FILES.map((f) => [f.name, f]));
    const model = byName.get('minilm-ml.onnx')!;
    const vocab = byName.get('minilm-ml-vocab.txt')!;
    expect(vocab.url.endsWith('/unigram.json')).toBe(true);
    expect(vocab.url.replace(/\/unigram\.json$/, '')).toBe(model.url.replace(/\/onnx\/model_int8\.onnx$/, ''));
  });
});

describe('ocrLanguageMissing', () => {
  it('flags a screen language with no installed OCR pack, only when native code reports the packs', () => {
    expect(ocrLanguageMissing(['en-US', 'en-GB'], 'es')).toBe(true);
    expect(ocrLanguageMissing(['en-US', 'es-ES'], 'es')).toBe(false);
    expect(ocrLanguageMissing(['es-MX'], 'es')).toBe(false);
    expect(ocrLanguageMissing(['en-US'], 'en')).toBe(false);
    expect(ocrLanguageMissing(undefined, 'es')).toBe(false); // Apple Vision reads every supported language
  });
});

describe('the setting', () => {
  it('defaults to English and drops anything unknown', () => {
    expect(cleanSettings({}).screenLanguage).toBe('en');
    expect(cleanSettings({ screenLanguage: 'es' }).screenLanguage).toBe('es');
    expect(cleanSettings({ screenLanguage: 'fr' }).screenLanguage).toBe('en');
  });
});

describe('vision LLM prompt', () => {
  it('adds the Spanish line only for Spanish and keeps the English module names', () => {
    const mods = localizeModules([lib('Calculus')], 'es');
    const es = buildSystem(mods, 'es');
    expect(es).toContain(screenLanguageHint('es')!);
    expect(es).toContain('- Calculus: Cálculo, derivada');
    expect(buildSystem([lib('Calculus')], 'en')).not.toContain('Spanish');
    expect(buildSystem([lib('Calculus')])).toBe(buildSystem([lib('Calculus')], 'en'));
  });

  it('every Spanish subject entry belongs to a library subject', () => {
    expect(Object.keys(SUBJECT_KEYWORDS_ES).every((n) => LIBRARY_MODULES.some((m) => m.name === n))).toBe(true);
  });
});
