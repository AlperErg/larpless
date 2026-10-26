import type { SessionSummary } from '../../src/contracts/domain';
import * as api from '../../src/social/api';
import { fakeSupabase } from '../../test/fakeSupabase';

const ME = 'user-me';
const THEM = 'user-them';

const summary: SessionSummary = {
  id: 'sess_1',
  startedAt: Date.UTC(2026, 9, 9, 13, 0),
  endedAt: Date.UTC(2026, 9, 9, 14, 0),
  totalS: 3600.4,
  focusS: 2900,
  focusPct: 81,
  breakdown: [],
  pomodoros: 2,
};

const breakdown = [
  { key: 'mod_bio', label: 'Biology', color: 'green' as const, seconds: 2400, pct: 67 },
  { key: 'distracted', label: 'Distracted', color: 'red' as const, seconds: 600, pct: 17 },
];

describe('usernames', () => {
  it('normalizes and validates', () => {
    expect(api.normalizeUsername('  @Ada_L ')).toBe('ada_l');
    expect(api.usernameProblem('ada_l')).toBeNull();
    expect(api.usernameProblem('ab')).not.toBeNull();
    expect(api.usernameProblem('has space')).not.toBeNull();
    expect(api.emailFor('ada_l')).toBe('ada_l@larpless.local');
  });
});

