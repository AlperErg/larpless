/**
 * On-device screen model (Option 1 of the classifier plan): turns FLScreenModel's scores into a verdict.
 *
 * Native code captures the screen, reads its text with OCR, and returns only numbers: a SigLIP 2 logit per
 * fixed image prompt (one per library subject, plus generic "study" and "distraction" prompts), a MiniLM
 * cosine between the window title + screen text and each module description, and how many of each module's
 * keywords appear there as whole words. This file fuses them exactly like scripts/embed_bench/bench.py
 * `fused_predict`, with the parameters the bench validated (APP_PARAMS there; keep the two in sync):
 *
 *   gate     = gImg * imageMargin + bias + gKw * min(maxHits, 3) (+ gTxt * textMargin with OCR text) → P(study)
 *   subject  = argmax of the weighted mean of softmax(image / tImg) (weight 1 - alpha), softmax(text / tTxt)
 *              (alpha, when OCR found text) and softmax(hits / tKw) (beta, when any keyword matched)
 *   confidence = P(study) * P(subject)   (or 1 - P(study) for "not study")
 *
 * v2 parameters come from 18 real screenshots and still win on 54 (30 study screens, 24 distractions):
 * leave-one-out top-1 94% with library subjects, 87% with a custom course that has no keywords (94% with
 * keywords), study vs distraction 54/54.
 *
 * Used only in the 'classifier' mode (Settings → Local AI), where its verdict is final; in the 'vlm' mode
 * Ollama reads the screen and this model is never run. Custom courses have no image prompt (the SigLIP text
 * tower isn't shipped), so they're chosen from the screen text only. Pure: no React Native, no stores.
 */
import type { ScreenLanguage, ScreenVerdict, StudyModule } from '../contracts/domain';
import type { ActiveWindow, ScreenModelApi, ScreenModelFile, ScreenModelInput, ScreenModelScores } from '../contracts/native';
import { OCR_LANGUAGE } from './screenLanguage';
import { TEXT_DISTRACTIONS_ES } from './subjectKeywords.es';

/**
 * Pinned Hugging Face files (commit + SHA-256), downloaded once at onboarding into LocalFolder\Models (Windows) or
 * ~/Library/Application Support/<bundle id>/Models (macOS). One text model serves every screen language, so
 * switching language never needs another download: the multilingual MiniLM (bench 2026-11: Spanish screens 7/14 →
 * 13/14; English dev 50/54, holdout 9/11 vs 10/11 with all-MiniLM-L6-v2; same speed, ~50 MB more RAM).
 */
export const SCREEN_MODEL_FILES: ScreenModelFile[] = [
  {
    // SigLIP 2 base/16 at 224 px, vision tower only (Apache-2.0, google/siglip2-base-patch16-224).
    name: 'siglip2-vision.onnx',
    url: 'https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/ba1f3b0843f24bc5417d38e19c37b287d719b2f4/onnx/vision_model.onnx',
    sha256: 'c0573e3f4140c3a7c4e9cc5912bd6b26a033b46a6a8e8af26cbea262b163bcad',
    size: 371_807_752,
  },
  {
    // paraphrase-multilingual-MiniLM-L12-v2 (Apache-2.0), int8 ONNX export. Its SentencePiece vocabulary is
    // derived from tokenizer.json and ships inside the app (minilm-ml-vocab.txt), so only the model downloads.
    name: 'minilm-ml.onnx',
    url: 'https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/2c4055b12046f11709e9df2c122e59ffbdc2f900/onnx/model_int8.onnx',
    sha256: 'd6ea442ff6a891daefed7c83b2f596fc5dc66bf697e4d006236f64f34bbcf4c8',
    size: 118_054_609,
  },
];

export const SCREEN_MODEL_BYTES = SCREEN_MODEL_FILES.reduce((n, f) => n + f.size, 0);

export const FUSION = { alpha: 0.25, tImg: 1.0, tTxt: 0.05, gImg: 0.5, gTxt: 0.0, bias: 0.0, beta: 0.5, tKw: 0.5, gKw: 0.0 };
/** Below this many OCR characters the screen text is ignored (title-only text is too thin). */
export const MIN_OCR_CHARS = 40;

