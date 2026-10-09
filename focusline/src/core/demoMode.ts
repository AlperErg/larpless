/**
 * Demo mode: replay a recorded session (fixtureChunks) through the real store/alerts/panel path,
 * one chunk every 2 s. It never touches the screen or the webcam. The session controller owns it
 * (`start({ demo: true })`) and passes `onChunk` = the same `applyChunk` used for live chunks.
 *
 * Core may import `src/fixtures/data.ts` (pure data) but never `apply.ts` (it imports the store).
 */
import type { Chunk } from '../contracts/domain';
import { chunkId } from './ids';

export const DEMO_INTERVAL_MS = 2000;

export interface DemoOptions {
  chunks: readonly Chunk[];
  sessionId: string;
  /** The demo session's start; replayed chunks are re-anchored back to back from here. */
  startedAt: number;
  intervalMs?: number;
  /** Return false to hold the replay (paused, on a break, ended). */
  canAdvance(): boolean;
  onChunk(chunk: Chunk): void;
  onDone?(): void;
}

export interface DemoHandle {
  stop(): void;
  /** Chunks replayed so far. */
  readonly played: number;
}

/** Re-id and re-anchor recorded chunks into a new session (ids, indices, timestamps). */
export function rebaseChunks(chunks: readonly Chunk[], sessionId: string, startedAt: number): Chunk[] {
  let t = startedAt;
  return chunks.map((c, index) => {
    const out: Chunk = { ...c, id: chunkId(sessionId, index), sessionId, index, startedAt: t };
    t += c.durationS * 1000;
    return out;
  });
}

export function startDemo(opts: DemoOptions): DemoHandle {
  const queue = rebaseChunks(opts.chunks, opts.sessionId, opts.startedAt);
  let played = 0;
  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (!opts.canAdvance()) return;
    const next = queue[played];
    if (!next) {
      handle.stop();
      opts.onDone?.();
      return;
    }
    played += 1;
    opts.onChunk(next);
    if (played >= queue.length) {
      handle.stop();
      opts.onDone?.();
    }
  }, opts.intervalMs ?? DEMO_INTERVAL_MS);

  const handle: DemoHandle = {
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    get played() {
      return played;
    },
  };
  return handle;
}
