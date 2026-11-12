begin;
set local lock_timeout='5s';

create table public.anticheat_asset_compensations (
  id uuid primary key default gen_random_uuid(),appeal_id uuid not null references public.anticheat_sanction_appeals(id),
  asset_kind text not null check(asset_kind in('CARD','SALE','PACK')),
  recovery_id uuid not null,owner_id uuid not null,admin_id uuid not null,
  amount integer not null check(amount>0),reason text not null check(length(btrim(reason)) between 10 and 500),
  created_at timestamptz not null default clock_timestamp(),unique(asset_kind,recovery_id)
);
alter table public.anticheat_asset_compensations enable row level security;
revoke all on public.anticheat_asset_compensations from public,anon,authenticated,service_role;
create trigger anticheat_asset_compensations_immutable before update or delete on public.anticheat_asset_compensations
  for each row execute function public.prevent_anticheat_ledger_mutation();

create table public.anticheat_compensation_proposals (
  id uuid primary key default gen_random_uuid(),appeal_id uuid not null references public.anticheat_sanction_appeals(id),
  asset_kind text not null check(asset_kind in('CARD','SALE','PACK')),recovery_id uuid not null,
  owner_id uuid not null,admin_id uuid not null,amount integer not null check(amount>0),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  created_at timestamptz not null default clock_timestamp(),unique(asset_kind,recovery_id)
);
alter table public.anticheat_compensation_proposals enable row level security;
revoke all on public.anticheat_compensation_proposals from public,anon,authenticated,service_role;
create trigger anticheat_compensation_proposals_immutable before update or delete on public.anticheat_compensation_proposals
  for each row execute function public.prevent_anticheat_ledger_mutation();

create function public.admin_compensate_anticheat_recovery(
  p_appeal uuid,p_kind text,p_recovery uuid,p_reason text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare target record; r public.anticheat_asset_recoveries%rowtype;
  pack public.anticheat_reward_pack_recoveries%rowtype; restored public.user_cards%rowtype;
  prior uuid; result uuid; quantity integer; owner_exists boolean;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if not public.anticheat_runtime_flag_enabled('farm_compensation')
    or public.anticheat_runtime_flag_enabled('automatic_decisions_paused') then raise exception 'COMPENSATION_DISABLED'; end if;
  if p_kind is null or p_kind not in('CARD','SALE','PACK')
    or length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'INVALID_COMPENSATION'; end if;
  select a.user_id,(s.metadata->>'cluster')::uuid cluster_id into target
  from public.anticheat_sanction_appeals a
  join public.anticheat_sanction_appeal_decisions d on d.appeal_id=a.id and d.outcome='CORRECTION_REQUIRED'
  join public.account_sanctions s on s.id=a.receipt_id and s.user_id=a.user_id
  where a.id=p_appeal and a.receipt_kind='ACCOUNT' and s.metadata->>'action' in('FARM_BAN','FARM_WARNING');
  if not found or target.cluster_id is null then raise exception 'COMPENSATION_NOT_APPROVED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('farm-compensation:'||p_kind||':'||p_recovery,0));
  select id into prior from public.anticheat_asset_compensations where asset_kind=p_kind and recovery_id=p_recovery
    and owner_id=target.user_id;
  if found then return prior; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||target.user_id,0));
  perform 1 from public.user_profiles where user_id=target.user_id for update;
  owner_exists:=found;
  -- Authorize the exact original debit before recording a proposal or restoring it.
  if p_kind='PACK' then
    select * into pack from public.anticheat_reward_pack_recoveries where lot_id=p_recovery
      and cluster_id=target.cluster_id and beneficiary_id=target.user_id;
    if not found then raise exception 'COMPENSATION_NOT_APPROVED'; end if;
    quantity:=pack.packs;
  else
    select * into r from public.anticheat_asset_recoveries where id=p_recovery and asset_kind=p_kind
      and cluster_id=target.cluster_id and owner_id=target.user_id;
    if not found then raise exception 'COMPENSATION_NOT_APPROVED'; end if;
    quantity:=case when p_kind='CARD' then 1 else r.recovered_karas end;
  end if;
  begin
  if not owner_exists then raise exception 'COMPENSATION_NEEDS_REVIEW' using errcode='YK001'; end if;
  if p_kind='PACK' then
    update public.referral_pack_reward_lots set remaining_packs=remaining_packs+pack.packs,
      removed_packs=removed_packs-pack.packs where id=pack.lot_id and beneficiary_id=target.user_id
        and removed_packs>=pack.packs;
    if not found then raise exception 'COMPENSATION_NEEDS_REVIEW' using errcode='YK001'; end if;
    update public.user_profiles set bonus_regular_packs=bonus_regular_packs+pack.packs where user_id=target.user_id;
  else
    if p_kind='SALE' then
      perform public.credit_karas(target.user_id,quantity);
    else
      -- Restore the original instance only. Folder/image state may have
      -- changed since recovery and is not reattached.
      if exists(select 1 from public.user_cards where id=r.card_instance_id)
        or not exists(select 1 from public.cards where id=(r.card_snapshot->>'card_id')::uuid) then
        raise exception 'COMPENSATION_NEEDS_REVIEW' using errcode='YK001';
      end if;
      restored:=jsonb_populate_record(null::public.user_cards,r.card_snapshot||
        jsonb_build_object('folder_id',null,'custom_image_url',null,'is_locked',false));
      insert into public.user_cards select restored.*;
    end if;
  end if;
  exception when sqlstate 'YK001' then
    insert into public.anticheat_compensation_proposals(appeal_id,asset_kind,recovery_id,owner_id,admin_id,amount,reason)
      values(p_appeal,p_kind,p_recovery,target.user_id,auth.uid(),quantity,btrim(p_reason))
      on conflict(asset_kind,recovery_id) do nothing;
    select id into strict result from public.anticheat_compensation_proposals
      where asset_kind=p_kind and recovery_id=p_recovery and owner_id=target.user_id;
    return result;
  end;
  insert into public.anticheat_asset_compensations(appeal_id,asset_kind,recovery_id,owner_id,admin_id,amount,reason)
    values(p_appeal,p_kind,p_recovery,target.user_id,auth.uid(),quantity,btrim(p_reason))
    returning id into result;
  return result;
