begin;
set local lock_timeout='5s';

-- Scores and legacy reviews still feed the admin ledger. Only these event
-- types can enter Discord, regardless of their score.
create or replace function public.anticheat_discord_event_allowed(p_event_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((
    select e.event_type in ('network_cluster_threshold','anticheat_operational_alert','referral_network_enforcement')
      or (e.event_type='trade_shared_network_identity' and e.metadata->'sharedDevice'='true'::jsonb)
    from public.anticheat_events e where e.id=p_event_id
  ),false)
$$;

do $routing$
declare
  original text;
  updated text;
begin
  original:=pg_get_functiondef('public.queue_anticheat_discord_alert()'::regprocedure);
  updated:=replace(original,'if new.risk_points<=0 or not public.anticheat_discord_event_allowed(new.event_id) then return new;end if;',
    'if new.risk_points<=0 or not public.anticheat_runtime_flag_enabled(''discord_alerts_v2'')
        or not public.anticheat_discord_event_allowed(new.event_id) then return new;end if;');
  if updated=original then raise exception 'UNEXPECTED_DISCORD_ENQUEUE_FUNCTION'; end if;
  execute updated;

  original:=pg_get_functiondef('public.dispatch_anticheat_discord_alerts()'::regprocedure);
  updated:=replace(original,'select * into config from public.anticheat_discord_config where id;',
    'delete from public.anticheat_discord_outbox where event_id in (
      select event_id from public.anticheat_discord_outbox
      where dispatched_at is null and request_id is null
        and not public.anticheat_discord_event_allowed(event_id)
      for update skip locked
    );
    select * into config from public.anticheat_discord_config where id;');
  if updated=original then raise exception 'UNEXPECTED_DISCORD_DISPATCH_FUNCTION'; end if;
  original:=updated;
  updated:=replace(original,'where dispatched_at is null and attempts<12',
    'where dispatched_at is null and attempts<12
      and (request_id is not null or (public.anticheat_runtime_flag_enabled(''discord_alerts_v2'')
        and public.anticheat_discord_event_allowed(event_id)))');
  if updated=original then raise exception 'UNEXPECTED_DISCORD_DISPATCH_FILTER'; end if;
  execute updated;
end
$routing$;

-- An in-flight HTTP request may already have reached Discord. Preserve its
-- receipt handling and suppress a fresh submission if it fails.
delete from public.anticheat_discord_outbox
where dispatched_at is null and request_id is null
  and not public.anticheat_discord_event_allowed(event_id);

commit;
