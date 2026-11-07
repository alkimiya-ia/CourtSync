-- CourtSync MVP schema (v0.2)
-- Games, teams, players, participants, tracker assignments,
-- immutable stat events + corrections, official score events.
--
-- Security model
--   * Every table has RLS. Reads require game membership (game_participants).
--   * All game administration, joining, tracking and scorekeeper changes go through
--     SECURITY DEFINER RPCs with an empty search_path and explicit checks.
--   * Clients may only INSERT into stat_events, stat_corrections, score_events and players,
--     each guarded by RLS. No client UPDATE/DELETE on any table.
--   * Event ids are client-generated uuids: inserts are idempotent (ON CONFLICT DO NOTHING).

create extension if not exists pgcrypto;

-- ============================================================ types
create type public.stat_type as enum (
  'FG2_MADE','FG2_MISS','FG3_MADE','FG3_MISS','FT_MADE','FT_MISS',
  'REB_OFF','REB_DEF','AST','STL','BLK','TOV','PF'
);
create type public.participant_role as enum ('organizer','tracker','scorekeeper','spectator');

-- ============================================================ tables
create table public.games (
  id                        uuid primary key default gen_random_uuid(),
  code                      text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  periods                   smallint not null default 4 check (periods between 1 and 8),
  current_period            smallint not null default 1 check (current_period between 1 and 12),
  status                    text not null default 'live' check (status in ('live','final')),
  organizer_id              uuid not null references auth.users(id),
  scorekeeper_id            uuid references auth.users(id),
  scorekeeper_request_id    uuid references auth.users(id),
  scorekeeper_requested_at  timestamptz,
  created_at                timestamptz not null default now(),
  expires_at                timestamptz not null default now() + interval '2 days',
  finished_at               timestamptz,
  check (scorekeeper_request_id is null or scorekeeper_request_id is distinct from scorekeeper_id)
);

create table public.teams (
  id       uuid primary key default gen_random_uuid(),
  game_id  uuid not null references public.games(id) on delete cascade,
  side     text not null check (side in ('home','away')),
  name     text not null check (char_length(name) between 1 and 60),
  unique (game_id, side),
  unique (id, game_id)
);

create table public.players (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null,
  team_id     uuid not null,
  jersey      smallint not null check (jersey between 0 and 99),
  name        text not null default '' check (char_length(name) <= 60),
  created_at  timestamptz not null default now(),
  unique (team_id, jersey),
  unique (id, game_id),
  -- composite FK: a player's team must belong to the same game
  foreign key (team_id, game_id) references public.teams(id, game_id) on delete cascade
);
create index on public.players (game_id);

create table public.game_participants (
  game_id       uuid not null references public.games(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  role          public.participant_role not null,
  joined_at     timestamptz not null default now(),
  primary key (game_id, user_id)
);

create table public.tracker_assignments (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null,
  player_id   uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('primary','backup')),
  created_at  timestamptz not null default now(),
  ended_at    timestamptz,
  foreign key (player_id, game_id) references public.players(id, game_id) on delete cascade
);
create unique index tracker_assignments_active_user on public.tracker_assignments (player_id, user_id) where ended_at is null;
create unique index tracker_assignments_one_primary on public.tracker_assignments (player_id) where ended_at is null and role = 'primary';
create index on public.tracker_assignments (game_id);

create table public.stat_events (
  id          uuid primary key,                       -- client-generated idempotency key
  seq         bigint generated always as identity unique,
  game_id     uuid not null,
  player_id   uuid not null,
  user_id     uuid not null references auth.users(id),
  type        public.stat_type not null,
  period      smallint not null check (period between 1 and 12),
  client_ts   timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (id, game_id),
  foreign key (player_id, game_id) references public.players(id, game_id) on delete cascade
);
create index on public.stat_events (game_id, seq);

create table public.stat_corrections (
  id          uuid primary key,                       -- client-generated
  seq         bigint generated always as identity unique,
  game_id     uuid not null,
  event_id    uuid not null,
  user_id     uuid not null references auth.users(id),
  action      text not null check (action in ('void','restore','change_type')),
  new_type    public.stat_type,
  client_ts   timestamptz not null,
  created_at  timestamptz not null default now(),
  check ((action = 'change_type') = (new_type is not null)),
  -- composite FK: the corrected event must be in the same game
  foreign key (event_id, game_id) references public.stat_events(id, game_id) on delete cascade
);
create index on public.stat_corrections (game_id, seq);

