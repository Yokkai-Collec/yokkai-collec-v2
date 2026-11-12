begin;
set local lock_timeout='5s';

alter table public.anticheat_runtime_flags drop constraint anticheat_runtime_flags_flag_check;
alter table public.anticheat_runtime_flags add constraint anticheat_runtime_flags_flag_check check(flag in(
  'discord_alerts_v2','graph_detection_v2','risk_score_v2_shadow','quarantine_shadow',
  'quarantine_enforcement','advanced_recovery','automatic_sanctions','automatic_decisions_paused',
  'quarantine_auto_release','ip_cluster_detection','cluster_investigation','referral_evidence_hold',
  'farm_policy_v1','auto_farm_ban','auto_farm_warning','auto_farm_suspension','farm_compensation'
));
insert into public.anticheat_runtime_flags(flag) values
  ('farm_policy_v1'),('auto_farm_ban'),('auto_farm_warning'),('auto_farm_suspension'),('farm_compensation');

-- Reuse the auction cleanup, Auth write, session revocation and audit from
-- the existing ban routine. Only the admin wrapper and trusted workers can call it.
do $shared_ban$
declare body text; guard text:='if not public.is_current_user_admin() then raise exception ''ADMIN_REQUIRED'' using errcode=''P0001''; end if;';
begin
  select prosrc into strict body from pg_proc where oid='public.admin_set_user_ban(uuid,boolean)'::regprocedure;
  if strpos(body,guard)=0 then raise exception 'UNEXPECTED_BAN_BODY'; end if;
  body:=replace(replace(replace(body,guard,''),'perform public.assert_player_not_banned();',''),'auth.uid()','p_actor');
  execute format('create function public.apply_account_ban_core(p_user_id uuid,p_banned boolean,p_actor uuid) returns void language plpgsql set search_path='''' as %L',body);
end
$shared_ban$;
revoke all on function public.apply_account_ban_core(uuid,boolean,uuid) from public,anon,authenticated,service_role;
create or replace function public.admin_set_user_ban(p_user_id uuid,p_banned boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  perform public.apply_account_ban_core(p_user_id,p_banned,auth.uid());
end;
$$;

create table public.anticheat_farm_bans (
  user_id uuid primary key,cluster_id uuid not null,evidence_version text not null,
  receipt_id uuid not null unique references public.account_sanctions(id),
  ban_audit_id bigint not null, applied_at timestamptz not null default clock_timestamp()
);
create table public.anticheat_farm_warnings (
  cluster_id uuid primary key,user_id uuid not null,receipt_id uuid not null unique references public.account_sanctions(id),
  secondary_ids uuid[] not null check(cardinality(secondary_ids)>=3),evidence_version text not null
);
create index anticheat_farm_warnings_user_idx on public.anticheat_farm_warnings(user_id);
create table public.anticheat_farm_suspensions (
  id uuid primary key default gen_random_uuid(),user_id uuid not null,
  receipt_id uuid not null unique references public.account_sanctions(id),
  warning_receipts uuid[] not null check(cardinality(warning_receipts)=3),
  applied_at timestamptz not null,ends_at timestamptz not null,
  check(ends_at=applied_at+interval '48 hours')
);
create index anticheat_farm_suspensions_user_idx on public.anticheat_farm_suspensions(user_id,ends_at desc);
create table public.anticheat_farm_restriction_corrections (
  restriction_kind text not null check(restriction_kind in('BAN','SUSPENSION')),
  restriction_id uuid not null, actor uuid, reason text not null,
  created_at timestamptz not null default clock_timestamp(),primary key(restriction_kind,restriction_id)
);
create table public.anticheat_farm_runs (
  cluster_id uuid not null,evidence_version text not null,mode text not null check(mode in('DRY_RUN','APPLY')),
  snapshot jsonb not null,created_at timestamptz not null default clock_timestamp(),
  primary key(cluster_id,evidence_version,mode)
);
alter table public.account_sanctions drop constraint account_sanctions_sanction_type_check;
alter table public.account_sanctions add constraint account_sanctions_sanction_type_check check(sanction_type in(
  'AFFILIATE_ABUSE_SANCTION','AFFILIATE_ABUSE_WARNING_WITH_PENALTY','AFFILIATE_ABUSE_WARNING',
  'AFFILIATE_ABUSE_NETWORK_WARNING','FARM_BAN','FARM_SUSPENSION'
));
do $receipt_check$
declare definition text;
begin
  select pg_get_constraintdef(oid) into strict definition from pg_constraint
    where conrelid='public.account_sanctions'::regclass and conname='account_sanctions_type_relation_check';
  execute 'alter table public.account_sanctions drop constraint account_sanctions_type_relation_check';
  execute 'alter table public.account_sanctions add constraint account_sanctions_type_relation_check check (('||
    substring(definition from 8 for char_length(definition)-8)||') or
    (sanction_type in(''FARM_BAN'',''FARM_SUSPENSION'') and card_action=''NONE'' and kara_action=''NONE''))';
end
$receipt_check$;
do $private$
declare relation text;
begin
  foreach relation in array array['anticheat_farm_bans','anticheat_farm_warnings','anticheat_farm_suspensions',
    'anticheat_farm_restriction_corrections','anticheat_farm_runs'] loop
    execute format('alter table public.%I enable row level security',relation);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',relation);
    execute format('create trigger immutable before update or delete on public.%I for each row execute function public.prevent_anticheat_ledger_mutation()',relation);
  end loop;
end
$private$;

-- Only independent A+C evidence for each account is eligible for policy v1.
-- Direct, live ownership edges are re-read. Other scenarios remain reviewable.
create function public.anticheat_farm_enforcement_plan(p_cluster uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f public.anticheat_farm_evidence%rowtype; c public.anticheat_network_clusters%rowtype;
  members uuid[]; individual uuid[]; initiated integer; current_c jsonb; verdict text;
  revision text; review text; critical_count integer;
begin
  select * into f from public.anticheat_farm_evidence where cluster_id=p_cluster;
  if not found then return jsonb_build_object('decision','SUSPECTED'); end if;
  select * into c from public.anticheat_network_clusters where id=p_cluster;
  revision:=public.anticheat_farm_evidence_version(f);
  select decision into review from public.anticheat_farm_reviews where cluster_id=p_cluster and evidence_version=revision;
  if review='DISMISSED' then return jsonb_build_object('decision','REJECTED','version',revision); end if;
  if c.id is null or c.evaluated_at<>f.evaluated_cluster_at
    or f.evaluated_at<now()-interval '30 minutes' then
    return jsonb_build_object('decision','NEEDS_REVIEW','version',revision);
  end if;
  if f.decision<>'ECONOMICALLY_CONFIRMED' then return jsonb_build_object('decision','SUSPECTED','version',revision); end if;
  if not (f.evidence->'scenarioFindings' ?& array['A','C']) then
    return jsonb_build_object('decision','CORROBORATED','version',revision);
  end if;
  select array(select n.user_id from public.anticheat_network_observations n
    where n.network_identity=c.network_identity and n.last_seen_at>=now()-make_interval(days=>s.observation_days)
    order by n.user_id limit 101),s.critical_count into members,critical_count from public.anticheat_cluster_settings s;
  if cardinality(members) not between critical_count and 100 or not f.beneficiary_id=any(members)
    or exists(select 1 from public.admin_users where user_id=f.beneficiary_id) then
    return jsonb_build_object('decision','NEEDS_REVIEW','version',revision);
  end if;
  current_c:=public.anticheat_additional_farm_scenarios(members)->'C';
  if (current_c->>'beneficiary')::uuid is distinct from f.beneficiary_id then
    return jsonb_build_object('decision','NEEDS_REVIEW','version',revision);
  end if;
  with proofs as (
    select distinct on(r.referred_id) r.referred_id,t.from_user=f.beneficiary_id initiated
    from jsonb_array_elements(f.evidence#>'{scenarioFindings,A,proofs}') p
    join jsonb_array_elements(current_c->'proofs') q on p->>'secondary'=q->>'secondary' and p->>'referral'=q->>'referral'
    join public.referrals r on r.id=(p->>'referral')::uuid and r.referrer_id=f.beneficiary_id and r.rewarded_at is not null
    join public.regular_pack_opening_cards pc on pc.card_instance_id=(p->>'card')::uuid and pc.original_owner_id=r.referred_id
    join public.regular_pack_card_transfers x on x.id=(p->>'edge')::bigint
      and x.card_instance_id=pc.card_instance_id and x.from_user_id=r.referred_id and x.to_user_id=f.beneficiary_id
    join public.trade_offers t on t.id=x.trade_offer_id and t.status='accepted'
    where r.referred_id=any(members)
      and ((t.from_user=r.referred_id and t.to_user=f.beneficiary_id
             and pc.card_instance_id=any(t.offered_card_ids) and cardinality(t.requested_card_ids)=0 and t.requested_karas=0)
        or (t.from_user=f.beneficiary_id and t.to_user=r.referred_id
             and pc.card_instance_id=any(t.requested_card_ids) and cardinality(t.offered_card_ids)=0 and t.offered_karas=0))
      and not exists(select 1 from public.admin_users a where a.user_id=r.referred_id)
      and exists(select 1 from auth.users u where u.id=r.referred_id)
      and not exists(select 1 from public.regular_pack_card_transfers later
        where later.card_instance_id=x.card_instance_id and later.id>x.id and later.to_user_id=r.referred_id)
    order by r.referred_id,t.from_user=f.beneficiary_id desc,x.id
  )
  select coalesce(array_agg(referred_id order by referred_id),'{}'),
    (count(*) filter(where proofs.initiated))::integer into individual,initiated from proofs;
  verdict:=case when cardinality(individual)<3 then 'NEEDS_REVIEW'
    when public.anticheat_runtime_flag_enabled('farm_policy_v1') then 'CONFIRMED' else 'CORROBORATED' end;
  return jsonb_build_object('decision',verdict,'version',revision,'beneficiary',f.beneficiary_id,
    'secondaries',individual,'principalInvolved',initiated>=2,'policy','A_AND_C_DIRECT_V1');
end;
$$;
revoke all on function public.anticheat_farm_enforcement_plan(uuid) from public,anon,authenticated,service_role;

create function public.admin_simulate_anticheat_farm(p_cluster uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare plan jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  plan:=public.anticheat_farm_enforcement_plan(p_cluster);
  if plan ? 'version' then
    plan:=plan||jsonb_build_object('recovery',public.admin_preview_anticheat_farm_recovery(p_cluster));
    insert into public.anticheat_farm_runs(cluster_id,evidence_version,mode,snapshot)
    values(p_cluster,plan->>'version','DRY_RUN',plan) on conflict do nothing;
  end if;
  return plan||jsonb_build_object('mode','DRY_RUN');
end;
$$;
revoke all on function public.admin_simulate_anticheat_farm(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_simulate_anticheat_farm(uuid) to authenticated;

create function public.apply_anticheat_farm_policy(p_cluster uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare plan jsonb; confirmed jsonb; secondary uuid; beneficiary uuid; users uuid[];
  receipt uuid; before_balance integer; audit_id bigint; applied integer:=0;
  warning_ids uuid[]; stamp timestamptz;
begin
  if not public.anticheat_runtime_flag_enabled('farm_policy_v1')
    or public.anticheat_runtime_flag_enabled('automatic_decisions_paused') then return '{}'::jsonb; end if;
  perform 1 from public.anticheat_network_clusters where id=p_cluster for update;
  perform 1 from public.anticheat_farm_evidence where cluster_id=p_cluster for update;
  plan:=public.anticheat_farm_enforcement_plan(p_cluster);
  if plan->>'decision'<>'CONFIRMED' then return plan; end if;
  beneficiary:=(plan->>'beneficiary')::uuid;
  users:=array(select jsonb_array_elements_text(plan->'secondaries')::uuid);
  perform pg_advisory_xact_lock(hashtextextended('farm-principal:'||beneficiary,0));
  if public.anticheat_runtime_flag_enabled('auto_farm_ban') then
    foreach secondary in array users loop
      perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||secondary,0));
      -- Active quarantines need a human resolution first.
      if exists(select 1 from public.anticheat_farm_bans where user_id=secondary)
        or exists(select 1 from public.anticheat_smurf_sanctions where smurf_user_id=secondary)
        or exists(select 1 from public.trade_offers where status='quarantined' and secondary in(from_user,to_user)) then continue; end if;
      -- Use the same auction-first order as economic settlement. All offers
      -- involving the subject are locked before changing the live Auth state.
      perform 1 from public.auctions where status='active' and secondary in(seller_id,buyer_id) order by id for update;
      perform 1 from public.trade_offers where status in('pending','quarantined') and secondary in(from_user,to_user)
        order by id for update;
      perform 1 from auth.users u where id=secondary and
        coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now() for update;
      if not found or exists(select 1 from public.trade_offers where status='quarantined' and secondary in(from_user,to_user)) then continue; end if;
      confirmed:=public.anticheat_farm_enforcement_plan(p_cluster);
      if confirmed is distinct from plan then raise exception 'FARM_EVIDENCE_CHANGED'; end if;
      perform public.apply_account_ban_core(secondary,true,null);
      select id into strict audit_id from public.admin_audit_logs where action='player.ban'
        and metadata->>'target_user_id'=secondary::text order by id desc limit 1;
      update public.trade_offers set status='cancelled',updated_at=clock_timestamp()
        where status='pending' and ((from_user=secondary and to_user=beneficiary)
          or (to_user=secondary and from_user=beneficiary))
        and ((cardinality(offered_card_ids)=0 and offered_karas=0)
          <> (cardinality(requested_card_ids)=0 and requested_karas=0));
      select karas_balance into strict before_balance from public.user_profiles where user_id=secondary;
      -- The account receipt system remains the player-facing source.
      insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
        cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
      values('farm-ban:'||secondary,secondary,'FARM_BAN','AFFILIATE_ABUSE','NONE','NONE',
        0,0,before_balance,before_balance,now(),now(),'APPLIED',jsonb_build_object('action','FARM_BAN','cluster',p_cluster))
      returning id into receipt;
      insert into public.anticheat_farm_bans(user_id,cluster_id,evidence_version,receipt_id,ban_audit_id)
        values(secondary,p_cluster,plan->>'version',receipt,audit_id);
      applied:=applied+1;
    end loop;
  end if;
  if public.anticheat_runtime_flag_enabled('auto_farm_warning') and (plan->>'principalInvolved')::boolean
    and not exists(select 1 from public.anticheat_farm_warnings where cluster_id=p_cluster
      or (user_id=beneficiary and secondary_ids&&users)) then
    select karas_balance into before_balance from public.user_profiles where user_id=beneficiary for update;
    if found then
      insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
        cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
      values('farm-warning:'||p_cluster,beneficiary,'AFFILIATE_ABUSE_WARNING','AFFILIATE_ABUSE','NONE','NONE',
        0,0,before_balance,before_balance,now(),now(),'APPLIED',jsonb_build_object('action','FARM_WARNING','cluster',p_cluster))
      returning id into receipt;
      insert into public.anticheat_farm_warnings values(p_cluster,beneficiary,receipt,users,plan->>'version');
    end if;
  end if;
  if public.anticheat_runtime_flag_enabled('auto_farm_suspension') then
    select array(select w.receipt_id from public.anticheat_farm_warnings w
      join public.account_sanctions a on a.id=w.receipt_id and a.status='APPLIED'
      where w.user_id=beneficiary and not exists(select 1 from public.anticheat_farm_suspensions prior
        where prior.user_id=beneficiary and w.receipt_id=any(prior.warning_receipts))
      order by a.applied_at,a.id limit 3) into warning_ids;
    if cardinality(warning_ids)=3 then
      stamp:=clock_timestamp();
      update auth.users set banned_until=stamp+interval '48 hours',updated_at=stamp where id=beneficiary
        and coalesce(banned_until,'-infinity')<=stamp;
      if found then
        delete from auth.sessions where user_id=beneficiary;
        select karas_balance into strict before_balance from public.user_profiles where user_id=beneficiary;
        insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
          cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
        values('farm-suspension:'||warning_ids[3],beneficiary,'FARM_SUSPENSION','AFFILIATE_ABUSE','NONE','NONE',
          0,0,before_balance,before_balance,stamp,stamp,'APPLIED',jsonb_build_object('endsAt',stamp+interval '48 hours'))
        returning id into receipt;
        insert into public.anticheat_farm_suspensions(user_id,receipt_id,warning_receipts,applied_at,ends_at)
          values(beneficiary,receipt,warning_ids,stamp,stamp+interval '48 hours');
      end if;
    end if;
  end if;
  insert into public.anticheat_farm_runs(cluster_id,evidence_version,mode,snapshot)
    values(p_cluster,plan->>'version','APPLY',plan||jsonb_build_object('bansApplied',applied))
    on conflict do nothing;
  return plan||jsonb_build_object('bansApplied',applied);
end;
$$;
revoke all on function public.apply_anticheat_farm_policy(uuid) from public,anon,authenticated,service_role;

create table public.anticheat_farm_job_progress (
  cluster_id uuid primary key,checked_at timestamptz not null,last_error text,attempts integer not null default 1,
  retries integer not null default 0,last_run_ms double precision not null
);
alter table public.anticheat_farm_job_progress enable row level security;
revoke all on public.anticheat_farm_job_progress from public,anon,authenticated,service_role;
create function public.run_anticheat_farm_policy()
returns integer language plpgsql security definer set search_path='' as $$
declare item record; fault text; processed integer:=0; started timestamptz;
begin
  if not public.anticheat_runtime_flag_enabled('farm_policy_v1')
    or public.anticheat_runtime_flag_enabled('automatic_decisions_paused')
    or not (public.anticheat_runtime_flag_enabled('auto_farm_ban') or public.anticheat_runtime_flag_enabled('auto_farm_warning')
      or public.anticheat_runtime_flag_enabled('auto_farm_suspension'))
    or not pg_try_advisory_xact_lock(hashtext('run-anticheat-farm-policy')) then return 0; end if;
  for item in select f.cluster_id from public.anticheat_farm_evidence f
    left join public.anticheat_farm_job_progress j using(cluster_id)
    where f.decision='ECONOMICALLY_CONFIRMED' and f.evaluated_at>=now()-interval '30 minutes'
      and (j.checked_at is null or j.checked_at<now()-interval '5 minutes')
    order by j.checked_at nulls first,f.cluster_id limit 5
  loop
    fault:=null;
    started:=clock_timestamp();
    begin
      perform public.apply_anticheat_farm_policy(item.cluster_id);
    exception when others then
      fault:=sqlstate;
      raise log 'Anti-cheat enforcement failed for cluster %, SQLSTATE %',item.cluster_id,fault;
    end;
    insert into public.anticheat_farm_job_progress(cluster_id,checked_at,last_error,last_run_ms)
      values(item.cluster_id,clock_timestamp(),fault,extract(epoch from clock_timestamp()-started)*1000)
      on conflict(cluster_id) do update set checked_at=excluded.checked_at,last_error=excluded.last_error,
        last_run_ms=excluded.last_run_ms,
        retries=public.anticheat_farm_job_progress.retries+case when public.anticheat_farm_job_progress.last_error is null then 0 else 1 end,
        attempts=case when excluded.last_error is null then 1 else public.anticheat_farm_job_progress.attempts+1 end;
    processed:=processed+1;
  end loop;
  return processed;
end;
$$;
revoke all on function public.run_anticheat_farm_policy() from public,anon,authenticated,service_role;
select cron.schedule('run-anticheat-farm-policy','4-59/5 * * * *','select public.run_anticheat_farm_policy();');
notify pgrst,'reload schema';
commit;
