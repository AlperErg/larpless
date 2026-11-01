#!/usr/bin/env node
/**
 * Demo accounts for the Friends tab.
 *
 *   node scripts/demo-social.mjs seed              create the demo accounts, friend them together, post sample sessions
 *   node scripts/demo-social.mjs accept [user]     accept every pending request sent to the demo accounts (or just one)
 *   node scripts/demo-social.mjs request <user>    every demo account sends a friend request to <user>
 *   node scripts/demo-social.mjs status            friends, pending requests and post counts per demo account
 *
 * Needs SUPABASE_URL and SUPABASE_ANON_KEY in the environment (the values entered in Settings → Friends).
 * Refuses to run while "Confirm email" is on, so it never makes Supabase send mail.
 */
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!URL_ || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY first.');
  process.exit(1);
}

export const PASSWORD = 'larpless-demo';
/** Existing demo accounts were created under the old name. */
const LEGACY_PASSWORD = 'focusline-demo';
const legacyEmail = (u) => `${u}@focusline.local`;

const H = 3600;
const subj = (label, color, minutes) => ({ label, color, seconds: minutes * 60 });

const DEMO = [
  {
    username: 'carlos_cejas',
    posts: [
      { daysAgo: 0, hour: 10, caption: 'Krebs cycle finally clicked 🧬', pomodoros: 4, streak: 6, parts: [subj('Biology', 'green', 95), subj('Organic Chemistry', 'orange', 25), subj('Distracted', 'red', 10)] },
      { daysAgo: 1, hour: 20, caption: 'Late one before the lab report', pomodoros: 3, streak: 5, parts: [subj('Organic Chemistry', 'orange', 70), subj('Biology', 'green', 15), subj('Distracted', 'red', 12)] },
      { daysAgo: 3, hour: 14, caption: null, pomodoros: 2, streak: 3, parts: [subj('Biology', 'green', 50), subj('Distracted', 'red', 8)] },
    ],
  },
  {
    username: 'kacper_kotwica',
    posts: [
      { daysAgo: 0, hour: 9, caption: 'Morning calc grind ☕️', pomodoros: 2, streak: 3, parts: [subj('Calculus', 'blue', 55), subj('Physics', 'purple', 20), subj('Distracted', 'red', 18)] },
      { daysAgo: 2, hour: 16, caption: 'Problem set 4 done', pomodoros: 3, streak: 1, parts: [subj('Physics', 'purple', 80), subj('Calculus', 'blue', 10), subj('Distracted', 'red', 25)] },
    ],
  },
  {
    username: 'guillermo_garcia',
    posts: [
      { daysAgo: 0, hour: 13, caption: 'Essay outline ✍️ 2,000 words to go', pomodoros: 5, streak: 12, parts: [subj('History', 'brown', 110), subj('Computer Science', 'pink', 30), subj('Distracted', 'red', 6)] },
      { daysAgo: 1, hour: 11, caption: null, pomodoros: 4, streak: 11, parts: [subj('Computer Science', 'pink', 90), subj('History', 'brown', 20), subj('Distracted', 'red', 9)] },
      { daysAgo: 2, hour: 15, caption: 'Recursion practice', pomodoros: 3, streak: 10, parts: [subj('Computer Science', 'pink', 65), subj('Distracted', 'red', 5)] },
    ],
  },
];

const newClient = () =>
  createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const emailFor = (u) => `${u}@larpless.local`;

async function preflight() {
  const res = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } });
  const s = await res.json();
  if (!s.mailer_autoconfirm) {
    throw new Error('"Confirm email" is still on in Supabase (Auth > Sign In / Providers > Email). Turn it off first.');
  }
  const probe = await newClient().from('profiles').select('id').limit(1);
  if (probe.error && /schema cache|does not exist/i.test(probe.error.message)) {
    throw new Error('Tables are missing. Run larpless/supabase/schema.sql in the Supabase SQL editor first.');
  }
}

async function login(username, { create = false } = {}) {
  const c = newClient();
  let { data, error } = await c.auth.signInWithPassword({ email: emailFor(username), password: PASSWORD });
  if (error) {
    const retry = await c.auth.signInWithPassword({ email: legacyEmail(username), password: LEGACY_PASSWORD });
    if (!retry.error) ({ data, error } = retry);
  }
  if (error && create) {
    ({ data, error } = await c.auth.signUp({ email: emailFor(username), password: PASSWORD, options: { data: { username } } }));
    if (!error && !data.session) throw new Error(`${username}: signed up but got no session (email confirmation?)`);
    if (!error) console.log(`  created @${username}`);
  }
  if (error) throw new Error(`${username}: ${error.message}`);
  return { c, id: data.user.id, username };
}