/** Text-side "not study" descriptions (same as bench.py TEXT_DISTRACTIONS). */
export const TEXT_DISTRACTIONS = [
  'social media feed: likes, followers, comments, stories, reels, posts',
  'online shopping: add to cart, price, checkout, free delivery, reviews',
  'chat messages: online, typing, sent, seen, group chat',
  'entertainment video: music video, subscribe, playlist, views, trailer',
  'video game: play, level, score, players, match, lobby',
  'streaming: watch now, episode, season, continue watching',
];

/**
 * A "not study" call below this (P(study) between 0.4 and 0.5) is `unknown` instead, so a borderline screen
 * doesn't fire distraction alerts. Its confidence is 1 - P(study), which is never below 0.5. On the
 * 54-screenshot bench every distraction reaches confidence >= 0.6 (P(study) <= 0.4) and no study screen is
 * called a distraction, so 0.6 flags all 24 with a margin on both sides. Study calls have no bar.
 */
export const EMBED_NOT_STUDY_CONFIDENCE = 0.6;

/**
 * Good enough to use ('classifier' mode has no Ollama behind it). Every study call counts, whatever its
 * confidence: the subject guess is mostly right even when unsure. "Not study" needs EMBED_NOT_STUDY_CONFIDENCE.
 */
export function isFinalAlone(v: ScreenVerdict): boolean {
  return v.studying || v.confidence >= EMBED_NOT_STUDY_CONFIDENCE;
}

/**
 * What native code embeds and scores the screen text against. `modules` come already localized
 * (screenLanguage.ts localizeModules); with Spanish, the Spanish "not study" descriptions are added.
 */
export function screenModelTexts(
  modules: Pick<StudyModule, 'id' | 'name' | 'keywords'>[],
  language: ScreenLanguage = 'en',
): ScreenModelInput['texts'] {
  const distractions = language === 'es' ? [...TEXT_DISTRACTIONS, ...TEXT_DISTRACTIONS_ES] : TEXT_DISTRACTIONS;
  return [
    ...modules.map((m) => ({
      id: m.id,
      text: m.keywords.length ? `${m.name}: ${m.keywords.join(', ')}` : m.name,
      keywords: [...m.keywords, m.name],
    })),
    ...distractions.map((text, i) => ({ id: `distract:${i}`, text })),
  ];
}

function maxOf(values: number[]): number {
  return values.length ? Math.max(...values) : -Infinity;
}

