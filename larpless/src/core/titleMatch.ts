/**
 * Window-title → study module matching. Pure TypeScript, no imports except types.
 *
 * Two matchers:
 * - `matchModuleByTitle`: whole-word matching for the classifier's title-first step (Windows only,
 *   see `ClassifierConfig.TITLE_FIRST`). Conservative: a wrong subject is worse than asking the VLM.
 * - `findModuleBySubstring`: the dev mock's loose substring matching (`mockVerdictFromTitle`).
 *
 * Word boundaries are checked by hand (no lookbehind, no `\p{…}`): Hermes on react-native-windows
 * may not support them. PRIVACY: titles are only read here, never stored or logged.
 */
import type { StudyModule } from '../contracts/domain';

/** Library subjects get ids like "lib_biology" (see `librarySubjectId` in subjectLibrary.ts). */
export function isLibraryModule(m: Pick<StudyModule, 'id'>): boolean {
  return m.id.startsWith('lib_');
}

/** A letter (any script with case) or an ASCII digit. `_` and punctuation are boundaries. */
export function isWordChar(c: string): boolean {
  return c.toUpperCase() !== c.toLowerCase() || (c >= '0' && c <= '9');
}

const isDigit = (c: string) => c >= '0' && c <= '9';
const isLetter = (c: string) => c.toUpperCase() !== c.toLowerCase();

/** Lowercase, trim and collapse internal whitespace. */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function wordCharCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (isWordChar(s[i])) n++;
  return n;
}

/** Keywords with fewer word characters than this ("AI", "R", "C++") are never matched. */
export const MIN_KEYWORD_WORD_CHARS = 3;
/** Single-word keywords at least this long that end in a letter also match their stem as a word prefix. */
export const STEM_MIN_LENGTH = 6;

function leftOk(title: string, at: number, kw: string): boolean {
  if (!isWordChar(kw[0])) return true;
  return at === 0 || !isWordChar(title[at - 1]);
}

function rightOk(title: string, end: number, kw: string): boolean {
  const last = kw[kw.length - 1];
  if (!isWordChar(last)) return true;
  if (end >= title.length) return true;
  const next = title[end];
  if (!isWordChar(next)) return true;
  // "math" matches "math201": a letter → digit step ends the word.
  return isLetter(last) && isDigit(next);
}

/** True when `needle` occurs in `title` with a left boundary and (unless `prefix`) a right one. */
function occursAsWord(title: string, needle: string, prefix: boolean): boolean {
  if (!needle) return false;
  let at = title.indexOf(needle);
  while (at !== -1) {
    if (leftOk(title, at, needle) && (prefix || rightOk(title, at + needle.length, needle))) return true;
    at = title.indexOf(needle, at + 1);
  }
  return false;
}

/**
 * Does the normalized title contain `keyword` as a whole word? Also true when a single-word keyword of
 * STEM_MIN_LENGTH+ characters ending in a letter appears as a word prefix minus its last letter
 * ("integral" → "Integration by parts", "célula" → "células madre").
 */
export function titleHasKeyword(normalizedTitle: string, keyword: string): boolean {
  const kw = normalizeText(keyword);
  if (wordCharCount(kw) < MIN_KEYWORD_WORD_CHARS) return false;
  if (occursAsWord(normalizedTitle, kw, false)) return true;
  const single = kw.indexOf(' ') === -1;
  if (single && kw.length >= STEM_MIN_LENGTH && isLetter(kw[kw.length - 1])) {
    return occursAsWord(normalizedTitle, kw.slice(0, -1), true);
  }
  return false;
}

/**
 * The one module whose name or a keyword appears in the title as a whole word, or null.
 * Several matches: the user's own modules win over library subjects; still several → null.
 */
export function matchModuleByTitle(windowTitle: string | null, modules: readonly StudyModule[]): StudyModule | null {
  if (!windowTitle) return null;
  const title = normalizeText(windowTitle);
  if (!title) return null;
  const hits = modules.filter((m) => [m.name, ...m.keywords].some((k) => titleHasKeyword(title, k)));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) return null;
  const own = hits.filter((m) => !isLibraryModule(m));
  return own.length === 1 ? own[0] : null;
}

/**
 * The dev mock's matching: the first module (array order) whose name or a keyword is a substring of
 * the title; keywords of 6+ characters also match without their last character.
 */
export function findModuleBySubstring(windowTitle: string | null, modules: readonly StudyModule[]): StudyModule | undefined {
  const title = (windowTitle ?? '').toLowerCase();
  if (!title) return undefined;
  return modules.find((m) =>
    [m.name, ...m.keywords].some((k) => {
      const kw = k.trim().toLowerCase();
      if (!kw) return false;
      return title.includes(kw) || (kw.length >= 6 && title.includes(kw.slice(0, -1)));
    }),
  );
}
