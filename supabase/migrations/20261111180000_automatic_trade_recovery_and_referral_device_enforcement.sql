begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
set local check_function_bodies=on;

-- A sanction receipt is immutable.  Keep the exact historical economic scope
-- on it so later signals cannot seize the same trade, card or auction twice.
alter table public.anticheat_automatic_trade_sanctions
  add column accepted_trade_ids uuid[] not null default '{}',
  add column source_auction_ids uuid[] not null default '{}',
  add column recovered_card_ids uuid[] not null default '{}',
  add column unavailable_card_ids uuid[] not null default '{}',
  add column recovered_trade_karas integer not null default 0 check(recovered_trade_karas>=0),
  add column recovered_sale_karas integer not null default 0 check(recovered_sale_karas>=0),
  add column unrecovered_karas integer not null default 0 check(unrecovered_karas>=0),
  add constraint anticheat_auto_trade_recovery_total_check
    check(recovered_trade_karas+recovered_sale_karas+unrecovered_karas>=0);

create table public.anticheat_automatic_trade_recovery_items (
  sanction_id uuid not null references public.anticheat_automatic_trade_sanctions(id) on delete restrict,
  kind text not null check(kind in('trade','auction','card')),
  item_id uuid not null,
  primary key(kind,item_id)
);
alter table public.anticheat_automatic_trade_recovery_items enable row level security;
revoke all on public.anticheat_automatic_trade_recovery_items from public,anon,authenticated,service_role;
create trigger anticheat_auto_trade_recovery_items_immutable
  before update or delete on public.anticheat_automatic_trade_recovery_items
  for each row execute function public.prevent_anticheat_ledger_mutation();

-- The direct-trade sanction unwinds every still-recoverable historical transfer
-- between the pair. Sold cards remain with the innocent auction buyer, but the
-- primary seller's proven sale proceeds are withdrawn. Spent proceeds are
-- recorded rather than guessed or turned into a negative balance.
create or replace function public.apply_automatic_trade_sanction(
  p_trade_id uuid,p_first_user_id uuid,p_second_user_id uuid,
  p_shared_network boolean,p_shared_device boolean
) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare
  stamp timestamptz:=clock_timestamp();
  v_primary_user_id uuid;
  v_banned_user_id uuid;
  v_primary_warning_number integer;
  v_primary_suspended_until timestamptz;
  v_trade_ids uuid[]:='{}';
  v_candidate_card_ids uuid[]:='{}';
  v_recovered_card_ids uuid[]:='{}';
  v_unavailable_card_ids uuid[]:='{}';
  v_sale_ids uuid[]:='{}';
  v_trade_net_karas integer:=0;
  v_primary_to_banned_karas integer:=0;
  v_banned_to_primary_karas integer:=0;
  v_sale_karas integer:=0;
  v_recovered_from_primary integer:=0;
  v_recovered_from_banned integer:=0;
  v_recovered_trade_karas integer:=0;
  v_recovered_sale_karas integer:=0;
  v_unrecovered_karas integer:=0;
  v_primary_balance integer:=0;
  v_banned_balance integer:=0;
  v_active_auction record;
  sanction_id uuid;
  sanction_event_id bigint;
