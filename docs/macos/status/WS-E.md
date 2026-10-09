# WS-E status: Social (Phase 2)

> Updated by the WS-E agent after every task. The orchestrator reads this at each checkpoint.

**Current:** P3 + P4 done (accounts, friends, feed, post from Summary) · **Sprint:** Phase 2 · **Last commit:** WS-E: Supabase accounts, friends and Friends feed

## Done

- Supabase client (`src/social/supabase.ts`, `src/social/env.ts`): lazy `createClient` with AsyncStorage session persistence.
- `supabase/schema.sql`: profiles (created by a trigger on sign-up), friendships (requests + accept), posts (stats only), RLS on all three, `are_friends()`. Re-runnable.
- `src/social/api.ts`: sign up / sign in with username + password, friend requests, accept / decline / remove, publish, feed.
- `src/store/socialStore.ts`: auth state via `onAuthStateChange`, feed + friend lists, offline fallback. `init()` runs at boot.
- UI: 👥 Friends in the sidebar and ⌘K palette → `FriendsPage` (Feed and Friends tabs) or `LoginPage` when signed out. `PostCard` for feed items. `SharePanel` on the Summary page ("Post to friends" with optional caption, then "Posted").

## Acceptance checklist

- [ ] P1 story card PNG: cut (not requested for this pass)
- [ ] P2 live photo: cut (not requested for this pass)
- [x] P3 posts and feed: posts are stats only; feed shows you + accepted friends; offline keeps the last feed with an "Offline" tag
- [x] P4 friends: add by username, incoming requests with Accept / Decline, sent requests with Cancel, Remove friend
- [x] Typecheck, Jest (28 new tests), Metro macOS bundle
- [ ] Xcode build and two-account check on the Mac: blocked on the dashboard setup below

## Deviations from the plan

- No photos: posts carry duration, focus %, pomodoros, streak, subject breakdown and an optional caption. No storage bucket.
- One Friends tab replaces separate Feed and Profile pages. The `profile` route renders the same page.
- `env.ts` is committed: the anon key is public by design and RLS protects every table.
- If they already sent you a request, adding them by username accepts it instead of failing.

## Requests to the orchestrator

- NEEDS HUMAN: in the Supabase dashboard, run `larpless/supabase/schema.sql` in the SQL editor, then turn off Authentication > Sign In / Providers > Email > "Confirm email". As of 16:40 the tables were missing and confirmation was still on.
- Added deps `@supabase/supabase-js` and `react-native-url-polyfill` (pure JS, no pods). Restart Metro after `npm install`.
- `jest.setup.js` stubs `react-native-url-polyfill/auto` (ESM-only package; Node has `URL`).

## Notes for integration

- Schema and RLS were checked against Postgres 16 (PGlite) with a stubbed `auth` schema: 23 checks covering request rules, accept-only-by-addressee, and post visibility for friends vs strangers.
- Two-account check: create account A, sign out, create B, add A by username; sign back in as A and accept; finish a session (a demo one works) and hit "Post to friends"; sign in as B and Refresh the feed.
- Pre-existing failures unrelated to this work: `__tests__/core/smoke.test.ts` and `stores.test.ts` expect `USE_MOCK_NATIVE: true` (flipped at checkpoint 2).
