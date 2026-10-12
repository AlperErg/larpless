import { keychainAuthStorage, normalizeSupabaseProjectUrl, setSupabaseCredentials } from '../../src/social/supabase';

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: jest.fn(async (k: string) => items.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      items.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      items.delete(k);
    }),
  };
}

const KEY = 'sb-abc-auth-token';
const SESSION = '{"access_token":"a","refresh_token":"r"}';

describe('keychainAuthStorage', () => {
  it('stores the session in the Keychain only', async () => {
    const keychain = memory();
    const legacy = memory();
    const storage = keychainAuthStorage(keychain, legacy);
    await storage.setItem(KEY, SESSION);
    expect(keychain.items.get(KEY)).toBe(SESSION);
    expect(legacy.items.has(KEY)).toBe(false);
    expect(await storage.getItem(KEY)).toBe(SESSION);
    await storage.removeItem(KEY);
    expect(keychain.items.has(KEY)).toBe(false);
  });

  it('moves a session saved in AsyncStorage into the Keychain and deletes the plain copy', async () => {
    const keychain = memory();
    const legacy = memory({ [KEY]: SESSION });
    const storage = keychainAuthStorage(keychain, legacy);
    expect(await storage.getItem(KEY)).toBe(SESSION);
    expect(keychain.items.get(KEY)).toBe(SESSION);
    expect(legacy.items.has(KEY)).toBe(false);
  });

  it('treats an undefined Keychain read (the bridge’s nil) as missing and still migrates', async () => {
    const keychain = { ...memory(), getItem: jest.fn(async () => undefined as unknown as string | null) };
    const legacy = memory({ [KEY]: SESSION });
    expect(await keychainAuthStorage(keychain, legacy).getItem(KEY)).toBe(SESSION);
    expect(keychain.items.get(KEY)).toBe(SESSION);
  });

  it('keeps the AsyncStorage copy when the Keychain write fails, and reads as signed out on a Keychain error', async () => {
    const legacy = memory({ [KEY]: SESSION });
    const failingSet = { ...memory(), setItem: jest.fn(async () => Promise.reject(new Error('denied'))) };
    expect(await keychainAuthStorage(failingSet, legacy).getItem(KEY)).toBe(SESSION);
    expect(legacy.items.get(KEY)).toBe(SESSION);

    const failingGet = { ...memory(), getItem: jest.fn(async () => Promise.reject(new Error('locked'))) };
    expect(await keychainAuthStorage(failingGet, legacy).getItem(KEY)).toBeNull();
  });

  it('a removal clears both stores', async () => {
    const keychain = memory({ [KEY]: SESSION });
    const legacy = memory({ [KEY]: SESSION });
    await keychainAuthStorage(keychain, legacy).removeItem(KEY);
    expect(keychain.items.size + legacy.items.size).toBe(0);
  });
});

describe('normalizeSupabaseProjectUrl', () => {
  it('strips REST and auth API suffixes', () => {
    expect(normalizeSupabaseProjectUrl('https://abc.supabase.co/rest/v1/')).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseProjectUrl('https://abc.supabase.co/rest/v1')).toBe('https://abc.supabase.co');
    expect(normalizeSupabaseProjectUrl('https://abc.supabase.co/auth/v1/')).toBe('https://abc.supabase.co');
  });

  it('leaves a correct project URL unchanged', () => {
    expect(normalizeSupabaseProjectUrl('https://abc.supabase.co')).toBe('https://abc.supabase.co');
  });
});

describe('setSupabaseCredentials', () => {
  afterEach(() => setSupabaseCredentials('', ''));

  it('treats REST-suffixed URL as the project root', () => {
    expect(setSupabaseCredentials('https://abc.supabase.co/rest/v1/', 'anon')).toBe(true);
    expect(setSupabaseCredentials('https://abc.supabase.co/rest/v1/', 'anon')).toBe(false);
  });
});