begin
  if p_trade_id is null or p_first_user_id is null or p_second_user_id is null
    or p_first_user_id=p_second_user_id
    or not(coalesce(p_shared_network,false) or coalesce(p_shared_device,false)) then
    return false;
  end if;
  if exists(select 1 from public.admin_users where user_id in(p_first_user_id,p_second_user_id)) then
    return false;
  end if;

  -- A pair lock serializes historical recovery and the immutable warning count.
  perform pg_advisory_xact_lock(hashtextextended(
    'automatic-trade:'||least(p_first_user_id,p_second_user_id)::text||':'||greatest(p_first_user_id,p_second_user_id)::text,0
  ));
  perform 1 from public.trade_offers where id=p_trade_id and status='accepted'
    and ((from_user=p_first_user_id and to_user=p_second_user_id)
      or (from_user=p_second_user_id and to_user=p_first_user_id)) for update;
  if not found or exists(select 1 from public.anticheat_automatic_trade_sanctions where trade_id=p_trade_id) then
    return false;
  end if;

  select u.id into v_banned_user_id from auth.users u
    where u.id in(p_first_user_id,p_second_user_id)
    order by coalesce((to_jsonb(u)->>'created_at')::timestamptz,'epoch'::timestamptz) desc,u.id desc limit 1;
  if v_banned_user_id is null then return false; end if;
  v_primary_user_id:=case when v_banned_user_id=p_first_user_id then p_second_user_id else p_first_user_id end;
  select count(*)::integer+1 into v_primary_warning_number
    from public.anticheat_automatic_trade_sanctions where primary_user_id=v_primary_user_id;
  if v_primary_warning_number>=3 then v_primary_suspended_until:=stamp+interval '2 days'; end if;

  -- Only direct trades not already claimed by an automatic receipt are in scope.
  -- Keep the signed balance: it is the exact amount needed to unwind every
  -- Karas transfer between the two accounts, regardless of its direction.
  select coalesce(array_agg(t.id order by t.updated_at,t.id),'{}'::uuid[]),
    coalesce(sum(case when t.from_user=v_banned_user_id
      then t.offered_karas-t.requested_karas else t.requested_karas-t.offered_karas end),0)::integer
  into v_trade_ids,v_trade_net_karas
  from public.trade_offers t
  where t.status='accepted'
    and ((t.from_user=v_banned_user_id and t.to_user=v_primary_user_id)
      or (t.from_user=v_primary_user_id and t.to_user=v_banned_user_id))
    and not exists(select 1 from public.anticheat_automatic_trade_recovery_items i where i.kind='trade' and i.item_id=t.id);

  v_primary_to_banned_karas:=greatest(v_trade_net_karas,0);
  v_banned_to_primary_karas:=greatest(-v_trade_net_karas,0);

  -- Retain every card transferred by either account. The earliest accepted
  -- transfer identifies its pre-farm owner; cards already back with that owner
  -- need no mutation.
  select coalesce(array_agg(distinct card_id order by card_id),'{}'::uuid[])
    into v_candidate_card_ids
  from public.trade_offers t
    cross join lateral unnest(t.offered_card_ids) offered(card_id)
  where t.id=any(v_trade_ids);

  -- A sale is seized only when the primary sold a card after receiving that
  -- exact card from the banned account. Auction buyers keep their purchase.
  with incoming as (
    select offered.card_id,max(t.updated_at) received_at
    from public.trade_offers t cross join lateral unnest(t.offered_card_ids) offered(card_id)
    where t.id=any(v_trade_ids) and t.from_user=v_banned_user_id and t.to_user=v_primary_user_id
    group by offered.card_id
  )
  select coalesce(array_agg(a.id order by a.created_at,a.id),'{}'::uuid[]),coalesce(sum(a.current_price),0)::integer
    into v_sale_ids,v_sale_karas
  from public.auctions a join incoming i on i.card_id=a.card_instance_id
  where a.status='sold' and a.seller_id=v_primary_user_id and a.created_at>=i.received_at
    and not exists(select 1 from public.anticheat_automatic_trade_recovery_items item where item.kind='auction' and item.item_id=a.id);

  -- Follow the project's economic lock order: auctions/offers, profiles, cards.
  perform 1 from public.auctions where id=any(v_sale_ids) or (status='active' and card_instance_id=any(v_candidate_card_ids)) order by id for update;
  perform 1 from public.trade_offers where id=any(v_trade_ids) or (status='pending' and (from_user in(v_primary_user_id,v_banned_user_id) or to_user in(v_primary_user_id,v_banned_user_id))) order by id for update;
  perform 1 from auth.users where id in(v_primary_user_id,v_banned_user_id) order by id for update;
  perform 1 from public.user_profiles where user_id in(v_primary_user_id,v_banned_user_id)
    or user_id in(select buyer_id from public.auctions where status='active' and card_instance_id=any(v_candidate_card_ids)) order by user_id for update;
  perform 1 from public.user_cards where id=any(v_candidate_card_ids) order by id for update;

  -- Cancel live listings for recoverable cards and return held bidder funds.
  for v_active_auction in select * from public.auctions where status='active' and card_instance_id=any(v_candidate_card_ids) order by id loop
    if v_active_auction.buyer_id is not null then perform public.credit_karas(v_active_auction.buyer_id,v_active_auction.current_price); end if;
    update public.auctions set status='expired',buyer_id=null,current_price=starting_price where id=v_active_auction.id;
  end loop;
  update public.trade_offers set status='cancelled',updated_at=stamp
    where status='pending' and (from_user in(v_primary_user_id,v_banned_user_id) or to_user in(v_primary_user_id,v_banned_user_id));
  update public.user_cards set is_locked=false
    where id=any(v_candidate_card_ids) and user_id in(v_primary_user_id,v_banned_user_id) and is_locked;

  with first_transfers as (
    select distinct on (offered.card_id) offered.card_id,t.from_user
    from public.trade_offers t cross join lateral unnest(t.offered_card_ids) offered(card_id)
    where t.id=any(v_trade_ids)
    order by offered.card_id,t.updated_at,t.id
  )
  select coalesce(array_agg(c.id order by c.id),'{}'::uuid[]) into v_recovered_card_ids
    from public.user_cards c join first_transfers transfer on transfer.card_id=c.id
    where c.user_id in(v_primary_user_id,v_banned_user_id) and c.user_id<>transfer.from_user
      and not exists(select 1 from public.auctions a where a.status='active' and a.card_instance_id=c.id);
  with first_transfers as (
    select distinct on (offered.card_id) offered.card_id,t.from_user
    from public.trade_offers t cross join lateral unnest(t.offered_card_ids) offered(card_id)
    where t.id=any(v_trade_ids)
    order by offered.card_id,t.updated_at,t.id
  )
  select coalesce(array_agg(transfer.card_id order by transfer.card_id),'{}'::uuid[]) into v_unavailable_card_ids
    from first_transfers transfer join public.user_cards c on c.id=transfer.card_id
    where c.user_id not in(v_primary_user_id,v_banned_user_id) and c.user_id<>transfer.from_user;

  select coalesce(karas_balance,0) into v_primary_balance from public.user_profiles where user_id=v_primary_user_id;
  select coalesce(karas_balance,0) into v_banned_balance from public.user_profiles where user_id=v_banned_user_id;
  v_recovered_from_primary:=least(v_primary_balance,v_primary_to_banned_karas+v_sale_karas);
  v_recovered_from_banned:=least(v_banned_balance,v_banned_to_primary_karas);
  v_recovered_trade_karas:=least(v_primary_to_banned_karas,v_recovered_from_primary)+v_recovered_from_banned;
  v_recovered_sale_karas:=least(v_sale_karas,greatest(0,v_recovered_from_primary-v_primary_to_banned_karas));
  v_unrecovered_karas:=v_primary_to_banned_karas+v_sale_karas-v_recovered_from_primary+v_banned_to_primary_karas-v_recovered_from_banned;

  insert into public.anticheat_automatic_trade_sanctions(
    trade_id,first_user_id,second_user_id,primary_user_id,banned_user_id,shared_network,shared_device,
    primary_warning_number,primary_suspended_until,accepted_trade_ids,source_auction_ids,recovered_card_ids,
    unavailable_card_ids,recovered_trade_karas,recovered_sale_karas,unrecovered_karas,applied_at
  ) values(
    p_trade_id,p_first_user_id,p_second_user_id,v_primary_user_id,v_banned_user_id,coalesce(p_shared_network,false),coalesce(p_shared_device,false),
    v_primary_warning_number,v_primary_suspended_until,v_trade_ids,v_sale_ids,v_recovered_card_ids,
    v_unavailable_card_ids,v_recovered_trade_karas,v_recovered_sale_karas,v_unrecovered_karas,stamp
  ) returning id into sanction_id;
  insert into public.anticheat_automatic_trade_recovery_items(sanction_id,kind,item_id)
    select sanction_id,'trade',id from unnest(v_trade_ids) id
    union all select sanction_id,'auction',id from unnest(v_sale_ids) id
    union all select sanction_id,'card',id from unnest(v_recovered_card_ids) id;

  with first_transfers as (
    select distinct on (offered.card_id) offered.card_id,t.from_user
    from public.trade_offers t cross join lateral unnest(t.offered_card_ids) offered(card_id)
    where t.id=any(v_trade_ids)
    order by offered.card_id,t.updated_at,t.id
  )
  update public.user_cards c set user_id=transfer.from_user,folder_id=null,is_first_owner=false,date_obtention=stamp
    from first_transfers transfer
    where c.id=transfer.card_id and c.id=any(v_recovered_card_ids)
      and c.user_id in(v_primary_user_id,v_banned_user_id) and c.user_id<>transfer.from_user;
  if v_recovered_from_primary>0 then
    update public.user_profiles set karas_balance=karas_balance-v_recovered_from_primary where user_id=v_primary_user_id;
    update public.user_profiles set karas_balance=karas_balance+v_recovered_from_primary where user_id=v_banned_user_id;
  end if;
  if v_recovered_from_banned>0 then
    update public.user_profiles set karas_balance=karas_balance-v_recovered_from_banned where user_id=v_banned_user_id;
    update public.user_profiles set karas_balance=karas_balance+v_recovered_from_banned where user_id=v_primary_user_id;
  end if;
  update auth.users set banned_until='infinity'::timestamptz,updated_at=stamp where id=v_banned_user_id;
  if to_regclass('auth.sessions') is not null then delete from auth.sessions where user_id=v_banned_user_id; end if;
  if v_primary_suspended_until is not null then
    update auth.users set banned_until=case when banned_until is null or banned_until<v_primary_suspended_until then v_primary_suspended_until else banned_until end,updated_at=stamp where id=v_primary_user_id;
    if to_regclass('auth.sessions') is not null then delete from auth.sessions where user_id=v_primary_user_id; end if;
  end if;

  insert into public.anticheat_events(event_type,actor_user_id,counterparty_user_id,subject_id,metadata,occurred_at)
    values('automatic_trade_sanction',p_first_user_id,p_second_user_id,p_trade_id,jsonb_build_object(
      'automatic',true,'sharedNetwork',coalesce(p_shared_network,false),'sharedDevice',coalesce(p_shared_device,false),
      'bannedUserId',v_banned_user_id,'primaryWarningNumber',v_primary_warning_number,
      'primarySuspendedUntil',v_primary_suspended_until,'recoveredCards',cardinality(v_recovered_card_ids),
      'unavailableCards',cardinality(v_unavailable_card_ids),'recoveredKaras',v_recovered_from_primary+v_recovered_from_banned,
      'unrecoveredKaras',v_unrecovered_karas,'saleKaras',v_recovered_sale_karas,
      'sanction',case when v_primary_suspended_until is null then 'newest_account_banned' else 'newest_account_banned_primary_suspended' end
    ),stamp) returning id into sanction_event_id;
  insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
    values(sanction_event_id,p_first_user_id,100,array['AUTOMATIC_TRADE_SANCTION']),
      (sanction_event_id,p_second_user_id,100,array['AUTOMATIC_TRADE_SANCTION']);
  insert into public.anticheat_cases(user_id,risk_score,event_count,reason_codes,first_flagged_at,last_flagged_at,status,updated_at)
    values(v_primary_user_id,100,1,array['AUTOMATIC_TRADE_SANCTION'],stamp,stamp,'open',stamp),
      (v_banned_user_id,100,1,array['AUTOMATIC_TRADE_SANCTION'],stamp,stamp,'open',stamp)
  on conflict(user_id) do update set risk_score=public.anticheat_cases.risk_score+excluded.risk_score,event_count=public.anticheat_cases.event_count+1,
    reason_codes=(select coalesce(array_agg(distinct reason order by reason),'{}'::text[]) from unnest(public.anticheat_cases.reason_codes||excluded.reason_codes) reason),
    last_flagged_at=excluded.last_flagged_at,status='open',reviewed_at=null,reviewed_by=null,updated_at=stamp;
  return true;
