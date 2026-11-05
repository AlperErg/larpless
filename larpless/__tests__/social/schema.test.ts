/**
 * @jest-environment node
 */
/// <reference types="node" />
/**
 * Row-level security in supabase/schema.sql, run in real Postgres (PGlite, see test/pglite.ts).
 * test/fakeSupabase.ts can't enforce any of this, so these are the only checks that friends-only
 * posts, one-way friend requests and the stats-only post table actually hold in the database.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { postPayload } from '../../src/social/api';
import { fixtureSummary } from '../../src/fixtures/data';
import { startTestPostgres } from '../../test/pglite';
import type { TestPostgres } from '../../test/pglite';

const SCHEMA = readFileSync(join(__dirname, '../../supabase/schema.sql'), 'utf8');

// The parts of a Supabase project that schema.sql relies on: the two API roles, auth.users,
// auth.uid() (reads the JWT subject the API sets per request) and the default table grants
// (Supabase grants everything to anon/authenticated and leaves the filtering to RLS).
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

type User = 'alice' | 'bob' | 'carol';
type Who = User | 'anon';

let db: TestPostgres;
const ids = {} as Record<User, string>;

/** Runs one statement the way the Supabase API would for this caller (role + JWT subject), in its own transaction. */
function as<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []) {
  return who === 'anon' ? db.as<T>('anon', null, sql, params) : db.as<T>('authenticated', ids[who], sql, params);
}

function insertAs(who: Who, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const sql = `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`;
  return as(who, sql, cols.map((c) => row[c]));
}

const changed = async (p: Promise<{ affectedRows: number }>) => (await p).affectedRows;

async function signUp(username: string): Promise<string> {
  const res = await db.query<{ id: string }>('insert into auth.users (raw_user_meta_data) values ($1) returning id', [{ username }]);
  return res.rows[0].id;
}

/** Seeded as the service role (bypasses RLS), so each test starts from a known state. */
async function seedFriendship(a: User, b: User, status: 'pending' | 'accepted'): Promise<string> {
  const res = await db.query<{ id: string }>(
    'insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, $3) returning id',
    [ids[a], ids[b], status],
  );
  return res.rows[0].id;
}

function postRow(user: User, sessionId = 'sess_1') {
  return {
    user_id: ids[user],
    local_session_id: sessionId,
    total_s: 3000,
    focus_pct: 80,
    started_at: '2026-10-01T09:00:00Z',
  };
}

async function seedPost(user: User, sessionId = 'sess_1') {
  const row = postRow(user, sessionId);
  await db.query(
    'insert into public.posts (user_id, local_session_id, total_s, focus_pct, started_at) values ($1, $2, $3, $4, $5)',
    Object.values(row),
  );
}

const visiblePostAuthors = async (who: Who) =>
  (await as<{ user_id: string }>(who, 'select user_id from public.posts')).rows.map((r) => r.user_id);

beforeAll(async () => {
  db = await startTestPostgres();
  await db.exec(SUPABASE_STUB);
  await db.exec(SCHEMA);
  await db.exec(SCHEMA); // the header promises it's safe to re-run
  ids.alice = await signUp('Alice');
  ids.bob = await signUp('bob');
  ids.carol = await signUp('carol');
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('delete from public.posts; delete from public.friendships; delete from public.rate_events;');
});

const usernamesVisibleTo = async (who: Who) =>
  (await as<{ username: string }>(who, 'select username from public.profiles order by username')).rows.map((r) => r.username);

/** The add-friend lookup as the app calls it: find_profile() by exact username. */
const findProfile = async (who: Who, username: string) =>
  (await as<{ username: string }>(who, 'select username from public.find_profile($1)', [username])).rows.map((r) => r.username);

