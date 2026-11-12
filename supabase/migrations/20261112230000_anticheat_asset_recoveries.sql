begin;
set local lock_timeout='5s';

create table public.anticheat_asset_recoveries (
  id uuid primary key default gen_random_uuid(), cluster_id uuid not null,
  evidence_version text not null, asset_kind text not null check(asset_kind in('CARD','SALE')),
  asset_id uuid not null, card_instance_id uuid not null unique, owner_id uuid not null,
  recovered_karas integer not null default 0 check(recovered_karas>=0),
  unrecovered_karas integer not null default 0 check(unrecovered_karas>=0),
  card_snapshot jsonb, admin_id uuid not null,
  reason text not null check(length(btrim(reason)) between 10 and 500),
  created_at timestamptz not null default clock_timestamp(),
  unique(asset_kind,asset_id),check((asset_kind='CARD')=(card_snapshot is not null))
);
alter table public.anticheat_asset_recoveries enable row level security;
revoke all on public.anticheat_asset_recoveries from public,anon,authenticated,service_role;
create trigger anticheat_asset_recoveries_immutable before update or delete on public.anticheat_asset_recoveries
  for each row execute function public.prevent_anticheat_ledger_mutation();

-- Existing sanction paths continue to own their existing assets. If their
-- cached preview races with a new recovery, the entire legacy transaction
-- must roll back instead of recording a duplicate claim.
create function public.guard_anticheat_legacy_recovery_claim()
returns trigger language plpgsql set search_path='' as $$
declare row_data jsonb:=to_jsonb(new);
begin
  if exists(select 1 from public.anticheat_asset_recoveries r where
    (r.asset_kind='SALE' and (
      (row_data->>'kind'='auction' and r.asset_id::text=coalesce(row_data->>'item_id',row_data->>'asset_id'))
      or coalesce(row_data->'source_auction_ids','[]') ? r.asset_id::text))
    or coalesce(row_data->'recovered_card_ids',row_data#>'{recovery,cardIds}','[]') ? r.card_instance_id::text
  ) then raise exception 'RECOVERY_ALREADY_CLAIMED'; end if;
  return new;
end;
$$;
revoke all on function public.guard_anticheat_legacy_recovery_claim() from public,anon,authenticated,service_role;
create trigger prevent_duplicate_farm_smurf_recovery before insert on public.anticheat_smurf_sanctions
  for each row execute function public.guard_anticheat_legacy_recovery_claim();
create trigger prevent_duplicate_farm_deleted_items before insert on public.anticheat_deleted_smurf_recovery_items
  for each row execute function public.guard_anticheat_legacy_recovery_claim();
create trigger prevent_duplicate_farm_deleted_receipt before insert on public.anticheat_deleted_smurf_recoveries
  for each row execute function public.guard_anticheat_legacy_recovery_claim();
create trigger prevent_duplicate_farm_deleted_claim before insert on public.anticheat_deleted_account_claims
  for each row execute function public.guard_anticheat_legacy_recovery_claim();
create trigger prevent_duplicate_farm_deleted_account before insert on public.anticheat_deleted_account_sanctions
  for each row execute function public.guard_anticheat_legacy_recovery_claim();

create function public.admin_preview_anticheat_asset_recovery(p_cluster uuid,p_kind text,p_asset uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f public.anticheat_farm_evidence%rowtype; item record; snapshot jsonb;
  actors uuid[]; amount integer:=0; owner_balance integer; eligible boolean;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_kind is null or p_kind not in('CARD','SALE') then raise exception 'INVALID_RECOVERY_KIND'; end if;
  select e.* into f from public.anticheat_farm_evidence e join public.anticheat_network_clusters n
    on n.id=e.cluster_id and n.evaluated_at=e.evaluated_cluster_at
    where e.cluster_id=p_cluster and e.decision='ECONOMICALLY_CONFIRMED'
      and e.evidence->>'primaryScenario' in('A','C');
  if not found then return null; end if;
  actors:=array_prepend(f.beneficiary_id,f.secondary_ids);

  -- The lot and the card instance must be attributable independently of
  -- the current inventory. The sale must match the exact credited amount.
  with known_cards as (
    select distinct c.card_instance_id from jsonb_array_elements(
      f.evidence->'scenarioFindings'->(f.evidence->>'primaryScenario')->'proofs') proof
    join public.referrals r on r.id=(proof->>'referral')::uuid and r.referrer_id=f.beneficiary_id
      and r.referred_id=(proof->>'secondary')::uuid and r.referred_id=any(f.secondary_ids)
    join public.referral_pack_reward_lots l on l.referral_id=r.id and l.beneficiary_id=any(actors)
    join public.regular_pack_openings o on o.referral_reward_lot_id=l.id and o.referral_id=r.id and o.source='referral_reward'
    join public.regular_pack_opening_cards c on c.pack_opening_id=o.id and c.original_owner_id=l.beneficiary_id
  )
  select c.card_instance_id,
    case when p_kind='CARD' then inventory.user_id else a.seller_id end owner_id,
    inventory.user_id holder,a.buyer_id buyer,coalesce(a.current_price,0) credited,
    inventory.is_locked,
    exists(select 1 from public.anticheat_trade_card_holds h where h.card_id=c.card_instance_id) reserved
  into item from known_cards c
  left join public.user_cards inventory on inventory.id=c.card_instance_id
  left join public.regular_pack_card_transfers x on p_kind='SALE' and x.card_instance_id=c.card_instance_id
    and x.transfer_type='auction_sale' and x.auction_id=p_asset
  left join public.auctions a on a.id=x.auction_id and a.status='sold' and a.seller_id=x.from_user_id
    and a.buyer_id=x.to_user_id and a.current_price=x.sale_karas
  where (p_kind='CARD' and c.card_instance_id=p_asset) or (p_kind='SALE' and a.id=p_asset)
  order by x.id limit 1;
  if not found then return null; end if;
  eligible:=coalesce(item.owner_id=any(actors),false)
    and exists(select 1 from public.account_sanctions s where s.user_id=item.owner_id and s.status='APPLIED'
      and s.metadata->>'cluster'=p_cluster::text and s.metadata->>'action' in('FARM_BAN','FARM_WARNING'))
    and not exists(select 1 from public.anticheat_asset_recoveries r where r.card_instance_id=item.card_instance_id)
    and not exists(select 1 from public.anticheat_smurf_sanctions s where item.card_instance_id=any(s.recovered_card_ids))
    and not exists(select 1 from public.anticheat_deleted_smurf_recoveries s where item.card_instance_id=any(s.recovered_card_ids))
    and not exists(select 1 from public.anticheat_deleted_account_sanctions s
      where coalesce(s.recovery->'cardIds','[]') ? item.card_instance_id::text);
  if p_kind='CARD' then
    eligible:=eligible and not coalesce(item.is_locked,true) and not item.reserved
      and not exists(select 1 from public.auctions a where a.card_instance_id=item.card_instance_id and a.status='active')
      and not exists(select 1 from public.regular_pack_card_transfers x where x.card_instance_id=item.card_instance_id
        and x.transfer_type='auction_sale');
  else
    -- Internal cycles need reconciliation. A legitimate external buyer keeps
    -- the card, and the seller's presently spendable balance caps recovery.
    eligible:=eligible and not item.buyer=any(actors) and public.anticheat_deleted_transfer_available('auction',p_asset);
    select karas_balance into owner_balance from public.user_profiles where user_id=item.owner_id;
    amount:=least(item.credited,greatest(0,coalesce(owner_balance,0)-(
      select coalesce(sum(h.amount),0) from public.anticheat_trade_kara_holds h where h.user_id=item.owner_id
    )))::integer;
    eligible:=eligible and amount>0;
  end if;
  snapshot:=jsonb_build_object('cluster',p_cluster,'version',public.anticheat_farm_evidence_version(f),
    'kind',p_kind,'asset',p_asset,'card',item.card_instance_id,'owner',item.owner_id,'holder',item.holder,
    'protectedHolder',item.holder is not null and not item.holder=any(actors),'reserved',item.reserved,
    'credited',item.credited,'recoverable',amount,'unrecoverable',item.credited-amount,
    'eligible',eligible);
  return snapshot||jsonb_build_object('token',md5(snapshot::text),
    'enabled',public.anticheat_runtime_flag_enabled('advanced_recovery')
      and not public.anticheat_runtime_flag_enabled('automatic_decisions_paused'));
end;
$$;

create function public.admin_apply_anticheat_asset_recovery(
  p_cluster uuid,p_kind text,p_asset uuid,p_token text,p_reason text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare plan jsonb; previous uuid; owner uuid; snapshot jsonb; debit integer; receipt uuid;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if not public.anticheat_runtime_flag_enabled('advanced_recovery')
    or public.anticheat_runtime_flag_enabled('automatic_decisions_paused') then raise exception 'ADVANCED_RECOVERY_DISABLED'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'INVALID_RECOVERY_REASON'; end if;
  perform pg_advisory_xact_lock(hashtextextended('farm-asset-recovery:'||p_kind||':'||p_asset,0));
  select id into previous from public.anticheat_asset_recoveries
    where asset_kind=p_kind and asset_id=p_asset and cluster_id=p_cluster;
  if found then return previous; end if;
  perform 1 from public.anticheat_network_clusters where id=p_cluster for update;
  perform 1 from public.anticheat_farm_evidence where cluster_id=p_cluster for update;
  plan:=public.admin_preview_anticheat_asset_recovery(p_cluster,p_kind,p_asset);
  if not coalesce((plan->>'eligible')::boolean,false) or p_token is distinct from plan->>'token' then
    raise exception 'RECOVERY_PREVIEW_CHANGED';
  end if;
  owner:=(plan->>'owner')::uuid;
  if p_kind='SALE' then perform 1 from public.auctions where id=p_asset for update; end if;
  perform 1 from public.user_profiles where user_id=owner for update;
  if p_kind='CARD' then perform 1 from public.user_cards where id=p_asset for update; end if;
  if public.admin_preview_anticheat_asset_recovery(p_cluster,p_kind,p_asset) is distinct from plan then
    raise exception 'RECOVERY_PREVIEW_CHANGED';
  end if;
  debit:=(plan->>'recoverable')::integer;
  if p_kind='CARD' then
    delete from public.user_cards c where id=p_asset and user_id=owner returning to_jsonb(c) into snapshot;
    if not found then raise exception 'RECOVERY_PREVIEW_CHANGED'; end if;
  else
    update public.user_profiles set karas_balance=karas_balance-debit where user_id=owner and karas_balance>=debit;
    if not found then raise exception 'RECOVERY_PREVIEW_CHANGED'; end if;
  end if;
  insert into public.anticheat_asset_recoveries(cluster_id,evidence_version,asset_kind,asset_id,card_instance_id,
    owner_id,recovered_karas,unrecovered_karas,card_snapshot,admin_id,reason)
  values(p_cluster,plan->>'version',p_kind,p_asset,(plan->>'card')::uuid,owner,debit,
    (plan->>'unrecoverable')::integer,snapshot,auth.uid(),btrim(p_reason))
  returning id into receipt;
  return receipt;
end;
$$;
revoke all on function public.admin_preview_anticheat_asset_recovery(uuid,text,uuid),
  public.admin_apply_anticheat_asset_recovery(uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_anticheat_asset_recovery(uuid,text,uuid),
  public.admin_apply_anticheat_asset_recovery(uuid,text,uuid,text,text) to authenticated;
create table public.anticheat_pending_reward_cancellations (
  referral_id uuid primary key references public.anticheat_referral_enforcements(referral_id),
  cluster_id uuid not null,evidence_version text not null,admin_id uuid not null,
  reason text not null check(length(btrim(reason)) between 10 and 500),
  cancelled_at timestamptz not null default clock_timestamp()
);
alter table public.anticheat_pending_reward_cancellations enable row level security;
revoke all on public.anticheat_pending_reward_cancellations from public,anon,authenticated,service_role;
create trigger anticheat_pending_reward_cancellations_immutable before update or delete
  on public.anticheat_pending_reward_cancellations for each row execute function public.prevent_anticheat_ledger_mutation();

-- A pending referral cannot supply proof from a reward that was never granted.
-- Require two distinct direct timed-pack gifts in reviewed scenario B instead.
create function public.anticheat_pending_farm_rewards(p_cluster uuid,p_version text)
returns table(id uuid,recipient uuid,packs integer)
language sql stable security definer set search_path='' as $$
  select r.id,r.referred_id,r.reward_packs
  from public.anticheat_farm_evidence f
  join public.anticheat_network_clusters c on c.id=f.cluster_id and c.evaluated_at=f.evaluated_cluster_at
  join public.anticheat_farm_reviews review on review.cluster_id=f.cluster_id
    and review.evidence_version=p_version and review.decision='CONFIRMED'
  join public.anticheat_referral_reward_holds h on h.referrer_id=f.beneficiary_id
    and h.network_identity=c.network_identity
  join public.referrals r on r.id=h.referral_id and r.referrer_id=f.beneficiary_id
  join public.anticheat_network_observations obs on obs.user_id=r.referred_id and obs.network_identity=c.network_identity
  where f.cluster_id=p_cluster and f.evaluated_at>=now()-interval '30 minutes'
    and public.anticheat_farm_evidence_version(f)=p_version and f.decision='ECONOMICALLY_CONFIRMED'
    and f.evidence#>>'{scenarioFindings,B,beneficiary}'=r.referrer_id::text
    and obs.last_seen_at>=now()-interval '24 hours'
    and r.verified_at is not null and r.rewarded_at is null and r.reward_packs>0
    and not exists(select 1 from public.admin_users a where a.user_id in(r.referrer_id,r.referred_id))
    and not exists(select 1 from public.anticheat_referral_enforcements e where e.referral_id=r.id)
    and (select count(distinct p.id)>=2 and count(distinct x.trade_offer_id)>=2
      from jsonb_array_elements(coalesce(f.evidence#>'{scenarioFindings,B,proofs}','[]')) donor
      cross join lateral jsonb_array_elements(donor) item
      join public.regular_pack_openings p on p.id=(item->>'opening')::uuid
        and p.opened_by=r.referred_id and p.source='timed'
      join public.regular_pack_card_transfers x on x.id=(item->>'edge')::bigint
        and x.card_instance_id=(item->>'card')::uuid and x.from_user_id=r.referred_id and x.to_user_id=r.referrer_id
      join public.trade_offers t on t.id=x.trade_offer_id and t.status='accepted'
      where item->>'secondary'=r.referred_id::text
        and ((t.from_user=r.referred_id and t.to_user=r.referrer_id
             and x.card_instance_id=any(t.offered_card_ids) and cardinality(t.requested_card_ids)=0 and t.requested_karas=0)
          or (t.from_user=r.referrer_id and t.to_user=r.referred_id
             and x.card_instance_id=any(t.requested_card_ids) and cardinality(t.offered_card_ids)=0 and t.offered_karas=0))
        and not exists(select 1 from public.regular_pack_card_transfers later
          where later.card_instance_id=x.card_instance_id and later.id>x.id and later.to_user_id=r.referred_id))
  order by r.id limit 100;
$$;
revoke all on function public.anticheat_pending_farm_rewards(uuid,text) from public,anon,authenticated,service_role;

create function public.admin_cancel_anticheat_pending_reward(p_cluster uuid,p_version text,p_referral uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare pending public.referrals%rowtype;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if not public.anticheat_runtime_flag_enabled('advanced_recovery')
    or public.anticheat_runtime_flag_enabled('automatic_decisions_paused') then raise exception 'ADVANCED_RECOVERY_DISABLED'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'INVALID_RECOVERY_REASON'; end if;
  perform 1 from public.anticheat_network_clusters where id=p_cluster for update;
  perform 1 from public.anticheat_farm_evidence where cluster_id=p_cluster for update;
  select * into pending from public.referrals where id=p_referral for update;
  if exists(select 1 from public.anticheat_pending_reward_cancellations
    where referral_id=p_referral and cluster_id=p_cluster and evidence_version=p_version) then return p_referral; end if;
  if pending.id is null or not exists(select 1 from public.anticheat_pending_farm_rewards(p_cluster,p_version) p
    where p.id=p_referral) then raise exception 'REWARD_PREVIEW_CHANGED'; end if;
  insert into public.anticheat_referral_enforcements(referral_id,referrer_id,referred_id,referred_banned,referral_packs_removed)
    values(pending.id,pending.referrer_id,pending.referred_id,false,0);
  insert into public.anticheat_pending_reward_cancellations(referral_id,cluster_id,evidence_version,admin_id,reason)
    values(p_referral,p_cluster,p_version,auth.uid(),btrim(p_reason));
  delete from public.anticheat_referral_reward_holds where referral_id=p_referral;
  return p_referral;
end;
$$;
revoke all on function public.admin_cancel_anticheat_pending_reward(uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_cancel_anticheat_pending_reward(uuid,text,uuid,text) to authenticated;

do $reward_preview$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.admin_preview_anticheat_farm_recovery(uuid)'::regprocedure);
  updated:=replace(definition,'''unusedPacks'',',
    '''pendingRewards'',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),''[]''::jsonb)
      from public.anticheat_pending_farm_rewards(p_cluster,public.anticheat_farm_evidence_version(f)) x),
     ''unusedPacks'',');
  if updated=definition then raise exception 'UNEXPECTED_PENDING_REWARD_PREVIEW'; end if;
  execute updated;
  definition:=pg_get_functiondef('public.complete_referral_after_verification(uuid,timestamptz)'::regprocedure);
  updated:=replace(definition,'if not found or referral.rewarded_at is not null then return;end if;',
    'if not found or referral.rewarded_at is not null or exists(
      select 1 from public.anticheat_pending_reward_cancellations a where a.referral_id=referral.id
    ) then return;end if;');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_CANCELLATION_GATE'; end if;
  execute updated;
end
$reward_preview$;
notify pgrst,'reload schema';
commit;
