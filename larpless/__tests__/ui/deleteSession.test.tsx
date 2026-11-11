import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { FeedPost } from '../../src/social/api';
import { streak } from '../../src/core/focus';
import { fixtureModules, fixtureSessions } from '../../src/fixtures/data';
import { appDb, initialAppState, useAppStore } from '../../src/store/appStore';
import { useNavStore } from '../../src/store/navStore';
import { initialSessionState, useSessionStore } from '../../src/store/sessionStore';
import { useSocialStore } from '../../src/store/socialStore';
import { streakWarning } from '../../src/ui/components/DeleteSession';
import { HistoryPage } from '../../src/ui/pages/HistoryPage';
import { SummaryPage } from '../../src/ui/pages/SummaryPage';

function textOf(r: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (typeof n === 'object' && 'children' in (n as object)) walk((n as { children: unknown }).children);
  };
  walk(r.toJSON());
  return out.join('');
}

const find = (r: ReactTestRenderer, id: string): ReactTestInstance | undefined =>
  r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0];

async function press(r: ReactTestRenderer, id: string): Promise<void> {
  const hit = find(r, id);
  if (!hit) throw new Error(`no ${id}`);
  await act(async () => {
    hit.props.onPress();
  });
}

async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  return r!;
}

const backup = { app: { ...useAppStore.getState() }, session: { ...useSessionStore.getState() }, social: { ...useSocialStore.getState() } };
const [target, ...rest] = fixtureSessions;
const id = target.id;
const savedIds = async () => (await appDb.listSessions()).map((s) => s.id);

const feedPost = (userId: string): FeedPost => ({
  id: `post-${userId}`,
  userId,
  username: userId,
  localSessionId: id,
  totalS: target.totalS,
  focusPct: target.focusPct,
  pomodoros: 0,
  streak: 1,
  breakdown: [],
  caption: null,
  startedAt: target.startedAt,
  createdAt: target.endedAt,
});

function signedIn(feed: FeedPost[], unpublish: (sessionId: string) => Promise<void>) {
  useSocialStore.setState({ status: 'signedIn', userId: 'u1', profile: { id: 'u1', username: 'ada' }, feed, feedLoaded: true, unpublish });
}

let r: ReactTestRenderer | null = null;

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await AsyncStorage.clear();
  for (const s of fixtureSessions) await appDb.saveSession(s);
  act(() => {
    useAppStore.setState({ loaded: true, modules: fixtureModules, sessions: fixtureSessions });
    useNavStore.setState({ route: 'history', params: {} });
  });
});

afterEach(() => {
  act(() => {
    r?.unmount();
    r = null;
    useAppStore.setState({ ...backup.app, ...initialAppState });
    useSessionStore.setState({ ...backup.session, ...initialSessionState });
    useSocialStore.setState(backup.social);
    useNavStore.setState({ route: 'home', params: {} });
  });
});

