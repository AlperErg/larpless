/** Which Supabase project Friends talks to, if any. Pure, so the opt-in rule is testable on its own. */
import type { Settings } from '../contracts/domain';

export interface SupabasePair {
  url: string;
  key: string;
}

export type FriendsServer = { kind: 'off' } | { kind: 'none' } | ({ kind: 'own' | 'hosted' } & SupabasePair);

/**
 * Why a key must not go into the app, or null. A secret key (sb_secret_…) or a legacy service_role JWT
 * bypasses row-level security, and a desktop app isn't a browser, so Supabase wouldn't refuse it.
 */
export function supabaseKeyProblem(key: string): string | null {
  const k = key.trim();
  if (/^sb_secret_/i.test(k)) return "That's a secret key. Use the publishable key (sb_publishable_…); secret keys bypass row-level security.";
  if (jwtRole(k) === 'service_role') return "That's the service_role key. Use the publishable key (sb_publishable_…); it bypasses row-level security.";
  return null;
}

/** The role claim of a legacy JWT key, or null for anything that isn't one. */
function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3 || typeof atob !== 'function') return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

type FriendsSettings = Pick<Settings, 'friendsEnabled' | 'supabaseUrl' | 'supabaseKey'>;

/**
 * Off → no server at all, so nothing leaves the computer. On → the user's own project when both fields
 * are filled in, else the hosted one. 'none' is on with neither (a build without a hosted server), or with
 * a secret key, which is never used.
 */
export function friendsServer(settings: FriendsSettings, hosted: { url: string; publishableKey: string }): FriendsServer {
  if (!settings.friendsEnabled) return { kind: 'off' };
  const ownUrl = settings.supabaseUrl.trim();
  const ownKey = settings.supabaseKey.trim();
  if (ownUrl && ownKey) return supabaseKeyProblem(ownKey) ? { kind: 'none' } : { kind: 'own', url: ownUrl, key: ownKey };
  const url = hosted.url.trim();
  const key = hosted.publishableKey.trim();
  if (url && key && !supabaseKeyProblem(key)) return { kind: 'hosted', url, key };
  return { kind: 'none' };
}

export function hasHostedServer(hosted: { url: string; publishableKey: string }): boolean {
  return !!hosted.url.trim() && !!hosted.publishableKey.trim() && !supabaseKeyProblem(hosted.publishableKey);
}
