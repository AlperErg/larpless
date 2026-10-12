/** The one Supabase client. Created lazily so tests and an unconfigured build never touch the network. */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

/** Settings override. Empty means "use env.ts". A half-filled pair is ignored until both are set. */
let runtimeUrl = '';
let runtimeKey = '';
let useRuntime = false;

let client: SupabaseClient | null = null;
let clientId = '';

/** Project root only — not `/rest/v1/` or `/auth/v1/` from the API docs. */
export function normalizeSupabaseProjectUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return '';
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/rest\/v1$/i, '').replace(/\/auth\/v1$/i, '');
  return url.replace(/\/+$/, '');
}

function pair(): { url: string; key: string } | null {
  const url = normalizeSupabaseProjectUrl(useRuntime ? runtimeUrl : SUPABASE_URL);
  const key = (useRuntime ? runtimeKey : SUPABASE_ANON_KEY).trim();
  if (!url || !key) return null;
  return { url, key };
}

function fingerprint(): string {
  const current = pair();
  return current ? `${current.url}\n${current.key}` : '';
}

export function isSupabaseConfigured(): boolean {
  return pair() !== null;
}

/** True when the live client must be dropped because the project identity changed. */
export function setSupabaseCredentials(url: string, key: string): boolean {
  const nextUrl = normalizeSupabaseProjectUrl(url);
  const nextKey = key.trim();
  const complete = !!nextUrl && !!nextKey;
  const cleared = !nextUrl && !nextKey;
  if (!complete && !cleared) return false;

  const before = fingerprint();
  if (cleared) {
    useRuntime = false;
    runtimeUrl = '';
    runtimeKey = '';
  } else {
    useRuntime = true;
    runtimeUrl = nextUrl;
    runtimeKey = nextKey;
  }
  if (fingerprint() === before) return false;
  client = null;
  clientId = '';
  return true;
}

export function getSupabase(): SupabaseClient {
  const current = pair();
  if (!current) throw new Error('Supabase is not configured');
  const id = `${current.url}\n${current.key}`;
  if (!client || clientId !== id) {
    client = createClient(current.url, current.key, {
      auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    clientId = id;
  }
  return client;
}
