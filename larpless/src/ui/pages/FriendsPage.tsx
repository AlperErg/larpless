/** Friends tab: your friends' posted sessions, and managing friends and requests. */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Friendship } from '../../social/api';
import { useNavStore } from '../../store/navStore';
import { useSocialStore } from '../../store/socialStore';
import { Button, Callout, Segmented, Tag, Text } from '../components';
import { Avatar, PostCard } from '../components/PostCard';
import { TextField } from '../components/TextField';
import { Page } from '../layout/Page';
import { errorText } from '../lib/social';
import { colors, space, tag } from '../theme';
import { AuthGate } from './LoginPage';

type Tab = 'feed' | 'friends';

export function FriendsPage() {
  const status = useSocialStore((s) => s.status);
  const profile = useSocialStore((s) => s.profile);
  const incoming = useSocialStore((s) => s.lists.incoming.length);
  const friendCount = useSocialStore((s) => s.lists.friends.length);
  const refresh = useSocialStore((s) => s.refresh);
  const signOut = useSocialStore((s) => s.signOut);
  const [tab, setTab] = useState<Tab>('feed');

  useEffect(() => {
    if (status === 'signedIn') refresh().catch(() => {});
  }, [status, refresh]);

  useEffect(() => {
    if (status !== 'signedIn') return;
    const nav = useNavStore.getState();
    if (!nav.params.auth || (nav.route !== 'feed' && nav.route !== 'profile')) return;
    const next = { ...nav.params };
    delete next.auth;
    nav.go(nav.route, next);
  }, [status]);

  if (status === 'loading') {
    return (
      <Page testID="page-friends" header={{ icon: '👥', title: 'Friends' }}>
        <Text muted>Loading…</Text>
      </Page>
    );
  }
  if (status !== 'signedIn') return <AuthGate />;

  return (
    <Page
      testID="page-friends"
      header={{
        icon: '👥',
        title: 'Friends',
        subtitle: <Text variant="small">{profile ? `Signed in as @${profile.username}` : 'Signed in'}</Text>,
        right: (
          <Button testID="friends-signout" title="Sign out" variant="secondary" onPress={() => signOut().catch(() => {})} />
        ),
      }}>
      <Segmented<Tab>
        testID="friends-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'feed', label: 'Feed', icon: '📰' },
          {
            value: 'friends',
            label: incoming ? `Friends · ${incoming} new` : friendCount ? `Friends (${friendCount})` : 'Friends',
            icon: '🤝',
          },
        ]}
      />
      <View style={styles.tabBody}>{tab === 'feed' ? <FeedTab onAddFriends={() => setTab('friends')} /> : <FriendsTab />}</View>
    </Page>
  );
}

function FeedTab({ onAddFriends }: { onAddFriends: () => void }) {
  const feed = useSocialStore((s) => s.feed);
  const feedLoaded = useSocialStore((s) => s.feedLoaded);
  const offline = useSocialStore((s) => s.offline);
  const refreshing = useSocialStore((s) => s.refreshing);
  const userId = useSocialStore((s) => s.userId);
  const friendCount = useSocialStore((s) => s.lists.friends.length);
  const refresh = useSocialStore((s) => s.refresh);

  return (
    <View testID="friends-feed">
      <View style={styles.row}>
        <Button
          testID="feed-refresh"
          title={refreshing ? 'Refreshing…' : 'Refresh'}
          icon="↻"
          variant="secondary"
          disabled={refreshing}
          onPress={() => refresh().catch(() => {})}
        />
        {offline ? <Tag testID="feed-offline" label="Offline" color="gray" style={styles.gapLeft} /> : null}
      </View>

      {!feedLoaded ? (
        <Text muted style={styles.block}>
          {offline ? "Couldn't load the feed." : 'Loading the feed…'}
        </Text>
      ) : feed.length === 0 ? (
        <Callout testID="feed-empty" emoji="🌱" style={styles.block}>
          <Text>
            {friendCount
              ? 'No posts yet. Finish a session and hit "Post to friends" on the summary.'
              : 'Add friends to see their sessions here.'}
          </Text>
          {friendCount ? null : <Button title="Add friends" variant="secondary" onPress={onAddFriends} style={styles.calloutButton} />}
        </Callout>
      ) : (
        feed.map((p) => <PostCard key={p.id} testID={`post-${p.id}`} post={p} mine={p.userId === userId} style={styles.card} />)
      )}
    </View>
  );
}

