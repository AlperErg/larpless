import type { ScreenVerdict } from '../../src/contracts/domain';
import type { WebcamSample } from '../../src/contracts/native';
import { fuseChunk, liveWebcam } from '../../src/core/chunkFuser';
import type { FuseInput } from '../../src/core/chunkFuser';

const BIO: ScreenVerdict = { studying: true, moduleId: 'mod_biology', activity: 'Reading slides', confidence: 0.9, source: 'vlm' };
const INSTA: ScreenVerdict = { studying: false, moduleId: null, activity: 'Instagram', confidence: 1, source: 'rule' };
const MUSIC: ScreenVerdict = { studying: false, moduleId: null, activity: 'Music video', confidence: 0.8, source: 'vlm' };

/** n samples; the first `absent` are absent, the last `phone` show a phone. */
function samples(n: number, absent = 0, phone = 0): WebcamSample[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 1000,
    personPresent: i >= absent,
    phoneVisible: i >= n - phone,
    phoneScore: i >= n - phone ? 0.8 : 0.05,
  }));
}

const base = (over: Partial<FuseInput>): FuseInput => ({
  sessionId: 'ses_abc',
  index: 3,
  startedAt: 1000,
  durationS: 10,
  samples: [],
  verdict: BIO,
  appName: 'Preview',
  ...over,
});

describe('chunkFuser', () => {
  it('subject: module id, verdict source, fields filled', () => {
    expect(fuseChunk(base({}))).toEqual({
      id: 'chk_abc_003',
      sessionId: 'ses_abc',
      index: 3,
      startedAt: 1000,
      durationS: 10,
      kind: 'subject',
      moduleId: 'mod_biology',
      reason: null,
      activity: 'Reading slides',
      confidence: 0.9,
      source: 'vlm',
      appName: 'Preview',
    });
    expect(fuseChunk(base({ verdict: { ...BIO, source: 'cache' } })).source).toBe('cache');
  });

  it('distracted: rule verdict → reason rule; VLM "Not study" → reason screen', () => {
    expect(fuseChunk(base({ verdict: INSTA, appName: 'Safari' }))).toMatchObject({ kind: 'distracted', reason: 'rule', source: 'rule', activity: 'Instagram', moduleId: null });
    expect(fuseChunk(base({ verdict: MUSIC }))).toMatchObject({ kind: 'distracted', reason: 'screen', source: 'vlm' });
  });

  it('unknown: null verdict → source none, confidence 0', () => {
    expect(fuseChunk(base({ verdict: null }))).toMatchObject({ kind: 'unknown', source: 'none', confidence: 0, moduleId: null, reason: null });
  });

  it('away beats everything: absent in > 2/3 of the samples (7 of 10)', () => {
    expect(fuseChunk(base({ samples: samples(10, 7), verdict: INSTA }))).toMatchObject({ kind: 'away', source: 'webcam', appName: null, reason: null, moduleId: null });
    // 6 of 10 is not > 2/3 → screen verdict decides
    expect(fuseChunk(base({ samples: samples(10, 6) })).kind).toBe('subject');
    // 30-sample chunk: 21 absent > 20 → away; exactly 20 is not
    expect(fuseChunk(base({ samples: samples(30, 21) })).kind).toBe('away');
    expect(fuseChunk(base({ samples: samples(30, 20) })).kind).toBe('subject');
  });

  it('phone: visible in > 1/6 of the samples (10-sample: 2 of 10; 1 is not)', () => {
    expect(fuseChunk(base({ samples: samples(10, 0, 2) }))).toMatchObject({ kind: 'distracted', reason: 'phone', source: 'webcam', activity: 'Phone', confidence: 0.8, appName: 'Preview' });
    expect(fuseChunk(base({ samples: samples(10, 0, 1) })).kind).toBe('subject');
    // 30 samples: 6 > 5 → phone; exactly 5 is not
    expect(fuseChunk(base({ samples: samples(30, 0, 6) })).reason).toBe('phone');
    expect(fuseChunk(base({ samples: samples(30, 0, 5) })).kind).toBe('subject');
  });

  it('phone beats an unknown or subject screen verdict; away beats phone', () => {
    expect(fuseChunk(base({ samples: samples(10, 0, 3), verdict: null })).reason).toBe('phone');
    expect(fuseChunk(base({ samples: samples(10, 8, 3) })).kind).toBe('away');
  });

  it('zero samples (webcam off or camera died mid-session) → presence unknown: never away/phone', () => {
    expect(fuseChunk(base({ samples: [] })).kind).toBe('subject');
    expect(fuseChunk(base({ samples: [], verdict: null })).kind).toBe('unknown');
    expect(fuseChunk(base({ samples: [], verdict: INSTA })).reason).toBe('rule');
  });

  it('respects an explicit verdictSource and clamps confidence', () => {
    expect(fuseChunk(base({ verdictSource: 'cache' })).source).toBe('cache');
    expect(fuseChunk(base({ verdict: { ...BIO, confidence: 3 } })).confidence).toBe(1);
  });

  it('invariants: moduleId only for subject, reason only for distracted', () => {
    const outs = [
      fuseChunk(base({})),
      fuseChunk(base({ verdict: INSTA })),
      fuseChunk(base({ verdict: null })),
      fuseChunk(base({ samples: samples(10, 9) })),
      fuseChunk(base({ samples: samples(10, 0, 5) })),
    ];
    for (const c of outs) {
      expect(c.moduleId !== null).toBe(c.kind === 'subject');
      expect(c.reason !== null).toBe(c.kind === 'distracted');
    }
  });

  describe('liveWebcam', () => {
    const at = (personPresent: boolean, phoneVisible = false): WebcamSample => ({ t: 0, personPresent, phoneVisible, phoneScore: phoneVisible ? 0.8 : 0 });

    it('away only after 5 consecutive samples without a person', () => {
      expect(liveWebcam([at(false), at(false), at(false), at(false)])).toBeNull();
      expect(liveWebcam([at(false), at(false), at(false), at(false), at(false)])).toBe('away');
      expect(liveWebcam([at(false), at(false), at(false), at(false), at(false), at(true)])).toBeNull(); // back at once
    });

    it('phone in 2 of the last 3 samples; a single detection is ignored', () => {
      expect(liveWebcam([at(true), at(true), at(true, true)])).toBeNull();
      expect(liveWebcam([at(true), at(true, true), at(true, true)])).toBe('phone');
      expect(liveWebcam([at(true, true), at(true), at(true, true)])).toBe('phone');
      expect(liveWebcam([at(true, true), at(true, true), at(true), at(true)])).toBeNull(); // put down
    });

    it('nothing to go on → null', () => {
      expect(liveWebcam([])).toBeNull();
    });
  });
});