end;$$;
revoke all on function public.apply_automatic_trade_sanction(uuid,uuid,uuid,boolean,boolean) from public,anon,authenticated,service_role;

-- Four verified referrals on the exact same first-party device are sufficient
-- proof of automated self-referral, even when the attacker rotates IPs.
create function public.enforce_referral_device_cohort() returns trigger
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); referrer uuid; device_users uuid[]; referral_ids uuid[];
  referral record; affected_users uuid[]:='{}'; affected_referrals uuid[]:='{}'; removed_packs integer:=0; event_id bigint; inserted_referral uuid;
begin
  for referrer in
    select distinct r.referrer_id from public.referrals r
    join public.anticheat_device_observations parent on parent.user_id=r.referrer_id and parent.device_identity=new.device_identity and parent.last_seen_at>=stamp-interval '7 days'
    join public.anticheat_device_observations child on child.user_id=r.referred_id and child.device_identity=parent.device_identity and child.last_seen_at>=stamp-interval '7 days'
    join auth.users u on u.id=r.referred_id and u.email_confirmed_at is not null
    where new.user_id in(parent.user_id,child.user_id) and (r.rewarded_at is not null or exists(select 1 from public.anticheat_referral_reward_holds h where h.referral_id=r.id))
  loop
    perform pg_advisory_xact_lock(hashtextextended('referral-device:'||referrer::text||':'||new.device_identity,0));
    select coalesce(array_agg(distinct r.referred_id order by r.referred_id),'{}'::uuid[]),coalesce(array_agg(distinct r.id order by r.id),'{}'::uuid[])
      into device_users,referral_ids from public.referrals r
      join public.anticheat_device_observations parent on parent.user_id=r.referrer_id and parent.device_identity=new.device_identity and parent.last_seen_at>=stamp-interval '7 days'
      join public.anticheat_device_observations child on child.user_id=r.referred_id and child.device_identity=parent.device_identity and child.last_seen_at>=stamp-interval '7 days'
      join auth.users u on u.id=r.referred_id and u.email_confirmed_at is not null
      where r.referrer_id=referrer and (r.rewarded_at is not null or exists(select 1 from public.anticheat_referral_reward_holds h where h.referral_id=r.id));
    if cardinality(device_users)<4 then continue; end if;
    for referral in select r.id,r.referred_id,r.reward_packs from public.referrals r where r.id=any(referral_ids)
      and not exists(select 1 from public.anticheat_referral_enforcements e where e.referral_id=r.id) order by r.id for update loop
      update auth.users set banned_until='infinity'::timestamptz,updated_at=stamp where id=referral.referred_id;
      if found then
        if to_regclass('auth.sessions') is not null then delete from auth.sessions where user_id=referral.referred_id; end if;
        affected_users:=array_append(affected_users,referral.referred_id);
      end if;
      insert into public.anticheat_referral_enforcements(referral_id,referrer_id,referred_id,referred_banned,referral_packs_removed,applied_at)
        values(referral.id,referrer,referral.referred_id,true,0,stamp) on conflict(referral_id) do nothing returning referral_id into inserted_referral;
      if inserted_referral is not null then affected_referrals:=array_append(affected_referrals,referral.id); end if;
      inserted_referral:=null;
    end loop;
    if cardinality(affected_referrals)=0 then continue; end if;
    select least(coalesce(p.bonus_regular_packs,0),coalesce((select sum(r.reward_packs) from public.referrals r where r.id=any(affected_referrals) and r.rewarded_at is not null),0))::integer
      into removed_packs from public.user_profiles p where p.user_id=referrer;
    if removed_packs>0 then update public.user_profiles set bonus_regular_packs=bonus_regular_packs-removed_packs where user_id=referrer; end if;
    delete from public.anticheat_referral_reward_holds where referral_id=any(affected_referrals);
    insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
      values('referral-device-warning:'||referrer::text||':'||md5(new.device_identity),referrer,'AFFILIATE_ABUSE_NETWORK_WARNING','AFFILIATE_ABUSE','NONE','NONE',0,0,
        coalesce((select karas_balance from public.user_profiles where user_id=referrer),0),coalesce((select karas_balance from public.user_profiles where user_id=referrer),0),stamp,stamp,'APPLIED',
        jsonb_build_object('enforcement','shared-device-four-rewarded-referrals','referredCount',cardinality(affected_users),'unusedReferralPacksRemoved',removed_packs)) on conflict(operation_id) do nothing;
    insert into public.anticheat_events(event_type,actor_user_id,occurred_at,metadata)
      values('referral_network_enforcement',referrer,stamp,jsonb_build_object('referralCount',cardinality(affected_users),'unusedReferralPacksRemoved',removed_packs,'identity','device')) returning id into event_id;
    insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
      values(event_id,referrer,60,array['REFERRAL_NETWORK_ENFORCEMENT']) on conflict do nothing;
    insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
      select event_id,user_id,100,array['REFERRAL_NETWORK_ENFORCEMENT'] from unnest(affected_users) user_id on conflict do nothing;
  end loop;
  return new;
