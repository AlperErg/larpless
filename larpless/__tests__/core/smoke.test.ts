import { differenceInCalendarDays } from 'date-fns';
import { config, DEFAULT_SETTINGS } from '../../src/config';
import type { Chunk } from '../../src/contracts/domain';
import type { NativeApis, WebcamSample } from '../../src/contracts/native';
import type { SessionStoreState } from '../../src/contracts/store';
import {
  fixtureChunks,
  fixtureModules,
  fixtureSessions,
  fixtureStates,
} from '../../src/fixtures/data';
import { applyFixture } from '../../src/fixtures/apply';
import { native } from '../../src/native';
import { mockApis } from '../../src/native/mock';
import { resetMockScreen } from '../../src/native/mock/screen';
import { useAppStore } from '../../src/store/appStore';
import { useSessionStore } from '../../src/store/sessionStore';

const API_KEYS: (keyof NativeApis)[] = [
  'screen',
  'permissions',
  'webcam',
  'panel',
  'notifications',
  'sound',
  'appShell',
  'nowPlaying',
  'ollamaHost',
];

function checkChunkInvariants(chunks: Chunk[]) {
  for (const c of chunks) {
    expect(c.moduleId !== null).toBe(c.kind === 'subject');
    expect(c.reason !== null).toBe(c.kind === 'distracted');
    expect(c.confidence).toBeGreaterThanOrEqual(0);
    expect(c.confidence).toBeLessThanOrEqual(1);
  }
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('Phase 0 smoke', () => {
  it('config defaults', () => {
    expect(config.USE_MOCK_NATIVE).toBe(true);
    expect(DEFAULT_SETTINGS.model).toBe('qwen3-vl:4b');
  });

  it('initial store state keeps the privacy invariant', () => {
    const s = useSessionStore.getState();
    expect(s.status).toBe('idle');
    expect(s.privacy.framesStored).toBe(0);
    expect(s.sound).toEqual({ id: 'off', volume: 0.5 });
    expect(s.ollama).toEqual({ status: 'unknown', model: 'qwen3-vl:4b' });
    expect(useAppStore.getState().loaded).toBe(false);
  });

  it('appStore.load marks the store loaded', async () => {
    await useAppStore.getState().load();
    expect(useAppStore.getState().loaded).toBe(true);
  });

  it('native facade selection uses the mocks', () => {
    for (const k of API_KEYS) {
      expect(mockApis[k]).toBeDefined();
      expect(native[k]).toBe(mockApis[k]);
    }
  });

  it('fixture chunks: 48 × 30 s, consistent ids, indices and timestamps', () => {
    expect(fixtureChunks).toHaveLength(48);
    fixtureChunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.durationS).toBe(30);
      expect(c.sessionId).toBe(fixtureChunks[0].sessionId);
      if (i > 0) expect(c.startedAt - fixtureChunks[i - 1].startedAt).toBe(30_000);
    });
    expect(new Set(fixtureChunks.map((c) => c.id)).size).toBe(48);
    checkChunkInvariants(fixtureChunks);

    const instagram = fixtureChunks.filter((c) => c.activity === 'Instagram');
    expect(instagram).toHaveLength(4);
    instagram.forEach((c) => {
      expect(c.reason).toBe('rule');
      expect(c.appName).toBe('Safari');
    });
    expect(fixtureChunks.filter((c) => c.reason === 'phone')).toHaveLength(1);
    expect(fixtureChunks.filter((c) => c.kind === 'away')).toHaveLength(2);

    const moduleIds = new Set(fixtureModules.map((m) => m.id));
    fixtureChunks.filter((c) => c.moduleId).forEach((c) => expect(moduleIds.has(c.moduleId!)).toBe(true));
  });

  it('fixture sessions: newest first with a current 5-day streak', () => {
    expect(fixtureSessions.length).toBeGreaterThanOrEqual(18);
    for (let i = 1; i < fixtureSessions.length; i++) {
      expect(fixtureSessions[i - 1].startedAt).toBeGreaterThan(fixtureSessions[i].startedAt);
    }
    const now = Date.now();
    const days = new Set(
      fixtureSessions.filter((s) => s.totalS >= 15 * 60).map((s) => differenceInCalendarDays(now, s.startedAt)),
    );
    [0, 1, 2, 3, 4].forEach((d) => expect(days.has(d)).toBe(true));
    expect(days.has(5)).toBe(false);
    expect(Math.max(...days)).toBeLessThan(30);
  });

  it('fixture states are internally consistent', () => {
    const { idle, running, distracted, summary } = fixtureStates;
    const brk = fixtureStates.break;
    expect(idle.status).toBe('idle');
    expect(running.status).toBe('running');
    expect(running.session?.id).toBeDefined();
    expect(running.timer?.runningSinceMs).not.toBeNull();
    expect(distracted.current?.kind).toBe('distracted');
    expect(distracted.alert?.level).toBeGreaterThan(0);
    expect(brk.status).toBe('break');
    expect(brk.pomodoro?.phase).toBe('break');
    expect(brk.timer?.runningSinceMs).toBeNull();
    expect(summary.status).toBe('ended');
    expect(summary.lastSummary).not.toBeNull();
    expect(summary.lastSummary?.id).toBe(summary.session?.id);

    const states = Object.values(fixtureStates) as Partial<SessionStoreState>[];
    for (const s of states) {
      expect(s.privacy?.framesStored).toBe(0);
      checkChunkInvariants(s.chunks ?? []);
      if (s.session && s.chunks) s.chunks.forEach((c) => expect(c.sessionId).toBe(s.session!.id));
    }
  });

  it('applyFixture("summary") fills both stores', () => {
    applyFixture('summary');
    expect(useSessionStore.getState().status).toBe('ended');
    expect(useAppStore.getState().modules).toHaveLength(3);
    expect(useAppStore.getState().sessions.length).toBe(fixtureSessions.length);
    applyFixture('idle');
    expect(useSessionStore.getState().status).toBe('idle');
    expect(useSessionStore.getState().chunks).toHaveLength(0);
  });

  it('mock screen switches window every 20 s, following the clock', async () => {
    jest.useFakeTimers();
    try {
      resetMockScreen();
      const titles: (string | null)[] = [];
      for (let i = 0; i < 9; i++) {
        titles.push((await mockApis.screen.getActiveWindow()).windowTitle);
        jest.advanceTimersByTime(10_000);
      }
      expect(titles[0]).toBe(titles[1]);
      expect(titles[2]).toBe('MATH201 Problem set 3.pdf');
      expect(titles[4]).toBe('Instagram');
      expect(titles[8]).toBe(titles[0]);
      const snap = await mockApis.screen.capture(config.CAPTURE);
      expect(snap.windowTitle).toBe(titles[8]);
      expect(snap.jpegBase64.startsWith('/9j/')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('mock webcam follows the 120 s schedule and stops cleanly', async () => {
    jest.useFakeTimers();
    try {
      const samples: WebcamSample[] = [];
      const unsubscribe = mockApis.webcam.onSample((s) => samples.push(s));
      expect(jest.getTimerCount()).toBe(0);
      await mockApis.webcam.start({ fps: 1 });
      jest.advanceTimersByTime(120_000);
      expect(samples).toHaveLength(120);
      expect(samples.filter((s) => !s.personPresent)).toHaveLength(25);
      expect(samples.filter((s) => s.phoneVisible)).toHaveLength(10);
      await mockApis.webcam.stop();
      expect(jest.getTimerCount()).toBe(0);
      unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });
});
