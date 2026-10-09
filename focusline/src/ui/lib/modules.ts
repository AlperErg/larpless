/** Module table drafts ⇄ StudyModule (pure). */
import type { StudyModule, TagColor } from '../../contracts/domain';
import { librarySubjectName } from '../../core/subjectLibrary';
import { TAG_COLORS } from '../theme';

export interface ModuleDraft {
  id: string;
  name: string;
  color: TagColor;
  /** Raw text while editing; parsed on save so typing "cell, " doesn't jump. */
  keywordsText: string;
}

export function newModuleId(): string {
  return `mod_${Math.random().toString(36).slice(2, 7)}${Date.now().toString(36).slice(-3)}`;
}

export function draftsFromModules(mods: StudyModule[]): ModuleDraft[] {
  return mods.map((m) => ({ id: m.id, name: m.name, color: m.color, keywordsText: m.keywords.join(', ') }));
}

export function parseKeywords(text: string): string[] {
  return text
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Trimmed, non-empty, unique (case-insensitive) names that aren't built-in subjects; the first row with a name wins. */
export function modulesFromDrafts(drafts: ModuleDraft[]): StudyModule[] {
  const seen = new Set<string>();
  const out: StudyModule[] = [];
  for (const d of drafts) {
    const name = d.name.trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k) || k === 'not study' || librarySubjectName(name)) continue;
    seen.add(k);
    out.push({ id: d.id, name, color: d.color, keywords: parseKeywords(d.keywordsText) });
  }
  return out;
}

/** Names that appear more than once (case-insensitive), for an inline warning. */
export function duplicateNames(drafts: ModuleDraft[]): string[] {
  const count = new Map<string, number>();
  drafts.forEach((d) => {
    const k = d.name.trim().toLowerCase();
    if (k) count.set(k, (count.get(k) ?? 0) + 1);
  });
  return Array.from(count.entries())
    .filter(([, n]) => n > 1)
    .map(([k]) => k);
}

/** Draft names that are already built-in subjects, in the library's spelling, for an inline warning. */
export function builtInNames(drafts: ModuleDraft[]): string[] {
  const out: string[] = [];
  for (const d of drafts) {
    const lib = librarySubjectName(d.name);
    if (lib && !out.includes(lib)) out.push(lib);
  }
  return out;
}

/** The warning under the course table: built-in clashes first, then duplicates. Null when all names are fine. */
export function courseNameProblem(drafts: ModuleDraft[]): string | null {
  const builtIn = builtInNames(drafts);
  if (builtIn.length) {
    const one = builtIn.length === 1;
    return `${builtIn.join(', ')} ${one ? 'is' : 'are'} already built in and tracked automatically. Give your course a more specific name, like "${builtIn[0]} 101".`;
  }
  const dups = duplicateNames(drafts);
  return dups.length ? `Names must be unique: ${dups.join(', ')}` : null;
}

export function nextTagColor(c: TagColor): TagColor {
  return TAG_COLORS[(TAG_COLORS.indexOf(c) + 1) % TAG_COLORS.length];
}

/** A colour not used yet (skips gray/red, which mean "away"/"distracted"). */
export function freshColor(used: TagColor[]): TagColor {
  const pool = TAG_COLORS.filter((c) => c !== 'gray' && c !== 'red');
  return pool.find((c) => !used.includes(c)) ?? pool[used.length % pool.length];
}

export function blankDraft(used: TagColor[]): ModuleDraft {
  return { id: newModuleId(), name: '', color: freshColor(used), keywordsText: '' };
}

