create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (char_length(title) between 1 and 200),
  is_complete boolean not null default false,
  scheduled_for date,
  created_at timestamptz not null default now()
);

alter table public.tasks add column if not exists scheduled_for date;

create table if not exists public.family_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (char_length(title) between 1 and 120),
  event_date date not null,
  event_type text not null check (event_type in ('family', 'birthday', 'anniversary')),
  is_recurring boolean not null default false,
  person_name text,
  event_time time,
  created_at timestamptz not null default now()
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  author_name text not null,
  topic text not null check (char_length(topic) between 1 and 60),
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.family_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('sos', 'safety')),
  title text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  updated_at timestamptz not null default now()
);

alter table public.tasks enable row level security;
alter table public.family_events enable row level security;
alter table public.community_posts enable row level security;
alter table public.family_alerts enable row level security;
alter table public.locations enable row level security;

drop policy if exists "Users manage their own tasks" on public.tasks;
create policy "Users manage their own tasks"
  on public.tasks for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own family events" on public.family_events;
create policy "Users manage their own family events"
  on public.family_events for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Signed-in users can read community posts" on public.community_posts;
create policy "Signed-in users can read community posts"
  on public.community_posts for select to authenticated
  using (true);

drop policy if exists "Users create their own community posts" on public.community_posts;
create policy "Users create their own community posts"
  on public.community_posts for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete their own community posts" on public.community_posts;
create policy "Users delete their own community posts"
  on public.community_posts for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own SOS records" on public.family_alerts;
create policy "Users manage their own SOS records"
  on public.family_alerts for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own location" on public.locations;
create policy "Users manage their own location"
  on public.locations for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

do $$
begin
  alter publication supabase_realtime add table public.family_alerts;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;