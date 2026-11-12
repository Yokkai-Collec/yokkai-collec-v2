begin;
set local lock_timeout='5s';

create table public.anticheat_warning_corrections (
  appeal_id uuid primary key references public.anticheat_sanction_appeals(id) on delete restrict,
  receipt_id uuid not null unique references public.account_sanctions(id) on delete restrict,
  admin_id uuid not null,
  reason text not null check(length(btrim(reason)) between 10 and 1000),
  corrected_at timestamptz not null default clock_timestamp()
);
alter table public.anticheat_warning_corrections enable row level security;
revoke all on public.anticheat_warning_corrections from public,anon,authenticated,service_role;
create trigger anticheat_warning_corrections_immutable before update or delete on public.anticheat_warning_corrections
  for each row execute function public.prevent_anticheat_ledger_mutation();

create function public.admin_void_anticheat_warning(p_appeal uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare receipt public.account_sanctions%rowtype;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then
    raise exception 'INVALID_WARNING_CORRECTION';
  end if;
  select s.* into receipt
    from public.anticheat_sanction_appeals a
    join public.anticheat_sanction_appeal_decisions d on d.appeal_id=a.id and d.outcome='CORRECTION_REQUIRED'
    join public.account_sanctions s on s.id=a.receipt_id and s.user_id=a.user_id
    where a.id=p_appeal and a.receipt_kind='ACCOUNT' and s.published_at is not null
      and s.sanction_type in('AFFILIATE_ABUSE_WARNING','AFFILIATE_ABUSE_NETWORK_WARNING')
      and s.cards_removed=0 and s.kara_removed=0 for update of s;
  if not found then raise exception 'WARNING_NOT_CORRECTABLE'; end if;
  if exists(select 1 from public.anticheat_warning_corrections where appeal_id=p_appeal) then return true; end if;
  if receipt.status<>'APPLIED' then raise exception 'WARNING_NOT_CORRECTABLE'; end if;
  update public.account_sanctions set status='ROLLED_BACK' where id=receipt.id;
  insert into public.anticheat_warning_corrections(appeal_id,receipt_id,admin_id,reason)
    values(p_appeal,receipt.id,auth.uid(),btrim(p_reason));
  return true;
end;
$$;
revoke all on function public.admin_void_anticheat_warning(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_void_anticheat_warning(uuid,text) to authenticated;

do $appeal_list$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.admin_list_anticheat_appeals()'::regprocedure);
  updated:=replace(definition,'''outcome'',d.outcome,''decisionReason'',d.reason)',
    '''outcome'',d.outcome,''decisionReason'',d.reason,
     ''warningVoided'',exists(select 1 from public.anticheat_warning_corrections w where w.appeal_id=a.id),
     ''canVoidWarning'',d.outcome=''CORRECTION_REQUIRED'' and a.receipt_kind=''ACCOUNT''
       and exists(select 1 from public.account_sanctions s where s.id=a.receipt_id and s.user_id=a.user_id
         and s.status=''APPLIED'' and s.published_at is not null
         and s.sanction_type in(''AFFILIATE_ABUSE_WARNING'',''AFFILIATE_ABUSE_NETWORK_WARNING'')
         and s.cards_removed=0 and s.kara_removed=0))');
  if updated=definition then raise exception 'UNEXPECTED_APPEAL_DTO'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.admin_anticheat_workload()'::regprocedure);
  updated:=replace(definition,'''deadlocks'',',
    '''pendingAppeals'',(select count(*) from public.anticheat_sanction_appeals a
       where not exists(select 1 from public.anticheat_sanction_appeal_decisions d where d.appeal_id=a.id)),
     ''correctionRequests'',(select count(*) from public.anticheat_sanction_appeal_decisions where outcome=''CORRECTION_REQUIRED''),
     ''recoveredPacks'',(select coalesce(sum(packs),0) from public.anticheat_reward_pack_recoveries),
     ''deadlocks'',');
  if updated=definition then raise exception 'UNEXPECTED_WORKLOAD_DTO'; end if;
  execute updated;
end
$appeal_list$;
notify pgrst,'reload schema';
commit;
