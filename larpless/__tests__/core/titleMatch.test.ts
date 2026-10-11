import type { StudyModule } from '../../src/contracts/domain';
import { LIBRARY_MODULES } from '../../src/core/subjectLibrary';
import { findModuleBySubstring, isLibraryModule, isWordChar, matchModuleByTitle, normalizeText, titleHasKeyword } from '../../src/core/titleMatch';
import { fixtureModules } from '../../src/fixtures/data';

const mod = (id: string, name: string, keywords: string[]): StudyModule => ({ id, name, color: 'blue', keywords });
const has = (title: string, kw: string) => titleHasKeyword(normalizeText(title), kw);

describe('titleMatch: whole words', () => {
  it('isWordChar: letters of any cased script and ASCII digits; _ and punctuation are boundaries', () => {
    expect(['a', 'Z', 'é', 'ñ', 'ß', 'Ж', '0', '9'].every(isWordChar)).toBe(true);
    expect(['_', '-', '.', ' ', '–', '(', '/'].some(isWordChar)).toBe(false);
  });

  it('does not match inside other words', () => {
    expect(has('Excellent.pdf', 'cell')).toBe(false);
    expect(has('Order cancellation', 'cell')).toBe(false);
    expect(has('submatrix notes', 'matrix')).toBe(false);
    expect(has('encélula', 'célula')).toBe(false);
    expect(has('XBIO101 notes', 'BIO')).toBe(false);
    expect(has('BIO_101 notes', 'BIO')).toBe(true);
  });

  it('checks every occurrence, not only the first', () => {
    expect(has('Excellent cell diagram', 'cell')).toBe(true);
  });

  it('never matches keywords with fewer than 3 word characters', () => {
    expect(has('AI lecture', 'AI')).toBe(false);
    expect(has('AI lecture', ' AI ')).toBe(false);
    expect(has('C++ primer', 'C++')).toBe(false);
    expect(has('R basics', 'R')).toBe(false);
  });

  it('matches whole words, a letter→digit step and accented words', () => {
    expect(has('MATH201 slides', 'MATH')).toBe(true);
    expect(has('Apuntes de Biología.pdf', 'Biología')).toBe(true);
    expect(has('Cell division – Lecture', 'cell')).toBe(true);
    expect(has('The periodic   table quiz', 'periodic  table')).toBe(true);
    // A keyword ending in a digit needs a real boundary after it.
    expect(has('BIO1010 notes', 'BIO101')).toBe(false);
  });

  it('stem: a single-word 6+ letter keyword matches its stem as a word prefix', () => {
    expect(has('Integration by parts – YouTube', 'integral')).toBe(true);
    expect(has('células madre', 'célula')).toBe(true);
    expect(has('Disintegration loops', 'integral')).toBe(false);
    // Multi-word and short keywords get no stem.
    expect(has('periodic tables', 'periodic table')).toBe(false);
    expect(has('cells', 'cell')).toBe(false);
  });
});

