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
 * v2 parameters come from 18 real screenshots (12 study screens across 9 courses + 4 distractions + 2 more
 * study): leave-one-out top-1 94% with library subjects, 72% with custom courses that have no keywords.
 *
 * Custom courses have no image prompt (the SigLIP text tower isn't shipped), so they're chosen from the
 * screen text only. Pure: no React Native, no stores.
 */
import type { ScreenVerdict, StudyModule } from '../contracts/domain';
import type { ActiveWindow, ScreenModelApi, ScreenModelFile, ScreenModelScores } from '../contracts/native';

/** Pinned Hugging Face files (commit + SHA-256), downloaded once at onboarding into LocalFolder\Models. */
export const SCREEN_MODEL_FILES: ScreenModelFile[] = [
  {
    // SigLIP 2 base/16 at 224 px, vision tower only (Apache-2.0, google/siglip2-base-patch16-224).
    name: 'siglip2-vision.onnx',
    url: 'https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/ba1f3b0843f24bc5417d38e19c37b287d719b2f4/onnx/vision_model.onnx',
    sha256: 'c0573e3f4140c3a7c4e9cc5912bd6b26a033b46a6a8e8af26cbea262b163bcad',
    size: 371_807_752,
  },
  {
    // all-MiniLM-L6-v2 (Apache-2.0).
    name: 'minilm.onnx',
    url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/onnx/model.onnx',
    sha256: '759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e',
    size: 90_387_606,
  },
  {
    name: 'minilm-vocab.txt',
    url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/vocab.txt',
    sha256: '07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3',
    size: 231_508,
  },
];

export const SCREEN_MODEL_BYTES = SCREEN_MODEL_FILES.reduce((n, f) => n + f.size, 0);

export const FUSION = { alpha: 0.25, tImg: 1.0, tTxt: 0.05, gImg: 0.5, gTxt: 0.0, bias: 0.0, beta: 0.5, tKw: 0.5, gKw: 0.0 };
/** Below this many OCR characters the screen text is ignored (title-only text is too thin). */
export const MIN_OCR_CHARS = 40;
/**
 * Use the verdict at or above this; below it, ask Ollama. P(subject) is spread over 44+ subjects, so real
 * answers sit low: on the 18-screenshot bench >= 0.15 answered half the screens at 89-100% accuracy.
 */
export const MIN_CONFIDENCE = 0.15;
/** If Ollama can't answer either, still use a verdict at or above this rather than `unknown`. */
export const FALLBACK_CONFIDENCE = 0.05;

/** Text-side "not study" descriptions (same as bench.py TEXT_DISTRACTIONS). */
export const TEXT_DISTRACTIONS = [
  'social media feed: likes, followers, comments, stories, reels, posts',
  'online shopping: add to cart, price, checkout, free delivery, reviews',
  'chat messages: online, typing, sent, seen, group chat',
  'entertainment video: music video, subscribe, playlist, views, trailer',
  'video game: play, level, score, players, match, lobby',
  'streaming: watch now, episode, season, continue watching',
];

/** What native code embeds and scores the screen text against. */
export function screenModelTexts(modules: Pick<StudyModule, 'id' | 'name' | 'keywords'>[]): { id: string; text: string }[] {
  return [
    ...modules.map((m) => ({
      id: m.id,
      text: m.keywords.length ? `${m.name}: ${m.keywords.join(', ')}` : m.name,
      keywords: [...m.keywords, m.name],
    })),
    ...TEXT_DISTRACTIONS.map((text, i) => ({ id: `distract:${i}`, text })),
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
  const imageMargin = Math.max(study, maxOf(imgKnown)) - distract;

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

export function createScreenModelStep(deps: {
  api: ScreenModelApi;
  now: () => number;
  ocrLanguage?: () => string | undefined;
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
      const scores = await deps.api.classify({
        maxWidth: Math.max(224, maxWidth),
        ocrLanguage: deps.ocrLanguage?.(),
        texts: screenModelTexts(modules),
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
      await deps.api.unload().catch(() => {});
    },
  };
}
