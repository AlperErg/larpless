import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { BreakdownEntry, SessionSummary } from '../../src/contracts/domain';
import type { FeedPost, FriendLists } from '../../src/social/api';
import { useNavStore } from '../../src/store/navStore';
import { useSocialStore } from '../../src/store/socialStore';
import type { SocialStore } from '../../src/store/socialStore';
import { SharePanel } from '../../src/ui/components/SharePanel';
import { buildCommands } from '../../src/ui/layout/CommandPalette';
import { FriendsPage } from '../../src/ui/pages/FriendsPage';

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

function byTestID(r: ReactTestRenderer, id: string, prop = 'onPress'): ReactTestInstance {
  const hits = r.root.findAll((n) => n.props.testID === id && typeof n.props[prop] === 'function');
  if (!hits.length) throw new Error(`no ${id} with ${prop}`);
  return hits[0];
}

const mounted: ReactTestRenderer[] = [];

async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  mounted.push(r!);
  return r!;
}

const original = { ...useSocialStore.getState() };
const noLists: FriendLists = { friends: [], incoming: [], outgoing: [] };

function signedIn(patch: Partial<SocialStore> = {}) {
  useSocialStore.setState({
    status: 'signedIn',
    userId: 'u1',
    profile: { id: 'u1', username: 'ada' },
    feed: [],
    feedLoaded: true,
    lists: noLists,
    postedSessionIds: [],
    offline: false,
    refreshing: false,
    refresh: jest.fn(async () => {}),
    ...patch,
  });
}

const friendPost: FeedPost = {
  id: 'p1',
  userId: 'u2',
  username: 'grace',
  localSessionId: 's1',
  totalS: 5400,
  focusPct: 88,
  pomodoros: 3,
  streak: 4,
  breakdown: [{ key: '0:Physics', label: 'Physics', color: 'purple', seconds: 4800, pct: 88 }],
  caption: 'Mock exam done',
  startedAt: Date.now() - 2 * 3600_000,
  createdAt: Date.now() - 3600_000,
};

const summary: SessionSummary = {
  id: 'sess_1',
  startedAt: Date.now() - 3600_000,
  endedAt: Date.now(),
  totalS: 3600,
  focusS: 3000,
  focusPct: 83,
  breakdown: [],
  pomodoros: 2,
};
const breakdown: BreakdownEntry[] = [{ key: 'm1', label: 'Biology', color: 'green', seconds: 3000, pct: 83 }];

beforeEach(() => {
  jest.useFakeTimers(); // the auth and header fades must not outlive a test
});

afterEach(() => {
  // Unmount before resetting the stores: a mounted page would re-render into the reset status
  // (e.g. 'unconfigured' without Supabase settings) and start a fade on real timers.
  act(() => {
    mounted.splice(0).forEach((r) => r.unmount());
    useSocialStore.setState(original, true);
    useNavStore.setState({ route: 'home', params: {}, paletteOpen: false });
  });
  jest.useRealTimers();
});

