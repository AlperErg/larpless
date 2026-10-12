/**
 * Supabase calls for accounts, friends and posts. Every helper takes the client, so tests pass a fake.
 * Posts carry stats only: never chunks, app names, window titles or images.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BreakdownEntry, SessionSummary, TagColor } from '../contracts/domain';

export interface Profile {
  id: string;
  username: string;
}

export type FriendshipStatus = 'pending' | 'accepted';

export interface Friendship {
  id: string;
  status: FriendshipStatus;
  /** 'outgoing' when I sent the request. */
  direction: 'incoming' | 'outgoing';
  other: Profile;
}

export interface FriendLists {
  friends: Friendship[];
  incoming: Friendship[];
  outgoing: Friendship[];
}

export interface FeedPost {
  id: string;
  userId: string;
  username: string;
  localSessionId: string;
  totalS: number;
  focusPct: number;
  pomodoros: number;
  streak: number;
  breakdown: BreakdownEntry[];
  caption: string | null;
  startedAt: number;
  createdAt: number;
}

export interface PublishInput {
  summary: SessionSummary;
  /** Breakdown and focus % after any relabelling on the Summary page. */
  breakdown: BreakdownEntry[];
  focusPct: number;
  streak: number;
  caption: string;
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const MIN_PASSWORD = 6;
export const MAX_CAPTION = 280;
/** Most subjects a post's breakdown carries. supabase/schema.sql enforces the same cap. */
export const MAX_BREAKDOWN = 20;
const TAG_COLORS: readonly TagColor[] = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const EMAIL_DOMAIN = 'larpless.local';
/** Accounts created before the rebrand. Username sign-in still accepts them. */
const LEGACY_EMAIL_DOMAIN = 'focusline.local';
const UNIQUE_VIOLATION = '23505';

export class SocialError extends Error {}

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

export function usernameProblem(username: string): string | null {
  if (USERNAME_RE.test(username)) return null;
  return 'Usernames are 3–20 characters: letters, numbers and underscores.';
}

export const emailFor = (username: string) => `${username}@${EMAIL_DOMAIN}`;

// Accounts -------------------------------------------------------------------

export async function signUp(client: SupabaseClient, rawUsername: string, password: string): Promise<void> {
  const username = normalizeUsername(rawUsername);
  const problem = usernameProblem(username);
  if (problem) throw new SocialError(problem);
  if (password.length < MIN_PASSWORD) throw new SocialError(`Passwords need at least ${MIN_PASSWORD} characters.`);
  const { data, error } = await client.auth.signUp({ email: emailFor(username), password, options: { data: { username } } });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) throw new SocialError('That username is taken.');
    throw new SocialError(error.message);
  }
  if (!data.session) throw new SocialError('Account created, but Supabase wants email confirmation. Turn off "Confirm email" in the dashboard.');
}

/** Accepts a username or, for accounts made outside the app, a full email address. */
export async function signIn(client: SupabaseClient, rawUsername: string, password: string): Promise<void> {
  const username = normalizeUsername(rawUsername);
  if (!username || !password) throw new SocialError('Enter your username and password.');
  const email = username.includes('@') ? username : emailFor(username);
  let { error } = await client.auth.signInWithPassword({ email, password });
  if (error && /invalid login credentials/i.test(error.message) && !username.includes('@')) {
    const retry = await client.auth.signInWithPassword({
      email: `${username}@${LEGACY_EMAIL_DOMAIN}`,
      password,
    });
    if (!retry.error) return;
    error = retry.error ?? error;
  }
  if (error) {
    if (/invalid login credentials/i.test(error.message)) throw new SocialError('Wrong username or password.');
    throw new SocialError(error.message);
  }
}

export async function signOut(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw new SocialError(error.message);
}

export async function getProfile(client: SupabaseClient, userId: string): Promise<Profile> {
  const { data, error } = await client.from('profiles').select('id, username').eq('id', userId).maybeSingle();
  if (error) throw new SocialError(error.message);
  if (!data) throw new SocialError('No profile found for this account. Has supabase/schema.sql been run?');
  return data as Profile;
}

// Friends --------------------------------------------------------------------

interface FriendshipRow {
  id: string;
  status: FriendshipStatus;
  requester_id: string;
  addressee_id: string;
  requester: Profile | null;
  addressee: Profile | null;
}

const FRIENDSHIP_SELECT =
  'id, status, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, username), addressee:profiles!friendships_addressee_id_fkey(id, username)';

export function splitFriendships(rows: FriendshipRow[], myId: string): FriendLists {
  const lists: FriendLists = { friends: [], incoming: [], outgoing: [] };
  for (const r of rows) {
    const outgoing = r.requester_id === myId;
    const other = outgoing ? r.addressee : r.requester;
    if (!other) continue;
    const f: Friendship = { id: r.id, status: r.status, direction: outgoing ? 'outgoing' : 'incoming', other };
    if (r.status === 'accepted') lists.friends.push(f);
    else (outgoing ? lists.outgoing : lists.incoming).push(f);
  }
  const byName = (a: Friendship, b: Friendship) => a.other.username.localeCompare(b.other.username);
  lists.friends.sort(byName);
  lists.incoming.sort(byName);
  lists.outgoing.sort(byName);
  return lists;
}

