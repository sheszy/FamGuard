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
  event_description text,
  event_location text,
  event_time time,
  event_end_time time,
  created_at timestamptz not null default now()
);

alter table public.family_events add column if not exists event_description text;
alter table public.family_events add column if not exists event_location text;
alter table public.family_events add column if not exists event_end_time time;

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
  target_user_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('sos', 'safety')),
  title text not null,
  message text not null,
  situation_reason text,
  latitude double precision,
  longitude double precision,
  status text not null default 'active',
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.family_alerts add column if not exists target_user_id uuid references auth.users(id) on delete cascade;
alter table public.family_alerts drop constraint if exists family_alerts_target_user_id_fkey;
alter table public.family_alerts add constraint family_alerts_target_user_id_fkey
  foreign key (target_user_id) references auth.users(id) on delete cascade;
alter table public.family_alerts add column if not exists situation_reason text;
alter table public.family_alerts add column if not exists latitude double precision;
alter table public.family_alerts add column if not exists longitude double precision;
alter table public.family_alerts add column if not exists status text not null default 'active';
alter table public.family_alerts add column if not exists acknowledged_by uuid references auth.users(id) on delete set null;
alter table public.family_alerts add column if not exists acknowledged_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'family_alerts_status_check'
      and conrelid = 'public.family_alerts'::regclass
  ) then
    alter table public.family_alerts
      add constraint family_alerts_status_check check (status in ('active', 'acknowledged'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'family_alerts_coordinates_check'
      and conrelid = 'public.family_alerts'::regclass
  ) then
    alter table public.family_alerts add constraint family_alerts_coordinates_check
      check (
        ((latitude is null) = (longitude is null))
        and (latitude is null or latitude between -90 and 90)
        and (longitude is null or longitude between -180 and 180)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'family_alerts_situation_reason_check'
      and conrelid = 'public.family_alerts'::regclass
  ) then
    alter table public.family_alerts add constraint family_alerts_situation_reason_check
      check (situation_reason is null or char_length(situation_reason) between 1 and 300);
  end if;
end;
$$;

create index if not exists family_alerts_target_status_created_idx
  on public.family_alerts (target_user_id, status, created_at desc);
create index if not exists family_alerts_sender_status_created_idx
  on public.family_alerts (user_id, status, created_at desc);

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

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  phone text check (phone is null or char_length(phone) between 7 and 32),
  relationship text not null check (relationship in (
    'mother', 'father', 'guardian', 'son', 'daughter', 'child',
    'sibling', 'grandparent', 'spouse', 'friend', 'other'
  )),
  birth_date date,
  family_code text not null unique
    default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  share_location boolean not null default false,
  notification_sound text not null default 'urgent-siren',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles
  add column if not exists notification_sound text not null default 'urgent-siren';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_notification_sound_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles add constraint user_profiles_notification_sound_check
      check (notification_sound in ('urgent-siren', 'pulse-chime', 'radar-beep', 'gentle-bell', 'custom'));
  end if;
end;
$$;

create or replace function public.lock_family_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.family_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  elsif new.family_code is distinct from old.family_code then
    raise exception 'FamGuard IDs cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_family_code on public.user_profiles;
create trigger lock_family_code
  before insert or update of family_code on public.user_profiles
  for each row execute function public.lock_family_code();

create table if not exists public.family_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (requester_id, recipient_id),
  check (requester_id <> recipient_id)
);

create table if not exists public.family_connections (
  member_a uuid not null references auth.users(id) on delete cascade,
  member_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_a, member_b),
  check (member_a < member_b)
);

drop policy if exists "Users manage their own SOS records" on public.family_alerts;
drop policy if exists "Users insert targeted family alerts" on public.family_alerts;
create policy "Users insert targeted family alerts"
  on public.family_alerts for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (target_user_id is null or (
      target_user_id <> user_id
      and exists (
        select 1 from public.family_connections c
        where (c.member_a = user_id and c.member_b = target_user_id)
          or (c.member_b = user_id and c.member_a = target_user_id)
      )
    ))
    and (kind <> 'sos' or (
      status = 'active'
      and situation_reason is not null
      and latitude is not null
      and longitude is not null
    ))
  );
