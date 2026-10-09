import { MODULE_PRESETS, MODULE_PRESET_GROUPS } from '../../src/ui/lib/modulePresets';
import { addPresetDraft, blankDraft, modulesFromDrafts } from '../../src/ui/lib/modules';

describe('module presets', () => {
  it('has a broad, unique library with usable keywords', () => {
    const names = MODULE_PRESET_GROUPS.flatMap((g) => g.presets.map((p) => p.name.toLowerCase()));
    expect(new Set(names).size).toBe(names.length);
    expect(MODULE_PRESETS.length).toBeGreaterThanOrEqual(30);
    for (const p of MODULE_PRESETS) {
      expect(p.keywords.length).toBeGreaterThanOrEqual(5);
      expect(['gray', 'red']).not.toContain(p.color); // reserved for away / distracted
      expect(p.name.toLowerCase()).not.toBe('not study');
    }
    expect(names).toEqual(expect.arrayContaining(['physics', 'coding', 'statistics', 'chemistry', 'economics']));
  });

  it('adds a pre-filled row, replacing an empty one and skipping duplicates', () => {
    const physics = MODULE_PRESETS.find((p) => p.name === 'Physics')!;
    let rows = addPresetDraft([blankDraft([])], physics);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Physics');
    expect(rows[0].keywordsText).toContain('velocity');

    rows = addPresetDraft(rows, physics);
    expect(rows).toHaveLength(1);

    const stats = MODULE_PRESETS.find((p) => p.name === 'Statistics')!;
    rows = addPresetDraft(rows, stats);
    const mods = modulesFromDrafts(rows);
    expect(mods.map((m) => m.name)).toEqual(['Physics', 'Statistics']);
    expect(mods[1].keywords).toContain('regression');
  });

  it('avoids reusing a colour already taken by another row', () => {
    const bio = MODULE_PRESETS.find((p) => p.name === 'Biology')!; // green
    const env = MODULE_PRESETS.find((p) => p.name === 'Environmental Science')!; // green
    const rows = addPresetDraft(addPresetDraft([], bio), env);
    expect(rows[0].color).toBe('green');
    expect(rows[1].color).not.toBe('green');
  });
});
