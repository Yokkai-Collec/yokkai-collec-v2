begin;
set local lock_timeout='5s';

create or replace function public.anticheat_effective_risk_snapshot(
  p_user_id uuid,p_as_of timestamptz
) returns table(risk_score integer,event_count integer,reason_codes text[])
language sql stable set search_path='' as $$
  with scored_subjects as materialized (
    -- Ordinary activity has zero weight: discard it before fetching event rows.
    select s.event_id,s.reason_codes
    from public.anticheat_event_subjects s
    where s.user_id=p_user_id and exists (
      select 1 from unnest(s.reason_codes) reason(code)
      where public.anticheat_reason_weight(reason.code)>0
    )
  ), reason_rows as materialized (
    select s.event_id,reason.code,
      public.anticheat_reason_weight(reason.code) weight,
      public.anticheat_reason_cap(reason.code) cap
    from scored_subjects s
    -- Keep indexed event lookups. A generic date estimate otherwise scans the
    -- entire 30-day event window again for every account in the admin list.
    cross join lateral (
      select occurred_at from public.anticheat_events where id=s.event_id offset 0
    ) e
    cross join lateral unnest(s.reason_codes) reason(code)
    where e.occurred_at>=public.anticheat_score_window_start(p_user_id,p_as_of)
      and e.occurred_at<=p_as_of
      and public.anticheat_reason_weight(reason.code)>0
  ), per_reason as (
    select code,count(*)::integer*weight points,max(cap) cap
    from reason_rows group by code,weight
  )
  select
    coalesce((select sum(least(points,cap)) from per_reason),0)::integer,
    coalesce((select count(distinct event_id) from reason_rows),0)::integer,
    coalesce((select array_agg(distinct code order by code) from reason_rows),'{}'::text[])
$$;
revoke all on function public.anticheat_effective_risk_snapshot(uuid,timestamptz)
  from public,anon,authenticated,service_role;

commit;
