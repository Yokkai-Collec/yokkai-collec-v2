begin;
set local lock_timeout = '3s';

alter table public.notifications
  add column mission_id text references public.mission_definitions(id),
  add column catalogue_achievement_id text references public.achievement_catalogue(id),
  add constraint notifications_progress_reference_check check (
    (type = 'mission_completed') = (mission_id is not null)
    and (type = 'catalogue_achievement_completed') = (catalogue_achievement_id is not null)
  );

do $types$
declare
  definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
  where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
  if definition is null then raise exception 'NOTIFICATION_CONSTRAINT_MISSING'; end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute 'alter table public.notifications add constraint notifications_type_check check '
    || '(type in (''mission_completed'', ''catalogue_achievement_completed'') or ('
    || substring(definition from 8 for char_length(definition) - 8) || '))';
end;
$types$;

create index notifications_progress_unread_idx on public.notifications(user_id)
where read_at is null
  and type in ('mission_completed', 'catalogue_achievement_completed', 'achievement_completed');

create function public.notify_mission_completed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  previous_value bigint := 0;
begin
  if tg_op = 'UPDATE' then previous_value := old.value; end if;
  if new.value <= previous_value then return new; end if;

  insert into public.notifications(user_id, type, reference_id, mission_id, created_at)
  select new.user_id, 'mission_completed',
    md5(m.id || ':' || extract(epoch from new.period_start)::text)::uuid,
    m.id, clock_timestamp()
  from public.mission_definitions m
  where m.period = new.period and m.metric = new.metric
    and previous_value < m.target and m.target <= new.value
  on conflict do nothing;
  return new;
end;
$$;

create trigger notify_mission_completed after insert or update of value on public.user_mission_progress
for each row execute function public.notify_mission_completed();

create function public.notify_catalogue_achievement_completed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.completed_at is null or (tg_op = 'UPDATE' and old.completed_at is not null) then
    return new;
  end if;

  if exists (select 1 from public.achievements a where a.id = new.achievement_id) then
    -- The legacy evaluator may have unlocked this tier and notified the player already.
    if not exists (
      select 1 from public.user_achievements a
      where a.user_id = new.user_id and a.achievement_id = new.achievement_id
        and a.completed_at is not null
    ) then
      insert into public.notifications(user_id, type, achievement_id, created_at)
      values (new.user_id, 'achievement_completed', new.achievement_id, clock_timestamp())
      on conflict do nothing;
    end if;
  else
    insert into public.notifications(user_id, type, reference_id, catalogue_achievement_id, created_at)
    values (new.user_id, 'catalogue_achievement_completed', md5(new.achievement_id)::uuid,
      new.achievement_id, clock_timestamp())
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger notify_catalogue_achievement_completed
after insert or update of completed_at on public.user_catalogue_achievements
for each row execute function public.notify_catalogue_achievement_completed();

create function public.progress_notification_details(note public.notifications) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  if note.type = 'mission_completed' then
    return (select jsonb_build_object('missionMetric', m.metric, 'missionTarget', m.target,
      'missionPeriod', m.period) from public.mission_definitions m where m.id = note.mission_id);
  elsif note.type = 'catalogue_achievement_completed' then
    return (select jsonb_build_object('referenceId', a.id, 'achievementName', a.titre,
      'achievementFamily', a.family_key, 'achievementTarget', a.condition_value,
      'achievementCategory', a.condition_categorie)
      from public.achievement_catalogue a where a.id = note.catalogue_achievement_id);
  end if;
  return '{}'::jsonb;
end;
$$;

-- Use the same completion details in the bell and web push, retaining their
-- existing filters and response shape for all previous event types.
do $details$
declare
  target regprocedure;
  definition text;
  marker text := ') || case when n.type=''wall_reply_received''';
begin
  foreach target in array array[
    'public.list_notifications(integer)'::regprocedure,
    'public.get_push_notification(uuid,timestamptz)'::regprocedure
  ] loop
    definition := pg_get_functiondef(target);
    if (length(definition) - length(replace(definition, marker, ''))) / length(marker) <> 1 then
      raise exception 'PROGRESS_NOTIFICATION_DETAILS_PATCH_MISMATCH: %', target;
    end if;
    execute replace(definition, marker,
      ') || public.progress_notification_details(n) || case when n.type=''wall_reply_received''');
  end loop;
end;
$details$;

