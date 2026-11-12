begin;
set local lock_timeout='5s';

create table public.anticheat_reward_pack_recoveries (
  lot_id uuid primary key,
  cluster_id uuid not null,
  beneficiary_id uuid not null,
  admin_id uuid not null,
  packs integer not null check(packs>0),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  recovered_at timestamptz not null default clock_timestamp()
);
alter table public.anticheat_reward_pack_recoveries enable row level security;
revoke all on public.anticheat_reward_pack_recoveries from public,anon,authenticated,service_role;
create trigger anticheat_reward_pack_recoveries_immutable
  before update or delete on public.anticheat_reward_pack_recoveries
  for each row execute function public.prevent_anticheat_ledger_mutation();

-- Recover one explicitly confirmed referred-account lot. Legacy enforcement
-- already handles referrer lots; those remain outside this writer.
create function public.admin_recover_anticheat_unused_reward_lot(
  p_cluster uuid,p_version text,p_lot uuid,p_expected_packs integer,p_reason text
)
returns integer language plpgsql security definer set search_path='' as $$
declare f public.anticheat_farm_evidence%rowtype;
  lot public.referral_pack_reward_lots%rowtype;
  bonus integer;
  attributed bigint;
  previous integer;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if not public.anticheat_runtime_flag_enabled('advanced_recovery')
    or public.anticheat_runtime_flag_enabled('automatic_decisions_paused') then
    raise exception 'ADVANCED_RECOVERY_DISABLED';
  end if;
  if coalesce(p_expected_packs,0)<=0 or length(btrim(coalesce(p_reason,''))) not between 10 and 500 then
    raise exception 'INVALID_PACK_RECOVERY';
  end if;
  select e.* into f from public.anticheat_farm_evidence e
    join public.anticheat_network_clusters c on c.id=e.cluster_id and c.evaluated_at=e.evaluated_cluster_at
    where e.cluster_id=p_cluster and e.decision='ECONOMICALLY_CONFIRMED'
    for update of c,e;
  if not found or public.anticheat_farm_evidence_version(f) is distinct from p_version
    or coalesce(f.evidence->>'primaryScenario','') not in('A','C')
    or not exists(select 1 from public.anticheat_farm_reviews r
      where r.cluster_id=p_cluster and r.evidence_version=p_version and r.decision='CONFIRMED') then
    raise exception 'FARM_EVIDENCE_CHANGED';
  end if;
  select * into lot from public.referral_pack_reward_lots where id=p_lot;
  if not found or lot.beneficiary_role<>'referred' or not lot.beneficiary_id=any(f.secondary_ids)
    or lot.referrer_id<>f.beneficiary_id or lot.beneficiary_id<>lot.referred_id
    or not exists(select 1 from jsonb_array_elements(
      f.evidence->'scenarioFindings'->(f.evidence->>'primaryScenario')->'proofs'
    ) proof where proof->>'referral'=lot.referral_id::text
      and proof->>'secondary'=lot.beneficiary_id::text) then
    raise exception 'PACK_LOT_NOT_IN_SCOPE';
  end if;

  -- Pack opening takes these locks in the same order.
  select bonus_regular_packs into bonus from public.user_profiles where user_id=lot.beneficiary_id for update;
  if not found then raise exception 'PACK_OWNER_UNAVAILABLE'; end if;
  select * into strict lot from public.referral_pack_reward_lots where id=p_lot for update;
  select packs into previous from public.anticheat_reward_pack_recoveries
    where lot_id=p_lot and cluster_id=p_cluster;
  if found then return previous; end if;
  if lot.remaining_packs<>p_expected_packs then raise exception 'PACK_LOT_CHANGED'; end if;
  select coalesce(sum(remaining_packs),0)+coalesce((
    select remaining_packs from public.legacy_regular_pack_bonus_balances where user_id=lot.beneficiary_id
  ),0) into attributed
  from public.referral_pack_reward_lots where beneficiary_id=lot.beneficiary_id;
  if bonus<>attributed or bonus<p_expected_packs then raise exception 'PACK_BALANCE_UNRECONCILED'; end if;
  update public.user_profiles set bonus_regular_packs=bonus_regular_packs-p_expected_packs
    where user_id=lot.beneficiary_id;
  update public.referral_pack_reward_lots set remaining_packs=0,removed_packs=removed_packs+p_expected_packs
    where id=p_lot;
  insert into public.anticheat_reward_pack_recoveries(lot_id,cluster_id,beneficiary_id,admin_id,packs,reason)
    values(p_lot,p_cluster,lot.beneficiary_id,auth.uid(),p_expected_packs,btrim(p_reason));
  return p_expected_packs;
end;
$$;
revoke all on function public.admin_recover_anticheat_unused_reward_lot(uuid,text,uuid,integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_recover_anticheat_unused_reward_lot(uuid,text,uuid,integer,text) to authenticated;

do $preview$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.admin_preview_anticheat_farm_recovery(uuid)'::regprocedure);
  updated:=replace(definition,'''unusedPacks'',',
    '''recoveryEnabled'',public.anticheat_runtime_flag_enabled(''advanced_recovery'')
        and not public.anticheat_runtime_flag_enabled(''automatic_decisions_paused''),
     ''referredLots'',(select coalesce(jsonb_agg(jsonb_build_object(
        ''id'',lot.id,''owner'',lot.beneficiary_id,''packs'',lot.remaining_packs
      ) order by lot.id),''[]''::jsonb)
      from lots lot join public.referral_pack_reward_lots l on l.id=lot.id
      where l.beneficiary_role=''referred'' and lot.remaining_packs>0),
     ''unusedPacks'',');
  if updated=definition then raise exception 'UNEXPECTED_FARM_RECOVERY_PREVIEW'; end if;
  execute updated;
end
$preview$;
notify pgrst,'reload schema';
commit;