end;
$$;
revoke all on function public.admin_compensate_anticheat_recovery(uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_compensate_anticheat_recovery(uuid,text,uuid,text) to authenticated;

do $appeal_dto$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.admin_list_anticheat_appeals()'::regprocedure);
  updated:=replace(definition,'''outcome'',d.outcome,''decisionReason'',d.reason,',
    '''outcome'',d.outcome,''decisionReason'',d.reason,
     ''restrictionCorrectable'',d.outcome=''CORRECTION_REQUIRED'' and exists(
       select 1 from public.account_sanctions s where a.receipt_kind=''ACCOUNT''
       and s.id=a.receipt_id and s.user_id=a.user_id and s.status=''APPLIED''
       and s.sanction_type in(''FARM_BAN'',''FARM_SUSPENSION'')),
     ''compensations'',case when d.outcome=''CORRECTION_REQUIRED''
       and public.anticheat_runtime_flag_enabled(''farm_compensation'') then (
         select coalesce(jsonb_agg(jsonb_build_object(''kind'',x.kind,''id'',x.id,''amount'',x.amount,
           ''proposed'',exists(select 1 from public.anticheat_compensation_proposals p
             where p.asset_kind=x.kind and p.recovery_id=x.id))),''[]''::jsonb)
         from public.account_sanctions s cross join lateral (
           select r.asset_kind kind,r.id,case when r.asset_kind=''CARD'' then 1 else r.recovered_karas end amount
             from public.anticheat_asset_recoveries r where r.owner_id=a.user_id and r.cluster_id::text=s.metadata->>''cluster''
           union all
           select ''PACK'',p.lot_id,p.packs from public.anticheat_reward_pack_recoveries p
             where p.beneficiary_id=a.user_id and p.cluster_id::text=s.metadata->>''cluster''
         ) x where a.receipt_kind=''ACCOUNT'' and s.id=a.receipt_id and s.user_id=a.user_id
           and not exists(select 1 from public.anticheat_asset_compensations c where c.asset_kind=x.kind and c.recovery_id=x.id)
       ) end,');
  if updated=definition then raise exception 'UNEXPECTED_APPEAL_DTO'; end if;
  execute updated;
end
$appeal_dto$;
notify pgrst,'reload schema';
commit;