create table public.score_events (
  id          uuid primary key,                       -- client-generated
  seq         bigint generated always as identity unique,
  game_id     uuid not null references public.games(id) on delete cascade,
  side        text not null check (side in ('home','away')),
  kind        text not null check (kind in ('score','adjust','void','restore')),
  delta       smallint not null default 0,
  target_id   uuid,
  user_id     uuid not null references auth.users(id),
  period      smallint not null check (period between 1 and 12),
  client_ts   timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (id, game_id),
  foreign key (target_id, game_id) references public.score_events(id, game_id),
  check (
    (kind = 'score'  and delta between 1 and 3 and target_id is null) or
    (kind = 'adjust' and delta between -3 and 3 and delta <> 0 and target_id is null) or
    (kind in ('void','restore') and delta = 0 and target_id is not null)
  )
);
create index on public.score_events (game_id, seq);

-- ============================================================ helper predicates
-- SECURITY DEFINER so they can read membership without recursive RLS.
-- They only answer questions about auth.uid() and never return row data.
create or replace function public.is_participant(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.game_participants where game_id = g and user_id = auth.uid());
$$;

create or replace function public.is_organizer(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.games where id = g and organizer_id = auth.uid());
$$;

create or replace function public.game_open(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.games where id = g and status = 'live' and expires_at > now());
$$;

