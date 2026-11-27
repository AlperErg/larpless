/**
 * Settings → Screen language: what changes with the language most screens are in.
 *
 * - OCR reads the screen in that language (`OCR_LANGUAGE`, passed to FLScreenModel as `ocrLanguage`).
 * - Built-in subjects get that language's name and keywords (`localizeModules`), for the screen model's keyword
 *   vote and text embedding and for the vision LLM's module list. Names and ids stay English: they are what
 *   verdicts, saved chunks and the UI use.
 * - The screen model's text "not study" descriptions get that language's versions too (`screenModelTexts`).
 *
 * Bench (scripts/embed_bench/bench.py --lang es, mirrored there): on 14 Spanish screens the app went from 7/14
 * (English OCR and keywords) to 12-13/14. Pure: no React Native, no stores.
 */
import type { ScreenLanguage, StudyModule } from '../contracts/domain';
import { ENGLISH_COURSE_CODES, SUBJECT_KEYWORDS_ES } from './subjectKeywords.es';

/** BCP-47 tag FLScreenModel hands to Apple Vision / Windows.Media.Ocr. */
export const OCR_LANGUAGE: Record<ScreenLanguage, string> = { en: 'en-US', es: 'es-ES' };

export const SCREEN_LANGUAGES: { value: ScreenLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

/**
 * Library subjects with the language's words first (its name, then its keywords) and the English keywords after,
 * minus the English course codes: Spanish material still shows English jargon and tool names (DNA, Python,
 * PyTorch). The vision LLM's prompt keeps the first PROMPT_KEYWORDS_PER_SUBJECT keywords, so it sees the Spanish
 * ones. User courses are left alone.
 */
export function localizeModules<T extends Pick<StudyModule, 'id' | 'name' | 'keywords'>>(modules: T[], language: ScreenLanguage): T[] {
  if (language === 'en') return modules;
  return modules.map((m) => {
    const es = m.id.startsWith('lib_') ? SUBJECT_KEYWORDS_ES[m.name] : undefined;
    return es ? { ...m, keywords: [es.name, ...es.keywords, ...m.keywords.filter((k) => !ENGLISH_COURSE_CODES.has(k))] } : m;
  });
}

/**
 * True when native code reports the OCR languages it can read and none is this screen language (Windows without the
 * language pack: Windows.Media.Ocr falls back to another language and the screen text comes out wrong).
 */
export function ocrLanguageMissing(ocrLanguages: readonly string[] | undefined, language: ScreenLanguage): boolean {
  if (!ocrLanguages) return false;
  return !ocrLanguages.some((tag) => tag.toLowerCase().split('-')[0] === language);
}

/** One line for the vision LLM's system prompt, or null for English. */
export function screenLanguageHint(language: ScreenLanguage | undefined): string | null {
  return language === 'es'
    ? 'Most screens are in Spanish: read Spanish text as normal, and use the Spanish keywords to pick the module. Always answer with the module names exactly as listed.'
    : null;
}
