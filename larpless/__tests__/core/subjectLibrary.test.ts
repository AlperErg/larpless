import { relabelVerdicts } from '../../src/core/classifier';
import type { ClassifyResult } from '../../src/core/classifier';
import {
  allSubjects,
  candidateSubjects,
  CORE_SUBJECT_NAMES,
  detectableSubjects,
  generalSubjectId,
  isCoreSubject,
  LIBRARY_MODULES,
  librarySubjectId,
  rollUpSubject,
  SUBJECT_GROUPS,
} from '../../src/core/subjectLibrary';
import { SUBJECT_KEYWORDS_ES } from '../../src/core/subjectKeywords.es';
import { fixtureModules } from '../../src/fixtures/data';

const id = librarySubjectId;
const names = (mods: { name: string }[]) => mods.map((m) => m.name);

describe('core subjects (#35)', () => {
  it('are the eight common subjects, all in the library', () => {
    expect([...CORE_SUBJECT_NAMES]).toEqual([
      'Biology',
      'Chemistry',
      'Physics',
      'Maths',
      'Programming',
      'History',
      'Literature',
      'Economics',
    ]);
    expect(CORE_SUBJECT_NAMES.filter((n) => !names(LIBRARY_MODULES).includes(n))).toEqual([]);
    expect(isCoreSubject(id('Biology'))).toBe(true);
    expect(isCoreSubject(id('Astronomy'))).toBe(false);
    expect(isCoreSubject('mod_thesis')).toBe(false);
  });

  it('Programming keeps the id it had as "Coding" and "Computer Science", so saved sessions still resolve', () => {
    expect(id('Programming')).toBe('lib_coding');
    expect(names(LIBRARY_MODULES)).not.toContain('Coding');
    expect(names(LIBRARY_MODULES)).not.toContain('Computer Science');
    expect(new Set(LIBRARY_MODULES.map((m) => m.id)).size).toBe(LIBRARY_MODULES.length);
  });

  it('every general subject is a core subject, and only Maths and Computing subjects have one', () => {
    const withGeneral = LIBRARY_MODULES.filter((m) => generalSubjectId(m.id));
    expect(new Set(withGeneral.map((m) => generalSubjectId(m.id)))).toEqual(new Set([id('Maths'), id('Programming')]));
    expect(generalSubjectId(id('Algorithms'))).toBe(id('Programming'));
    expect(generalSubjectId(id('Calculus'))).toBe(id('Maths'));
    expect(generalSubjectId(id('Maths'))).toBeNull();
    expect(generalSubjectId(id('Law'))).toBeNull();
    expect(generalSubjectId('mod_thesis')).toBeNull();
  });
});

describe('library keywords (#52)', () => {
  const lc = (k: string) => k.trim().toLowerCase();
  /** Keyword → the subjects listing it, case-insensitive. */
  const owners = new Map<string, { subject: string; group: string }[]>();
  for (const g of SUBJECT_GROUPS) {
    for (const s of g.presets) {
      for (const k of s.keywords) owners.set(lc(k), [...(owners.get(lc(k)) ?? []), { subject: s.name, group: g.title }]);
    }
  }
  // Words that genuinely belong to subjects in different groups. A keyword hit votes for every subject that
  // lists it, so a new entry here should be a real overlap, not a generic word.
  const SHARED_ACROSS_GROUPS = ['logic', 'thermodynamics', 'equilibrium', 'cognition', 'circuit', 'er diagram', 'bond'];

  it('no keyword is shared by subjects in different groups, except the known overlaps', () => {
    const across = [...owners].filter(([, o]) => new Set(o.map((x) => x.group)).size > 1).map(([k]) => k);
    expect(across.sort()).toEqual([...SHARED_ACROSS_GROUPS].sort());
  });

  it('Programming has only code-specific keywords, shared with no other subject', () => {
    const programming = LIBRARY_MODULES.find((m) => m.name === 'Programming')!;
    const kws = programming.keywords.map(lc);
    expect(kws).toEqual(expect.not.arrayContaining(['function', 'class', 'variable', 'exercise', 'cs', 'javascript', 'git']));
    expect(kws.filter((k) => owners.get(k)!.length > 1)).toEqual([]);
  });
});