-- Participant who may record stats (not a spectator) in an open game.
create or replace function public.can_record(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.game_open(g) and exists (
    select 1 from public.game_participants
    where game_id = g and user_id = auth.uid() and role <> 'spectator');
$$;

create or replace function public.is_scorekeeper(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.game_open(g) and exists (select 1 from public.games where id = g and scorekeeper_id = auth.uid());
$$;

-- The caller may record for this player:
--   * an ACTIVE assignment always qualifies, whatever the device clock says (ts is client-supplied
--     and phones can be minutes off, so it must not decide access for current trackers);
--   * an ENDED assignment qualifies only for events stamped inside that assignment's window
--     (±2 min device skew) AND only while the stop is recent (12 h), so a former tracker can't
--     backdate client_ts to keep writing for a player indefinitely.
create or replace function public.was_tracking(g uuid, p uuid, ts timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tracker_assignments a
    where a.game_id = g and a.player_id = p and a.user_id = auth.uid()
      and (
        a.ended_at is null
        or (ts between a.created_at - interval '2 minutes' and a.ended_at + interval '2 minutes'
            and a.ended_at > now() - interval '12 hours')
      ));
$$;

-- ============================================================ RLS
alter table public.games               enable row level security;
alter table public.teams               enable row level security;
alter table public.players             enable row level security;
alter table public.game_participants   enable row level security;
alter table public.tracker_assignments enable row level security;
alter table public.stat_events         enable row level security;
alter table public.stat_corrections    enable row level security;
alter table public.score_events        enable row level security;

create policy games_select        on public.games               for select to authenticated using (public.is_participant(id));
create policy teams_select        on public.teams               for select to authenticated using (public.is_participant(game_id));
create policy players_select      on public.players             for select to authenticated using (public.is_participant(game_id));
create policy participants_select on public.game_participants   for select to authenticated using (public.is_participant(game_id));
create policy assignments_select  on public.tracker_assignments for select to authenticated using (public.is_participant(game_id));
create policy stat_events_select  on public.stat_events         for select to authenticated using (public.is_participant(game_id));
create policy corrections_select  on public.stat_corrections    for select to authenticated using (public.is_participant(game_id));
create policy score_events_select on public.score_events        for select to authenticated using (public.is_participant(game_id));

-- Organizer can add late players while the game is open (team/game match enforced by composite FK).
create policy players_insert on public.players for insert to authenticated
  with check (public.is_organizer(game_id) and public.game_open(game_id));

-- Stat events: own events only, in an open game, for a player the caller is tracking.
-- Explicit exception: the organizer may record for any player in their game without an assignment.
create policy stat_events_insert on public.stat_events for insert to authenticated with check (
  user_id = auth.uid()
  and public.can_record(game_id)
  -- sanity bound on the client clock (offline backlog up to 1 day; 10 min of forward skew)
  and client_ts >= now() - interval '1 day'
  and client_ts <= now() + interval '10 minutes'
  and (public.was_tracking(game_id, player_id, client_ts) or public.is_organizer(game_id))
);

-- Corrections: by the event's original contributor, or the organizer. Same game enforced by composite FK.
create policy corrections_insert on public.stat_corrections for insert to authenticated with check (
  user_id = auth.uid()
  and public.can_record(game_id)
  and client_ts <= now() + interval '10 minutes'
  and exists (
    select 1 from public.stat_events e
    where e.id = event_id and e.game_id = stat_corrections.game_id
      and (e.user_id = auth.uid() or public.is_organizer(e.game_id)))
);

-- Official score: current scorekeeper only. Void/restore must target a score/adjust row on the same side.
create policy score_events_insert on public.score_events for insert to authenticated with check (
  user_id = auth.uid()
  and public.is_scorekeeper(game_id)
  and client_ts <= now() + interval '10 minutes'
  and (target_id is null or exists (
    select 1 from public.score_events s
    where s.id = target_id and s.game_id = score_events.game_id
      and s.kind in ('score','adjust') and s.side = score_events.side))
);

-- Defense in depth: no direct writes except the four guarded inserts above.
revoke insert, update, delete, truncate on public.games, public.teams, public.game_participants, public.tracker_assignments from authenticated;
revoke update, delete, truncate on public.players, public.stat_events, public.stat_corrections, public.score_events from authenticated;
revoke all on all tables in schema public from anon;

-- ============================================================ RPCs
create or replace function public.gen_game_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
    exit when not exists (select 1 from public.games where code = c);
  end loop;
  return c;
end $$;

create or replace function public.normalize_code(p text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Minimal info for the join screen. Reveals nothing beyond team names to holders of the code.
create or replace function public.game_preview(p_code text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare gm public.games%rowtype;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into gm from public.games where code = public.normalize_code(p_code);
  if not found then return json_build_object('found', false); end if;
  return json_build_object(
    'found', true,
    'status', gm.status,
    'expired', gm.expires_at <= now(),
    'member', exists (select 1 from public.game_participants where game_id = gm.id and user_id = auth.uid()),
    'home', (select name from public.teams where game_id = gm.id and side = 'home'),
    'away', (select name from public.teams where game_id = gm.id and side = 'away'),
    'has_scorekeeper', gm.scorekeeper_id is not null);
end $$;

-- p_players: [{"side":"home","jersey":23,"name":"Maya"}, ...]
create or replace function public.create_game(
  p_home text, p_away text, p_periods int, p_display_name text, p_players jsonb, p_keep_score boolean
) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); g uuid; c text; h uuid; a uuid; p jsonb;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if char_length(trim(coalesce(p_home, ''))) not between 1 and 60
     or char_length(trim(coalesce(p_away, ''))) not between 1 and 60
     or char_length(trim(coalesce(p_display_name, ''))) not between 1 and 40
     or coalesce(p_periods, 0) not between 1 and 8
     or jsonb_typeof(coalesce(p_players, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_players, '[]'::jsonb)) > 60 then
    raise exception 'INVALID_INPUT';
  end if;
  c := public.gen_game_code();
  insert into public.games (code, periods, organizer_id, scorekeeper_id)
    values (c, p_periods, uid, case when p_keep_score then uid end) returning id into g;
  insert into public.teams (game_id, side, name) values (g, 'home', trim(p_home)) returning id into h;
  insert into public.teams (game_id, side, name) values (g, 'away', trim(p_away)) returning id into a;
  for p in select * from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) loop
    if p->>'side' not in ('home','away') then raise exception 'INVALID_INPUT'; end if;
    insert into public.players (game_id, team_id, jersey, name)
      values (g, case when p->>'side' = 'home' then h else a end, (p->>'jersey')::smallint, left(coalesce(trim(p->>'name'), ''), 60));
  end loop;
  insert into public.game_participants (game_id, user_id, display_name, role)
    values (g, uid, trim(p_display_name), 'organizer');
  return json_build_object('game_id', g, 'code', c);
end $$;

-- p_role: tracker | spectator | scorekeeper.
-- 'scorekeeper' assigns immediately only for the organizer; anyone else files a request the organizer approves.
create or replace function public.join_game(p_code text, p_display_name text, p_role text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  gm public.games%rowtype;
  ex public.game_participants%rowtype;
  had boolean;
  sk text := null;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_role not in ('tracker','spectator','scorekeeper') then raise exception 'BAD_ROLE'; end if;
  if char_length(trim(coalesce(p_display_name, ''))) not between 1 and 40 then raise exception 'INVALID_NAME'; end if;

  select * into gm from public.games where code = public.normalize_code(p_code) for update;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  select * into ex from public.game_participants where game_id = gm.id and user_id = uid;
  had := found;

  -- Finished or expired: existing members keep access; newcomers may only watch.
  if gm.status <> 'live' or gm.expires_at <= now() then
    if had then return json_build_object('game_id', gm.id, 'code', gm.code, 'scorekeeper', null); end if;
    if p_role <> 'spectator' then raise exception 'GAME_CLOSED'; end if;
    insert into public.game_participants (game_id, user_id, display_name, role) values (gm.id, uid, trim(p_display_name), 'spectator');
    return json_build_object('game_id', gm.id, 'code', gm.code, 'scorekeeper', null);
  end if;

  if had then
    update public.game_participants
      set display_name = trim(p_display_name),
          role = case when ex.role = 'organizer' then ex.role else p_role::public.participant_role end
      where game_id = gm.id and user_id = uid;
  else
    insert into public.game_participants (game_id, user_id, display_name, role)
      values (gm.id, uid, trim(p_display_name), p_role::public.participant_role);
  end if;

  if p_role = 'scorekeeper' then
    if gm.scorekeeper_id = uid then
      sk := 'assigned';
    elsif gm.organizer_id = uid then
      update public.games set scorekeeper_id = uid,
        scorekeeper_request_id = case when scorekeeper_request_id = uid then null else scorekeeper_request_id end
        where id = gm.id;
      sk := 'assigned';
    elsif gm.scorekeeper_request_id is null or gm.scorekeeper_request_id = uid then
      update public.games set scorekeeper_request_id = uid, scorekeeper_requested_at = now() where id = gm.id;
      sk := 'requested';
    else
      raise exception 'SCOREKEEPER_REQUEST_PENDING';  -- rolls back the join too; user can pick another role
    end if;
  end if;

  return json_build_object('game_id', gm.id, 'code', gm.code, 'scorekeeper', sk);
end $$;

-- Ask to become scorekeeper (or take it immediately if you are the organizer). Atomic via row lock.
create or replace function public.request_scorekeeper(p_game uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); gm public.games%rowtype;
begin
  if not public.is_participant(p_game) then raise exception 'NOT_PARTICIPANT'; end if;
  select * into gm from public.games where id = p_game for update;
  if gm.status <> 'live' or gm.expires_at <= now() then raise exception 'GAME_CLOSED'; end if;
  if gm.scorekeeper_id = uid then return 'assigned'; end if;
  if gm.organizer_id = uid then
    update public.games set scorekeeper_id = uid,
      scorekeeper_request_id = case when scorekeeper_request_id = uid then null else scorekeeper_request_id end
      where id = p_game;
    return 'assigned';
  end if;
  if gm.scorekeeper_request_id is not null and gm.scorekeeper_request_id <> uid then raise exception 'SCOREKEEPER_REQUEST_PENDING'; end if;
  update public.games set scorekeeper_request_id = uid, scorekeeper_requested_at = now() where id = p_game;
  return 'requested';
end $$;

-- Organizer approves or declines the pending request. Approval transfers the role atomically.
create or replace function public.respond_scorekeeper_request(p_game uuid, p_approve boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare req uuid;
begin
  if not public.is_organizer(p_game) then raise exception 'NOT_ORGANIZER'; end if;
  select scorekeeper_request_id into req from public.games where id = p_game for update;
  if req is null then raise exception 'NO_REQUEST'; end if;
  if p_approve then
    if not public.game_open(p_game) then raise exception 'GAME_CLOSED'; end if;
    update public.games set scorekeeper_id = req, scorekeeper_request_id = null, scorekeeper_requested_at = null where id = p_game;
  else
    update public.games set scorekeeper_request_id = null, scorekeeper_requested_at = null where id = p_game;
  end if;
end $$;

-- Organizer assigns, transfers or clears (p_user null) the scorekeeper.
create or replace function public.set_scorekeeper(p_game uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_organizer(p_game) then raise exception 'NOT_ORGANIZER'; end if;
  if p_user is not null and not exists (
      select 1 from public.game_participants where game_id = p_game and user_id = p_user) then
    raise exception 'NOT_PARTICIPANT';
  end if;
  perform 1 from public.games where id = p_game for update;
  update public.games set
    scorekeeper_id = p_user,
    scorekeeper_request_id = case when scorekeeper_request_id = p_user then null else scorekeeper_request_id end,
    scorekeeper_requested_at = case when scorekeeper_request_id = p_user then null else scorekeeper_requested_at end
    where id = p_game;
  if p_user is not null then
    update public.game_participants set role = 'scorekeeper'
      where game_id = p_game and user_id = p_user and role = 'spectator';
  end if;
end $$;

-- Start tracking players. Role (primary/backup) is decided here, never by the client.
create or replace function public.start_tracking(p_game uuid, p_players uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); pid uuid;
begin
  if not public.can_record(p_game) then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(array_length(p_players, 1), 0) > 30 then raise exception 'INVALID_INPUT'; end if;
  foreach pid in array coalesce(p_players, '{}'::uuid[]) loop
    -- lock the player row so concurrent joins can't both become primary
    perform 1 from public.players where id = pid and game_id = p_game for update;
    if not found then raise exception 'PLAYER_NOT_IN_GAME'; end if;
    continue when exists (select 1 from public.tracker_assignments where player_id = pid and user_id = uid and ended_at is null);
    insert into public.tracker_assignments (game_id, player_id, user_id, role)
      values (p_game, pid, uid,
        case when exists (select 1 from public.tracker_assignments where player_id = pid and ended_at is null and role = 'primary')
             then 'backup' else 'primary' end);
  end loop;
end $$;

-- Stop tracking. If the caller was primary, the oldest active backup is promoted.
create or replace function public.stop_tracking(p_game uuid, p_players uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); pid uuid; r text;
begin
  if not public.is_participant(p_game) then raise exception 'NOT_PARTICIPANT'; end if;
  foreach pid in array coalesce(p_players, '{}'::uuid[]) loop
    perform 1 from public.players where id = pid and game_id = p_game for update;
    if not found then raise exception 'PLAYER_NOT_IN_GAME'; end if;
    r := null;
    update public.tracker_assignments set ended_at = now()
      where player_id = pid and user_id = uid and ended_at is null
      returning role into r;
    if r = 'primary' then
      update public.tracker_assignments set role = 'primary'
        where id = (select id from public.tracker_assignments
                    where player_id = pid and ended_at is null order by created_at limit 1);
    end if;
  end loop;
end $$;

create or replace function public.set_period(p_game uuid, p_period int) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  if not (public.is_organizer(p_game) or public.is_scorekeeper(p_game)) then raise exception 'NOT_ALLOWED'; end if;
  if not public.game_open(p_game) then raise exception 'GAME_CLOSED'; end if;
  select periods into n from public.games where id = p_game;
  update public.games set current_period = greatest(1, least(n + 4, p_period)) where id = p_game;
end $$;

create or replace function public.finish_game(p_game uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_organizer(p_game) then raise exception 'NOT_ORGANIZER'; end if;
  update public.games set status = 'final', finished_at = now(), scorekeeper_request_id = null, scorekeeper_requested_at = null
    where id = p_game and status = 'live';
end $$;

create or replace function public.reopen_game(p_game uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_organizer(p_game) then raise exception 'NOT_ORGANIZER'; end if;
  update public.games set status = 'live', finished_at = null, expires_at = greatest(expires_at, now() + interval '1 day')
    where id = p_game;
end $$;

-- ============================================================ function privileges
-- Postgres grants EXECUTE to PUBLIC by default: remove it everywhere, then grant explicitly.
revoke execute on all functions in schema public from public, anon, authenticated;

-- RLS helper predicates must be callable by the querying role.
grant execute on function public.is_participant(uuid)                     to authenticated;
grant execute on function public.is_organizer(uuid)                       to authenticated;
grant execute on function public.game_open(uuid)                          to authenticated;
grant execute on function public.can_record(uuid)                         to authenticated;
grant execute on function public.is_scorekeeper(uuid)                     to authenticated;
grant execute on function public.was_tracking(uuid, uuid, timestamptz)    to authenticated;

grant execute on function public.game_preview(text)                                   to authenticated;
grant execute on function public.create_game(text, text, int, text, jsonb, boolean)   to authenticated;
grant execute on function public.join_game(text, text, text)                          to authenticated;
grant execute on function public.request_scorekeeper(uuid)                            to authenticated;
grant execute on function public.respond_scorekeeper_request(uuid, boolean)           to authenticated;
grant execute on function public.set_scorekeeper(uuid, uuid)                          to authenticated;
grant execute on function public.start_tracking(uuid, uuid[])                         to authenticated;
grant execute on function public.stop_tracking(uuid, uuid[])                          to authenticated;
grant execute on function public.set_period(uuid, int)                                to authenticated;
grant execute on function public.finish_game(uuid)                                    to authenticated;
grant execute on function public.reopen_game(uuid)                                    to authenticated;
-- gen_game_code and normalize_code stay internal.

-- ============================================================ realtime
alter publication supabase_realtime add table
  public.games, public.players, public.game_participants, public.tracker_assignments,
  public.stat_events, public.stat_corrections, public.score_events;
