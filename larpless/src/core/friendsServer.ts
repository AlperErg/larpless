/** Which Supabase project Friends talks to, if any. Pure, so the opt-in rule is testable on its own. */
import type { Settings } from '../contracts/domain';

export interface SupabasePair {
  url: string;
  key: string;
}

export type FriendsServer = { kind: 'off' } | { kind: 'none' } | ({ kind: 'own' | 'hosted' } & SupabasePair);

type FriendsSettings = Pick<Settings, 'friendsEnabled' | 'supabaseUrl' | 'supabaseAnonKey'>;

/**
 * Off → no server at all, so nothing leaves the computer. On → the user's own project when both fields
 * are filled in, else the hosted one. 'none' is on with neither (a build without a hosted server).
 */
export function friendsServer(settings: FriendsSettings, hosted: { url: string; anonKey: string }): FriendsServer {
  if (!settings.friendsEnabled) return { kind: 'off' };
  const ownUrl = settings.supabaseUrl.trim();
  const ownKey = settings.supabaseAnonKey.trim();
  if (ownUrl && ownKey) return { kind: 'own', url: ownUrl, key: ownKey };
  const url = hosted.url.trim();
  const key = hosted.anonKey.trim();
  if (url && key) return { kind: 'hosted', url, key };
  return { kind: 'none' };
}

export function hasHostedServer(hosted: { url: string; anonKey: string }): boolean {
  return !!hosted.url.trim() && !!hosted.anonKey.trim();
}
