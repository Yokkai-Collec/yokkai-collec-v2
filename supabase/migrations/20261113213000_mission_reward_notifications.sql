begin;
set local lock_timeout = '3s';

-- The profile badge receives one event per newly reached Kara milestone.
alter table public.notifications
  add column mission_points integer,
  add column mission_reward integer;

create or replace function public.notify_mission_completed() returns trigger
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  reward_multiplier numeric := 1;
  previous_value bigint := 0;
  earned_points integer;
  new_points integer;
begin
  if tg_op = 'UPDATE' then previous_value := old.value; end if;
  select coalesce(sum(points), 0)::integer into new_points
  from public.mission_definitions
  where period = new.period and metric = new.metric
    and target > previous_value and target <= new.value;
  if new_points = 0 then return new; end if;

  earned_points := public.mission_points(new.user_id, new.period, new.period_start);
  if public.billing_has_game_pro(new.user_id) then
    reward_multiplier := 1.5;
  end if;

  insert into public.notifications(
    user_id, type, reference_id, mission_id, mission_points, mission_reward, created_at
  )
  select
    new.user_id,
    'mission_completed',
    md5(
      'mission-reward:' || new.period || ':' || new.period_start::text || ':' || milestone.points::text
    )::uuid,
    definition.id,
    milestone.points,
    ceil(milestone.reward * reward_multiplier)::integer,
    clock_timestamp()
  from public.gauge_milestones milestone
  join lateral (
    select definition.id
    from public.mission_definitions definition
    where definition.period = new.period and definition.metric = new.metric
    order by definition.target desc, definition.id
    limit 1
  ) definition on true
  where milestone.period = new.period
    and milestone.points <= earned_points
    and milestone.points > (
      select coalesce(sum(d.points), 0)
      from public.mission_definitions d
      join public.user_mission_progress p on p.user_id = new.user_id
        and p.period = d.period and p.period_start = new.period_start and p.metric = d.metric
      where d.period = new.period
        and d.target <= case when d.metric = new.metric then previous_value else p.value end
    )
    and not exists (
      select 1
      from public.user_milestone_claims claim
      where claim.user_id = new.user_id
        and claim.period = new.period
        and claim.period_start = new.period_start
        and claim.points = milestone.points
    )
  on conflict do nothing;

  return new;
end;
$$;

create function public.clear_claimed_mission_notification() returns trigger
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  update public.notifications set read_at = new.claimed_at
  where user_id = new.user_id and type = 'mission_completed' and read_at is null
    and reference_id = md5(
      'mission-reward:' || new.period || ':' || new.period_start::text || ':' || new.points::text
    )::uuid;
  return new;
end;
$$;

create trigger clear_claimed_mission_notification after insert on public.user_milestone_claims
for each row execute function public.clear_claimed_mission_notification();

-- Old alerts were emitted for every completed objective, including those with
-- no claimable reward. Do not keep an existing badge alive for those alerts.
update public.notifications
set read_at = clock_timestamp()
where type = 'mission_completed'
  and read_at is null
  and mission_reward is null;

create or replace function public.progress_notification_details(note public.notifications) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  if note.type = 'mission_completed' then
    return (
      select jsonb_strip_nulls(jsonb_build_object(
        'missionMetric', definition.metric,
        'missionTarget', definition.target,
        'missionPeriod', definition.period,
        'missionPoints', note.mission_points,
        'missionReward', note.mission_reward
      ))
      from public.mission_definitions definition
      where definition.id = note.mission_id
    );
  elsif note.type = 'catalogue_achievement_completed' then
    return (
      select jsonb_build_object(
        'referenceId', achievement.id,
        'achievementName', achievement.titre,
        'achievementFamily', achievement.family_key,
        'achievementTarget', achievement.condition_value,
        'achievementCategory', achievement.condition_categorie
      )
      from public.achievement_catalogue achievement
      where achievement.id = note.catalogue_achievement_id
    );
  end if;
  return '{}'::jsonb;
end;
$$;

-- Exclude mission events before applying the bell limit, acknowledging its
-- items or preparing Web Push. The profile count still reads the same table.
do $routing$
declare
  target regprocedure;
  definition text;
  marker text;
begin
  for target, marker in values
    ('public.list_notifications(integer)'::regprocedure, 'from public.notifications where user_id=player_id'),
    ('public.mark_notification_read(uuid)'::regprocedure, 'where user_id=player_id'),
    ('public.get_push_notification(uuid,timestamptz)'::regprocedure, 'where id=p_id and created_at=p_created_at')
  loop
    definition := pg_get_functiondef(target);
    if (length(definition) - length(replace(definition, marker, ''))) / length(marker) <> 1 then
      raise exception 'MISSION_NOTIFICATION_ROUTING_PATCH_MISMATCH: %', target;
    end if;
    execute replace(definition, marker, marker || ' and type<>''mission_completed''');
  end loop;
end;
$routing$;

create or replace function public.dispatch_notification_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare config public.push_dispatch_config%rowtype;
begin
  if new.type = 'mission_completed' then return new; end if;
  if tg_op = 'UPDATE' and new.created_at is not distinct from old.created_at then return new; end if;
  if not exists(select 1 from public.push_subscriptions where user_id = new.user_id) then return new; end if;
  select * into config from public.push_dispatch_config where id;
  if not found then return new; end if;
  execute 'select net.http_post(url := $1,body := $2,headers := $3,timeout_milliseconds := 10000)'
    using config.url, jsonb_build_object('id',new.id,'createdAt',new.created_at),
      jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||config.secret);
  return new;
exception when others then
  raise warning 'PUSH_DISPATCH_FAILED (%)',sqlstate;
  return new;
end;
$$;

revoke all on function public.notify_mission_completed(), public.clear_claimed_mission_notification(),
  public.progress_notification_details(public.notifications)
from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
