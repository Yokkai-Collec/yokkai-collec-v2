begin;
set local lock_timeout='5s';

alter table public.anticheat_runtime_flags drop constraint anticheat_runtime_flags_flag_check;
alter table public.anticheat_runtime_flags add constraint anticheat_runtime_flags_flag_check check(flag in(
  'discord_alerts_v2','graph_detection_v2','risk_score_v2_shadow','quarantine_shadow',
  'quarantine_enforcement','advanced_recovery','automatic_sanctions','automatic_decisions_paused',
  'quarantine_auto_release','ip_cluster_detection','cluster_investigation','referral_evidence_hold',
  'farm_policy_v1','auto_farm_ban','auto_farm_warning','auto_farm_suspension','farm_compensation',
  'referral_farm_sanctions'
));
insert into public.anticheat_runtime_flags(flag) values('referral_farm_sanctions');

-- Keep verification/observation fast. A worker applies sanctions in a separate
-- transaction and retries after contention without rolling back a signup.
create table public.anticheat_referral_farm_queue (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null,
  next_check_at timestamptz not null default clock_timestamp()
);
create index anticheat_referral_farm_queue_due_idx
  on public.anticheat_referral_farm_queue(next_check_at,referrer_id);
alter table public.anticheat_referral_farm_queue enable row level security;
revoke all on public.anticheat_referral_farm_queue from public,anon,authenticated,service_role;

create function public.anticheat_referral_farm_candidates(p_referrer uuid)
returns table(referral_id uuid,network_identity text,referrer_on_ip boolean)
language sql stable set search_path='' as $$
  with sightings as (
    select r.id,child.network_identity,count(*) over(partition by child.network_identity) as referral_count
    from public.referrals r
    join auth.users u on u.id=r.referred_id and u.email_confirmed_at is not null
    join public.anticheat_network_observations child on child.user_id=r.referred_id
      and child.last_seen_at>=now()-interval '7 days'
    where r.referrer_id=p_referrer and r.verified_at is not null
      and r.created_at>=now()-interval '7 days'
      and not exists(select 1 from public.admin_users a where a.user_id in(p_referrer,r.referred_id))
  )
  select distinct on(s.id) s.id,s.network_identity,(parent.user_id is not null) as referrer_on_ip
  from sightings s
  left join public.anticheat_network_observations parent on parent.user_id=p_referrer
    and parent.network_identity=s.network_identity and parent.last_seen_at>=now()-interval '7 days'
  where s.referral_count>=2
  order by s.id,referrer_on_ip desc,s.network_identity
$$;

create function public.queue_anticheat_referral_farm_check()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.anticheat_runtime_flag_enabled('referral_farm_sanctions') then return new; end if;
  if tg_table_name='referrals' then
    insert into public.anticheat_referral_farm_queue(referrer_id) values(new.referrer_id);
  else
    insert into public.anticheat_referral_farm_queue(referrer_id)
    select distinct r.referrer_id from public.referrals r
    where r.created_at>=now()-interval '7 days' and r.verified_at is not null
      and r.referred_id=new.user_id
    order by r.referrer_id;
  end if;
  return new;
end;
$$;
create trigger queue_referral_farm_on_verification after update of verified_at on public.referrals
  for each row when (old.verified_at is null and new.verified_at is not null)
  execute function public.queue_anticheat_referral_farm_check();
create trigger queue_referral_farm_on_network after insert or update of last_seen_at on public.anticheat_network_observations
  for each row execute function public.queue_anticheat_referral_farm_check();

create function public.queue_recent_referral_farms_on_activation()
returns trigger language plpgsql set search_path='' as $$
begin
  insert into public.anticheat_referral_farm_queue(referrer_id)
    select distinct r.referrer_id from public.referrals r
    where r.created_at>=now()-interval '7 days' and r.verified_at is not null;
  return new;
end;
$$;
create trigger queue_recent_referral_farms_on_activation after update of enabled on public.anticheat_runtime_flags
  for each row when (new.flag='referral_farm_sanctions' and new.enabled and not old.enabled)
  execute function public.queue_recent_referral_farms_on_activation();

