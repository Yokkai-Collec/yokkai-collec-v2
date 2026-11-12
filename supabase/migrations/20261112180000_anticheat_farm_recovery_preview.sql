begin;
set local lock_timeout='5s';

-- A read-only plan for reward lots explicitly named in a corroborated case.
create function public.admin_preview_anticheat_farm_recovery(p_cluster uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f public.anticheat_farm_evidence%rowtype; plan jsonb; actors uuid[];
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select e.* into f from public.anticheat_farm_evidence e
    join public.anticheat_network_clusters c on c.id=e.cluster_id and c.evaluated_at=e.evaluated_cluster_at
    where e.cluster_id=p_cluster and e.decision='ECONOMICALLY_CONFIRMED';
  if not found then return null; end if;
  actors:=array_prepend(f.beneficiary_id,f.secondary_ids);
  with referrals as materialized (
    select distinct (proof->>'referral')::uuid id
    from jsonb_array_elements(coalesce(f.evidence->'scenarioFindings'->(f.evidence->>'primaryScenario')->'proofs','[]')) proof
    where f.evidence->>'primaryScenario' in('A','C') and proof ? 'referral'
  ), lots as materialized (
    select l.id,l.beneficiary_id,l.remaining_packs,r.id as referral_id
    from referrals picked join public.referrals r on r.id=picked.id and r.referrer_id=f.beneficiary_id
    join public.referral_pack_reward_lots l on l.referral_id=r.id and l.beneficiary_id=any(actors)
  ), cards as materialized (
    select distinct c.card_instance_id,inventory.user_id as holder,
      case when inventory.user_id is null then 'UNAVAILABLE'
        when not inventory.user_id=any(actors) then 'THIRD_PARTY_PROTECTED'
        when inventory.is_locked or exists(select 1 from public.regular_pack_card_transfers e
          where e.card_instance_id=c.card_instance_id and e.transfer_type='auction_sale'
            and e.from_user_id=any(actors)) or exists(select 1 from public.anticheat_trade_card_holds h
          where h.card_id=c.card_instance_id) or exists(select 1 from public.auctions a
          where a.card_instance_id=c.card_instance_id and a.status='active') then 'BLOCKED'
        else 'HELD_BY_INVOLVED_ACCOUNT' end as state
    from lots l join public.regular_pack_openings o on o.referral_id=l.referral_id
      and o.referral_reward_lot_id=l.id and o.source='referral_reward'
    join public.regular_pack_opening_cards c on c.pack_opening_id=o.id
    left join public.user_cards inventory on inventory.id=c.card_instance_id
  ), sales as materialized (
    select distinct a.id,a.seller_id,a.buyer_id,e.card_instance_id,e.sale_karas
    from cards c join public.regular_pack_card_transfers e on e.card_instance_id=c.card_instance_id
      and e.transfer_type='auction_sale' and e.from_user_id=any(actors)
    join public.auctions a on a.id=e.auction_id and a.status='sold'
      and a.seller_id=e.from_user_id and a.buyer_id=e.to_user_id and a.current_price=e.sale_karas
    where not exists(select 1 from public.anticheat_deleted_smurf_recovery_items i
      where i.kind='auction' and i.item_id=a.id)
      and not exists(select 1 from public.anticheat_deleted_account_claims i
        where i.kind='auction' and i.asset_id=a.id)
      and not exists(select 1 from public.anticheat_smurf_sanctions s where a.id=any(s.source_auction_ids))
  ), seller_totals as (
    select s.seller_id,sum(s.sale_karas) credited,
      least(sum(s.sale_karas),greatest(0,coalesce(p.karas_balance,0)-coalesce((
        select sum(h.amount) from public.anticheat_trade_kara_holds h where h.user_id=s.seller_id
      ),0))) possible
    from sales s left join public.user_profiles p on p.user_id=s.seller_id
    group by s.seller_id,p.karas_balance
  )
  select jsonb_build_object(
    'beneficiary',f.beneficiary_id,'secondaries',f.secondary_ids,
    'unusedPacks',(select coalesce(sum(remaining_packs),0) from lots),
    'attributedCards',(select count(*) from cards),
    'protectedCards',(select count(*) from cards where state='THIRD_PARTY_PROTECTED'),
    'availableCards',(select count(*) from cards where state='HELD_BY_INVOLVED_ACCOUNT'),
    'blockedCards',(select count(*) from cards where state='BLOCKED'),
    'creditedKaras',(select coalesce(sum(credited),0) from seller_totals),
    'possibleKaras',(select coalesce(sum(possible),0) from seller_totals),
    'cards',(select coalesce(jsonb_agg(to_jsonb(c) order by c.card_instance_id),'[]') from (
      select * from cards order by card_instance_id limit 100
    ) c),
    'sales',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from (
      select * from sales order by id limit 100
    ) s)
  ) into plan;
  return plan;
end;
$$;
revoke all on function public.admin_preview_anticheat_farm_recovery(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_anticheat_farm_recovery(uuid) to authenticated;

create function public.admin_anticheat_workload()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  return jsonb_build_object(
    'clusters',(select count(*) from public.anticheat_network_clusters),
    'investigated',(select count(*) from public.anticheat_network_clusters where investigation_state='REVIEWED_SIGNALS'),
    'confirmed',(select count(distinct cluster_id) from public.anticheat_farm_reviews where decision='CONFIRMED'),
    'dismissed',(select count(distinct cluster_id) from public.anticheat_farm_reviews where decision='DISMISSED'),
    'activeQuarantines',(select count(*) from public.anticheat_quarantines where status in('PENDING_ANALYSIS','AWAITING_REVIEW')),
    'overdueQuarantines',(select count(*) from public.anticheat_quarantines where status='AWAITING_REVIEW' and review_due_at<=now()),
    'analysisFailures',(select count(*) from public.anticheat_quarantines where status='AWAITING_REVIEW' and analysis_outcome='ANALYSIS_ERROR'),
    'manualSmurfSanctions',(select count(*) from public.anticheat_smurf_sanctions),
    'deadlocks',(select deadlocks from pg_catalog.pg_stat_database where datname=current_database())
  );
end;
$$;
revoke all on function public.admin_anticheat_workload() from public,anon,authenticated,service_role;
grant execute on function public.admin_anticheat_workload() to authenticated;
notify pgrst,'reload schema';
commit;
