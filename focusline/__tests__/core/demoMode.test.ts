import type { Chunk } from '../../src/contracts/domain';
import { rebaseChunks, startDemo } from '../../src/core/demoMode';
import { fixtureChunks } from '../../src/fixtures/data';

describe('demoMode', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('rebaseChunks re-ids and re-anchors back to back into the new session', () => {
    const out = rebaseChunks(fixtureChunks, 'ses_demo', 1_000);
    expect(out).toHaveLength(48);
    expect(out[0]).toMatchObject({ id: 'chk_demo_000', sessionId: 'ses_demo', index: 0, startedAt: 1_000 });
    expect(out[47]).toMatchObject({ index: 47, startedAt: 1_000 + 47 * 30_000 });
    expect(out.map((c) => c.kind)).toEqual(fixtureChunks.map((c) => c.kind));
    expect(fixtureChunks[0].sessionId).toBe('ses_fixture'); // fixtures untouched
  });

  it('replays one chunk per interval, holds while canAdvance is false, stops at the end', () => {
    const got: Chunk[] = [];
    let ok = true;
    const done = jest.fn();
    const h = startDemo({ chunks: fixtureChunks.slice(0, 3), sessionId: 'ses_d', startedAt: 0, canAdvance: () => ok, onChunk: (c) => got.push(c), onDone: done });
    jest.advanceTimersByTime(2_000);
    expect(got).toHaveLength(1);
    ok = false;
    jest.advanceTimersByTime(10_000);
    expect(got).toHaveLength(1);
    ok = true;
    jest.advanceTimersByTime(4_000);
    expect(got.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(h.played).toBe(3);
    expect(done).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stop() clears the timer', () => {
    const h = startDemo({ chunks: fixtureChunks, sessionId: 's', startedAt: 0, canAdvance: () => true, onChunk: () => {} });
    h.stop();
    expect(jest.getTimerCount()).toBe(0);
  });
});
