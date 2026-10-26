/**
 * Accounts, friends and the feed. The local session flow never waits on this store:
 * every network failure leaves the last data in memory and flips `offline`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import * as api from '../social/api';
import type { FeedPost, FriendLists, Profile, PublishInput } from '../social/api';
import { getSupabase, isSupabaseConfigured } from '../social/supabase';

export type AuthStatus = 'unconfigured' | 'loading' | 'signedOut' | 'signedIn';

export interface SocialState {
  status: AuthStatus;
  userId: string | null;
  profile: Profile | null;
  feed: FeedPost[];
  feedLoaded: boolean;
  lists: FriendLists;
  /** Sessions posted from this device since launch (the feed covers older ones). */
  postedSessionIds: string[];
  offline: boolean;
  refreshing: boolean;
}

export interface SocialActions {
  init(): void;
  signIn(username: string, password: string): Promise<void>;
  signUp(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Delete the account and everything it posted, then sign out. Local history stays. */
  deleteAccount(): Promise<void>;
  /** Drop the current session and listen on the client for the latest keys. */
  reconfigure(): void;
  refresh(): Promise<void>;
  addFriend(username: string): Promise<'sent' | 'accepted'>;
  acceptRequest(friendshipId: string): Promise<void>;
  removeFriendship(friendshipId: string): Promise<void>;
  publish(input: PublishInput): Promise<void>;
}

export type SocialStore = SocialState & SocialActions;

const emptyLists: FriendLists = { friends: [], incoming: [], outgoing: [] };

const signedOutState = {
  userId: null,
  profile: null,
  feed: [],
  feedLoaded: false,
  lists: emptyLists,
  postedSessionIds: [],
  offline: false,
  refreshing: false,
} satisfies Omit<SocialState, 'status'>;

export function isSessionPosted(s: SocialState, sessionId: string): boolean {
  return (
    s.postedSessionIds.includes(sessionId) ||
    s.feed.some((p) => p.userId === s.userId && p.localSessionId === sessionId)
  );
}

export function createSocialStore(getClient: () => SupabaseClient, configured: boolean | (() => boolean)) {
  const isConfigured = typeof configured === 'function' ? configured : () => configured;
  let initialized = false;
  let unsubscribe: (() => void) | null = null;

  return create<SocialStore>()((set, get) => {
    const requireUser = (): string => {
      const id = get().userId;
      if (!id) throw new api.SocialError('Sign in first.');
      return id;
    };

    const onSignedIn = async (userId: string) => {
      if (get().userId === userId) return;
      set({ ...signedOutState, status: 'signedIn', userId });
      try {
        const profile = await api.getProfile(getClient(), userId);
        if (get().userId === userId) set({ profile });
      } catch (e) {
        console.warn('[social] profile load failed:', e instanceof Error ? e.message : String(e));
      }
      await get().refresh();
    };

    const listen = () => {
      if (!isConfigured() || initialized) return;
      initialized = true;
      const { data } = getClient().auth.onAuthStateChange((_event, session) => {
        // Supabase warns against awaiting client calls inside this callback; defer them.
        setTimeout(() => {
          if (session?.user) {
            onSignedIn(session.user.id).catch(() => {});
          } else {
            set({ ...signedOutState, status: 'signedOut' });
          }
        }, 0);
      });
      unsubscribe = () => data.subscription.unsubscribe();
    };

    return {
      status: isConfigured() ? 'loading' : 'unconfigured',
      ...signedOutState,

      init: listen,

      reconfigure: () => {
        unsubscribe?.();
        unsubscribe = null;
        initialized = false;
        set({ ...signedOutState, status: isConfigured() ? 'loading' : 'unconfigured' });
        listen();
      },

      signIn: (username, password) => api.signIn(getClient(), username, password),
      signUp: (username, password) => api.signUp(getClient(), username, password),
      signOut: () => api.signOut(getClient()),

      deleteAccount: async () => {
        requireUser();
        await api.deleteAccount(getClient());
        set({ ...signedOutState, status: 'signedOut' });
      },

      refresh: async () => {
        const userId = get().userId;
        if (!userId) return;
        set({ refreshing: true });
        const client = getClient();
        const [feed, lists] = await Promise.allSettled([api.fetchFeed(client), api.listFriendships(client, userId)]);
        if (get().userId !== userId) return;
        set({
          refreshing: false,
          offline: feed.status === 'rejected' || lists.status === 'rejected',
          ...(feed.status === 'fulfilled' ? { feed: feed.value, feedLoaded: true } : null),
          ...(lists.status === 'fulfilled' ? { lists: lists.value } : null),
        });
      },

      addFriend: async (username) => {
        const result = await api.sendFriendRequest(getClient(), requireUser(), username);
        await get().refresh();
        return result;
      },

      acceptRequest: async (friendshipId) => {
        requireUser();
        await api.acceptRequest(getClient(), friendshipId);
        await get().refresh();
      },

      removeFriendship: async (friendshipId) => {
        requireUser();
        await api.removeFriendship(getClient(), friendshipId);
        await get().refresh();
      },

      publish: async (input) => {
        await api.publishSession(getClient(), requireUser(), input);
        set((s) => ({ postedSessionIds: [...s.postedSessionIds, input.summary.id] }));
        await get().refresh();
      },
    };
  });
}

export const useSocialStore = createSocialStore(getSupabase, isSupabaseConfigured);
