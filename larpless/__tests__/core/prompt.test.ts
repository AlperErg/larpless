import { buildMessages, buildSchema, NOT_STUDY, parseVerdict, SYSTEM } from '../../src/core/prompt';
import { fixtureModules } from '../../src/fixtures/data';

describe('prompt', () => {
  it('buildSchema lists every module plus "Not study", all fields required', () => {
    const s = buildSchema(['Biology', 'Maths']);
    expect(s.properties.subject.enum).toEqual(['Biology', 'Maths', NOT_STUDY]);
    expect(s.required.sort()).toEqual(['confidence', 'studying', 'subject']);
    expect(SYSTEM).not.toContain('"activity"');
    expect(s.properties.studying.type).toBe('boolean');
    expect(s.properties.confidence.type).toBe('number');
  });

  it('buildMessages: system prompt + user text with modules and the image', () => {
    const msgs = buildMessages({
      appName: 'Preview',
      windowTitle: null,
      modules: fixtureModules,
      imageBase64: 'IMG',
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'system', content: SYSTEM });
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].images).toEqual(['IMG']);
    expect(msgs[1].content).toBe(
      [
        'Frontmost app: Preview',
        'Window title: unknown',
        'Modules:',
        '- Biology: cell, mitosis, BIO101',
        '- Maths: integral, matrix, MATH201',
        '- History: revolution, HIST110',
      ].join('\n'),
    );
  });

  describe('parseVerdict', () => {
    it('maps the subject to the module id (exact)', () => {
      expect(
        parseVerdict({ studying: true, subject: 'Biology', activity: 'Reading slides', confidence: 0.9 }, fixtureModules),
      ).toEqual({ studying: true, moduleId: 'mod_biology', activity: '', confidence: 0.9, source: 'vlm' });
    });

    it('falls back to a case-insensitive match', () => {
      const v = parseVerdict({ studying: true, subject: ' maths ', activity: 'x', confidence: 0.7 }, fixtureModules);
      expect(v?.moduleId).toBe('mod_maths');
    });

    it('"Not study" → studying false, no module', () => {
      const v = parseVerdict({ studying: true, subject: 'Not study', activity: 'Instagram feed', confidence: 0.95 }, fixtureModules);
      expect(v).toEqual({ studying: false, moduleId: null, activity: '', confidence: 0.95, source: 'vlm' });
    });

    it('module subject with studying:false → not studying', () => {
      const v = parseVerdict({ studying: false, subject: 'History', activity: 'News', confidence: 0.4 }, fixtureModules);
      expect(v).toMatchObject({ studying: false, moduleId: null });
    });

    it('clamps confidence and ignores any description the model still sends', () => {
      const v = parseVerdict({ studying: true, subject: 'Biology', activity: 'word '.repeat(30), confidence: 7 }, fixtureModules)!;
      expect(v.confidence).toBe(1);
      expect(v.activity).toBe('');
      expect(parseVerdict({ studying: true, subject: 'Biology', activity: 'a', confidence: -3 }, fixtureModules)!.confidence).toBe(0);
      expect(parseVerdict({ studying: true, subject: 'Biology', activity: 'a', confidence: 'x' }, fixtureModules)!.confidence).toBe(0.5);
    });

    it('accepts a JSON string', () => {
      const v = parseVerdict('{"studying":true,"subject":"History","activity":"Essay","confidence":0.8}', fixtureModules);
      expect(v?.moduleId).toBe('mod_history');
    });

    it('rejects unusable shapes', () => {
      expect(parseVerdict(null, fixtureModules)).toBeNull();
      expect(parseVerdict('not json', fixtureModules)).toBeNull();
      expect(parseVerdict([], fixtureModules)).toBeNull();
      expect(parseVerdict({ studying: true }, fixtureModules)).toBeNull();
      expect(parseVerdict({ studying: true, subject: 'Chemistry', activity: 'x', confidence: 1 }, fixtureModules)).toBeNull();
    });
  });
});
