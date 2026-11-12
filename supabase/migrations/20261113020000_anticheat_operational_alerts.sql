begin;
set local lock_timeout='5s';

alter table public.anticheat_events drop constraint anticheat_events_event_type_check;
alter table public.anticheat_events add constraint anticheat_events_event_type_check check(event_type in(
  'account_registered','trade_created','trade_accepted','trade_declined','trade_cancelled',
  'auction_created','auction_bid','auction_sold','auction_expired','referral_rewarded',
  'network_identity_shared','trade_shared_network_identity','referral_network_review','referral_network_enforcement',
  'network_cluster_threshold','anticheat_operational_alert'
));
create unique index anticheat_operational_alert_once on public.anticheat_events(subject_id,((metadata->>'category')))
  where event_type='anticheat_operational_alert';
create function public.enqueue_anticheat_operational_alert(p_category text,p_ref uuid,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare event_id bigint;
begin
  if not public.anticheat_runtime_flag_enabled('discord_alerts_v2')
    or p_ref is null or p_actor is null or p_category not in(
      'FARM_CONFIRMED','FARM_BAN','FARM_WARNING','FARM_SUSPENSION','CRITICAL_QUARANTINE',
      'RECOVERY_FAILURE','ENFORCEMENT_JOB_FAILURE','QUARANTINE_JOB_FAILURE') then return; end if;
  insert into public.anticheat_events(event_type,actor_user_id,subject_id,metadata)
    values('anticheat_operational_alert',p_actor,p_ref,jsonb_build_object('category',p_category))
    on conflict do nothing returning id into event_id;
  if event_id is not null then
    insert into public.anticheat_discord_outbox(event_id,payload) values(event_id,jsonb_build_object(
      'allowed_mentions',jsonb_build_object('parse','[]'::jsonb),
      'embeds',jsonb_build_array(jsonb_build_object('title','Yokkai · anti-cheat',
        'url','https://yokkai-collec.com/admin/security',
        'description',format('%s · reference %s',p_category,p_ref)))
    ));
  end if;
end;
$$;
revoke all on function public.enqueue_anticheat_operational_alert(text,uuid,uuid) from public,anon,authenticated,service_role;

create function public.capture_anticheat_operational_alert()
returns trigger language plpgsql security definer set search_path='' as $$
declare category text; person uuid; reference_id uuid;
begin
  if tg_table_name='anticheat_farm_runs' then
    person:=(new.snapshot->>'beneficiary')::uuid;
    reference_id:=md5((new.snapshot->>'beneficiary')||':'||coalesce((new.snapshot->'secondaries')::text,''))::uuid;
    category:='FARM_CONFIRMED';
  elsif tg_table_name='account_sanctions' then
    category:=coalesce(new.metadata->>'action',new.sanction_type);
    reference_id:=new.id;
    person:=new.user_id;
  elsif tg_table_name='anticheat_quarantines' then
    category:=case new.analysis_outcome when 'CRITICAL_UNRESOLVED' then 'CRITICAL_QUARANTINE'
      when 'ANALYSIS_ERROR' then 'QUARANTINE_JOB_FAILURE' end;
    reference_id:=new.id;
    person:=new.sender_user_id;
  elsif tg_table_name='anticheat_farm_job_progress' then
    category:='ENFORCEMENT_JOB_FAILURE';
    reference_id:=new.cluster_id;
    select beneficiary_id into person from public.anticheat_farm_evidence where cluster_id=new.cluster_id;
  end if;
  if category is not null then perform public.enqueue_anticheat_operational_alert(category,reference_id,person); end if;
  return new;
end;
$$;
revoke all on function public.capture_anticheat_operational_alert() from public,anon,authenticated,service_role;
create trigger farm_run_operational_alert after insert on public.anticheat_farm_runs
  for each row when (new.mode='APPLY') execute function public.capture_anticheat_operational_alert();
create trigger farm_sanction_operational_alert after insert on public.account_sanctions
  for each row when (new.status='APPLIED' and (new.sanction_type in('FARM_BAN','FARM_SUSPENSION')
    or new.metadata->>'action'='FARM_WARNING')) execute function public.capture_anticheat_operational_alert();
create trigger quarantine_operational_alert after update of analysis_outcome on public.anticheat_quarantines
  for each row when (new.analysis_outcome is distinct from old.analysis_outcome) execute function public.capture_anticheat_operational_alert();
create trigger farm_job_operational_alert after insert or update of last_error on public.anticheat_farm_job_progress
  for each row when (new.last_error is not null) execute function public.capture_anticheat_operational_alert();

create table public.anticheat_recovery_failures (
  asset_id uuid primary key,sql_state text not null,recorded_at timestamptz not null default clock_timestamp()
);
alter table public.anticheat_recovery_failures enable row level security;
revoke all on public.anticheat_recovery_failures from public,anon,authenticated,service_role;
create function public.admin_record_anticheat_recovery_failure(p_asset uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_asset is null or p_code is null or p_code!~'^[0-9A-Z]{5}$' or p_code in('P0001','42501') then return; end if;
  insert into public.anticheat_recovery_failures(asset_id,sql_state) values(p_asset,p_code) on conflict do nothing;
  if found then perform public.enqueue_anticheat_operational_alert('RECOVERY_FAILURE',p_asset,auth.uid()); end if;
end;
$$;
revoke all on function public.admin_record_anticheat_recovery_failure(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_anticheat_recovery_failure(uuid,text) to authenticated;

do $admin_views$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.admin_list_anticheat_clusters(uuid)'::regprocedure);
  updated:=replace(definition,'''farmReview'',r.decision,',
    '''farmReview'',r.decision,''enforcement'',case when p_id is not null then (
      select runs.snapshot from public.anticheat_farm_runs runs where runs.cluster_id=c.id
        and runs.evidence_version=public.anticheat_farm_evidence_version(f)
      order by (runs.mode=''APPLY'') desc limit 1) end,');
  if updated=definition then raise exception 'UNEXPECTED_CLUSTER_DTO'; end if;
  execute updated;
  definition:=pg_get_functiondef('public.admin_anticheat_workload()'::regprocedure);
  updated:=replace(definition,'''deadlocks'',',
    '''simulations'',(select count(*) from public.anticheat_farm_runs where mode=''DRY_RUN''),
     ''farmBans'',(select count(*) from public.anticheat_farm_bans),
     ''farmWarnings'',(select count(*) from public.anticheat_farm_warnings),
     ''farmSuspensions'',(select count(*) from public.anticheat_farm_suspensions),
     ''recoveredCards'',(select count(*) from public.anticheat_asset_recoveries where asset_kind=''CARD''),
     ''recoveredKaras'',(select coalesce(sum(recovered_karas),0) from public.anticheat_asset_recoveries),
     ''partialRecoveries'',(select count(*) from public.anticheat_asset_recoveries where unrecovered_karas>0),
     ''recoveryFailures'',(select count(*) from public.anticheat_recovery_failures),
     ''compensations'',(select count(*) from public.anticheat_asset_compensations),
     ''jobErrors'',(select count(*) from public.anticheat_farm_job_progress where last_error is not null),
     ''jobRetries'',(select coalesce(sum(retries),0) from public.anticheat_farm_job_progress),
     ''jobDurationMs'',(select coalesce(max(last_run_ms),0)::bigint from public.anticheat_farm_job_progress),
     ''queueAgeSeconds'',(select coalesce(extract(epoch from now()-min(queued_at))::bigint,0)
       from public.anticheat_discord_outbox where dispatched_at is null),
     ''deadlocks'',');
  if updated=definition then raise exception 'UNEXPECTED_WORKLOAD_DTO'; end if;
  execute updated;
end
$admin_views$;
notify pgrst,'reload schema';
commit;
