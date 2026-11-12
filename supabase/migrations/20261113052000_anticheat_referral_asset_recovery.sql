begin;
set local lock_timeout='5s';

alter table public.anticheat_referral_enforcements add column recovery_incident uuid;
create index anticheat_referral_asset_cases_idx
  on public.anticheat_referral_enforcements(referrer_id,referral_id) where recovery_incident is not null;

alter table public.anticheat_asset_recoveries alter column admin_id drop not null;
alter table public.anticheat_asset_recoveries add column source_trade_id uuid;
alter table public.anticheat_asset_recoveries drop constraint anticheat_asset_recoveries_asset_kind_check;
alter table public.anticheat_asset_recoveries add constraint anticheat_asset_recoveries_asset_kind_check
  check(asset_kind in('CARD','SALE','TRADE') and ((asset_kind='TRADE')=(source_trade_id is not null)));
create index anticheat_asset_recovery_trade_idx
  on public.anticheat_asset_recoveries(source_trade_id) where source_trade_id is not null;

create table public.anticheat_referral_asset_queue (
  incident_id uuid primary key,
  referrer_id uuid not null,
  next_check_at timestamptz not null default clock_timestamp()
);
create index anticheat_referral_asset_queue_due_idx
  on public.anticheat_referral_asset_queue(next_check_at,incident_id);
alter table public.anticheat_referral_asset_queue enable row level security;
revoke all on public.anticheat_referral_asset_queue from public,anon,authenticated,service_role;

