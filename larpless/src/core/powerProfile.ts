/**
 * How often a session asks the vision model to look, and how big each screenshot is.
 * The saved setting is the ceiling. A session can step down one level when a call runs
 * longer than a chunk, or when three windows arrive during one call. That step lasts
 * until the session ends and is not written back to settings.
 */
import { config } from '../config';
import type { PowerProfile } from '../contracts/domain';
import type { CaptureOptions } from '../contracts/native';

/** Distinct windows seen during one vision call before we skip to whatever is frontmost. */
export const BEHIND_WINDOWS = 3;

export interface PowerSpec {
  id: PowerProfile;
  chunkS: number;
  liveSettleMs: number;
  capture: CaptureOptions;
  cacheTtlMs: number;
  keepAlive: string;
  classifyTimeoutMs: number;
}

export const POWER_PROFILES: Record<PowerProfile, PowerSpec> = {
  eco: {
    id: 'eco',
    chunkS: 30,
    liveSettleMs: 3_000,
    capture: { maxWidth: 768, jpegQuality: 0.5 },
    cacheTtlMs: 180_000,
    keepAlive: '5m',
    classifyTimeoutMs: config.CLASSIFY_TIMEOUT_MS,
  },
  medium: {
    id: 'medium',
    chunkS: 15,
    liveSettleMs: 2_000,
    capture: { maxWidth: 1024, jpegQuality: 0.6 },
    cacheTtlMs: 120_000,
    keepAlive: '15m',
    classifyTimeoutMs: config.CLASSIFY_TIMEOUT_MS,
  },
  high: {
    id: 'high',
    chunkS: 10,
    liveSettleMs: 1_000,
    capture: { maxWidth: 1280, jpegQuality: 0.7 },
    cacheTtlMs: 120_000,
    keepAlive: '30m',
    classifyTimeoutMs: config.CLASSIFY_TIMEOUT_MS,
  },
};

/** More demanding first. Stepping down moves toward eco. */
const LADDER: PowerProfile[] = ['high', 'medium', 'eco'];

let override: PowerProfile | null = null;

export function isPowerProfile(value: unknown): value is PowerProfile {
  return value === 'eco' || value === 'medium' || value === 'high';
}

/** Session-only step. Null until a session steps down, and after the next session starts. */
export function sessionOverride(): PowerProfile | null {
  return override;
}

export function resetSessionProfile(): void {
  override = null;
}

export function effectiveProfile(chosen: unknown): PowerSpec {
  const saved = isPowerProfile(chosen) ? chosen : 'medium';
  return POWER_PROFILES[override ?? saved];
}

/** Move one step toward eco for the rest of the session. Eco stays eco. */
export function stepSessionProfile(chosen: unknown): PowerProfile {
  const current = effectiveProfile(chosen).id;
  const i = LADDER.indexOf(current);
  const next = LADDER[Math.min(i + 1, LADDER.length - 1)];
  override = next;
  return next;
}