end;$$;
revoke all on function public.enforce_referral_device_cohort() from public,anon,authenticated,service_role;
drop trigger if exists enforce_referral_device_cohort on public.anticheat_device_observations;
create trigger enforce_referral_device_cohort after insert or update of last_seen_at on public.anticheat_device_observations
  for each row execute function public.enforce_referral_device_cohort();

-- Discord remains silent for generic risk, but never for automatic sanctions.
create or replace function public.queue_anticheat_discord_alert() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_row public.anticheat_events%rowtype; actor_name text; counterparty_name text; link_evidence text; sanction_evidence text; alert_payload jsonb;
begin
  if new.risk_points<=0 then return new; end if;
  select * into event_row from public.anticheat_events where id=new.event_id;
  if not found or event_row.event_type not in('trade_shared_identity','automatic_trade_sanction','referral_network_enforcement') then return new; end if;
  select coalesce(p.pseudo,'Joueur') into actor_name from public.user_profiles p where p.user_id=event_row.actor_user_id;
  select coalesce(p.pseudo,'Joueur') into counterparty_name from public.user_profiles p where p.user_id=event_row.counterparty_user_id;
  link_evidence:=array_to_string(array_remove(array[case when coalesce((event_row.metadata->>'sharedNetwork')::boolean,false) then 'même IP' end,case when coalesce((event_row.metadata->>'sharedDevice')::boolean,false) then 'même appareil' end],null),' · ');
  sanction_evidence:=case when event_row.event_type='referral_network_enforcement'
    then format('%s filleuls automatisés bloqués · %s pack(s) bonus retiré(s)',coalesce(event_row.metadata->>'referralCount','0'),coalesce(event_row.metadata->>'unusedReferralPacksRemoved','0'))
    else format('Compte le plus récent banni définitivement · avertissement #%s%s · %s Karas récupérés',coalesce(event_row.metadata->>'primaryWarningNumber','1'),case when event_row.metadata->>'primarySuspendedUntil' is not null then ' · compte principal suspendu 48 h' else '' end,coalesce(event_row.metadata->>'recoveredKaras','0')) end;
  alert_payload:=jsonb_build_object('allowed_mentions',jsonb_build_object('parse','{}'::text[]),'embeds',jsonb_build_array(jsonb_build_object(
    'title',case when event_row.event_type='automatic_trade_sanction' then 'Yokkai · sanction automatique appliquée' when event_row.event_type='referral_network_enforcement' then 'Yokkai · fraude au parrainage bloquée' else 'Yokkai · échange entre comptes liés détecté' end,
    'description',case when event_row.event_type='referral_network_enforcement' then coalesce(actor_name,'Joueur') else format('%s ↔ %s',coalesce(actor_name,'Joueur'),coalesce(counterparty_name,'Joueur')) end,
    'color',case when event_row.event_type='trade_shared_identity' then 16744192 else 15158332 end,
    'fields',jsonb_build_array(jsonb_build_object('name',case when event_row.event_type='referral_network_enforcement' then 'Détection' else 'Détection' end,'value',case when event_row.event_type='referral_network_enforcement' then 'cohorte de parrainages sur la même identité d’appareil' else coalesce(link_evidence,'compte lié') end,'inline',false),jsonb_build_object('name',case when event_row.event_type='trade_shared_identity' then 'Échange' else 'Sanction' end,'value',case when event_row.event_type='trade_shared_identity' then format('Échange #%s',event_row.subject_id) else sanction_evidence end,'inline',false)),
    'timestamp',event_row.occurred_at)));
  insert into public.anticheat_discord_outbox(event_id,payload) values(new.event_id,alert_payload)
    on conflict(event_id) do update set payload=excluded.payload where public.anticheat_discord_outbox.dispatched_at is null;
  return new;
end;$$;
revoke all on function public.queue_anticheat_discord_alert() from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
