begin;
set local lock_timeout='5s';

create table public.anticheat_sanction_appeals (
  id uuid primary key default gen_random_uuid(),
  receipt_kind text not null check(receipt_kind in('ACCOUNT','SMURF')),
  receipt_id uuid not null,
  user_id uuid not null,
  reason text not null check(length(btrim(reason)) between 10 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  unique(receipt_kind,receipt_id)
);
create table public.anticheat_sanction_appeal_decisions (
  appeal_id uuid primary key references public.anticheat_sanction_appeals(id) on delete restrict,
  reviewer_id uuid not null,
  outcome text not null check(outcome in('UPHELD','CORRECTION_REQUIRED')),
  reason text not null check(length(btrim(reason)) between 10 and 1000),
  decided_at timestamptz not null default clock_timestamp()
);
alter table public.anticheat_sanction_appeals enable row level security;
alter table public.anticheat_sanction_appeal_decisions enable row level security;
revoke all on public.anticheat_sanction_appeals,public.anticheat_sanction_appeal_decisions
  from public,anon,authenticated,service_role;
create trigger anticheat_sanction_appeals_immutable before update or delete on public.anticheat_sanction_appeals
  for each row execute function public.prevent_anticheat_ledger_mutation();
create trigger anticheat_sanction_appeal_decisions_immutable before update or delete on public.anticheat_sanction_appeal_decisions
  for each row execute function public.prevent_anticheat_ledger_mutation();
create index anticheat_sanction_appeals_created_idx on public.anticheat_sanction_appeals(created_at,id);
create index account_sanctions_history_user_idx on public.account_sanctions(user_id,applied_at desc)
  where published_at is not null;

create function public.get_my_anticheat_sanction_history()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid();
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('kind',s.kind,'id',s.id,
      'appliedAt',s.applied_at,'state',s.state,'appealId',a.id,
      'appealStatus',case when a.id is not null then coalesce(d.outcome,'PENDING') end,
      'decisionReason',d.reason) order by s.applied_at desc,s.id),'[]')
    from (
      select * from (
        select 'ACCOUNT' kind,id,applied_at,status state
        from public.account_sanctions where user_id=viewer and published_at is not null
        union all
        select 'SMURF',id,applied_at,'APPLIED' from public.anticheat_smurf_sanctions where smurf_user_id=viewer
      ) receipts order by applied_at desc,id limit 50
    ) s
    left join public.anticheat_sanction_appeals a on a.receipt_id=s.id and a.receipt_kind=s.kind
    left join public.anticheat_sanction_appeal_decisions d on d.appeal_id=a.id
  );
end;
$$;

create function public.submit_my_anticheat_appeal(p_kind text,p_receipt uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); appeal_id uuid;
begin
  perform public.assert_player_not_banned();
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then
    raise exception 'INVALID_APPEAL_REASON';
  end if;
  if not (
    coalesce(p_kind='ACCOUNT',false) and exists(select 1 from public.account_sanctions
      where id=p_receipt and user_id=viewer and published_at is not null and status='APPLIED')
    or coalesce(p_kind='SMURF',false) and exists(select 1 from public.anticheat_smurf_sanctions
      where id=p_receipt and smurf_user_id=viewer)
  ) then raise exception 'SANCTION_NOT_FOUND'; end if;
  insert into public.anticheat_sanction_appeals(receipt_kind,receipt_id,user_id,reason)
    values(p_kind,p_receipt,viewer,btrim(p_reason))
    on conflict(receipt_kind,receipt_id) do nothing returning id into appeal_id;
  if appeal_id is null then
    select id into strict appeal_id from public.anticheat_sanction_appeals
      where receipt_kind=p_kind and receipt_id=p_receipt and user_id=viewer;
  end if;
  return appeal_id;
end;
$$;

create function public.admin_list_anticheat_appeals()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'userId',a.user_id,
    'receiptId',a.receipt_id,'receiptKind',a.receipt_kind,'reason',a.reason,'createdAt',a.created_at,
    'outcome',d.outcome,'decisionReason',d.reason)
    order by (d.outcome is null) desc,a.created_at,a.id),'[]')
    from (
      select appeal.* from public.anticheat_sanction_appeals appeal
      left join public.anticheat_sanction_appeal_decisions decision on decision.appeal_id=appeal.id
      order by (decision.appeal_id is null) desc,appeal.created_at,appeal.id limit 50
    ) a left join public.anticheat_sanction_appeal_decisions d on d.appeal_id=a.id);
end;
$$;

create function public.admin_review_anticheat_appeal(p_id uuid,p_outcome text,p_reason text)
returns text language plpgsql security definer set search_path='' as $$
declare prior text;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_outcome is null or p_outcome not in('UPHELD','CORRECTION_REQUIRED')
    or length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then
    raise exception 'INVALID_APPEAL_DECISION';
  end if;
  perform 1 from public.anticheat_sanction_appeals where id=p_id for update;
  if not found then raise exception 'APPEAL_NOT_FOUND'; end if;
  select outcome into prior from public.anticheat_sanction_appeal_decisions where appeal_id=p_id;
  if found then
    if prior=p_outcome then return prior; end if;
    raise exception 'APPEAL_ALREADY_REVIEWED';
  end if;
  insert into public.anticheat_sanction_appeal_decisions(appeal_id,reviewer_id,outcome,reason)
    values(p_id,auth.uid(),p_outcome,btrim(p_reason));
  return p_outcome;
end;
$$;

revoke all on function public.get_my_anticheat_sanction_history(),
  public.submit_my_anticheat_appeal(text,uuid,text),public.admin_list_anticheat_appeals(),
  public.admin_review_anticheat_appeal(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_my_anticheat_sanction_history(),
  public.submit_my_anticheat_appeal(text,uuid,text),public.admin_list_anticheat_appeals(),
  public.admin_review_anticheat_appeal(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
