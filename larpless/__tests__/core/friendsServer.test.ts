import { DEFAULT_SETTINGS } from '../../src/config';
import { friendsServer, hasHostedServer } from '../../src/core/friendsServer';

const hosted = { url: 'https://hosted.supabase.co', anonKey: 'hosted-key' };
const noHosted = { url: '', anonKey: '' };
const own = { supabaseUrl: 'https://own.supabase.co', supabaseAnonKey: 'own-key' };

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