describe('Spanish keywords (screen language Español)', () => {
  /** Lowercase without accents: how the screen model matches keywords. */
  const fold = (k: string) => k.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const groupOf = new Map<string, string>();
  for (const g of SUBJECT_GROUPS) for (const s of g.presets) if (!groupOf.has(s.name)) groupOf.set(s.name, g.title);

  it('covers every library subject, and only library subjects', () => {
    expect(Object.keys(SUBJECT_KEYWORDS_ES).sort()).toEqual(names(LIBRARY_MODULES).sort());
    for (const [subject, es] of Object.entries(SUBJECT_KEYWORDS_ES)) {
      expect({ subject, name: es.name.trim().length > 0, keywords: es.keywords.length >= 2 }).toEqual({ subject, name: true, keywords: true });
    }
  });

  it('no Spanish keyword or name is shared by subjects in different groups', () => {
    const owners = new Map<string, Set<string>>();
    for (const [subject, es] of Object.entries(SUBJECT_KEYWORDS_ES)) {
      for (const k of [es.name, ...es.keywords]) owners.set(fold(k), (owners.get(fold(k)) ?? new Set()).add(groupOf.get(subject)!));
    }
    expect([...owners].filter(([, g]) => g.size > 1).map(([k]) => k)).toEqual([]);
  });

  it('leaves out Spanish words that show up on any screen or on distractions', () => {
    const everyday = ['funcion', 'sistema', 'analisis', 'serie', 'oferta', 'valoracion', 'hilo', 'clasificacion', 'ley', 'van', 'media', 'modelo', 'indice', 'esquema', 'proceso', 'registro', 'artista', 'personaje', 'tratamiento', 'gestion'];
    const all = Object.values(SUBJECT_KEYWORDS_ES).flatMap((es) => es.keywords.map(fold));
    expect(all.filter((k) => everyday.includes(k))).toEqual([]);
  });
});

describe('detectableSubjects', () => {
  const all = allSubjects([{ id: 'mod_thesis', name: 'Thesis', color: 'purple', keywords: [] }]);

  it('drops subjects that are off, own courses included', () => {
    const on = detectableSubjects(all, [id('Astronomy'), 'mod_thesis']);
    expect(on).toHaveLength(all.length - 2);
    expect(names(on)).not.toContain('Astronomy');
    expect(names(on)).not.toContain('Thesis');
  });

  it('keeps core subjects on, whatever the list says', () => {
    const on = detectableSubjects(all, all.map((m) => m.id));
    expect(names(on)).toEqual([...CORE_SUBJECT_NAMES]);
  });

  it('ignores unknown ids, and uses everything when nothing would be left', () => {
    expect(detectableSubjects(fixtureModules, ['mod_gone'])).toEqual(fixtureModules);
    expect(detectableSubjects(fixtureModules, fixtureModules.map((m) => m.id))).toEqual(fixtureModules);
  });
});

describe('subjects that are off roll up to their general subject', () => {
  const all = allSubjects([{ id: 'mod_thesis', name: 'Thesis', color: 'purple', keywords: [] }]);
  const off = [id('Algorithms'), id('Calculus'), id('Law'), 'mod_thesis'];

  it('the classifier still compares an off subject that has a general subject, and no other off subject', () => {
    const candidates = names(candidateSubjects(all, off));
    expect(candidates).toEqual(expect.arrayContaining(['Algorithms', 'Calculus', 'Programming', 'Maths']));
    expect(candidates).not.toContain('Law');
    expect(candidates).not.toContain('Thesis');
    expect(candidateSubjects(all, [])).toEqual(all);
  });

  it('with only the core subjects on, every Maths and Computing subject is still compared', () => {
    const candidates = candidateSubjects(all, all.map((m) => m.id));
    const expected = LIBRARY_MODULES.filter((m) => isCoreSubject(m.id) || generalSubjectId(m.id));
    expect(names(candidates)).toEqual(names(expected));
  });

  it('labels an off subject as its general subject, and leaves the rest alone', () => {
    expect(rollUpSubject(id('Algorithms'), all, off)).toBe(id('Programming'));
    expect(rollUpSubject(id('Calculus'), all, off)).toBe(id('Maths'));
    expect(rollUpSubject(id('Operating Systems'), all, off)).toBe(id('Operating Systems'));
    expect(rollUpSubject(id('Law'), all, off)).toBe(id('Law'));
    expect(rollUpSubject(id('Biology'), all, [id('Biology')])).toBe(id('Biology'));
  });

  it('relabelVerdicts applies it to study verdicts only', async () => {
    const result = (verdict: ClassifyResult['verdict']): ClassifyResult => ({ verdict, tookScreenshot: true, appName: 'Code', key: 'k' });
    const study = result({ studying: true, moduleId: id('Algorithms'), activity: '', confidence: 0.8, source: 'vlm' });
    const distracted = result({ studying: false, moduleId: null, activity: 'Gaming', confidence: 0.9, source: 'vlm' });
    const queue = [study, distracted, result(null)];
    const inner = { classifyCurrent: jest.fn(async (_modules: unknown[]) => queue.shift()!), reset: jest.fn() };
    const wrapped = relabelVerdicts(inner, (m) => rollUpSubject(m, all, off));

    const first = await wrapped.classifyCurrent(candidateSubjects(all, off));
    expect(first.verdict).toMatchObject({ studying: true, moduleId: id('Programming'), confidence: 0.8 });
    expect(study.verdict?.moduleId).toBe(id('Algorithms'));
    expect(await wrapped.classifyCurrent([])).toBe(distracted);
    expect((await wrapped.classifyCurrent([])).verdict).toBeNull();
    expect(wrapped.reset).toBe(inner.reset);
  });
});
