import type { SupabaseClient } from '@supabase/supabase-js';

export interface FakeResponse {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

export interface FakeCall {
  table: string;
  ops: [string, unknown[]][];
}

type AuthCallback = (event: string, session: { user: { id: string } } | null) => void;

/**
 * Minimal stand-in for the Supabase client. Each `from(table)` chain records its method calls and
 * resolves to the next scripted response for that table (or `{ data: null, error: null }`).
 */
export function fakeSupabase(script: Record<string, FakeResponse[]> = {}) {
  const calls: FakeCall[] = [];
  let authCallback: AuthCallback | null = null;

  const from = (table: string) => {
    const call: FakeCall = { table, ops: [] };
    calls.push(call);
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            const res = script[table]?.shift() ?? {};
            return (resolve: (v: unknown) => void) => resolve({ data: res.data ?? null, error: res.error ?? null });
          }
          return (...args: unknown[]) => {
            call.ops.push([prop, args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };

  const auth = {
    signUp: jest.fn(async (_: unknown) => ({ data: { session: { access_token: 't' } }, error: null as { message: string } | null })),
    signInWithPassword: jest.fn(async (_: unknown) => ({ data: {}, error: null as { message: string } | null })),
    signOut: jest.fn(async () => ({ error: null })),
    onAuthStateChange: jest.fn((cb: AuthCallback) => {
      authCallback = cb;
      return { data: { subscription: { unsubscribe: () => {} } } };
    }),
  };

  return {
    client: { from, auth } as unknown as SupabaseClient,
    auth,
    calls,
    /** Ops recorded for the n-th call to `table` (0-based). */
    opsFor(table: string, n = 0) {
      return calls.filter((c) => c.table === table)[n]?.ops ?? [];
    },
    emitAuth(session: { user: { id: string } } | null) {
      authCallback?.(session ? 'SIGNED_IN' : 'SIGNED_OUT', session);
    },
  };
}

export const flush = () => new Promise<void>((r) => setTimeout(() => r(), 5));
