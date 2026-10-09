/**
 * Fuse one chunk's webcam samples and screen verdict into a Chunk (PLAN.md §6/§8).
 * Rule order: away → phone → unknown → distracted → subject.
 *
 * With zero samples (webcam off, or the camera stopped mid-session) presence is unknown, so the
 * away/phone rules are skipped; the screen verdict decides.
 */
import type { Chunk, ChunkSource, ScreenVerdict } from '../contracts/domain';
import type { WebcamSample } from '../contracts/native';
import { chunkId } from './ids';

/** Away when the person is absent in more than 2/3 of the samples. */
export const AWAY_FRACTION = 2 / 3;
/** Phone when it's visible in more than 1/6 of the samples. */
export const PHONE_FRACTION = 1 / 6;

export const AWAY_ACTIVITY = 'Away from desk';
export const PHONE_ACTIVITY = 'Phone';

const round2 = (x: number) => Math.round(x * 100) / 100;

export function awayStats(samples: readonly WebcamSample[]): { away: boolean; fraction: number } {
  if (!samples.length) return { away: false, fraction: 0 };
  const absent = samples.filter((s) => !s.personPresent).length;
  const fraction = absent / samples.length;
  return { away: fraction > AWAY_FRACTION, fraction };
}

export function phoneStats(samples: readonly WebcamSample[]): { phone: boolean; fraction: number; score: number } {
  if (!samples.length) return { phone: false, fraction: 0, score: 0 };
  const visible = samples.filter((s) => s.phoneVisible);
  const fraction = visible.length / samples.length;
  const score = visible.length ? visible.reduce((a, s) => a + s.phoneScore, 0) / visible.length : 0;
  return { phone: fraction > PHONE_FRACTION, fraction, score };
}

export interface FuseInput {
  sessionId: string;
  index: number;
  startedAt: number;
  durationS: number;
  samples: readonly WebcamSample[];
  verdict: ScreenVerdict | null;
  /** Defaults to verdict.source. */
  verdictSource?: ScreenVerdict['source'];
  appName: string | null;
}

export function fuseChunk({
  sessionId,
  index,
  startedAt,
  durationS,
  samples,
  verdict,
  verdictSource,
  appName,
}: FuseInput): Chunk {
  const base = { id: chunkId(sessionId, index), sessionId, index, startedAt, durationS };

  const away = awayStats(samples);
  if (away.away) {
    return { ...base, kind: 'away', moduleId: null, reason: null, activity: AWAY_ACTIVITY, confidence: round2(away.fraction), source: 'webcam', appName: null };
  }

  const phone = phoneStats(samples);
  if (phone.phone) {
    return { ...base, kind: 'distracted', moduleId: null, reason: 'phone', activity: PHONE_ACTIVITY, confidence: round2(phone.score), source: 'webcam', appName };
  }

  const source: ChunkSource = verdictSource ?? verdict?.source ?? 'none';
  const confidence = verdict ? Math.min(1, Math.max(0, verdict.confidence)) : 0;

  if (!verdict || (verdict.studying && !verdict.moduleId)) {
    return { ...base, kind: 'unknown', moduleId: null, reason: null, activity: verdict?.activity ?? '', confidence: 0, source: 'none', appName };
  }

  if (!verdict.studying) {
    return { ...base, kind: 'distracted', moduleId: null, reason: source === 'rule' ? 'rule' : 'screen', activity: verdict.activity, confidence, source, appName };
  }

  return { ...base, kind: 'subject', moduleId: verdict.moduleId, reason: null, activity: verdict.activity, confidence, source, appName };
}
