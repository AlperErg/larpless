import { normalizeSupabaseProjectUrl, setSupabaseCredentials } from '../../src/social/supabase';

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