describe('deleting a session from History', () => {
  it('asks first: Cancel keeps it, confirming removes it from the list, the stats and storage', async () => {
    r = await render(<HistoryPage />);
    expect(textOf(r)).toContain(`across ${fixtureSessions.length} sessions`);
    await press(r, `toggle-${id}`);

    await press(r, `delete-session-${id}`);
    expect(textOf(r)).toContain("It can't be undone.");
    expect(find(r, `delete-session-with-post-${id}`)).toBeUndefined();
    await press(r, `delete-session-cancel-${id}`);
    expect(useAppStore.getState().sessions).toHaveLength(fixtureSessions.length);
    expect(await savedIds()).toContain(id);

    await press(r, `delete-session-${id}`);
    await press(r, `delete-session-only-${id}`);
    expect(useAppStore.getState().sessions.map((s) => s.id)).toEqual(rest.map((s) => s.id));
    expect(textOf(r)).toContain(`across ${rest.length} session`);
    expect(find(r, `toggle-${id}`)).toBeUndefined();
    expect(await savedIds()).not.toContain(id);
    expect(await appDb.getChunks(id)).toEqual([]);
    // Streaks are computed from the session list, so they follow without a refresh step.
    expect(streak(useAppStore.getState().sessions, target.endedAt)).toBe(streak(rest, target.endedAt));
  });

  it('offers to delete the post of a shared session, and keeps the session when that fails', async () => {
    const unpublish = jest.fn<Promise<void>, [string]>().mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValue(undefined);
    act(() => signedIn([feedPost('u1')], unpublish));
    r = await render(<HistoryPage />);
    await press(r, `toggle-${id}`);
    await press(r, `delete-session-${id}`);
    expect(textOf(r)).toContain("posted to your friends' feed");

    await press(r, `delete-session-with-post-${id}`);
    expect(unpublish).toHaveBeenCalledWith(id);
    expect(textOf(r)).toContain("The post wasn't deleted, so the session was kept.");
    expect(await savedIds()).toContain(id);

    await press(r, `delete-session-with-post-${id}`);
    expect(unpublish).toHaveBeenCalledTimes(2);
    expect(await savedIds()).not.toContain(id);
  });

  it('"Delete session only" leaves the post alone, and a friend\'s post is never offered', async () => {
    const unpublish = jest.fn(async () => {});
    act(() => signedIn([feedPost('u2')], unpublish));
    r = await render(<HistoryPage />);
    await press(r, `toggle-${id}`);
    await press(r, `delete-session-${id}`);
    expect(find(r, `delete-session-with-post-${id}`)).toBeUndefined();

    act(() => signedIn([feedPost('u1')], unpublish));
    expect(find(r, `delete-session-with-post-${id}`)).toBeDefined();
    await press(r, `delete-session-only-${id}`);
    expect(unpublish).not.toHaveBeenCalled();
    expect(await savedIds()).not.toContain(id);
  });
});

describe('streak warning', () => {
  const DAY = 86_400_000;
  const now = new Date(2026, 5, 10, 18).getTime();
  // Long enough to count towards a streak whatever the threshold is: a copy of a fixture session, moved in time.
  const on = (sid: string, daysAgo: number) => ({ ...target, id: sid, startedAt: now - daysAgo * DAY - 3_600_000, endedAt: now - daysAgo * DAY });
  const three = [on('today', 0), on('yesterday', 1), on('before', 2)];

  it('warns only when the delete would shorten the current streak', () => {
    expect(streak(three, now)).toBe(3);
    expect(streakWarning(three, 'yesterday', now)).toBe('Your streak drops from 3 days to 1 day.');
    expect(streakWarning(three, 'before', now)).toBe('Your streak drops from 3 days to 2 days.');
    expect(streakWarning([on('yesterday', 1)], 'yesterday', now)).toBe('This ends your 1 day streak.');
    // Another session the same day keeps the day, and an old session isn't part of the streak.
    expect(streakWarning([...three, on('today2', 0)], 'today', now)).toBeNull();
    expect(streakWarning([...three, on('old', 30)], 'old', now)).toBeNull();
  });

  it('shows in the confirm step', async () => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'], now });
    try {
      act(() => useAppStore.setState({ sessions: three }));
      r = await render(<HistoryPage />);
      await press(r, 'toggle-yesterday');
      await press(r, 'delete-session-yesterday');
      expect(textOf(r)).toContain('Your streak drops from 3 days to 1 day.');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('deleting a session from its Summary page', () => {
  it('deletes after the confirmation, forgets it as the last summary and goes to History', async () => {
    act(() => {
      useSessionStore.setState({ lastSummary: target });
      useNavStore.setState({ route: 'summary', params: { sessionId: id } });
    });
    r = await render(<SummaryPage />);
    await press(r, `delete-session-${id}`);
    expect(useNavStore.getState().route).toBe('summary');
    await press(r, `delete-session-only-${id}`);
    expect(useNavStore.getState().route).toBe('history');
    expect(useSessionStore.getState().lastSummary).toBeNull();
    expect(await savedIds()).not.toContain(id);
  });
});