describe('accounts', () => {
  it('signUp validates before calling Supabase', async () => {
    const f = fakeSupabase();
    await expect(api.signUp(f.client, 'a', 'secret1')).rejects.toThrow(/3–20/);
    await expect(api.signUp(f.client, 'ada_l', '123')).rejects.toThrow(/at least 6/);
    expect(f.auth.signUp).not.toHaveBeenCalled();
  });

  it('signUp sends the username as metadata on the fake email', async () => {
    const f = fakeSupabase();
    await api.signUp(f.client, 'Ada_L', 'secret1');
    expect(f.auth.signUp).toHaveBeenCalledWith({
      email: 'ada_l@larpless.local',
      password: 'secret1',
      options: { data: { username: 'ada_l' } },
    });
  });

  it('signUp explains a taken username and email confirmation', async () => {
    const f = fakeSupabase();
    f.auth.signUp.mockResolvedValueOnce({ data: { session: null } as never, error: { message: 'User already registered' } });
    await expect(api.signUp(f.client, 'ada_l', 'secret1')).rejects.toThrow('That username is taken.');
    f.auth.signUp.mockResolvedValueOnce({ data: { session: null } as never, error: null });
    await expect(api.signUp(f.client, 'ada_l', 'secret1')).rejects.toThrow(/Confirm email/);
  });

  it('signIn maps bad credentials', async () => {
    const f = fakeSupabase();
    f.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } });
    await expect(api.signIn(f.client, 'ada_l', 'nope')).rejects.toThrow('Wrong username or password.');
    expect(f.auth.signInWithPassword.mock.calls.map((c) => (c[0] as { email: string }).email)).toEqual([
      'ada_l@larpless.local',
      'ada_l@focusline.local',
    ]);
    await expect(api.signIn(f.client, '', '')).rejects.toThrow(/Enter your username/);
  });

  it('signIn falls back to accounts created before the rebrand', async () => {
    const f = fakeSupabase();
    f.auth.signInWithPassword
      .mockResolvedValueOnce({ data: {}, error: { message: 'Invalid login credentials' } })
      .mockResolvedValueOnce({ data: {}, error: null });
    await api.signIn(f.client, 'carlos_cejas', 'pw');
    expect(f.auth.signInWithPassword.mock.calls.map((c) => (c[0] as { email: string }).email)).toEqual([
      'carlos_cejas@larpless.local',
      'carlos_cejas@focusline.local',
    ]);
  });

  it('signIn takes a username or a full email', async () => {
    const f = fakeSupabase();
    await api.signIn(f.client, 'Ada_L', 'pw');
    await api.signIn(f.client, ' Alper@Test.com ', 'pw');
    expect(f.auth.signInWithPassword.mock.calls.map((c) => (c[0] as { email: string }).email)).toEqual([
      'ada_l@larpless.local',
      'alper@test.com',
    ]);
  });

  it('deleteAccount calls delete_account, then forgets the dead session on this device only', async () => {
    const f = fakeSupabase();
    await api.deleteAccount(f.client);
    expect(f.rpc).toHaveBeenCalledWith('delete_account');
    expect(f.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('deleteAccount keeps the session when the server refuses, and explains an outdated schema', async () => {
    const f = fakeSupabase({
      'rpc:delete_account': [
        { error: { message: 'Could not find the function public.delete_account without parameters in the schema cache', code: 'PGRST202' } },
        { error: { message: 'JWT expired' } },
      ],
    });
    await expect(api.deleteAccount(f.client)).rejects.toThrow(/Run the latest supabase\/schema\.sql/);
    await expect(api.deleteAccount(f.client)).rejects.toThrow('JWT expired');
    expect(f.auth.signOut).not.toHaveBeenCalled();
  });

  it('getProfile errors clearly when the schema trigger never ran', async () => {
    const f = fakeSupabase({ profiles: [{ data: null }] });
    await expect(api.getProfile(f.client, ME)).rejects.toThrow(/schema.sql/);
  });
});

describe('friend requests', () => {
  it('rejects unknown users and yourself', async () => {
    const f = fakeSupabase({ profiles: [{ data: null }, { data: { id: ME, username: 'me' } }] });
    await expect(api.sendFriendRequest(f.client, ME, 'ghost')).rejects.toThrow('No one is called @ghost.');
    await expect(api.sendFriendRequest(f.client, ME, 'me')).rejects.toThrow("That's you.");
  });

  it('rejects existing friends and duplicate requests', async () => {
    const target = { data: { id: THEM, username: 'them' } };
    const f = fakeSupabase({
      profiles: [target, target],
      friendships: [
        { data: { id: 'f1', status: 'accepted', requester_id: THEM } },
        { data: { id: 'f1', status: 'pending', requester_id: ME } },
      ],
    });
    await expect(api.sendFriendRequest(f.client, ME, 'them')).rejects.toThrow(/already friends/);
    await expect(api.sendFriendRequest(f.client, ME, 'them')).rejects.toThrow(/already pending/);
  });

  it('accepts their request instead of sending a second one', async () => {
    const f = fakeSupabase({
      profiles: [{ data: { id: THEM, username: 'them' } }],
      friendships: [{ data: { id: 'f1', status: 'pending', requester_id: THEM } }, {}],
    });
    await expect(api.sendFriendRequest(f.client, ME, '@Them')).resolves.toBe('accepted');
    expect(f.opsFor('friendships', 1)).toEqual([
      ['update', [{ status: 'accepted' }]],
      ['eq', ['id', 'f1']],
    ]);
  });

  it('inserts a pending request', async () => {
    const f = fakeSupabase({ profiles: [{ data: { id: THEM, username: 'them' } }], friendships: [{ data: null }, {}] });
    await expect(api.sendFriendRequest(f.client, ME, 'them')).resolves.toBe('sent');
    expect(f.opsFor('profiles')).toContainEqual(['eq', ['username', 'them']]);
    expect(f.opsFor('friendships', 1)).toEqual([['insert', [{ requester_id: ME, addressee_id: THEM }]]]);
  });

  it('splits friendships into friends, incoming and outgoing', () => {
    const p = (id: string, username: string) => ({ id, username });
    const lists = api.splitFriendships(
      [
        { id: 'a', status: 'accepted', requester_id: ME, addressee_id: 'u2', requester: p(ME, 'me'), addressee: p('u2', 'zed') },
        { id: 'b', status: 'accepted', requester_id: 'u3', addressee_id: ME, requester: p('u3', 'amy'), addressee: p(ME, 'me') },
        { id: 'c', status: 'pending', requester_id: 'u4', addressee_id: ME, requester: p('u4', 'bo'), addressee: p(ME, 'me') },
        { id: 'd', status: 'pending', requester_id: ME, addressee_id: 'u5', requester: p(ME, 'me'), addressee: p('u5', 'cy') },
      ],
      ME,
    );
    expect(lists.friends.map((f) => f.other.username)).toEqual(['amy', 'zed']);
    expect(lists.incoming.map((f) => [f.other.username, f.direction])).toEqual([['bo', 'incoming']]);
    expect(lists.outgoing.map((f) => [f.other.username, f.direction])).toEqual([['cy', 'outgoing']]);
  });
});

describe('posts', () => {
  it('the payload carries stats only', () => {
    const payload = api.postPayload(ME, { summary, breakdown, focusPct: 80.6, streak: 3, caption: '  Exam prep  ' });
    expect(Object.keys(payload).sort()).toEqual(
      ['breakdown', 'caption', 'focus_pct', 'local_session_id', 'pomodoros', 'started_at', 'streak', 'total_s', 'user_id'].sort(),
    );
    expect(payload).toMatchObject({ user_id: ME, local_session_id: 'sess_1', total_s: 3600, focus_pct: 81, pomodoros: 2, streak: 3, caption: 'Exam prep' });
    expect(payload.breakdown).toEqual([
      { label: 'Biology', color: 'green', seconds: 2400, pct: 67 },
      { label: 'Distracted', color: 'red', seconds: 600, pct: 17 },
    ]);
    expect(api.postPayload(ME, { summary, breakdown, focusPct: 80, streak: 0, caption: '   ' }).caption).toBeNull();
  });

  it('posting the same session twice is fine, other errors throw', async () => {
    const f = fakeSupabase({ posts: [{ error: { message: 'dup', code: '23505' } }, { error: { message: 'boom' } }] });
    const input = { summary, breakdown, focusPct: 80, streak: 1, caption: '' };
    await expect(api.publishSession(f.client, ME, input)).resolves.toBeUndefined();
    await expect(api.publishSession(f.client, ME, input)).rejects.toThrow('boom');
  });

  it('maps feed rows', async () => {
    const f = fakeSupabase({
      posts: [
        {
          data: [
            {
              id: 'p1',
              user_id: THEM,
              local_session_id: 's9',
              total_s: 1800,
              focus_pct: 70,
              pomodoros: 1,
              streak: 2,
              breakdown: [{ label: 'Maths', color: 'blue', seconds: 1200, pct: 70 }],
              caption: null,
              started_at: '2026-10-09T13:00:00Z',
              created_at: '2026-10-09T13:30:00Z',
              profiles: { username: 'them' },
            },
          ],
        },
      ],
    });
    const feed = await api.fetchFeed(f.client);
    expect(feed[0]).toMatchObject({ id: 'p1', username: 'them', totalS: 1800, focusPct: 70, createdAt: Date.parse('2026-10-09T13:30:00Z') });
    expect(feed[0].breakdown[0]).toMatchObject({ label: 'Maths', color: 'blue', pct: 70 });
    expect(f.opsFor('posts')).toContainEqual(['order', ['created_at', { ascending: false }]]);
  });

  it('drops malformed breakdown entries from a friend’s post instead of passing them to the UI', () => {
    const row = {
      id: 'p1',
      user_id: THEM,
      local_session_id: 's9',
      total_s: 60,
      focus_pct: 50,
      pomodoros: 0,
      streak: 0,
      caption: null,
      started_at: '2026-10-09T13:00:00Z',
      created_at: '2026-10-09T13:30:00Z',
      profiles: { username: 'them' },
    };
    const post = api.toFeedPost({
      ...row,
      breakdown: [
        { label: 'Maths', color: 'nope', seconds: 30, pct: 150 },
        { label: { x: 1 }, color: 'blue', seconds: 30, pct: 50 },
        { label: 'Art', color: 'blue', seconds: -1, pct: 50 },
        { label: 'Art', color: 'blue', seconds: 30, pct: 'x' },
        null,
        'Maths',
        ...Array.from({ length: 30 }, (_, i) => ({ label: `S${i}`, color: 'green', seconds: 1, pct: -5 })),
      ],
    });
    expect(post.breakdown[0]).toEqual({ key: '0:Maths', label: 'Maths', color: 'gray', seconds: 30, pct: 100 });
    expect(post.breakdown).toHaveLength(1 + (api.MAX_BREAKDOWN - 6));
    expect(post.breakdown.every((e) => typeof e.label === 'string' && e.pct >= 0 && e.pct <= 100)).toBe(true);
    expect(api.toFeedPost({ ...row, breakdown: { label: 'Maths' } }).breakdown).toEqual([]);
    expect(api.toFeedPost({ ...row, breakdown: null }).breakdown).toEqual([]);
  });
});