export async function listFriendships(client: SupabaseClient, myId: string): Promise<FriendLists> {
  const { data, error } = await client.from('friendships').select(FRIENDSHIP_SELECT);
  if (error) throw new SocialError(error.message);
  return splitFriendships((data ?? []) as unknown as FriendshipRow[], myId);
}

/** Sends a request, or accepts theirs if they already asked you. Returns what happened. */
export async function sendFriendRequest(
  client: SupabaseClient,
  myId: string,
  rawUsername: string,
): Promise<'sent' | 'accepted'> {
  const username = normalizeUsername(rawUsername);
  if (!username) throw new SocialError('Enter a username.');
  const { data: target, error: findError } = await client.from('profiles').select('id, username').eq('username', username).maybeSingle();
  if (findError) throw new SocialError(findError.message);
  if (!target) throw new SocialError(`No one is called @${username}.`);
  if (target.id === myId) throw new SocialError("That's you.");

  const { data: existing, error: existingError } = await client
    .from('friendships')
    .select('id, status, requester_id')
    .or(`and(requester_id.eq.${myId},addressee_id.eq.${target.id}),and(requester_id.eq.${target.id},addressee_id.eq.${myId})`)
    .maybeSingle();
  if (existingError) throw new SocialError(existingError.message);
  if (existing) {
    if (existing.status === 'accepted') throw new SocialError(`You're already friends with @${username}.`);
    if (existing.requester_id === myId) throw new SocialError(`Request to @${username} is already pending.`);
    await acceptRequest(client, existing.id);
    return 'accepted';
  }

  const { error } = await client.from('friendships').insert({ requester_id: myId, addressee_id: target.id });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new SocialError(`Request to @${username} is already pending.`);
    throw new SocialError(error.message);
  }
  return 'sent';
}

export async function acceptRequest(client: SupabaseClient, friendshipId: string): Promise<void> {
  const { error } = await client.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
  if (error) throw new SocialError(error.message);
}

/** Decline, cancel or unfriend. */
export async function removeFriendship(client: SupabaseClient, friendshipId: string): Promise<void> {
  const { error } = await client.from('friendships').delete().eq('id', friendshipId);
  if (error) throw new SocialError(error.message);
}

// Posts ----------------------------------------------------------------------

interface PostRow {
  id: string;
  user_id: string;
  local_session_id: string;
  total_s: number;
  focus_pct: number;
  pomodoros: number;
  streak: number;
  /** Written by other people's clients: may hold anything, so it is checked in toFeedPost(). */
  breakdown: unknown;
  caption: string | null;
  started_at: string;
  created_at: string;
  profiles: { username: string } | null;
}

export function postPayload(myId: string, input: PublishInput) {
  const caption = input.caption.trim().slice(0, MAX_CAPTION);
  return {
    user_id: myId,
    local_session_id: input.summary.id,
    total_s: Math.round(input.summary.totalS),
    focus_pct: Math.round(input.focusPct),
    pomodoros: input.summary.pomodoros,
    streak: input.streak,
    breakdown: input.breakdown.slice(0, MAX_BREAKDOWN).map((e) => ({ label: e.label, color: e.color, seconds: Math.round(e.seconds), pct: e.pct })),
    caption: caption || null,
    started_at: new Date(input.summary.startedAt).toISOString(),
  };
}

/** Posting the same session twice counts as success. */
export async function publishSession(client: SupabaseClient, myId: string, input: PublishInput): Promise<void> {
  const { error } = await client.from('posts').insert(postPayload(myId, input));
  if (error && error.code !== UNIQUE_VIOLATION) throw new SocialError(error.message);
}

/** Keeps only well-formed entries, so one friend's bad post can't break the feed. */
function cleanBreakdown(raw: unknown): BreakdownEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BreakdownEntry[] = [];
  for (const e of raw.slice(0, MAX_BREAKDOWN)) {
    if (!e || typeof e !== 'object') continue;
    const { label, color, seconds, pct } = e as Record<string, unknown>;
    if (typeof label !== 'string' || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) continue;
    if (typeof pct !== 'number' || !Number.isFinite(pct)) continue;
    out.push({
      key: `${out.length}:${label}`,
      label,
      color: TAG_COLORS.includes(color as TagColor) ? (color as TagColor) : 'gray',
      seconds,
      pct: Math.min(100, Math.max(0, pct)),
    });
  }
  return out;
}

export function toFeedPost(r: PostRow): FeedPost {
  return {
    id: r.id,
    userId: r.user_id,
    username: r.profiles?.username ?? 'unknown',
    localSessionId: r.local_session_id,
    totalS: r.total_s,
    focusPct: r.focus_pct,
    pomodoros: r.pomodoros,
    streak: r.streak,
    breakdown: cleanBreakdown(r.breakdown),
    caption: typeof r.caption === 'string' ? r.caption : null,
    startedAt: Date.parse(r.started_at),
    createdAt: Date.parse(r.created_at),
  };
}

/** You and your accepted friends, newest first (RLS does the filtering). */
export async function fetchFeed(client: SupabaseClient, limit = 50): Promise<FeedPost[]> {
  const { data, error } = await client
    .from('posts')
    .select('*, profiles(username)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new SocialError(error.message);
  return ((data ?? []) as unknown as PostRow[]).map(toFeedPost);
}