do $reward_gate$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.complete_referral_after_verification(uuid,timestamptz)'::regprocedure);
  updated:=replace(definition,'held_until timestamptz;', 'held_until timestamptz; shared_ip record;');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_DECLARATIONS'; end if;
  definition:=updated;
  updated:=replace(definition,'    returning * into referral;',
    '    returning * into referral;
  if exists(select 1 from public.anticheat_referral_enforcements e where e.referral_id=referral.id) then return; end if;
  if public.anticheat_runtime_flag_enabled(''referral_farm_sanctions'')
    and not public.anticheat_runtime_flag_enabled(''automatic_decisions_paused'') then
    select * into shared_ip from public.anticheat_referral_farm_candidates(referral.referrer_id) c
      where c.referral_id=referral.id;
    if found then
      insert into public.anticheat_referral_reward_holds(referral_id,referrer_id,network_identity,release_after)
      values(referral.id,referral.referrer_id,shared_ip.network_identity,clock_timestamp()+interval ''5 minutes'')
      on conflict(referral_id) do update set network_identity=excluded.network_identity,release_after=excluded.release_after;
      return;
    end if;
  end if;');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_PAYOUT'; end if;
  execute replace(updated,
    '  if exists(select 1 from public.anticheat_referral_enforcements e where e.referral_id=referral.id) then return;end if;',
    '');

  -- Use the new decision path when enabled, with the global pause respected.
  definition:=pg_get_functiondef('public.enforce_referral_network_cohort()'::regprocedure);
  updated:=replace(definition,'  if tg_table_name=',
    '  if public.anticheat_runtime_flag_enabled(''referral_farm_sanctions'') then return new; end if;
  if tg_table_name=');
  if updated=definition then raise exception 'UNEXPECTED_LEGACY_REFERRAL_TRIGGER'; end if;
  execute updated;
end
$reward_gate$;

-- The existing warning ledger and 48 h suspension receipts support appeals.
alter table public.anticheat_farm_warnings drop constraint anticheat_farm_warnings_secondary_ids_check;
alter table public.anticheat_farm_warnings add constraint anticheat_farm_warnings_secondary_ids_check
  check(cardinality(secondary_ids)>=3 or (evidence_version='REFERRAL_SHARED_IP' and cardinality(secondary_ids)>=1));

create function public.apply_anticheat_referral_farm(p_referrer uuid)
returns integer language plpgsql set search_path='' as $$
declare
  ids uuid[];
  children uuid[];
  linked_children uuid[];
  incident uuid;
  warnings uuid[];
  referral public.referrals%rowtype;
  lot public.referral_pack_reward_lots%rowtype;
  receipt uuid;
  audit_id bigint;
  event_id bigint;
  balance integer;
  parent_packs integer;
  parent_total integer:=0;
  child_total integer:=0;
  blocked_packs integer:=0;
  applied_ban boolean;
  stamp timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('farm-principal:'||p_referrer,0));
  select array_agg(r.id order by r.id),array_agg(r.referred_id order by r.id)
    into ids,children
  from public.anticheat_referral_farm_candidates(p_referrer) c
  join public.referrals r on r.id=c.referral_id
  where not exists(select 1 from public.anticheat_referral_enforcements e where e.referral_id=r.id);
  if ids is null then return 0; end if;

  -- Lock referrals before balances, like the normal payout path. Lock auction
  -- rows before the Auth and balance writes performed by the shared ban routine.
  perform 1 from public.referrals where id=any(ids) order by id for update;
  perform 1 from public.auctions where status='active'
    and (seller_id=any(children) or buyer_id=any(children)) order by id for update nowait;
  perform 1 from auth.users where id=p_referrer or id=any(children) order by id for update nowait;
  perform 1 from public.user_profiles where user_id=p_referrer or user_id=any(children) order by user_id for update;

  select array_agg(r.id order by r.id),array_agg(r.referred_id order by r.id),
    array_agg(r.referred_id order by r.id) filter(where c.referrer_on_ip)
    into ids,children,linked_children
  from public.anticheat_referral_farm_candidates(p_referrer) c
  join public.referrals r on r.id=c.referral_id
  where r.id=any(ids)
    and not exists(select 1 from public.anticheat_referral_enforcements e where e.referral_id=r.id);
  if ids is null then return 0; end if;
  incident:=ids[1];
  stamp:=clock_timestamp();

  for referral in select * from public.referrals where id=any(ids) order by id loop
    applied_ban:=false;
    parent_packs:=0;
    if exists(select 1 from auth.users u where u.id=referral.referred_id and u.banned_until is distinct from 'infinity'::timestamptz)
      and not exists(select 1 from public.anticheat_farm_bans b where b.user_id=referral.referred_id) then
      perform public.apply_account_ban_core(referral.referred_id,true,null);
      select id into strict audit_id from public.admin_audit_logs where action='player.ban'
        and metadata->>'target_user_id'=referral.referred_id::text order by id desc limit 1;
      select karas_balance into strict balance from public.user_profiles where user_id=referral.referred_id;
      insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
        cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
      values('referral-farm-ban:'||referral.id,referral.referred_id,'FARM_BAN','AFFILIATE_ABUSE','NONE','NONE',
        0,0,balance,balance,stamp,stamp,'APPLIED',jsonb_build_object('action','FARM_BAN',
          'referrer',p_referrer,'referral',referral.id,'cohort',incident))
      returning id into receipt;
      insert into public.anticheat_farm_bans(user_id,cluster_id,evidence_version,receipt_id,ban_audit_id)
        values(referral.referred_id,incident,'REFERRAL_SHARED_IP',receipt,audit_id);
      applied_ban:=true;
    end if;

    -- Remove only unopened packs attributable to these exact referrals, on
    -- both accounts. Opened or untracked packs never debit unrelated lots.
    for lot in select * from public.referral_pack_reward_lots
      where referral_id=referral.id and remaining_packs>0 order by beneficiary_id for update
    loop
      update public.user_profiles set bonus_regular_packs=bonus_regular_packs-lot.remaining_packs
        where user_id=lot.beneficiary_id and bonus_regular_packs>=lot.remaining_packs;
      if not found then raise exception 'REFERRAL_PACK_BALANCE_MISMATCH'; end if;
      update public.referral_pack_reward_lots set remaining_packs=0,removed_packs=removed_packs+lot.remaining_packs where id=lot.id;
      if lot.beneficiary_role='referrer' then
        parent_packs:=parent_packs+lot.remaining_packs;
      else
        child_total:=child_total+lot.remaining_packs;
      end if;
    end loop;
    parent_total:=parent_total+parent_packs;
    if referral.rewarded_at is null then blocked_packs:=blocked_packs+referral.reward_packs; end if;
    insert into public.anticheat_referral_enforcements(referral_id,referrer_id,referred_id,referred_banned,referral_packs_removed,applied_at)
      values(referral.id,p_referrer,referral.referred_id,applied_ban,parent_packs,stamp);
    delete from public.anticheat_referral_reward_holds where referral_id=referral.id;
  end loop;

  -- Someone can reuse another player's public referral code. Only sanction
  -- the referrer when they also used the IP shared by the referred accounts.
  if linked_children is not null then
    select karas_balance into strict balance from public.user_profiles where user_id=p_referrer;
    select array(select w.receipt_id from public.anticheat_farm_warnings w
      join public.account_sanctions a on a.id=w.receipt_id and a.status='APPLIED'
      where w.user_id=p_referrer and not exists(select 1 from public.anticheat_farm_suspensions s
        join public.account_sanctions applied on applied.id=s.receipt_id and applied.status='APPLIED'
        where s.user_id=p_referrer and w.receipt_id=any(s.warning_receipts))
      order by a.applied_at,a.id limit 3) into warnings;
    insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
      cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
    values('referral-farm-warning:'||incident,p_referrer,'AFFILIATE_ABUSE_WARNING','AFFILIATE_ABUSE','NONE','NONE',
      0,0,balance,balance,stamp,stamp,'APPLIED',jsonb_build_object('action','FARM_WARNING',
        'referrer',p_referrer,'children',linked_children,'cohort',incident))
    returning id into receipt;
    insert into public.anticheat_farm_warnings(cluster_id,user_id,receipt_id,secondary_ids,evidence_version)
      values(incident,p_referrer,receipt,linked_children,'REFERRAL_SHARED_IP');

    if cardinality(warnings)=3 then
      update auth.users set banned_until=stamp+interval '48 hours',updated_at=stamp
        where id=p_referrer and coalesce(banned_until,'-infinity')<=stamp;
      if found then
        delete from auth.sessions where user_id=p_referrer;
        insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
          cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
        values('referral-farm-suspension:'||incident,p_referrer,'FARM_SUSPENSION','AFFILIATE_ABUSE','NONE','NONE',
          0,0,balance,balance,stamp,stamp,'APPLIED',jsonb_build_object('endsAt',stamp+interval '48 hours',
            'referrer',p_referrer,'children',linked_children,'cohort',incident))
        returning id into receipt;
        insert into public.anticheat_farm_suspensions(user_id,receipt_id,warning_receipts,applied_at,ends_at)
          values(p_referrer,receipt,warnings,stamp,stamp+interval '48 hours');
      end if;
    end if;
  end if;

  insert into public.anticheat_events(event_type,actor_user_id,subject_id,occurred_at,metadata)
    values('referral_network_enforcement',p_referrer,incident,stamp,jsonb_build_object(
      'policy','REFERRAL_SHARED_IP','referralCount',cardinality(children),'referredCount',cardinality(children),
      'unusedReferralPacksRemoved',parent_total,'unusedReferredPacksRemoved',child_total,'blockedPacksPerSide',blocked_packs))
    returning id into event_id;
  insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
    values(event_id,p_referrer,60,array['REFERRAL_NETWORK_ENFORCEMENT']);
  insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
    select event_id,user_id,100,array['REFERRAL_NETWORK_ENFORCEMENT'] from unnest(children) user_id;
  return cardinality(ids);
end;
$$;

create function public.run_anticheat_referral_farms()
returns integer language plpgsql security definer set search_path='' as $$
declare item record; applied integer:=0;
begin
  if not public.anticheat_runtime_flag_enabled('referral_farm_sanctions')
    or public.anticheat_runtime_flag_enabled('automatic_decisions_paused')
    or not pg_try_advisory_xact_lock(hashtext('run-anticheat-referral-farms')) then return 0; end if;
  for item in select referrer_id,array_agg(id) as queue_ids from public.anticheat_referral_farm_queue
    where next_check_at<=now() group by referrer_id order by min(next_check_at),referrer_id limit 25
  loop
    begin
      applied:=applied+public.apply_anticheat_referral_farm(item.referrer_id);
      delete from public.anticheat_referral_farm_queue where id=any(item.queue_ids);
    exception when others then
      update public.anticheat_referral_farm_queue set next_check_at=clock_timestamp()+interval '5 minutes'
        where id=any(item.queue_ids);
      raise log 'Referral farm enforcement failed for referrer %, SQLSTATE %',item.referrer_id,sqlstate;
    end;
  end loop;
  return applied;
end;
$$;

do $receipts_and_discord$
declare definition text; updated text;
begin
  -- The farm ban ledger is keyed by user_id.
  definition:=pg_get_functiondef('public.admin_restore_anticheat_restriction(uuid,text)'::regprocedure);
  updated:=replace(definition,'ban.id','ban.user_id');
  if updated<>definition then execute updated; end if;

  definition:=pg_get_functiondef('public.format_anticheat_discord_alert()'::regprocedure);
  updated:=replace(definition,'      if beneficiary is not null and beneficiary<>e.actor_user_id then',
    '      select coalesce(beneficiary,(s.metadata->>''referrer'')::uuid) into beneficiary
        from public.account_sanctions s where s.id=e.subject_id;
      if beneficiary is not null and beneficiary<>e.actor_user_id then');
  if updated=definition then raise exception 'UNEXPECTED_DISCORD_FARM_SANCTION'; end if;
  definition:=updated;
  updated:=replace(definition,'    elsif e.event_type=''referral_network_enforcement'' then',
    '    elsif e.event_type=''referral_network_enforcement'' and e.metadata->>''policy''=''REFERRAL_SHARED_IP'' then
      subject_title:=''Bonus de parrainage bloqués · IP commune'';
      summary:=''Plusieurs filleuls récents du même parrain ont utilisé la même adresse IP.'';
      accent:=15158332;
      select string_agg(public.anticheat_discord_profile(s.user_id),'' · '' order by s.user_id)
        into accounts from (
          select user_id from public.anticheat_event_subjects
          where event_id=e.id and user_id<>e.actor_user_id order by user_id limit 7
        ) s;
      if accounts is not null then
        fields:=fields||jsonb_build_array(jsonb_build_object(''name'',
          format(''Filleuls concernés (%s)'',e.metadata->>''referredCount''),''value'',accounts));
      end if;
      fields:=fields||jsonb_build_array(jsonb_build_object(''name'',''Packs bonus'',
        ''value'',format(''%s bloqués pour le parrain et %s pour les filleuls · %s packs non ouverts retirés au parrain et %s aux filleuls'',
          e.metadata->>''blockedPacksPerSide'',e.metadata->>''blockedPacksPerSide'',
          e.metadata->>''unusedReferralPacksRemoved'',e.metadata->>''unusedReferredPacksRemoved'')));
    elsif e.event_type=''referral_network_enforcement'' then');
  if updated=definition then raise exception 'UNEXPECTED_DISCORD_REFERRAL_ENFORCEMENT'; end if;
  execute updated;
end
$receipts_and_discord$;

revoke all on function public.anticheat_referral_farm_candidates(uuid),public.queue_anticheat_referral_farm_check(),
  public.queue_recent_referral_farms_on_activation(),public.apply_anticheat_referral_farm(uuid),
  public.run_anticheat_referral_farms()
  from public,anon,authenticated,service_role;
select cron.schedule('run-anticheat-referral-farms','* * * * *','select public.run_anticheat_referral_farms();');

commit;
