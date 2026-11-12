begin;
set local lock_timeout='5s';

-- Only the database operator can register an exception. The identity survives
-- a pseudo change and grants no permissions to the exempt account.
create table public.anticheat_account_exemptions (
  user_id uuid primary key,
  reason text not null check(length(btrim(reason))>=10),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.anticheat_account_exemptions enable row level security;
revoke all on public.anticheat_account_exemptions from public,anon,authenticated,service_role;

create function public.anticheat_account_exempt(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.admin_users where user_id=p_user)
    or exists(select 1 from public.anticheat_account_exemptions where user_id=p_user)
$$;
revoke all on function public.anticheat_account_exempt(uuid) from public,anon,authenticated,service_role;

create function public.clear_exempt_anticheat_context()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.anticheat_network_observations where user_id=new.user_id;
  delete from public.anticheat_device_observations where user_id=new.user_id;
  return new;
end;
$$;
revoke all on function public.clear_exempt_anticheat_context() from public,anon,authenticated,service_role;
create trigger clear_exempt_anticheat_context after insert on public.anticheat_account_exemptions
  for each row execute function public.clear_exempt_anticheat_context();
create trigger clear_admin_anticheat_context after insert on public.admin_users
  for each row execute function public.clear_exempt_anticheat_context();
delete from public.anticheat_network_observations where public.anticheat_account_exempt(user_id);
delete from public.anticheat_device_observations where public.anticheat_account_exempt(user_id);

do $guards$
declare signature text; definition text; updated text; guard text;
begin
  foreach signature in array array[
    'public.record_anticheat_network_observation(uuid,text)',
    'public.record_anticheat_device_observation(uuid,text)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    updated:=replace(definition,'begin','begin
  if public.anticheat_account_exempt(p_user_id) then return false; end if;');
    if updated=definition then raise exception 'UNEXPECTED_OBSERVATION_BODY %',signature; end if;
    execute updated;
  end loop;
  foreach signature in array array[
    'public.record_anticheat_event(text,uuid,uuid,uuid,integer,integer,jsonb,timestamptz)',
    'public.record_anticheat_context_signal(text,uuid,uuid,uuid,integer,text,jsonb)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    updated:=replace(definition,'begin','begin
  if public.anticheat_account_exempt(p_actor_user_id)
    or public.anticheat_account_exempt(p_counterparty_user_id) then return null; end if;');
    if updated=definition then raise exception 'UNEXPECTED_EVENT_BODY %',signature; end if;
    execute updated;
  end loop;

  definition:=pg_get_functiondef('public.anticheat_trade_shares_connection(public.trade_offers)'::regprocedure);
  updated:=replace(definition,'select exists(','select not public.anticheat_account_exempt(p_offer.from_user)
    and not public.anticheat_account_exempt(p_offer.to_user) and exists(');
  if updated=definition then raise exception 'UNEXPECTED_TRADE_CONNECTION'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.capture_trade_quarantine_shadow()'::regprocedure);
  updated:=replace(definition,'begin','begin
  if public.anticheat_account_exempt(new.from_user) or public.anticheat_account_exempt(new.to_user) then return new; end if;');
  if updated=definition then raise exception 'UNEXPECTED_SHADOW_BODY'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.anticheat_referral_farm_candidates(uuid)'::regprocedure);
  updated:=replace(definition,'and not exists(select 1 from public.admin_users a where a.user_id in(p_referrer,r.referred_id))',
    'and not public.anticheat_account_exempt(p_referrer)
      and not public.anticheat_account_exempt(r.referred_id)');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_CANDIDATES'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.complete_referral_after_verification(uuid,timestamptz)'::regprocedure);
  updated:=replace(definition,'  select review.network_identity,review.last_flagged_at+interval ''7 days''',
    '  if not public.anticheat_account_exempt(referral.referrer_id)
    and not public.anticheat_account_exempt(referral.referred_id) then
  select review.network_identity,review.last_flagged_at+interval ''7 days''');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_REVIEW_QUERY'; end if;
  definition:=updated;
  updated:=replace(definition,'  if held_network is not null then','  end if;
  if held_network is not null then');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_REVIEW_END'; end if;
  execute updated;

  foreach signature in array array[
    'public.evaluate_anticheat_network_clusters()',
    'public.evaluate_anticheat_farm_evidence()'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    updated:=replace(definition,'join auth.users u on u.id=n.user_id',
      'join auth.users u on u.id=n.user_id and not public.anticheat_account_exempt(u.id)');
    if updated=definition then raise exception 'UNEXPECTED_CLUSTER_MEMBERS %',signature; end if;
    execute updated;
  end loop;
  definition:=pg_get_functiondef('public.anticheat_farm_enforcement_plan(uuid)'::regprocedure);
  updated:=replace(definition,'if f.decision<>''ECONOMICALLY_CONFIRMED'' then',
    'if public.anticheat_account_exempt(f.beneficiary_id)
    or exists(select 1 from unnest(f.secondary_ids) member(user_id) where public.anticheat_account_exempt(member.user_id))
    then return jsonb_build_object(''decision'',''REJECTED'',''version'',revision); end if;
  if f.decision<>''ECONOMICALLY_CONFIRMED'' then');
  if updated=definition then raise exception 'UNEXPECTED_FARM_PLAN'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.recover_anticheat_referral_sponsor_assets(uuid,uuid)'::regprocedure);
  updated:=replace(definition,'begin','begin
  if public.anticheat_account_exempt(p_referrer) then return false; end if;');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_RECOVERY'; end if;
  execute updated;
  definition:=pg_get_functiondef('public.anticheat_referral_sponsor_cards(uuid)'::regprocedure);
  updated:=replace(definition,'and e.recovery_incident is not null',
    'and e.recovery_incident is not null
    and not public.anticheat_account_exempt(p_referrer) and not public.anticheat_account_exempt(e.referred_id)');
  if updated=definition then raise exception 'UNEXPECTED_RECOVERY_CARD_PROVENANCE'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.admin_preview_smurf_sanction(uuid,uuid)'::regprocedure);
  updated:=replace(definition,'not smurf_admin and not primary_admin',
    'not smurf_admin and not primary_admin
      and not public.anticheat_account_exempt(p_smurf_user_id)
      and not public.anticheat_account_exempt(p_primary_user_id)');
  if updated=definition then raise exception 'UNEXPECTED_MANUAL_SMURF_PREVIEW'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.admin_preview_anticheat_asset_recovery(uuid,text,uuid)'::regprocedure);
  updated:=replace(definition,'eligible:=coalesce(item.owner_id=any(actors),false)',
    'eligible:=not public.anticheat_account_exempt(item.owner_id)
    and coalesce(item.owner_id=any(actors),false)');
  if updated=definition then raise exception 'UNEXPECTED_MANUAL_ASSET_PREVIEW'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.enforce_referral_network_cohort()'::regprocedure);
  updated:=replace(definition,'where r.referrer_id=referrer',
    'where r.referrer_id=referrer and not public.anticheat_account_exempt(referrer)');
  updated:=replace(updated,'join auth.users u on u.id=r.referred_id',
    'join auth.users u on u.id=r.referred_id and not public.anticheat_account_exempt(u.id)');
  if updated=definition then raise exception 'UNEXPECTED_LEGACY_REFERRAL_MEMBERS'; end if;
  execute updated;
end
$guards$;

-- Re-check queued Discord messages against live exemptions.
do $discord$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.anticheat_discord_event_allowed(bigint)'::regprocedure);
  updated:=replace(definition,'from public.anticheat_events e where e.id=p_event_id',
    'from public.anticheat_events e where e.id=p_event_id
      and not public.anticheat_account_exempt(e.actor_user_id)
      and not public.anticheat_account_exempt(e.counterparty_user_id)');
  if updated=definition then raise exception 'UNEXPECTED_DISCORD_ROUTING'; end if;
  execute updated;
end
$discord$;

-- Exemption installation also closes automatic receipts that would otherwise
-- remain active after an operator has already restored the live account.
create function public.reconcile_exempt_anticheat_account(p_user uuid)
returns integer language plpgsql set search_path='' as $$
declare receipt public.account_sanctions%rowtype; suspension public.anticheat_farm_suspensions%rowtype;
  latest_audit bigint; expected_audit bigint; corrected integer:=0; released boolean;
begin
  if not public.anticheat_account_exempt(p_user) then raise exception 'ACCOUNT_NOT_EXEMPT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('farm-principal:'||p_user,0));
  perform 1 from auth.users where id=p_user for update;
  for receipt in select * from public.account_sanctions s where s.user_id=p_user and s.status='APPLIED'
    and (s.sanction_type in('FARM_BAN','FARM_SUSPENSION','SHARED_TRADE_BAN','SHARED_TRADE_WARNING','SHARED_TRADE_SUSPENSION',
      'AFFILIATE_ABUSE_NETWORK_WARNING') or s.metadata->>'action'='FARM_WARNING')
    order by s.applied_at desc,s.id for update
  loop
    released:=false;
    if receipt.sanction_type in('FARM_BAN','SHARED_TRADE_BAN') then
      select id into latest_audit from public.admin_audit_logs
        where action in('player.ban','player.unban') and metadata->>'target_user_id'=p_user::text order by id desc limit 1;
      select coalesce((receipt.metadata->>'banAuditId')::bigint,
        (select b.ban_audit_id from public.anticheat_farm_bans b where b.receipt_id=receipt.id)) into expected_audit;
      if latest_audit=expected_audit then
        update auth.users set banned_until=null,updated_at=clock_timestamp() where id=p_user and banned_until='infinity';
        released:=found;
      end if;
    elsif receipt.sanction_type in('FARM_SUSPENSION','SHARED_TRADE_SUSPENSION') then
      select * into suspension from public.anticheat_farm_suspensions where receipt_id=receipt.id;
      update auth.users set banned_until=null,updated_at=clock_timestamp() where id=p_user and banned_until=suspension.ends_at;
      released:=found;
    end if;
    if released then
      insert into public.admin_audit_logs(admin_user_id,action,metadata)
        values(null,'player.unban',jsonb_build_object('target_user_id',p_user,'reason','Approved anti-cheat account exemption','receipt',receipt.id));
    end if;
    update public.account_sanctions set status='ROLLED_BACK' where id=receipt.id;
    corrected:=corrected+1;
  end loop;
  return corrected;
end;
$$;
revoke all on function public.reconcile_exempt_anticheat_account(uuid) from public,anon,authenticated,service_role;

commit;
