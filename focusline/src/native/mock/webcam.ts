import type { Unsubscribe, WebcamApi, WebcamSample } from '../../contracts/native';
import { TINY_JPEG_BASE64 } from './screen';

const CYCLE_S = 120;
const listeners = new Set<(s: WebcamSample) => void>();
let interval: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;

/** Deterministic schedule, relative to start(): away 35–60 s and phone 80–90 s of every 120 s. */
function sampleAt(now: number): WebcamSample {
  const s = Math.floor((now - startedAt) / 1000) % CYCLE_S;
  const phoneVisible = s >= 80 && s < 90;
  return {
    t: now,
    personPresent: !(s >= 35 && s < 60),
    phoneVisible,
    phoneScore: phoneVisible ? 0.86 : 0.04,
  };
}

function clear(): void {
  if (interval !== null) {
    clearInterval(interval);
    interval = null;
  }
}

export const mockWebcam: WebcamApi = {
  start: async ({ fps }) => {
    clear();
    const rate = fps > 0 ? fps : 1;
    startedAt = Date.now();
    interval = setInterval(() => {
      const sample = sampleAt(Date.now());
      listeners.forEach((cb) => cb(sample));
    }, 1000 / rate);
    console.log('[mock webcam] start', rate);
  },
  stop: async () => {
    clear();
    console.log('[mock webcam] stop');
  },
  capturePhoto: async () => ({ jpegBase64: TINY_JPEG_BASE64, width: 1, height: 1 }),
  onSample: (cb): Unsubscribe => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};