function softmax(values: number[], t: number): number[] {
  const m = maxOf(values);
  const e = values.map((v) => Math.exp((v - m) / t));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Scores → verdict, or null when nothing can be said (no module has an image prompt and there's no text). */
export function fuseScores(
  scores: Pick<ScreenModelScores, 'image' | 'text' | 'ocrChars'> & Partial<Pick<ScreenModelScores, 'keywords'>>,
  modules: Pick<StudyModule, 'id'>[],
  p = FUSION,
): ScreenVerdict | null {
  const entries = Object.entries(scores.image);
  const study = maxOf(entries.filter(([k]) => k.startsWith('study:')).map(([, v]) => v));
  const distract = maxOf(entries.filter(([k]) => k.startsWith('distract:')).map(([, v]) => v));
  const imgSubj = modules.map((m) => scores.image[m.id]);
  const imgKnown = imgSubj.filter((v): v is number => typeof v === 'number');
  if (!Number.isFinite(distract)) return null;
  // The gate (study or not) uses every library subject's prompt, as the bench validated it, not only the subjects
  // the user has turned on: a subject switched off (or shadowed by a same-name course) still looks like study.
  const library = maxOf(entries.filter(([k]) => k.startsWith('lib_')).map(([, v]) => v));
  const imageMargin = Math.max(study, library, maxOf(imgKnown)) - distract;

  const text = scores.text;
  const hasText = text !== null && scores.ocrChars >= MIN_OCR_CHARS;
  let textSubj: number[] = [];
  let textMargin = 0;
  if (hasText) {
    textSubj = modules.map((m) => text[m.id] ?? -1);
    const textDistract = maxOf(Object.entries(text).filter(([k]) => k.startsWith('distract:')).map(([, v]) => v));
    textMargin = maxOf(textSubj) - (Number.isFinite(textDistract) ? textDistract : 0);
  }

  const hits = modules.map((m) => scores.keywords?.[m.id] ?? 0);
  const maxHits = Math.max(0, ...hits);
  const pStudy = sigmoid(p.gImg * imageMargin + p.bias + p.gKw * Math.min(maxHits, 3) + (hasText ? p.gTxt * textMargin : 0));
  if (pStudy < 0.5) {
    return { studying: false, moduleId: null, activity: '', confidence: 1 - pStudy, source: 'embed' };
  }

  // Weighted mean of the signals that are present. Custom courses get 0 on the image side (no prompt).
  const parts: { w: number; probs: number[] }[] = [];
  const knownIdx = imgSubj.map((v, i) => (typeof v === 'number' ? i : -1)).filter((i) => i >= 0);
  if (knownIdx.length) {
    const imgProbs = new Array<number>(modules.length).fill(0);
    softmax(knownIdx.map((i) => imgSubj[i] as number), p.tImg).forEach((v, j) => {
      imgProbs[knownIdx[j]] = v;
    });
    parts.push({ w: 1 - p.alpha, probs: imgProbs });
  }
  if (hasText) parts.push({ w: p.alpha, probs: softmax(textSubj, p.tTxt) });
  if (maxHits > 0 && p.beta > 0) parts.push({ w: p.beta, probs: softmax(hits, p.tKw) });
  const total = parts.reduce((n, x) => n + x.w, 0);
  if (!parts.length || total <= 0) return null;
  const probs = modules.map((_, i) => parts.reduce((n, x) => n + x.w * x.probs[i], 0) / total);
  let best = 0;
  probs.forEach((v, i) => {
    if (v > probs[best]) best = i;
  });
  return { studying: true, moduleId: modules[best].id, activity: '', confidence: pStudy * probs[best], source: 'embed' };
}

export interface ScreenModelResult {
  verdict: ScreenVerdict | null;
  window: ActiveWindow;
  ocrChars: number;
  tookMs: number;
}

/** The classifier's view of the screen model (see createScreenModelStep). */
export interface ScreenModelStep {
  /** Installed and supported on this platform. Cheap: cached between calls. */
  ready(): Promise<boolean>;
  classify(modules: StudyModule[], opts: { maxWidth: number }): Promise<ScreenModelResult>;
  unload(): Promise<void>;
}

const STATUS_RECHECK_MS = 60_000;
/** Longest a session end waits for the native unload. */
export const UNLOAD_WAIT_MS = 3_000;

export function createScreenModelStep(deps: {
  api: ScreenModelApi;
  now: () => number;
  /** Settings → Screen language: the OCR language and the extra text distractions. Default English. */
  language?: () => ScreenLanguage;
  log?: (line: string) => void;
}): ScreenModelStep {
  let installed: boolean | null = null;
  let checkedAt = -Infinity;
  const log = deps.log ?? ((line: string) => console.log(line));
  return {
    async ready() {
      if (installed === true) return true;
      if (deps.now() - checkedAt < STATUS_RECHECK_MS) return false;
      checkedAt = deps.now();
      try {
        const s = await deps.api.status(SCREEN_MODEL_FILES);
        installed = s.supported && s.installed;
      } catch {
        installed = false;
      }
      return installed;
    },
    async classify(modules, { maxWidth }) {
      const started = deps.now();
      const language = deps.language?.() ?? 'en';
      const scores = await deps.api.classify({
        maxWidth: Math.max(224, maxWidth),
        ocrLanguage: OCR_LANGUAGE[language],
        texts: screenModelTexts(modules, language),
      });
      const verdict = fuseScores(scores, modules);
      const tookMs = Math.max(0, deps.now() - started);
      const label = verdict ? (verdict.studying ? modules.find((m) => m.id === verdict.moduleId)?.name : 'Not study') : 'none';
      // PRIVACY: timings, sizes and the label only; never the title or screen text.
      log(
        `[embed] ${tookMs} ms (ocr ${Math.round(scores.timings.ocrMs)}, image ${Math.round(scores.timings.imageMs)}, ` +
          `text ${Math.round(scores.timings.textMs)}; ${scores.ocrChars} chars) → ${label} ${verdict ? verdict.confidence.toFixed(2) : ''}`,
      );
      const { appName, bundleId, windowTitle, isSelf } = scores;
      return { verdict, window: { appName, bundleId, windowTitle, isSelf }, ocrChars: scores.ocrChars, tookMs };
    },
    async unload() {
      // Native unload waits for a classify still running after its JS deadline; don't let that hold up the
      // end of a session (the native side drops the models once it gets the lock).
      let timer: ReturnType<typeof setTimeout> | null = null;
      const bound = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, UNLOAD_WAIT_MS);
      });
      await Promise.race([deps.api.unload().catch(() => {}), bound]);
      if (timer !== null) clearTimeout(timer);
    },
  };
}
