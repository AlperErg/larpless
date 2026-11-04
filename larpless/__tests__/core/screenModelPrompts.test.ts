import { readFileSync } from 'fs';
import { join } from 'path';
import { LIBRARY_MODULES } from '../../src/core/subjectLibrary';

// The fixed SigLIP prompt embeddings both apps ship (scripts/embed_bench/export_prompts.py writes both copies).
const ROOT = join(__dirname, '..', '..');
const WINDOWS = join(ROOT, 'windows', 'LarpLess', 'Assets', 'Models', 'FLScreenModelPrompts.json');
const MAC = join(ROOT, 'macos', 'Focusline-macOS', 'Native', 'ScreenModel', 'FLScreenModelPrompts.json');

describe('FLScreenModelPrompts.json', () => {
  it('is the same file on Windows and macOS', () => {
    expect(readFileSync(MAC).equals(readFileSync(WINDOWS))).toBe(true);
  });

  it('has an image prompt for every library subject', () => {
    // A subject without one silently gets no image score (like a custom course): rerun export_prompts.py.
    const doc = JSON.parse(readFileSync(MAC, 'utf8')) as { prompts: { id: string }[] };
    const ids = new Set(doc.prompts.map((p) => p.id));
    expect(LIBRARY_MODULES.map((m) => m.id).filter((id) => !ids.has(id))).toEqual([]);
  });
});
