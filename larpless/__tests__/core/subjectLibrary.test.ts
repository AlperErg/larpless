import { allSubjects, detectableSubjects, LIBRARY_MODULES, librarySubjectId } from '../../src/core/subjectLibrary';
import { fixtureModules } from '../../src/fixtures/data';

describe('detectableSubjects', () => {
  const all = allSubjects([{ id: 'mod_thesis', name: 'Thesis', color: 'purple', keywords: [] }]);

  it('drops subjects that are off, own courses included', () => {
    const on = detectableSubjects(all, [librarySubjectId('Biology'), 'mod_thesis']);
    expect(on).toHaveLength(all.length - 2);
    expect(on.map((m) => m.name)).not.toContain('Biology');
    expect(on.map((m) => m.name)).not.toContain('Thesis');
  });

  it('ignores unknown ids, and uses everything when nothing would be left', () => {
    expect(detectableSubjects(fixtureModules, ['mod_gone'])).toEqual(fixtureModules);
    expect(detectableSubjects(LIBRARY_MODULES, LIBRARY_MODULES.map((m) => m.id))).toEqual(LIBRARY_MODULES);
  });
});
