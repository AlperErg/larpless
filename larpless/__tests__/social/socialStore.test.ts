import type { SessionSummary } from '../../src/contracts/domain';
import { createSocialStore, isSessionPosted } from '../../src/store/socialStore';
import { fakeSupabase, flush } from '../../test/fakeSupabase';

const post = (id: string, userId: string, localSessionId: string) => ({
  id,
  user_id: userId,
  local_session_id: localSessionId,
  total_s: 1200,
  focus_pct: 75,
  pomodoros: 0,
  streak: 1,
  breakdown: [],
  caption: null,
  started_at: '2026-10-09T13:00:00Z',
  created_at: '2026-10-09T13:20:00Z',
  profiles: { username: 'someone' },
});

const summary: SessionSummary = {
  id: 'sess_new',
  startedAt: 0,
  endedAt: 1000,
  totalS: 900,
  focusS: 800,
  focusPct: 89,
  breakdown: [],
  pomodoros: 0,
};

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

it('stays unconfigured without Supabase settings', () => {
  const f = fakeSupabase();
  const store = createSocialStore(() => f.client, false);
  store.getState().init();
  expect(store.getState().status).toBe('unconfigured');
  expect(f.auth.onAuthStateChange).not.toHaveBeenCalled();
});

it('loads profile, feed and friends on sign-in and clears them on sign-out', async () => {
  const f = fakeSupabase({
    profiles: [{ data: { id: 'u1', username: 'ada' } }],
    posts: [{ data: [post('p1', 'u1', 'sess_old')] }],
    friendships: [{ data: [] }],
  });
  const store = createSocialStore(() => f.client, true);
  expect(store.getState().status).toBe('loading');
  store.getState().init();
  store.getState().init();
  expect(f.auth.onAuthStateChange).toHaveBeenCalledTimes(1);

  f.emitAuth({ user: { id: 'u1' } });
  await flush();
  const s = store.getState();
  expect(s.status).toBe('signedIn');
  expect(s.profile).toEqual({ id: 'u1', username: 'ada' });
  expect(s.feed.map((p) => p.id)).toEqual(['p1']);
  expect(s.feedLoaded).toBe(true);
  expect(s.offline).toBe(false);
  expect(isSessionPosted(s, 'sess_old')).toBe(true);
  expect(isSessionPosted(s, 'sess_other')).toBe(false);

  f.emitAuth(null);
  await flush();
  expect(store.getState()).toMatchObject({ status: 'signedOut', userId: null, profile: null, feed: [] });
});

it('keeps the last feed and flags offline when a refresh fails', async () => {
  const f = fakeSupabase({
    profiles: [{ data: { id: 'u1', username: 'ada' } }],
    posts: [{ data: [post('p1', 'u2', 's1')] }, { error: { message: 'TypeError: Network request failed' } }],
    friendships: [{ data: [] }, { data: [] }],
  });
  const store = createSocialStore(() => f.client, true);
  store.getState().init();
  f.emitAuth({ user: { id: 'u1' } });
  await flush();
  await store.getState().refresh();
  expect(store.getState().offline).toBe(true);
  expect(store.getState().feed.map((p) => p.id)).toEqual(['p1']);
});

it('reconnects when configuration appears later', () => {
  const f = fakeSupabase();
  let configured = false;
  const store = createSocialStore(() => f.client, () => configured);
  store.getState().init();
  expect(store.getState().status).toBe('unconfigured');
  expect(f.auth.onAuthStateChange).not.toHaveBeenCalled();

  configured = true;
  store.getState().reconfigure();
  expect(store.getState().status).toBe('loading');
  expect(f.auth.onAuthStateChange).toHaveBeenCalledTimes(1);

  store.getState().reconfigure();
  expect(f.auth.onAuthStateChange).toHaveBeenCalledTimes(2);
});

it('publish marks the session as posted', async () => {
  const f = fakeSupabase({ profiles: [{ data: { id: 'u1', username: 'ada' } }] });
  const store = createSocialStore(() => f.client, true);
  store.getState().init();
  f.emitAuth({ user: { id: 'u1' } });
  await flush();
  await store.getState().publish({ summary, breakdown: [], focusPct: 89, streak: 2, caption: '' });
  expect(isSessionPosted(store.getState(), 'sess_new')).toBe(true);
  expect(f.opsFor('posts', 1)[0][0]).toBe('insert');
});

it('actions need a signed-in user', async () => {
  const f = fakeSupabase();
  const store = createSocialStore(() => f.client, true);
  await expect(store.getState().addFriend('bob')).rejects.toThrow('Sign in first.');
  await expect(store.getState().publish({ summary, breakdown: [], focusPct: 0, streak: 0, caption: '' })).rejects.toThrow('Sign in first.');
});