describe('FriendsPage', () => {
  it('shows the login form when signed out', async () => {
    act(() => useSocialStore.setState({ status: 'signedOut' }));
    const r = await render(<FriendsPage />);
    expect(r.root.findAll((n) => n.props.testID === 'page-login').length).toBeGreaterThan(0);
    expect(textOf(r)).toContain('Create an account');
  });

  it('opens a create-account screen and submits the new account', async () => {
    const signUp = jest.fn(async () => {});
    act(() => useSocialStore.setState({ status: 'signedOut', signUp }));
    const r = await render(<FriendsPage />);
    await act(async () => byTestID(r, 'login-create').props.onPress());
    expect(r.root.findAll((n) => n.props.testID === 'page-signup').length).toBeGreaterThan(0);
    expect(textOf(r)).toContain('Create account');
    await act(async () => byTestID(r, 'signup-username', 'onChangeText').props.onChangeText('ada_l'));
    expect(textOf(r)).toContain('@ada_l');
    await act(async () => byTestID(r, 'signup-password', 'onChangeText').props.onChangeText('secret1'));
    await act(async () => byTestID(r, 'signup-confirm', 'onChangeText').props.onChangeText('secret1'));
    await act(async () => byTestID(r, 'signup-submit').props.onPress());
    expect(signUp).toHaveBeenCalledWith('ada_l', 'secret1');
  });

  it('stays on create-account when the passwords differ', async () => {
    const signUp = jest.fn(async () => {});
    act(() => useSocialStore.setState({ status: 'signedOut', signUp }));
    const r = await render(<FriendsPage />);
    await act(async () => byTestID(r, 'login-create').props.onPress());
    await act(async () => byTestID(r, 'signup-password', 'onChangeText').props.onChangeText('secret1'));
    await act(async () => byTestID(r, 'signup-confirm', 'onChangeText').props.onChangeText('nope'));
    await act(async () => byTestID(r, 'signup-submit').props.onPress());
    expect(signUp).not.toHaveBeenCalled();
    expect(textOf(r)).toContain("Those passwords don't match.");
  });

  it('signs out from the friends header', async () => {
    const signOut = jest.fn(async () => {});
    act(() => signedIn({ signOut }));
    const r = await render(<FriendsPage />);
    await act(async () => byTestID(r, 'friends-signout').props.onPress());
    expect(signOut).toHaveBeenCalled();
  });

  it('surfaces sign-in errors inline', async () => {
    const signIn = jest.fn(async () => {
      throw new Error('Wrong username or password.');
    });
    act(() => useSocialStore.setState({ status: 'signedOut', signIn }));
    const r = await render(<FriendsPage />);
    await act(async () => byTestID(r, 'login-username', 'onChangeText').props.onChangeText('ada'));
    await act(async () => byTestID(r, 'login-password', 'onChangeText').props.onChangeText('pw'));
    await act(async () => byTestID(r, 'login-submit').props.onPress());
    expect(signIn).toHaveBeenCalledWith('ada', 'pw');
    expect(textOf(r)).toContain('Wrong username or password.');
  });

  it('renders friends’ posts with stats, breakdown and an offline tag', async () => {
    act(() => signedIn({ feed: [friendPost], offline: true, lists: { ...noLists, friends: [] } }));
    const r = await render(<FriendsPage />);
    const t = textOf(r);
    expect(t).toContain('Signed in as @ada');
    expect(t).toContain('@grace');
    expect(t).toContain('1h 30m');
    expect(t).toContain('88%');
    expect(t).toContain('Physics');
    expect(t).toContain('Mock exam done');
    expect(t).toContain('Offline');
  });

  it('shows the empty state and incoming requests with Accept', async () => {
    const acceptRequest = jest.fn(async () => {});
    act(() =>
      signedIn({
        acceptRequest,
        lists: {
          friends: [],
          incoming: [{ id: 'f1', status: 'pending', direction: 'incoming', other: { id: 'u3', username: 'linus' } }],
          outgoing: [],
        },
      }),
    );
    const r = await render(<FriendsPage />);
    expect(textOf(r)).toContain('Add friends to see their sessions here.');
    expect(textOf(r)).toContain('Friends · 1 new');
    await act(async () => byTestID(r, 'friends-tab-friends').props.onPress());
    expect(textOf(r)).toContain('@linus');
    await act(async () => byTestID(r, 'accept-linus').props.onPress());
    expect(acceptRequest).toHaveBeenCalledWith('f1');
  });

  it('adds a friend by username and reports the result', async () => {
    const addFriend = jest.fn(async () => 'sent' as const);
    act(() => signedIn({ addFriend }));
    const r = await render(<FriendsPage />);
    await act(async () => byTestID(r, 'friends-tab-friends').props.onPress());
    await act(async () => byTestID(r, 'friend-username', 'onChangeText').props.onChangeText('@grace'));
    await act(async () => byTestID(r, 'friend-send').props.onPress());
    expect(addFriend).toHaveBeenCalledWith('grace');
    expect(textOf(r)).toContain('Request sent to @grace.');
  });
});

describe('account commands', () => {
  it('puts sign-in, create account and sign-out on the command palette', () => {
    const signedOut = buildCommands({ status: 'idle', demoFast: false, hasSummary: false, devTools: false, auth: 'signedOut' });
    expect(signedOut.map((c) => c.id)).toEqual(expect.arrayContaining(['sign-in', 'create-account']));
    act(() => signedOut.find((c) => c.id === 'create-account')?.run());
    expect(useNavStore.getState()).toMatchObject({ route: 'feed', params: { auth: 'signUp' } });

    const signedInCmds = buildCommands({
      status: 'idle',
      demoFast: false,
      hasSummary: false,
      devTools: false,
      auth: 'signedIn',
      username: 'ada',
    });
    expect(signedInCmds.find((c) => c.id === 'sign-out')).toMatchObject({ title: 'Sign out', hint: '@ada' });
  });
});

describe('SharePanel', () => {
  it('asks you to sign in when signed out', async () => {
    act(() => useSocialStore.setState({ status: 'signedOut' }));
    const r = await render(<SharePanel summary={summary} breakdown={breakdown} focusPct={83} />);
    expect(textOf(r)).toContain('Sign in to share');
  });

  it('renders nothing when Supabase is unconfigured', async () => {
    act(() => useSocialStore.setState({ status: 'unconfigured' }));
    const r = await render(<SharePanel summary={summary} breakdown={breakdown} focusPct={83} />);
    expect(r.toJSON()).toBeNull();
  });

  it('posts the summary stats with the caption', async () => {
    const publish = jest.fn(async () => {});
    act(() => signedIn({ publish }));
    const r = await render(<SharePanel summary={summary} breakdown={breakdown} focusPct={83} />);
    await act(async () => byTestID(r, 'share-caption', 'onChangeText').props.onChangeText('Cells!'));
    await act(async () => byTestID(r, 'share-post').props.onPress());
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ summary, breakdown, focusPct: 83, caption: 'Cells!' }));
  });

  it('shows Posted once the session is in the feed', async () => {
    act(() => signedIn({ postedSessionIds: ['sess_1'] }));
    const r = await render(<SharePanel summary={summary} breakdown={breakdown} focusPct={83} />);
    expect(textOf(r)).toContain("Posted to your friends' feed.");
  });
});
