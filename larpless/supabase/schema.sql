-- LarpLess social schema: profiles, friendships, posts.
-- Paste into the Supabase SQL editor and run. Safe to re-run.
-- Also turn off Authentication > Sign In / Providers > Email > "Confirm email":
-- accounts use <username>@larpless.local addresses that can't receive mail.

-- Profiles -------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Who can read a profile is set after the friendships table (see "profiles visible to you and your
-- connections"): yourself, friends and people with a pending request. Nobody can list everyone (#6).
drop policy if exists "profiles readable by signed-in users" on public.profiles;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No CAPTCHA yet (#14): Supabase limits sign-ups per IP (Authentication > Rate Limits), and this
  -- caps new accounts across the whole project, so a bot spread over many IPs can't flood it.
  if (select count(*) from public.profiles p where p.created_at > now() - interval '1 hour') >= 100 then
    raise exception 'signup_limit' using errcode = 'P0001';
  end if;
  insert into public.profiles (id, username)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Settings > Delete account. Removes the caller's auth user; the profile, friendships and posts
-- cascade from it. Security definer because the API roles can't touch auth.users.
create or replace function public.delete_account()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

-- Rate limits (#7) -----------------------------------------------------------
-- What each account may create through the API, counted in a private log that a delete doesn't undo,
-- so cancelling and resending a request still counts. Rows older than a day are removed as you go,
-- and all of an account's rows go with it. The dashboard and the service role (no JWT) aren't limited.

create table if not exists public.rate_events (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);

create index if not exists rate_events_user_kind_at_idx on public.rate_events (user_id, kind, at);

-- RLS with no policies: the API roles can't read or write the log; only check_rate() below can.
alter table public.rate_events enable row level security;
revoke all on public.rate_events from anon, authenticated;

create or replace function public.check_rate(p_kind text, p_per_hour integer, p_per_day integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  last_hour integer;
  last_day integer;
begin
  if me is null then
    return;
  end if;
  delete from public.rate_events e where e.user_id = me and e.at < now() - interval '1 day';
  select count(*) filter (where e.at > now() - interval '1 hour'), count(*)
    into last_hour, last_day
    from public.rate_events e
    where e.user_id = me and e.kind = p_kind;
  if last_hour >= p_per_hour or last_day >= p_per_day then
    raise exception 'rate_limit:%', p_kind using errcode = 'P0001';
  end if;
  insert into public.rate_events (user_id, kind) values (me, p_kind);
end;
$$;

revoke execute on function public.check_rate(text, integer, integer) from public, anon, authenticated;

-- Friendships ----------------------------------------------------------------

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_key on public.friendships (
  least(requester_id, addressee_id),
  greatest(requester_id, addressee_id)
);

alter table public.friendships enable row level security;

drop policy if exists "profiles visible to you and your connections" on public.profiles;
create policy "profiles visible to you and your connections" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.friendships f
      where (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
         or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
    )
  );

-- Add friend: finds one profile by its exact username, so nobody can list the others. Lookups count
-- towards a limit, so usernames can't be guessed in bulk either.
create or replace function public.find_profile(p_username text)
returns table (id uuid, username text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.check_rate('lookup', 30, 100);
  return query
    select p.id, p.username from public.profiles p where p.username = lower(trim(p_username)) limit 1;
end;
$$;

revoke execute on function public.find_profile(text) from public, anon;
grant execute on function public.find_profile(text) to authenticated;

create or replace function public.limit_friend_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.check_rate('friend_request', 20, 50);
  return new;
end;
$$;

drop trigger if exists friendships_rate_limit on public.friendships;
create trigger friendships_rate_limit
  before insert on public.friendships
  for each row execute function public.limit_friend_requests();

drop policy if exists "friendships visible to both sides" on public.friendships;
create policy "friendships visible to both sides" on public.friendships
  for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));

drop policy if exists "send requests as yourself" on public.friendships;
create policy "send requests as yourself" on public.friendships
  for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');

drop policy if exists "addressee accepts" on public.friendships;
create policy "addressee accepts" on public.friendships
  for update to authenticated
  using (addressee_id = auth.uid() and status = 'pending')
  with check (addressee_id = auth.uid() and status = 'accepted');

drop policy if exists "either side removes" on public.friendships;
create policy "either side removes" on public.friendships
  for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- Only the status can change on update; the two ids are fixed once sent.
revoke update on public.friendships from anon, authenticated;
grant update (status) on public.friendships to authenticated;

-- Security invoker, so the friendships policy above applies: the RPC can only
-- answer for pairs that include the caller, not reveal other users' friends.
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b) or (f.requester_id = b and f.addressee_id = a))
  );
$$;

-- Posts ----------------------------------------------------------------------
-- Stats only: no photos, chunks, app names or window titles.

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  local_session_id text not null,
  total_s integer not null check (total_s >= 0),
  focus_pct integer not null check (focus_pct between 0 and 100),
  pomodoros integer not null default 0 check (pomodoros >= 0),
  streak integer not null default 0 check (streak >= 0),
  breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(breakdown) = 'array'),
  caption text check (char_length(caption) <= 280),
  started_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, local_session_id)
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);

-- Friends' clients render the breakdown, so only well-formed entries in the tag palette get in
-- (src/social/api.ts MAX_BREAKDOWN). Not valid: rows already stored aren't re-checked.
create or replace function public.valid_breakdown(b jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when jsonb_typeof(b) <> 'array' then false
    when jsonb_array_length(b) > 20 then false
    else not exists (
      select 1 from jsonb_array_elements(b) e
      where jsonb_typeof(e) is distinct from 'object'
        or jsonb_typeof(e -> 'label') is distinct from 'string'
        or coalesce(e ->> 'color', '') not in ('gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red')
        or jsonb_typeof(e -> 'seconds') is distinct from 'number'
        or jsonb_typeof(e -> 'pct') is distinct from 'number'
    )
  end
$$;

alter table public.posts drop constraint if exists posts_breakdown_valid;
alter table public.posts add constraint posts_breakdown_valid check (public.valid_breakdown(breakdown)) not valid;

alter table public.posts enable row level security;

create or replace function public.limit_posts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.check_rate('post', 10, 30);
  return new;
end;
$$;

drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit
  before insert on public.posts
  for each row execute function public.limit_posts();

drop policy if exists "posts visible to author and friends" on public.posts;
create policy "posts visible to author and friends" on public.posts
  for select to authenticated
  using (user_id = auth.uid() or public.are_friends(auth.uid(), user_id));

drop policy if exists "post as yourself" on public.posts;
create policy "post as yourself" on public.posts
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "delete your own posts" on public.posts;
create policy "delete your own posts" on public.posts
  for delete to authenticated
  using (user_id = auth.uid());