describe('profiles', () => {
  it('sign-up creates a profile with the lowercased username', async () => {
    const res = await db.query<{ username: string }>('select username from public.profiles where id = $1', [ids.alice]);
    expect(res.rows).toEqual([{ username: 'alice' }]);
  });

  it('sign-up fails outright for a username the app would never send', async () => {
    await expect(signUp('no spaces!')).rejects.toMatchObject({ code: '23514' });
  });

  it('nobody can list every username (#6): you see yourself and people you have a request or friendship with', async () => {
    expect(await usernamesVisibleTo('carol')).toEqual(['carol']);
    await seedFriendship('alice', 'carol', 'pending');
    expect(await usernamesVisibleTo('carol')).toEqual(['alice', 'carol']);
    expect(await usernamesVisibleTo('alice')).toEqual(['alice', 'carol']);
    expect(await usernamesVisibleTo('bob')).toEqual(['bob']);
    expect((await as('anon', 'select * from public.profiles')).rows).toEqual([]);
  });

  it('find_profile() finds one person by their exact username, case and spaces aside, and nothing else', async () => {
    expect(await findProfile('carol', 'bob')).toEqual(['bob']);
    expect(await findProfile('carol', '  BOB ')).toEqual(['bob']);
    expect(await findProfile('carol', 'bo')).toEqual([]);
    expect(await findProfile('carol', '%')).toEqual([]);
    await expect(as('anon', "select * from public.find_profile('bob')")).rejects.toMatchObject({ code: '42501' });
  });

  it('nobody can create or edit profiles through the API', async () => {
    await expect(insertAs('alice', 'profiles', { id: ids.alice, username: 'alice2' })).rejects.toMatchObject({ code: '42501' });
    expect(await changed(as('alice', "update public.profiles set username = 'alice2' where id = $1", [ids.alice]))).toBe(0);
    expect(await changed(as('alice', 'delete from public.profiles where id = $1', [ids.bob]))).toBe(0);
  });
});

describe('delete_account()', () => {
  it('deletes only the caller, with their profile, friendships and posts', async () => {
    const dave = await signUp('dave');
    await db.query('insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, $3)', [dave, ids.alice, 'accepted']);
    await db.query('insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, $3)', [ids.bob, ids.alice, 'accepted']);
    await db.query(
      'insert into public.posts (user_id, local_session_id, total_s, focus_pct, started_at) values ($1, $2, $3, $4, $5)',
      Object.values({ ...postRow('alice'), user_id: dave }),
    );
    await seedPost('alice');

    await db.as('authenticated', dave, 'select public.delete_account()');

    const left = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows.length;
    expect(await left('select 1 from auth.users where id = $1', [dave])).toBe(0);
    expect(await left('select 1 from public.profiles where id = $1', [dave])).toBe(0);
    expect(await left('select 1 from public.friendships where $1 in (requester_id, addressee_id)', [dave])).toBe(0);
    expect(await left('select 1 from public.posts where user_id = $1', [dave])).toBe(0);
    // Everyone else is untouched.
    expect(await left('select 1 from public.profiles where id in ($1, $2, $3)', [ids.alice, ids.bob, ids.carol])).toBe(3);
    expect(await left('select 1 from public.friendships')).toBe(1);
    expect(await left('select 1 from public.posts where user_id = $1', [ids.alice])).toBe(1);
  });

  it('anonymous callers cannot run it', async () => {
    await expect(as('anon', 'select public.delete_account()')).rejects.toMatchObject({ code: '42501' });
    expect((await db.query('select 1 from public.profiles')).rows.length).toBe(3);
  });
});