drop policy if exists "Users read their own and addressed family alerts" on public.family_alerts;
create policy "Users read their own and addressed family alerts"
  on public.family_alerts for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      (target_user_id is null or target_user_id = (select auth.uid()))
      and exists (
        select 1 from public.family_connections c
        where (c.member_a = user_id and c.member_b = (select auth.uid()))
          or (c.member_b = user_id and c.member_a = (select auth.uid()))
      )
    )
  );
drop policy if exists "Users delete their own family alerts" on public.family_alerts;
create policy "Users delete their own family alerts"
  on public.family_alerts for delete to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists family_connections_member_b_idx
  on public.family_connections (member_b);
create index if not exists family_requests_recipient_pending_idx
  on public.family_requests (recipient_id, created_at desc)
  where status = 'pending';
create index if not exists family_requests_requester_pending_idx
  on public.family_requests (requester_id, created_at desc)
  where status = 'pending';

create or replace function public.touch_location_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_location_updated_at on public.locations;
create trigger touch_location_updated_at
  before insert or update on public.locations
  for each row execute function public.touch_location_updated_at();

alter table public.user_profiles enable row level security;
alter table public.family_requests enable row level security;
alter table public.family_connections enable row level security;

drop policy if exists "Users read their own profile" on public.user_profiles;
create policy "Users read their own profile"
  on public.user_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create their own profile" on public.user_profiles;
create policy "Users create their own profile"
  on public.user_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own profile" on public.user_profiles;
create policy "Users update their own profile"
  on public.user_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users read requests involving them" on public.family_requests;
create policy "Users read requests involving them"
  on public.family_requests for select to authenticated
  using ((select auth.uid()) in (requester_id, recipient_id));

drop policy if exists "Users read their family connections" on public.family_connections;
create policy "Users read their family connections"
  on public.family_connections for select to authenticated
  using ((select auth.uid()) in (member_a, member_b));

