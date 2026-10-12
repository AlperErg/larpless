import { buildMessages, buildSchema, buildSystem, buildTitleUserText, NOT_STUDY, parseVerdict, SYSTEM } from '../../src/core/prompt';
import { fixtureModules } from '../../src/fixtures/data';

describe('prompt', () => {
  it('buildSchema lists every module plus "Not study", all fields required', () => {
    const s = buildSchema(['Biology', 'Maths']);
    expect(s.properties.subject.enum).toEqual(['Biology', 'Maths', NOT_STUDY]);
    expect(s.required.sort()).toEqual(['confidence', 'studying', 'subject']);
    expect(s.properties.activity.type).toBe('string');
    expect(SYSTEM).toContain('Checking email');
    expect(s.properties.studying.type).toBe('boolean');
    expect(s.properties.confidence.type).toBe('number');
  });

  it('buildMessages: modules in the system prompt (same every call), window + image in the user message', () => {
    const msgs = buildMessages({
      appName: 'Preview',
      windowTitle: null,
      modules: fixtureModules,
      imageBase64: 'IMG',
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({
      role: 'system',
      content: [
        SYSTEM,
        '',
        'Modules:',
        '- Biology: cell, mitosis, BIO101',
        '- Maths: integral, matrix, MATH201',
        '- History: revolution, HIST110',
      ].join('\n'),
    });
    expect(msgs[1]).toEqual({ role: 'user', content: 'Frontmost app: Preview\nWindow title: unknown', images: ['IMG'] });

    // Nothing that changes per call may reach the system prompt, or Ollama can't reuse it.
    const other = buildMessages({ appName: 'Safari', windowTitle: 'Instagram', modules: fixtureModules, imageBase64: 'IMG2' });
    expect(other[0]).toEqual(msgs[0]);
    expect(buildSystem(fixtureModules)).toBe(msgs[0].content);
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

    it('"Not study" → studying false, no module, short reason kept', () => {
      const v = parseVerdict({ studying: true, subject: 'Not study', activity: 'Checking email', confidence: 0.95 }, fixtureModules);
      expect(v).toEqual({ studying: false, moduleId: null, activity: 'Checking email', confidence: 0.95, source: 'vlm' });
    });

    it('drops a reason that copies the window title and caps a long one', () => {
      const title = 'Inbox (2) - user@gmail.com - Gmail';
      expect(parseVerdict({ studying: false, subject: 'Not study', activity: title, confidence: 0.9 }, fixtureModules, title)?.activity).toBe('');
      expect(
        parseVerdict(
          { studying: false, subject: 'Not study', activity: 'word '.repeat(20), confidence: 0.9 },
          fixtureModules,
        )?.activity.length,
      ).toBeLessThanOrEqual(32);
    });

    it('buildTitleUserText has no image and still names the window', () => {
      const text = buildTitleUserText('Chrome', 'Inbox - Gmail');
      expect(text).toContain('No screenshot');
      expect(text).toContain('Frontmost app: Chrome');
      expect(text).toContain('Window title: Inbox - Gmail');
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

    it('accepts a module line copied from the prompt ("Biology: cell, mitosis")', () => {
      expect(parseVerdict({ studying: true, subject: 'Biology: cell', confidence: 0.95 }, fixtureModules)?.moduleId).toBe('mod_biology');
      expect(parseVerdict({ studying: true, subject: 'maths: integral, matrix', confidence: 0.9 }, fixtureModules)?.moduleId).toBe('mod_maths');
      expect(parseVerdict({ studying: false, subject: 'Not study: feed', confidence: 0.9 }, fixtureModules)).toMatchObject({ studying: false, moduleId: null });
      expect(parseVerdict({ studying: true, subject: 'Chemistry: acids', confidence: 0.9 }, fixtureModules)).toBeNull();
    });

    it('a course name containing ":" still matches in full', () => {
      const mods = [...fixtureModules, { id: 'mod_cs', name: 'CS 101: Intro', color: 'blue' as const, keywords: [] }];
      expect(parseVerdict({ studying: true, subject: 'CS 101: Intro', confidence: 0.8 }, mods)?.moduleId).toBe('mod_cs');
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