create table public.achievement_notification_refreshes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  evaluated_at timestamptz not null,
  progress_revision text not null
);
alter table public.achievement_notification_refreshes enable row level security;
revoke all on table public.achievement_notification_refreshes from public, anon, authenticated, service_role;
create trigger account_deletion_write_guard before insert or update or delete
on public.achievement_notification_refreshes for each statement execute function public.guard_deleted_account();
create trigger account_deletion_reference_guard before insert or update
on public.achievement_notification_refreshes for each row execute function public.guard_deleted_account();

-- Share completion rules with the achievements page. Background checks do not
-- grant an activity day or build the full catalogue response.
do $evaluator$
declare
  definition text := pg_get_functiondef('public.get_achievement_catalogue()'::regprocedure);
  activity text := 'perform public.mark_player_progress(player,''activity_days'',(stamp at time zone ''Europe/Paris'')::date::text,stamp);';
  response text := 'select coalesce(jsonb_agg(jsonb_build_object(';
begin
  if (length(definition) - length(replace(definition, activity, ''))) / length(activity) <> 1
    or (length(definition) - length(replace(definition, response, ''))) / length(response) <> 1 then
    raise exception 'PROGRESS_CATALOGUE_EVALUATOR_PATCH_MISMATCH';
  end if;
  execute replace(replace(replace(definition,
    'public.get_achievement_catalogue()', 'public.evaluate_achievement_catalogue(include_details boolean)'),
    activity, 'if include_details then ' || activity || ' end if;'),
    response, 'if not include_details then return null; end if; ' || response);
end;
$evaluator$;

create or replace function public.get_achievement_catalogue() returns jsonb
language sql volatile security definer set search_path = '' as $$
  select public.evaluate_achievement_catalogue(true)
$$;

-- Pack/trade mutations retain their bounded evaluator. Compare the player's
-- small progress counters before reusing the full catalogue evaluator.
create function public.refresh_notification_achievements(player uuid) returns void
language plpgsql volatile set search_path = '' as $$
declare
  last_refresh public.achievement_notification_refreshes%rowtype;
  stamp timestamptz := clock_timestamp();
  revision text;
begin
  select * into last_refresh from public.achievement_notification_refreshes where user_id = player;
  if last_refresh.evaluated_at > stamp - interval '20 seconds' then return; end if;

  select md5(jsonb_build_array(
    (select to_jsonb(s) from public.user_achievement_stats s where s.user_id = player),
    (select jsonb_object_agg(c.metric, c.value) from public.user_progress_counters c where c.user_id = player)
  )::text) into revision;

  -- Time and progress by invited players can unlock achievements for an idle account.
  if last_refresh.progress_revision = revision
    and last_refresh.evaluated_at > stamp - interval '15 minutes' then return; end if;

  if not public.wall_actor_visible(player) then return; end if;
  perform 1 from public.user_profiles where user_id = player for update skip locked;
  if not found then return; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('player-progress:' || player::text, 0)) then
    return;
  end if;
  if exists (select 1 from public.achievement_notification_refreshes
    where user_id = player and evaluated_at > stamp - interval '20 seconds') then return; end if;

  perform public.evaluate_achievement_catalogue(false);
  insert into public.achievement_notification_refreshes(user_id, evaluated_at, progress_revision)
  values (player, stamp, revision)
  on conflict (user_id) do update set
    evaluated_at = excluded.evaluated_at, progress_revision = excluded.progress_revision;
end;
$$;

create function public.list_notifications(p_limit integer, p_include_progress boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  player uuid := auth.uid();
begin
  if not coalesce(p_include_progress, false) then return public.list_notifications(p_limit); end if;
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.refresh_notification_achievements(player);
  return jsonb_build_object(
    'items', public.list_notifications(p_limit),
    'progressUnread', (
      select count(*) from public.notifications where user_id = player and read_at is null
        and type in ('mission_completed', 'catalogue_achievement_completed', 'achievement_completed')
    )
  );
end;
$$;

create function public.mark_progress_notifications_read() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  player uuid := auth.uid();
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.assert_player_not_banned();
  update public.notifications set read_at = clock_timestamp()
  where user_id = player and read_at is null
    and type in ('mission_completed', 'catalogue_achievement_completed', 'achievement_completed');
end;
$$;

revoke all on function public.notify_mission_completed(), public.notify_catalogue_achievement_completed(),
  public.progress_notification_details(public.notifications), public.refresh_notification_achievements(uuid),
  public.evaluate_achievement_catalogue(boolean),
  public.list_notifications(integer, boolean), public.mark_progress_notifications_read()
from public, anon, authenticated, service_role;
grant execute on function public.list_notifications(integer, boolean), public.mark_progress_notifications_read()
to authenticated;
notify pgrst, 'reload schema';
commit;