create or replace function public.can_view_family_location(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_owner_id <> auth.uid()
    and exists (
      select 1
      from public.family_connections c
      join public.user_profiles p on p.user_id = p_owner_id
      where p.share_location
        and exists (
          select 1 from public.locations l
          where l.user_id = p_owner_id
            and l.updated_at >= now() - interval '2 minutes'
        )
        and (
          (c.member_a = auth.uid() and c.member_b = p_owner_id)
          or (c.member_b = auth.uid() and c.member_a = p_owner_id)
        )
    );
$$;

drop policy if exists "Accepted family can read shared locations" on public.locations;
create policy "Accepted family can read shared locations"
  on public.locations for select to authenticated
  using (public.can_view_family_location(user_id));

create or replace function public.lookup_family_code(p_family_code text)
returns table(member_id uuid, display_name text, relationship text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;

  if length(trim(coalesce(p_family_code, ''))) <> 16 then
    return;
  end if;

  return query
    select p.user_id, p.display_name, p.relationship
    from public.user_profiles p
    where p.family_code = upper(trim(p_family_code))
      and p.user_id <> auth.uid();
end;
$$;

create or replace function public.request_family_connection(p_family_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_id uuid;
  v_request_id uuid;
  v_pending_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;

  if not exists (
    select 1 from public.user_profiles p where p.user_id = auth.uid()
  ) then
    raise exception 'Complete your profile before connecting with family.';
  end if;

  select p.user_id into v_target_id
  from public.user_profiles p
  where p.family_code = upper(trim(coalesce(p_family_code, '')));

  if v_target_id is null or v_target_id = auth.uid() then
    raise exception 'No matching FamGuard ID was found.';
  end if;

  if exists (
    select 1 from public.family_connections c
    where c.member_a = least(auth.uid(), v_target_id)
      and c.member_b = greatest(auth.uid(), v_target_id)
  ) then
    raise exception 'You are already connected with this family member.';
  end if;

  if exists (
    select 1 from public.family_requests r
    where r.requester_id = v_target_id
      and r.recipient_id = auth.uid()
      and r.status = 'pending'
  ) then
    raise exception 'This person has already sent you a request. Review it in Fam-Dash.';
  end if;

  select r.id into v_request_id
  from public.family_requests r
  where r.requester_id = auth.uid()
    and r.recipient_id = v_target_id
    and r.status = 'pending';

  if v_request_id is not null then
    return v_request_id;
  end if;

  select count(*) into v_pending_count
  from public.family_requests r
  where r.requester_id = auth.uid()
    and r.status = 'pending';

  if v_pending_count >= 20 then
    raise exception 'You have too many pending family requests.';
  end if;

  insert into public.family_requests (requester_id, recipient_id)
  values (auth.uid(), v_target_id)
  on conflict (requester_id, recipient_id) do update
    set status = 'pending', created_at = now(), responded_at = null
  returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.respond_to_family_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;
  if p_accept is null then
    raise exception 'Choose whether to accept or decline the request.';
  end if;

  select r.requester_id into v_requester_id
  from public.family_requests r
  where r.id = p_request_id
    and r.recipient_id = auth.uid()
    and r.status = 'pending'
  for update;

  if v_requester_id is null then
    raise exception 'That pending family request was not found.';
  end if;

  update public.family_requests
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = p_request_id;

  if p_accept then
    insert into public.family_connections (member_a, member_b)
    values (least(v_requester_id, auth.uid()), greatest(v_requester_id, auth.uid()))
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.get_family_members()
returns table(member_id uuid, display_name text, relationship text, sharing_location boolean, connected_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.display_name, p.relationship, p.share_location, c.created_at
  from public.family_connections c
  join public.user_profiles p
    on p.user_id = case when c.member_a = auth.uid() then c.member_b else c.member_a end
  where auth.uid() is not null
    and auth.uid() in (c.member_a, c.member_b)
  order by p.display_name;
$$;

create or replace function public.get_family_requests()
returns table(
  request_id uuid,
  direction text,
  counterpart_id uuid,
  counterpart_name text,
  counterpart_role text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    case when r.requester_id = auth.uid() then 'sent'::text else 'received'::text end,
    case when r.requester_id = auth.uid() then recipient.user_id else requester.user_id end,
    case when r.requester_id = auth.uid() then recipient.display_name else requester.display_name end,
    case when r.requester_id = auth.uid() then recipient.relationship else requester.relationship end,
    r.created_at
  from public.family_requests r
  join public.user_profiles requester on requester.user_id = r.requester_id
  join public.user_profiles recipient on recipient.user_id = r.recipient_id
  where auth.uid() is not null
    and auth.uid() in (r.requester_id, r.recipient_id)
    and r.status = 'pending'
  order by r.created_at desc;
$$;

create or replace function public.acknowledge_family_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;

  update public.family_alerts a
  set status = 'acknowledged',
      acknowledged_by = auth.uid(),
      acknowledged_at = now()
  where a.id = p_alert_id
    and a.kind = 'sos'
    and a.status = 'active'
    and a.user_id <> auth.uid()
    and (a.target_user_id is null or a.target_user_id = auth.uid())
    and exists (
      select 1 from public.family_connections c
      where (c.member_a = a.user_id and c.member_b = auth.uid())
        or (c.member_b = a.user_id and c.member_a = auth.uid())
    )
  returning a.user_id into v_sender_id;

  if v_sender_id is null then
    raise exception 'Active SOS alert not found or not assigned to this account.';
  end if;
end;
$$;

revoke all on function public.can_view_family_location(uuid) from public, anon;
revoke all on function public.lock_family_code() from public, anon;
revoke all on function public.touch_location_updated_at() from public, anon;
revoke all on function public.lookup_family_code(text) from public, anon;
revoke all on function public.request_family_connection(text) from public, anon;
revoke all on function public.respond_to_family_request(uuid, boolean) from public, anon;
revoke all on function public.get_family_members() from public, anon;
revoke all on function public.get_family_requests() from public, anon;
revoke all on function public.acknowledge_family_alert(uuid) from public, anon;
grant execute on function public.can_view_family_location(uuid) to authenticated;
grant execute on function public.lookup_family_code(text) to authenticated;
grant execute on function public.request_family_connection(text) to authenticated;
grant execute on function public.respond_to_family_request(uuid, boolean) to authenticated;
grant execute on function public.get_family_members() to authenticated;
grant execute on function public.get_family_requests() to authenticated;
grant execute on function public.acknowledge_family_alert(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'locations'
    ) then
      alter publication supabase_realtime add table public.locations;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'family_requests'
    ) then
      alter publication supabase_realtime add table public.family_requests;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'family_connections'
    ) then
      alter publication supabase_realtime add table public.family_connections;
    end if;
  end if;
end;
$$;