async function profileId(c, username) {
  const { data, error } = await c.from('profiles').select('id').eq('username', username).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No profile @${username}`);
  return data.id;
}

async function sendRequest(from, toUsername) {
  const to = await profileId(from.c, toUsername);
  const { error } = await from.c.from('friendships').insert({ requester_id: from.id, addressee_id: to });
  if (error && error.code !== '23505') throw new Error(`${from.username} → ${toUsername}: ${error.message}`);
  return !error;
}

async function acceptAll(user) {
  const { data, error } = await user.c
    .from('friendships')
    .select('id, requester:profiles!friendships_requester_id_fkey(username)')
    .eq('addressee_id', user.id)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
  for (const f of data) {
    const r = await user.c.from('friendships').update({ status: 'accepted' }).eq('id', f.id);
    if (r.error) throw new Error(r.error.message);
    console.log(`  @${user.username} accepted @${f.requester?.username}`);
  }
  return data.length;
}

function postRow(userId, username, p, i) {
  const total = p.parts.reduce((a, e) => a + e.seconds, 0);
  const focus = p.parts.filter((e) => e.label !== 'Distracted').reduce((a, e) => a + e.seconds, 0);
  const start = new Date();
  start.setDate(start.getDate() - p.daysAgo);
  start.setHours(p.hour, 0, 0, 0);
  if (start.getTime() + total * 1000 > Date.now()) start.setTime(Date.now() - total * 1000 - 5 * 60_000);
  return {
    user_id: userId,
    local_session_id: `demo_${username}_${i}`,
    total_s: total,
    focus_pct: Math.round((focus / total) * 100),
    pomodoros: p.pomodoros,
    streak: p.streak,
    breakdown: p.parts.map((e) => ({ ...e, pct: Math.round((e.seconds / total) * 100) })),
    caption: p.caption,
    started_at: start.toISOString(),
    created_at: new Date(start.getTime() + total * 1000).toISOString(),
  };
}

async function seed() {
  const users = [];
  for (const d of DEMO) users.push(await login(d.username, { create: true }));

  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) await sendRequest(users[i], users[j].username);
  }
  for (const u of users) await acceptAll(u);

  for (const [k, d] of DEMO.entries()) {
    const u = users[k];
    let added = 0;
    for (const [i, p] of d.posts.entries()) {
      const { error } = await u.c.from('posts').insert(postRow(u.id, u.username, p, i));
      if (error && error.code !== '23505') throw new Error(`${u.username} post ${i}: ${error.message}`);
      if (!error) added++;
    }
    console.log(`  @${u.username}: ${added} new posts`);
  }
}

async function status() {
  for (const d of DEMO) {
    const u = await login(d.username);
    const { data: fr } = await u.c
      .from('friendships')
      .select('status, requester_id, requester:profiles!friendships_requester_id_fkey(username), addressee:profiles!friendships_addressee_id_fkey(username)');
    const { count } = await u.c.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', u.id);
    const friends = fr.filter((f) => f.status === 'accepted').map((f) => (f.requester_id === u.id ? f.addressee : f.requester).username);
    const incoming = fr.filter((f) => f.status === 'pending' && f.requester_id !== u.id).map((f) => f.requester.username);
    const outgoing = fr.filter((f) => f.status === 'pending' && f.requester_id === u.id).map((f) => f.addressee.username);
    console.log(`@${u.username}  posts=${count}  friends=[${friends.join(', ')}]  incoming=[${incoming.join(', ')}]  sent=[${outgoing.join(', ')}]`);
  }
}

const [cmd, arg] = process.argv.slice(2);
try {
  await preflight();
  if (cmd === 'seed') {
    await seed();
    await status();
  } else if (cmd === 'accept') {
    const names = arg ? [arg.replace(/^@/, '')] : DEMO.map((d) => d.username);
    let n = 0;
    for (const name of names) n += await acceptAll(await login(name));
    console.log(n ? `Accepted ${n} request(s).` : 'No pending requests.');
  } else if (cmd === 'request') {
    if (!arg) throw new Error('Usage: request <username>');
    const target = arg.replace(/^@/, '').toLowerCase();
    for (const d of DEMO) {
      const sent = await sendRequest(await login(d.username), target);
      console.log(`  @${d.username} → @${target}: ${sent ? 'sent' : 'already exists'}`);
    }
  } else if (cmd === 'status') {
    await status();
  } else {
    console.log('Usage: node scripts/demo-social.mjs seed | accept [user] | request <user> | status');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
}