function FriendsTab() {
  const lists = useSocialStore((s) => s.lists);
  const addFriend = useSocialStore((s) => s.addFriend);
  const acceptRequest = useSocialStore((s) => s.acceptRequest);
  const removeFriendship = useSocialStore((s) => s.removeFriendship);
  const [username, setUsername] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const send = () => {
    if (sending || !username.trim()) return;
    setSending(true);
    setMessage(null);
    const name = username.trim().replace(/^@/, '');
    addFriend(name)
      .then((r) => {
        setUsername('');
        setMessage({ ok: true, text: r === 'accepted' ? `You and @${name} are now friends.` : `Request sent to @${name}.` });
      })
      .catch((e: unknown) => setMessage({ ok: false, text: errorText(e) }))
      .finally(() => setSending(false));
  };

  const act = (id: string, fn: (id: string) => Promise<void>) => {
    setBusyId(id);
    setMessage(null);
    fn(id)
      .catch((e: unknown) => setMessage({ ok: false, text: errorText(e) }))
      .finally(() => setBusyId(null));
  };

  return (
    <View testID="friends-manage">
      <Text weight="semibold">Add a friend</Text>
      <View style={[styles.row, styles.addRow]}>
        <TextField
          testID="friend-username"
          value={username}
          onChangeText={setUsername}
          placeholder="@username"
          onSubmitEditing={send}
          style={styles.addInput}
        />
        <Button
          testID="friend-send"
          title={sending ? 'Sending…' : 'Send request'}
          variant="primary"
          disabled={sending || !username.trim()}
          onPress={send}
          style={styles.gapLeft}
        />
      </View>
      {message ? (
        <Text testID="friend-message" variant="small" color={message.ok ? tag.green.text : tag.red.text} style={styles.message}>
          {message.text}
        </Text>
      ) : null}

      {lists.incoming.length ? (
        <FriendSection title="Requests">
          {lists.incoming.map((f) => (
            <FriendRow key={f.id} f={f} note="wants to be friends">
              <Button
                testID={`accept-${f.other.username}`}
                title="Accept"
                variant="primary"
                disabled={busyId === f.id}
                onPress={() => act(f.id, acceptRequest)}
              />
              <Button title="Decline" variant="ghost" disabled={busyId === f.id} onPress={() => act(f.id, removeFriendship)} style={styles.gapLeftSm} />
            </FriendRow>
          ))}
        </FriendSection>
      ) : null}

      <FriendSection title={`Friends${lists.friends.length ? ` (${lists.friends.length})` : ''}`}>
        {lists.friends.length ? (
          lists.friends.map((f) => (
            <FriendRow key={f.id} f={f}>
              <Button title="Remove" variant="danger" disabled={busyId === f.id} onPress={() => act(f.id, removeFriendship)} />
            </FriendRow>
          ))
        ) : (
          <Text muted>No friends yet. Ask a friend for their username.</Text>
        )}
      </FriendSection>

      {lists.outgoing.length ? (
        <FriendSection title="Sent">
          {lists.outgoing.map((f) => (
            <FriendRow key={f.id} f={f} note="pending">
              <Button title="Cancel" variant="ghost" disabled={busyId === f.id} onPress={() => act(f.id, removeFriendship)} />
            </FriendRow>
          ))}
        </FriendSection>
      ) : null}
    </View>
  );
}

function FriendSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text weight="semibold" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function FriendRow({ f, note, children }: { f: Friendship; note?: string; children: ReactNode }) {
  return (
    <View testID={`friend-${f.other.username}`} style={styles.friendRow}>
      <Avatar username={f.other.username} size={24} />
      <Text weight="medium" numberOfLines={1}>{`@${f.other.username}`}</Text>
      {note ? (
        <Text variant="small" style={styles.note}>
          {note}
        </Text>
      ) : null}
      <View style={styles.flex} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  gapLeft: { marginLeft: space.md },
  gapLeftSm: { marginLeft: space.xs },
  tabBody: { marginTop: space.lg },
  block: { marginTop: space.lg },
  card: { marginTop: space.lg },
  calloutButton: { marginTop: space.sm },
  addRow: { marginTop: space.sm },
  addInput: { width: 240 },
  message: { marginTop: space.sm },
  section: { marginTop: space.xxl },
  sectionTitle: {
    paddingBottom: space.xs,
    marginBottom: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  friendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.xs + 2 },
  note: { marginLeft: space.sm },
});