describe('friendships', () => {
  it('you can send a pending request as yourself', async () => {
    await insertAs('alice', 'friendships', { requester_id: ids.alice, addressee_id: ids.bob });
    const rows = (await db.query<{ status: string }>('select status from public.friendships')).rows;
    expect(rows).toEqual([{ status: 'pending' }]);
  });

  it('you cannot send a request on someone else’s behalf or skip straight to accepted', async () => {
    await expect(insertAs('alice', 'friendships', { requester_id: ids.bob, addressee_id: ids.carol })).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      insertAs('alice', 'friendships', { requester_id: ids.alice, addressee_id: ids.bob, status: 'accepted' }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(insertAs('anon', 'friendships', { requester_id: ids.alice, addressee_id: ids.bob })).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('you cannot befriend yourself', async () => {
    await expect(insertAs('alice', 'friendships', { requester_id: ids.alice, addressee_id: ids.alice })).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('one row per pair: a request back the other way is a unique violation (the app reports "already pending")', async () => {
    await seedFriendship('alice', 'bob', 'pending');
    await expect(insertAs('bob', 'friendships', { requester_id: ids.bob, addressee_id: ids.alice })).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('only the two people involved can see a friendship', async () => {
    await seedFriendship('alice', 'bob', 'pending');
    const count = async (who: Who) => (await as(who, 'select id from public.friendships')).rows.length;
    expect(await count('alice')).toBe(1);
    expect(await count('bob')).toBe(1);
    expect(await count('carol')).toBe(0);
    expect(await count('anon')).toBe(0);
  });

  it('only the addressee can accept, and only while it is pending', async () => {
    const id = await seedFriendship('alice', 'bob', 'pending');
    const accept = (who: Who) => changed(as(who, "update public.friendships set status = 'accepted' where id = $1", [id]));
    expect(await accept('alice')).toBe(0); // the requester can't accept their own request
    expect(await accept('carol')).toBe(0);
    expect(await accept('bob')).toBe(1);
    expect(await changed(as('bob', "update public.friendships set status = 'pending' where id = $1", [id]))).toBe(0);
    const rows = (await db.query<{ status: string }>('select status from public.friendships')).rows;
    expect(rows).toEqual([{ status: 'accepted' }]);
  });

  it('the two ids are fixed once sent', async () => {
    const id = await seedFriendship('alice', 'bob', 'pending');
    await expect(as('bob', 'update public.friendships set requester_id = $1 where id = $2', [ids.carol, id])).rejects.toMatchObject({
      code: '42501',
    });
    await expect(as('alice', 'update public.friendships set addressee_id = $1 where id = $2', [ids.carol, id])).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('either side can remove it (decline, cancel, unfriend); nobody else can', async () => {
    const pending = await seedFriendship('alice', 'bob', 'pending');
    const accepted = await seedFriendship('carol', 'alice', 'accepted');
    const remove = (who: Who, id: string) => changed(as(who, 'delete from public.friendships where id = $1', [id]));
    expect(await remove('carol', pending)).toBe(0);
    expect(await remove('bob', pending)).toBe(1); // decline
    expect(await remove('bob', accepted)).toBe(0);
    expect(await remove('alice', accepted)).toBe(1); // unfriend
    expect((await db.query('select id from public.friendships')).rows).toEqual([]);
  });
});

describe('are_friends()', () => {
  const areFriends = async (who: Who, a: User, b: User) =>
    (await as<{ ok: boolean }>(who, 'select public.are_friends($1, $2) as ok', [ids[a], ids[b]])).rows[0].ok;

  it('is true for an accepted pair, from either side, and false while pending', async () => {
    await seedFriendship('alice', 'bob', 'accepted');
    await seedFriendship('alice', 'carol', 'pending');
    expect(await areFriends('alice', 'alice', 'bob')).toBe(true);
    expect(await areFriends('bob', 'bob', 'alice')).toBe(true);
    expect(await areFriends('alice', 'alice', 'carol')).toBe(false);
  });

  it('does not reveal other people’s friendships (security invoker)', async () => {
    await seedFriendship('alice', 'bob', 'accepted');
    expect(await areFriends('carol', 'alice', 'bob')).toBe(false);
    await expect(areFriends('anon', 'alice', 'bob')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('posts', () => {
  it('you see your own posts and your accepted friends’ posts, nobody else’s', async () => {
    await seedFriendship('alice', 'bob', 'accepted');
    await seedPost('alice');
    expect(await visiblePostAuthors('alice')).toEqual([ids.alice]);
    expect(await visiblePostAuthors('bob')).toEqual([ids.alice]);
    expect(await visiblePostAuthors('carol')).toEqual([]);
    expect(await visiblePostAuthors('anon')).toEqual([]);
  });

  it('a pending request does not unlock posts in either direction', async () => {
    await seedFriendship('alice', 'bob', 'pending');
    await seedPost('alice');
    await seedPost('bob');
    expect(await visiblePostAuthors('alice')).toEqual([ids.alice]);
    expect(await visiblePostAuthors('bob')).toEqual([ids.bob]);
  });

  it('unfriending hides their posts again', async () => {
    const id = await seedFriendship('alice', 'bob', 'accepted');
    await seedPost('alice');
    expect(await visiblePostAuthors('bob')).toEqual([ids.alice]);
    await as('bob', 'delete from public.friendships where id = $1', [id]);
    expect(await visiblePostAuthors('bob')).toEqual([]);
  });

  it('the feed query gets the author’s username for a friend’s post', async () => {
    await seedFriendship('alice', 'bob', 'accepted');
    await seedPost('alice');
    const res = await as<{ username: string }>(
      'bob',
      'select pr.username from public.posts p left join public.profiles pr on pr.id = p.user_id',
    );
    expect(res.rows).toEqual([{ username: 'alice' }]);
  });

  it('accepts the exact payload the app publishes', async () => {
    const payload = postPayload(ids.alice, {
      summary: fixtureSummary,
      focusPct: fixtureSummary.focusPct,
      streak: 5,
      breakdown: [{ key: 'm', label: 'Maths', color: 'blue', seconds: 1200.4, pct: 60 }],
      caption: '  deep work  ',
    });
    await insertAs('alice', 'posts', payload);
    const row = (await db.query<Record<string, unknown>>('select * from public.posts')).rows[0];
    expect(row).toMatchObject({ user_id: ids.alice, local_session_id: fixtureSummary.id, caption: 'deep work', streak: 5 });
    expect(row.breakdown).toEqual([{ label: 'Maths', color: 'blue', seconds: 1200, pct: 60 }]);
  });

  it('posting the same session twice is a unique violation (the app treats it as already posted)', async () => {
    await insertAs('alice', 'posts', postRow('alice'));
    await expect(insertAs('alice', 'posts', postRow('alice'))).rejects.toMatchObject({ code: '23505' });
  });

  it('you can only post as yourself and only delete your own posts; nobody can edit one', async () => {
    await expect(insertAs('alice', 'posts', postRow('bob'))).rejects.toMatchObject({ code: '42501' });
    await expect(insertAs('anon', 'posts', postRow('alice'))).rejects.toMatchObject({ code: '42501' });

    await seedFriendship('alice', 'bob', 'accepted');
    await seedPost('alice');
    expect(await changed(as('bob', 'delete from public.posts where user_id = $1', [ids.alice]))).toBe(0);
    expect(await changed(as('alice', 'update public.posts set focus_pct = 100 where user_id = $1', [ids.alice]))).toBe(0);
    expect(await changed(as('alice', 'delete from public.posts where user_id = $1', [ids.alice]))).toBe(1);
  });

  it('rejects out-of-range stats, long captions and a malformed breakdown', async () => {
    const bad: Record<string, unknown>[] = [
      { focus_pct: 101 },
      { focus_pct: -1 },
      { total_s: -5 },
      { pomodoros: -1 },
      { streak: -1 },
      { caption: 'x'.repeat(281) },
      { breakdown: { label: 'Maths' } },
      { breakdown: [{ label: 'Maths', color: 'nope', seconds: 30, pct: 50 }] },
      { breakdown: [{ label: { x: 1 }, color: 'blue', seconds: 30, pct: 50 }] },
      { breakdown: [{ label: 'Maths', color: 'blue', seconds: '30', pct: 50 }] },
      { breakdown: [{ label: 'Maths', color: 'blue', seconds: 30 }] },
      { breakdown: ['Maths'] },
      { breakdown: Array.from({ length: 21 }, (_, i) => ({ label: `S${i}`, color: 'blue', seconds: 1, pct: 1 })) },
    ];
    for (const patch of bad) {
      await expect(insertAs('alice', 'posts', { ...postRow('alice'), ...patch })).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('privacy: the table holds stats only (adding a column here should be a deliberate decision)', async () => {
    const res = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'posts' order by column_name",
    );
    expect(res.rows.map((r) => r.column_name)).toEqual([
      'breakdown',
      'caption',
      'created_at',
      'focus_pct',
      'id',
      'local_session_id',
      'pomodoros',
      'started_at',
      'streak',
      'total_s',
      'user_id',
    ]);
  });
});

describe('rate limits (#7)', () => {
  const rateError = (kind: string) => expect.objectContaining({ message: expect.stringContaining(`rate_limit:${kind}`) });

  async function logEvents(who: User, kind: string, count: number, minutesAgo = 0) {
    await db.query(
      `insert into public.rate_events (user_id, kind, at) select $1, $2, now() - make_interval(mins => $3) from generate_series(1, $4)`,
      [ids[who], kind, minutesAgo, count],
    );
  }

  it('allows 20 friend requests an hour, and counts a cancelled request', async () => {
    await logEvents('alice', 'friend_request', 18);
    await insertAs('alice', 'friendships', { requester_id: ids.alice, addressee_id: ids.bob });
    await as('alice', 'delete from public.friendships where requester_id = $1', [ids.alice]);
    await insertAs('alice', 'friendships', { requester_id: ids.alice, addressee_id: ids.bob });
    await as('alice', 'delete from public.friendships where requester_id = $1', [ids.alice]);
    await expect(insertAs('alice', 'friendships', { requester_id: ids.alice, addressee_id: ids.bob })).rejects.toEqual(rateError('friend_request'));
    // Only alice is limited.
    await insertAs('bob', 'friendships', { requester_id: ids.bob, addressee_id: ids.carol });
  });

  it('allows 50 friend requests a day', async () => {
    await logEvents('alice', 'friend_request', 50, 120);
    await expect(insertAs('alice', 'friendships', { requester_id: ids.alice, addressee_id: ids.bob })).rejects.toEqual(rateError('friend_request'));
  });

  it('forgets events older than a day', async () => {
    await logEvents('alice', 'friend_request', 50, 25 * 60);
    await insertAs('alice', 'friendships', { requester_id: ids.alice, addressee_id: ids.bob });
    const left = await db.query<{ n: number }>('select count(*)::int as n from public.rate_events where user_id = $1', [ids.alice]);
    expect(left.rows).toEqual([{ n: 1 }]);
  });

  it('allows 10 posts an hour and 30 a day', async () => {
    await logEvents('alice', 'post', 9);
    await insertAs('alice', 'posts', postRow('alice', 'sess_a'));
    await expect(insertAs('alice', 'posts', postRow('alice', 'sess_b'))).rejects.toEqual(rateError('post'));
    await logEvents('bob', 'post', 30, 120);
    await expect(insertAs('bob', 'posts', postRow('bob', 'sess_c'))).rejects.toEqual(rateError('post'));
  });

  it('a rejected post does not count (the event rolls back with it)', async () => {
    await insertAs('alice', 'posts', postRow('alice', 'sess_dup'));
    await expect(insertAs('alice', 'posts', postRow('alice', 'sess_dup'))).rejects.toMatchObject({ code: '23505' });
    const n = await db.query<{ n: number }>("select count(*)::int as n from public.rate_events where kind = 'post'");
    expect(n.rows).toEqual([{ n: 1 }]);
  });

  it('allows 30 username lookups an hour, so usernames cannot be guessed in bulk', async () => {
    await logEvents('carol', 'lookup', 29);
    expect(await findProfile('carol', 'bob')).toEqual(['bob']);
    await expect(findProfile('carol', 'alice')).rejects.toEqual(rateError('lookup'));
  });

  it('the log is private, and the dashboard or service role is never limited', async () => {
    await logEvents('alice', 'friend_request', 50);
    expect((await as('alice', 'select * from public.rate_events').catch((e: { code: string }) => e.code))).toBe('42501');
    await expect(insertAs('alice', 'rate_events', { user_id: ids.alice, kind: 'post' })).rejects.toMatchObject({ code: '42501' });
    await expect(as('alice', 'select public.check_rate($1, 1, 1)', ['post'])).rejects.toMatchObject({ code: '42501' });
    await seedFriendship('alice', 'bob', 'pending');
  });
});

describe('sign-up cap (#14, until there is a CAPTCHA)', () => {
  it('refuses new accounts once 100 were created in the last hour', async () => {
    const recent = await db.query<{ n: number }>("select count(*)::int as n from public.profiles where created_at > now() - interval '1 hour'");
    const fill = 100 - recent.rows[0].n;
    await db.query(
      "insert into auth.users (raw_user_meta_data) select jsonb_build_object('username', 'bulk_' || g) from generate_series(1, $1) g",
      [fill],
    );
    try {
      await expect(signUp('one_too_many')).rejects.toMatchObject({ message: expect.stringContaining('signup_limit') });
      // An hour later the window has moved on.
      await db.query("update public.profiles set created_at = now() - interval '2 hours' where starts_with(username, 'bulk_')");
      const id = await signUp('next_hour');
      await db.query('delete from auth.users where id = $1', [id]);
    } finally {
      await db.query("delete from auth.users where starts_with(raw_user_meta_data ->> 'username', 'bulk_')");
    }
  });
});

// Catches the mistakes the Supabase Security Advisor lints for, so a new table or function can't
// quietly ship open: Supabase grants every new table and function in `public` to anon/authenticated.
describe('hardening', () => {
  /** Tables, views and functions in `public` created by schema.sql (not by an extension). */
  const OWN = `not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')`;

  it('every table in public has row-level security on', async () => {
    const res = await db.query<{ name: string; rls: boolean }>(
      `select c.relname as name, c.relrowsecurity as rls from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and ${OWN}
       order by 1`,
    );
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.filter((r) => !r.rls).map((r) => r.name)).toEqual([]);
  });

  it('every view in public is security_invoker, so it cannot read past RLS', async () => {
    const res = await db.query<{ name: string }>(
      `select c.relname as name from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') and ${OWN}
         and not coalesce('security_invoker=true' = any (c.reloptions), false)`,
    );
    expect(res.rows).toEqual([]);
  });

  it('every function in public pins search_path', async () => {
    const res = await db.query<{ name: string }>(
      `select c.proname as name from pg_proc c
       where c.pronamespace = 'public'::regnamespace and ${OWN}
         and not exists (select 1 from unnest(c.proconfig) s where s like 'search_path=%')
       order by 1`,
    );
    expect(res.rows).toEqual([]);
  });

  it('only the intended security definer functions can be called through the API', async () => {
    const callable = async (role: string) =>
      (
        await db.query<{ name: string }>(
          `select c.proname as name from pg_proc c
           where c.pronamespace = 'public'::regnamespace and c.prosecdef and ${OWN}
             and has_function_privilege($1, c.oid, 'execute')
           order by 1`,
          [role],
        )
      ).rows.map((r) => r.name);
    expect(await callable('anon')).toEqual([]);
    expect(await callable('authenticated')).toEqual(['delete_account', 'find_profile']);
  });
});
