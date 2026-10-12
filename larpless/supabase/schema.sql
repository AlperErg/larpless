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

drop policy if exists "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable by signed-in users" on public.profiles
  for select to authenticated using (true);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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
