import { DEFAULT_SETTINGS } from '../../src/config';
import { friendsServer, hasHostedServer, supabaseKeyProblem } from '../../src/core/friendsServer';

const hosted = { url: 'https://hosted.supabase.co', publishableKey: 'hosted-key' };
const noHosted = { url: '', publishableKey: '' };
const own = { supabaseUrl: 'https://own.supabase.co', supabaseKey: 'own-key' };

describe('friendsServer', () => {
  it('is off by default, so no server is used at all', () => {
    expect(DEFAULT_SETTINGS.friendsEnabled).toBe(false);
    expect(friendsServer(DEFAULT_SETTINGS, hosted)).toEqual({ kind: 'off' });
  });

  it('stays off even with an own server filled in', () => {
    expect(friendsServer({ ...DEFAULT_SETTINGS, ...own }, hosted)).toEqual({ kind: 'off' });
  });

  it('uses the hosted server once turned on', () => {
    expect(friendsServer({ ...DEFAULT_SETTINGS, friendsEnabled: true }, hosted)).toEqual({
      kind: 'hosted',
      url: 'https://hosted.supabase.co',
      key: 'hosted-key',
    });
  });

  it('prefers a complete own server over the hosted one', () => {
    expect(friendsServer({ ...DEFAULT_SETTINGS, friendsEnabled: true, ...own }, hosted)).toEqual({
      kind: 'own',
      url: 'https://own.supabase.co',
      key: 'own-key',
    });
    // Half filled in: the hosted server still applies.
    expect(friendsServer({ ...DEFAULT_SETTINGS, friendsEnabled: true, supabaseUrl: own.supabaseUrl }, hosted).kind).toBe('hosted');
  });

  it("is 'none' when on in a build without a hosted server", () => {
    expect(hasHostedServer(noHosted)).toBe(false);
    expect(friendsServer({ ...DEFAULT_SETTINGS, friendsEnabled: true }, noHosted)).toEqual({ kind: 'none' });
    expect(friendsServer({ ...DEFAULT_SETTINGS, friendsEnabled: true, ...own }, noHosted).kind).toBe('own');
  });
});

/** A legacy JWT key with this role claim (unsigned; only the payload is read). */
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;

describe('supabaseKeyProblem', () => {
  it('accepts publishable and legacy anon keys', () => {
    expect(supabaseKeyProblem('sb_publishable_abc123')).toBeNull();
    expect(supabaseKeyProblem(jwt('anon'))).toBeNull();
    expect(supabaseKeyProblem('')).toBeNull();
  });

  it('refuses secret and service_role keys, which bypass row-level security', () => {
    expect(supabaseKeyProblem('sb_secret_abc123')).toMatch(/secret key/);
    expect(supabaseKeyProblem(jwt('service_role'))).toMatch(/service_role/);
  });

  it('never connects with a secret key, own or hosted', () => {
    const on = { ...DEFAULT_SETTINGS, friendsEnabled: true };
    expect(friendsServer({ ...on, supabaseUrl: 'https://own.supabase.co', supabaseKey: 'sb_secret_x' }, hosted)).toEqual({ kind: 'none' });
    const leaked = { url: 'https://hosted.supabase.co', publishableKey: 'sb_secret_x' };
    expect(hasHostedServer(leaked)).toBe(false);
    expect(friendsServer(on, leaked)).toEqual({ kind: 'none' });
  });
});