describe('matchModuleByTitle', () => {
  it('finds a module by keyword, stem or name', () => {
    expect(matchModuleByTitle('Integration by parts – YouTube', fixtureModules)?.id).toBe('mod_maths');
    expect(matchModuleByTitle('MATH201 Problem set 3.pdf', fixtureModules)?.id).toBe('mod_maths');
    expect(matchModuleByTitle('History essay draft', fixtureModules)?.id).toBe('mod_history');
    expect(matchModuleByTitle('BIO101 Lecture 4.pdf', fixtureModules)?.id).toBe('mod_biology');
    const es = [mod('mod_bio', 'Biología', ['célula'])];
    expect(matchModuleByTitle('Apuntes de Biología.pdf', es)?.id).toBe('mod_bio');
    expect(matchModuleByTitle('células madre – Wikipedia', es)?.id).toBe('mod_bio');
  });

  it('null for no title, no match, or a word only inside another word', () => {
    expect(matchModuleByTitle(null, fixtureModules)).toBeNull();
    expect(matchModuleByTitle('', fixtureModules)).toBeNull();
    expect(matchModuleByTitle('Some music video', fixtureModules)).toBeNull();
    expect(matchModuleByTitle('Excellent.pdf', fixtureModules)).toBeNull();
    expect(matchModuleByTitle('submatrix', fixtureModules)).toBeNull();
    expect(matchModuleByTitle('AI news', [mod('mod_ai', 'AI', ['AI'])])).toBeNull();
  });

  it('ambiguity: two own modules → null', () => {
    const mods = [mod('mod_a', 'Genetics', ['cell']), mod('mod_b', 'Biochem', ['cell'])];
    expect(matchModuleByTitle('cell membrane notes', mods)).toBeNull();
  });

  it('ambiguity: own module beats a library subject', () => {
    const mods = [mod('lib_biology', 'Biology', ['cell']), mod('mod_x', 'Histology', ['cell'])];
    expect(matchModuleByTitle('cell membrane notes', mods)?.id).toBe('mod_x');
  });

  it('ambiguity: two library subjects → null', () => {
    const mods = [mod('lib_biology', 'Biology', ['cell']), mod('lib_anatomy', 'Anatomy', ['cell'])];
    expect(matchModuleByTitle('cell membrane notes', mods)).toBeNull();
  });

  it('library subjects match whole words too', () => {
    const astronomy = LIBRARY_MODULES.find((m) => m.id === 'lib_astronomy')!;
    expect(astronomy.keywords).toContain('star');
    expect(matchModuleByTitle('Star map homework', LIBRARY_MODULES)?.id).toBe('lib_astronomy');
    expect(matchModuleByTitle('starter pack', LIBRARY_MODULES)).toBeNull();
    expect(matchModuleByTitle('Starter pack', [astronomy])).toBeNull();
  });

  it('isLibraryModule: library ids start with lib_', () => {
    expect(LIBRARY_MODULES.every(isLibraryModule)).toBe(true);
    expect(fixtureModules.some(isLibraryModule)).toBe(false);
  });
});

describe('findModuleBySubstring (dev mock matching)', () => {
  /** The mock's matching before it moved to titleMatch.ts, kept verbatim as the reference. */
  function legacy(windowTitle: string | null, modules: StudyModule[]) {
    const lc = (s: string) => s.toLowerCase();
    const title = lc(windowTitle ?? '');
    return title
      ? modules.find((m) =>
          [m.name, ...m.keywords].some((k) => {
            const kw = lc(k.trim());
            if (!kw) return false;
            return title.includes(kw) || (kw.length >= 6 && title.includes(kw.slice(0, -1)));
          }),
        )
      : undefined;
  }

  const titles = [
    null,
    '',
    'MATH201 Problem set 3.pdf',
    'Integration by parts – YouTube',
    'History essay draft',
    'Some music video',
    'Excellent.pdf',
    'submatrix',
    'XBIO101 notes',
    'Star map homework',
    'starter pack',
    'Apuntes de Biología.pdf',
    'células madre',
    'Visual Studio Code',
    'cell membrane notes',
  ];
  const moduleSets: StudyModule[][] = [
    fixtureModules,
    LIBRARY_MODULES,
    [...fixtureModules, ...LIBRARY_MODULES],
    [mod('mod_bio', 'Biología', ['célula', '  ', '']), mod('mod_x', 'X', ['cell'])],
  ];

  it('gives exactly the old results (first module in array order, substring + 6+ stem)', () => {
    for (const mods of moduleSets) {
      for (const t of titles) {
        expect(findModuleBySubstring(t, mods)).toBe(legacy(t, mods));
      }
    }
    // Substring semantics, unlike matchModuleByTitle.
    expect(findModuleBySubstring('Excellent.pdf', fixtureModules)?.id).toBe('mod_biology');
  });
});