do $enqueue$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.apply_anticheat_referral_farm(uuid)'::regprocedure);
  updated:=replace(definition,'referral_packs_removed,applied_at)', 'referral_packs_removed,applied_at,recovery_incident)');
  updated:=replace(updated,'applied_ban,parent_packs,stamp);','applied_ban,parent_packs,stamp,incident);');
  updated:=replace(updated,'  return cardinality(ids);',
    '  insert into public.anticheat_referral_asset_queue(incident_id,referrer_id) values(incident,p_referrer);
  return cardinality(ids);');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_ENFORCEMENT'; end if;
  execute updated;
end
$enqueue$;

-- Share the claim fence with earlier manual recoveries and admin history.
create or replace function public.anticheat_deleted_transfer_available(p_kind text,p_id uuid)
returns boolean language sql stable set search_path='' as $$
  select not exists(select 1 from public.anticheat_deleted_account_claims where kind=p_kind and asset_id=p_id)
    and not exists(select 1 from public.anticheat_deleted_smurf_recovery_items where kind=p_kind and item_id=p_id)
    and not exists(select 1 from public.anticheat_smurf_sanctions s where
      (p_kind='trade' and p_id=any(s.accepted_trade_ids)) or (p_kind='auction' and p_id=any(s.source_auction_ids)))
    and not exists(select 1 from public.anticheat_asset_recoveries r where
      (p_kind='trade' and r.source_trade_id=p_id) or (p_kind='auction' and r.asset_kind='SALE' and r.asset_id=p_id))
$$;

do $legacy_claims$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.guard_anticheat_legacy_recovery_claim()'::regprocedure);
  updated:=replace(definition,'    (r.asset_kind=''SALE'' and (',
    '    (r.source_trade_id is not null and (
      (row_data->>''kind''=''trade'' and r.source_trade_id::text=coalesce(row_data->>''item_id'',row_data->>''asset_id''))
      or coalesce(row_data->''accepted_trade_ids'',row_data->''source_trade_ids'',''[]'') ? r.source_trade_id::text))
    or (r.asset_kind=''SALE'' and (');
  if updated=definition then raise exception 'UNEXPECTED_LEGACY_ASSET_CLAIM_FENCE'; end if;
  execute updated;
end
$legacy_claims$;

create function public.anticheat_referral_sponsor_cards(p_referrer uuid)
returns table(card_instance_id uuid,incident_id uuid)
language sql stable set search_path='' as $$
  select c.card_instance_id,e.recovery_incident
  from public.anticheat_referral_enforcements e
  join public.referral_pack_reward_lots l on l.referral_id=e.referral_id
    and l.referrer_id=p_referrer and l.beneficiary_id=p_referrer and l.beneficiary_role='referrer'
  join public.regular_pack_openings o on o.referral_reward_lot_id=l.id
    and o.referral_id=e.referral_id and o.source='referral_reward' and o.opened_by=p_referrer
  join public.regular_pack_opening_cards c on c.pack_opening_id=o.id and c.original_owner_id=p_referrer
  where e.referrer_id=p_referrer and e.recovery_incident is not null
$$;

create function public.recover_anticheat_referral_sponsor_assets(p_referrer uuid,p_incident uuid)
returns boolean language plpgsql set search_path='' as $$
declare
  item record;
  source_kind text;
  source_id uuid;
  trade_id uuid;
  traded_cards uuid[];
  balance integer;
  held_karas bigint;
  gain integer;
  debit integer;
  cards_removed integer:=0;
  karas_removed bigint:=0;
  karas_unrecovered bigint:=0;
  waiting boolean:=false;
  snapshot jsonb;
  event_id bigint;
begin
  -- Both marketplace and trade settlement take the profile before transferring
  -- the card. Check the live inventory and spendable balance under that lock.
  select p.karas_balance into balance from public.user_profiles p where p.user_id=p_referrer for update;
  if not found then return false; end if;
  select coalesce(sum(h.amount),0) into held_karas from public.anticheat_trade_kara_holds h where h.user_id=p_referrer;

  for item in
    select c.card_instance_id,c.incident_id
    from public.anticheat_referral_sponsor_cards(p_referrer) c
    where not exists(select 1 from public.anticheat_asset_recoveries r where r.card_instance_id=c.card_instance_id)
      and not exists(select 1 from public.anticheat_smurf_sanctions s where c.card_instance_id=any(s.recovered_card_ids))
      and not exists(select 1 from public.anticheat_deleted_smurf_recoveries s where c.card_instance_id=any(s.recovered_card_ids))
      and not exists(select 1 from public.anticheat_deleted_account_sanctions s
        where coalesce(s.recovery->'cardIds','[]') ? c.card_instance_id::text)
    order by c.card_instance_id
  loop
    if exists(select 1 from public.anticheat_asset_recoveries r where r.card_instance_id=item.card_instance_id) then
      continue;
    end if;
    perform 1 from public.user_cards c where c.id=item.card_instance_id and c.user_id=p_referrer for update;
    if found then
      if exists(select 1 from public.auctions a where a.card_instance_id=item.card_instance_id and a.status='active')
        or exists(select 1 from public.anticheat_trade_card_holds h where h.card_id=item.card_instance_id) then
        waiting:=true;
        continue;
      end if;
      delete from public.user_cards c where c.id=item.card_instance_id and c.user_id=p_referrer
        returning to_jsonb(c) into snapshot;
      insert into public.anticheat_asset_recoveries(cluster_id,evidence_version,asset_kind,asset_id,
        card_instance_id,owner_id,card_snapshot,reason)
      values(item.incident_id,'REFERRAL_SHARED_IP','CARD',item.card_instance_id,item.card_instance_id,
        p_referrer,snapshot,'Automatic recovery of a card from a cancelled referral bonus');
      cards_removed:=cards_removed+1;
      continue;
    end if;

    source_kind:=null;
    source_id:=null;
    trade_id:=null;
    traded_cards:=null;
    gain:=0;
    -- Only the latest outgoing edge can describe the current disposal.
    select x.transfer_type,x.auction_id,x.trade_offer_id
      into source_kind,source_id,trade_id
    from public.regular_pack_card_transfers x
    where x.card_instance_id=item.card_instance_id and x.from_user_id=p_referrer
    order by x.occurred_at desc,x.id desc limit 1;
    if source_kind='auction_sale' then
      if not public.anticheat_deleted_transfer_available('auction',source_id) then continue; end if;
      select a.current_price into gain from public.auctions a
      join public.regular_pack_card_transfers x on x.auction_id=a.id and x.card_instance_id=a.card_instance_id
        and x.transfer_type='auction_sale' and x.sale_karas=a.current_price
        and x.from_user_id=a.seller_id and x.to_user_id=a.buyer_id
      where a.id=source_id and a.status='sold' and a.seller_id=p_referrer and a.card_instance_id=item.card_instance_id;
      if not found then continue; end if;
      traded_cards:=array[item.card_instance_id];
    elsif source_kind='trade' then
      if not public.anticheat_deleted_transfer_available('trade',trade_id) then continue; end if;
      select case when t.from_user=p_referrer then t.offered_card_ids else t.requested_card_ids end,
        greatest(0,case when t.from_user=p_referrer then t.requested_karas-t.offered_karas
          else t.offered_karas-t.requested_karas end)
      into traded_cards,gain
      from public.trade_offers t
      join public.regular_pack_card_transfers x on x.trade_offer_id=t.id and x.card_instance_id=item.card_instance_id
        and x.transfer_type='trade' and x.from_user_id=p_referrer
      where t.id=trade_id and t.status='accepted' and (
        (t.from_user=p_referrer and x.to_user_id=t.to_user and item.card_instance_id=any(t.offered_card_ids))
        or (t.to_user=p_referrer and x.to_user_id=t.from_user and item.card_instance_id=any(t.requested_card_ids)));
      if not found then continue; end if;
      if exists(select 1 from unnest(traded_cards) sent(card_id) where not exists(
        select 1 from public.anticheat_referral_sponsor_cards(p_referrer) proof where proof.card_instance_id=sent.card_id
      )) then
        gain:=(gain::bigint*80/100)::integer;
      end if;
      select array_agg(c.card_instance_id order by c.card_instance_id) into traded_cards
      from public.anticheat_referral_sponsor_cards(p_referrer) c
      where c.card_instance_id=any(traded_cards)
        and not exists(select 1 from public.anticheat_asset_recoveries r where r.card_instance_id=c.card_instance_id)
        and not exists(select 1 from public.anticheat_smurf_sanctions s where c.card_instance_id=any(s.recovered_card_ids))
        and not exists(select 1 from public.anticheat_deleted_smurf_recoveries s where c.card_instance_id=any(s.recovered_card_ids))
        and not exists(select 1 from public.anticheat_deleted_account_sanctions s
          where coalesce(s.recovery->'cardIds','[]') ? c.card_instance_id::text)
        and not exists(select 1 from public.user_cards owned where owned.id=c.card_instance_id and owned.user_id=p_referrer)
        and exists(select 1 from public.regular_pack_card_transfers x where x.card_instance_id=c.card_instance_id
          and x.from_user_id=p_referrer and x.trade_offer_id=trade_id
          and x.id=(select latest.id from public.regular_pack_card_transfers latest
            where latest.card_instance_id=c.card_instance_id and latest.from_user_id=p_referrer
            order by latest.occurred_at desc,latest.id desc limit 1));
    else
      continue;
    end if;
    if gain<=0 or not coalesce(item.card_instance_id=any(traded_cards),false) then continue; end if;

    debit:=least(gain,greatest(0,balance-held_karas))::integer;
    if debit>0 then
      update public.user_profiles set karas_balance=karas_balance-debit where user_id=p_referrer;
      balance:=balance-debit;
    end if;
    insert into public.anticheat_asset_recoveries(cluster_id,evidence_version,asset_kind,asset_id,card_instance_id,
      owner_id,recovered_karas,unrecovered_karas,reason,source_trade_id)
    select proof.incident_id,'REFERRAL_SHARED_IP',case source_kind when 'trade' then 'TRADE' else 'SALE' end,
      case source_kind when 'trade' then proof.card_instance_id else source_id end,
      proof.card_instance_id,p_referrer,case when proof.card_instance_id=item.card_instance_id then debit else 0 end,
      case when proof.card_instance_id=item.card_instance_id then gain-debit else 0 end,
      'Automatic recovery of proceeds from a cancelled referral bonus',trade_id
    from public.anticheat_referral_sponsor_cards(p_referrer) proof where proof.card_instance_id=any(traded_cards);
    karas_removed:=karas_removed+debit;
    karas_unrecovered:=karas_unrecovered+gain-debit;
  end loop;

  if (cards_removed>0 or karas_removed>0 or karas_unrecovered>0)
    and public.anticheat_runtime_flag_enabled('discord_alerts_v2') then
    insert into public.anticheat_events(event_type,actor_user_id,subject_id,metadata)
    values('anticheat_operational_alert',p_referrer,gen_random_uuid(),jsonb_build_object('category','REFERRAL_ASSET_RECOVERY',
      'incident',p_incident,'cardsRemoved',cards_removed,'karasRemoved',karas_removed,'karasUnrecovered',karas_unrecovered))
    returning id into event_id;
    insert into public.anticheat_discord_outbox(event_id,payload) values(event_id,'{}');
  end if;
  return waiting;
end;
$$;

create function public.run_anticheat_referral_asset_recovery()
returns integer language plpgsql security definer set search_path='' as $$
declare item record; processed integer:=0;
begin
  if not public.anticheat_runtime_flag_enabled('referral_farm_sanctions')
    or public.anticheat_runtime_flag_enabled('automatic_decisions_paused')
    or not pg_try_advisory_xact_lock(hashtext('run-anticheat-referral-asset-recovery')) then return 0; end if;
  for item in select referrer_id,min(incident_id::text)::uuid as incident_id,array_agg(incident_id) as incidents
    from public.anticheat_referral_asset_queue where next_check_at<=now()
    group by referrer_id order by min(next_check_at),referrer_id limit 25
  loop
    begin
      if public.recover_anticheat_referral_sponsor_assets(item.referrer_id,item.incident_id) then
        update public.anticheat_referral_asset_queue set next_check_at=clock_timestamp()+interval '5 minutes'
          where incident_id=any(item.incidents);
      else
        delete from public.anticheat_referral_asset_queue where incident_id=any(item.incidents);
      end if;
      processed:=processed+1;
    exception when others then
      update public.anticheat_referral_asset_queue set next_check_at=clock_timestamp()+interval '5 minutes'
        where incident_id=any(item.incidents);
      raise log 'Referral asset recovery failed for referrer %, SQLSTATE %',item.referrer_id,sqlstate;
    end;
  end loop;
  return processed;
end;
$$;

do $discord$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.format_anticheat_discord_alert()'::regprocedure);
  updated:=replace(definition,'    if category=''FARM_CONFIRMED'' then',
    '    if category=''REFERRAL_ASSET_RECOVERY'' then
      subject_title:=''Récupération des gains du parrainage'';
      summary:=''Cartes et Karas rattachés aux packs bonus des parrainages sanctionnés.'';
      admin_url:=admin_url||''?user=''||e.actor_user_id;
      fields:=jsonb_build_array(
        jsonb_build_object(''name'',''Parrain'',''value'',public.anticheat_discord_profile(e.actor_user_id)),
        jsonb_build_object(''name'',''Cartes retirées'',''value'',e.metadata->>''cardsRemoved''),
        jsonb_build_object(''name'',''Karas retirés'',''value'',e.metadata->>''karasRemoved''),
        jsonb_build_object(''name'',''Karas non récupérés'',''value'',e.metadata->>''karasUnrecovered''));
    elsif category=''FARM_CONFIRMED'' then');
  if updated=definition then raise exception 'UNEXPECTED_DISCORD_REFERRAL_RECOVERY'; end if;
  execute updated;
end
$discord$;

revoke all on function public.anticheat_referral_sponsor_cards(uuid),
  public.recover_anticheat_referral_sponsor_assets(uuid,uuid),public.run_anticheat_referral_asset_recovery()
  from public,anon,authenticated,service_role;
select cron.schedule('run-anticheat-referral-asset-recovery','* * * * *','select public.run_anticheat_referral_asset_recovery();');

commit;
