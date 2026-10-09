import { NativeModules } from 'react-native';
import type { SoundId } from '../contracts/domain';
import type { SoundApi } from '../contracts/native';

const M = NativeModules.FLSound;

export const sound: SoundApi = {
  play: (id, fadeMs = 400) => M.play(id, fadeMs),
  setVolume: (v) => M.setVolume(v),
  duck: (factor, fadeMs = 400) => M.duck(factor, fadeMs),
  chime: (kind) => M.chime(kind),
};

export interface SoundDebugState {
  configured: boolean;
  engineRunning: boolean;
  currentId: SoundId;
  voice: string | null;            // voice actually playing ('brown' for rain/cafe without their loop file)
  volume: number;
  duck: number;
  gains: Record<string, number>;   // current per-voice gain
  rampsInFlight: Record<string, number>;
  sampleRate: number;
  loops: string[];
  muted: boolean;
  chimeCount: number;
  /** Largest per-tick gain change of any fade ≥ 300 ms, as a fraction of its span (reset by setMuted). */
  maxGainStepRel: number;
  lastError: string | null;
}

/** Rows per tapped node: [tMs, rms, maxSampleStep]. Keys: white, pink, brown, chime (+ rain/cafe loops). */
export interface SoundMeter {
  ok: boolean;
  engineRunning?: boolean;
  rows?: Record<string, [number, number, number][]>;
  error?: string;
}

/** Dev-only helpers for HarnessB (not part of the contract). */
export const soundDebug = {
  available: (): boolean => !!M && typeof M.debugState === 'function',
  state: (): Promise<SoundDebugState> => M.debugState(),
  /** Mutes the speakers only (main mixer); voices keep running so meters still read them. */
  setMuted: (on: boolean): void => M.debugSetMuted(on),
  meter: (durationMs: number): Promise<SoundMeter> => M.debugMeter(durationMs),
};
