begin;
set local lock_timeout='5s';

create function public.correct_anticheat_farm_suspension(p_id uuid,p_actor uuid,p_reason text)
returns boolean language plpgsql set search_path='' as $$
declare s public.anticheat_farm_suspensions%rowtype;
begin
  select * into s from public.anticheat_farm_suspensions where id=p_id;
  if not found then return false; end if;
  if exists(select 1 from public.anticheat_farm_restriction_corrections
    where restriction_kind='SUSPENSION' and restriction_id=s.id) then return true; end if;
  update auth.users set banned_until=null,updated_at=clock_timestamp()
    where id=s.user_id and banned_until=s.ends_at;
  if not found then return false; end if;
  update public.account_sanctions set status='ROLLED_BACK' where id=s.receipt_id;
  insert into public.anticheat_farm_restriction_corrections(restriction_kind,restriction_id,actor,reason)
    values('SUSPENSION',s.id,p_actor,p_reason);
  return true;
end;
$$;
revoke all on function public.correct_anticheat_farm_suspension(uuid,uuid,text) from public,anon,authenticated,service_role;

create function public.reassess_suspension_on_warning_correction()
returns trigger language plpgsql set search_path='' as $$
declare item record;
begin
  for item in
    select s.id,s.user_id from public.anticheat_farm_suspensions s
    where s.ends_at>now() and new.receipt_id=any(s.warning_receipts)
  loop
    perform pg_advisory_xact_lock(hashtextextended('farm-principal:'||item.user_id,0));
    if (select count(*) from public.anticheat_farm_warnings w join public.account_sanctions r on r.id=w.receipt_id
      where w.user_id=item.user_id and r.status='APPLIED')<3 then
      perform public.correct_anticheat_farm_suspension(item.id,new.admin_id,'A supporting warning was voided');
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.reassess_suspension_on_warning_correction() from public,anon,authenticated,service_role;
create trigger reassess_farm_suspension after insert on public.anticheat_warning_corrections
  for each row execute function public.reassess_suspension_on_warning_correction();

create function public.admin_restore_anticheat_restriction(p_appeal uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare target public.account_sanctions%rowtype; ban public.anticheat_farm_bans%rowtype;
  suspension uuid; latest_ban_audit bigint;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then raise exception 'INVALID_RESTRICTION_CORRECTION'; end if;
  select s.* into target from public.anticheat_sanction_appeals a
    join public.anticheat_sanction_appeal_decisions d on d.appeal_id=a.id and d.outcome='CORRECTION_REQUIRED'
    join public.account_sanctions s on s.id=a.receipt_id and s.user_id=a.user_id
    where a.id=p_appeal and a.receipt_kind='ACCOUNT' and s.sanction_type in('FARM_BAN','FARM_SUSPENSION');
  if not found then raise exception 'RESTRICTION_NOT_CORRECTABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('farm-principal:'||target.user_id,0));
  if target.sanction_type='FARM_SUSPENSION' then
    select id into strict suspension from public.anticheat_farm_suspensions where receipt_id=target.id;
    if public.correct_anticheat_farm_suspension(suspension,auth.uid(),btrim(p_reason)) then return true; end if;
    raise exception 'RESTRICTION_CHANGED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||target.user_id,0));
  select * into strict ban from public.anticheat_farm_bans where receipt_id=target.id;
  if exists(select 1 from public.anticheat_farm_restriction_corrections
    where restriction_kind='BAN' and restriction_id=target.id) then return true; end if;
  perform 1 from auth.users where id=target.user_id and banned_until='infinity'::timestamptz for update;
  if not found then raise exception 'RESTRICTION_CHANGED'; end if;
  select id into latest_ban_audit from public.admin_audit_logs where action in('player.ban','player.unban')
    and metadata->>'target_user_id'=target.user_id::text order by id desc limit 1;
  if latest_ban_audit is distinct from ban.ban_audit_id then raise exception 'RESTRICTION_CHANGED'; end if;
  perform public.apply_account_ban_core(target.user_id,false,auth.uid());
  update public.account_sanctions set status='ROLLED_BACK' where id=target.id;
  insert into public.anticheat_farm_restriction_corrections(restriction_kind,restriction_id,actor,reason)
    values('BAN',target.id,auth.uid(),btrim(p_reason));
  return true;
end;
$$;
revoke all on function public.admin_restore_anticheat_restriction(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_restore_anticheat_restriction(uuid,text) to authenticated;

-- Operators issue a short-lived bearer capability after verifying the
-- player's identity out of band. No anonymous email or receipt lookup.
create table public.anticheat_appeal_capabilities (
  token_hash bytea primary key,receipt_id uuid not null references public.account_sanctions(id),
  issued_by uuid not null,verification_note text not null,expires_at timestamptz not null,
  consumed_at timestamptz
);
alter table public.anticheat_appeal_capabilities enable row level security;
revoke all on public.anticheat_appeal_capabilities from public,anon,authenticated,service_role;
create index anticheat_appeal_capabilities_receipt_idx on public.anticheat_appeal_capabilities(receipt_id);

create function public.admin_issue_anticheat_appeal_token(p_receipt uuid,p_verified_identity_note text)
returns text language plpgsql security definer set search_path='' as $$
declare token text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if length(btrim(coalesce(p_verified_identity_note,''))) not between 20 and 500 then
    raise exception 'IDENTITY_VERIFICATION_REQUIRED';
  end if;
  perform 1 from public.account_sanctions where id=p_receipt and published_at is not null for update;
  if not found then raise exception 'SANCTION_NOT_FOUND'; end if;
  update public.anticheat_appeal_capabilities set consumed_at=clock_timestamp()
    where receipt_id=p_receipt and consumed_at is null;
  insert into public.anticheat_appeal_capabilities(token_hash,receipt_id,issued_by,verification_note,expires_at)
    values(sha256(convert_to(token,'UTF8')),p_receipt,auth.uid(),btrim(p_verified_identity_note),clock_timestamp()+interval '15 minutes');
  return token;
end;
$$;
revoke all on function public.admin_issue_anticheat_appeal_token(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_issue_anticheat_appeal_token(uuid,text) to authenticated;

create function public.consume_anticheat_appeal_token(p_token text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid; receipt public.account_sanctions%rowtype; result jsonb;
begin
  if p_token is null or p_token!~'^[0-9a-f]{64}$' then raise exception 'INVALID_APPEAL_TOKEN'; end if;
  if p_reason is not null and length(btrim(p_reason)) not between 10 and 1000 then raise exception 'INVALID_APPEAL_REASON'; end if;
  update public.anticheat_appeal_capabilities set consumed_at=clock_timestamp()
    where token_hash=sha256(convert_to(p_token,'UTF8')) and consumed_at is null and expires_at>clock_timestamp()
    returning receipt_id into target;
  if not found then raise exception 'INVALID_APPEAL_TOKEN'; end if;
  select * into strict receipt from public.account_sanctions where id=target;
  if p_reason is not null then
    if receipt.status<>'APPLIED' then raise exception 'SANCTION_NOT_FOUND'; end if;
    insert into public.anticheat_sanction_appeals(receipt_kind,receipt_id,user_id,reason)
      values('ACCOUNT',receipt.id,receipt.user_id,btrim(p_reason)) on conflict(receipt_kind,receipt_id) do nothing;
  end if;
  select jsonb_build_object('type',case when receipt.metadata->>'action'='FARM_WARNING'
    then 'FARM_WARNING' else receipt.sanction_type end,'state',receipt.status,
    'status',case when a.id is not null then coalesce(d.outcome,'PENDING') end,'decisionReason',d.reason)
    into result from (select 1) base
    left join public.anticheat_sanction_appeals a on a.receipt_kind='ACCOUNT' and a.receipt_id=target
    left join public.anticheat_sanction_appeal_decisions d on d.appeal_id=a.id;
  return result;
end;
$$;
revoke all on function public.consume_anticheat_appeal_token(text,text) from public,anon,authenticated,service_role;
grant execute on function public.consume_anticheat_appeal_token(text,text) to anon,authenticated;

do $history$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.get_my_anticheat_sanction_history()'::regprocedure);
  updated:=replace(definition,'''appliedAt'',s.applied_at,',
    '''appliedAt'',s.applied_at,''type'',s.sanction_type,');
  updated:=replace(updated,'applied_at,status state',
    'applied_at,status state,coalesce(metadata->>''action'',sanction_type) sanction_type');
  updated:=replace(updated,'''SMURF'',id,applied_at,''APPLIED''',
    '''SMURF'',id,applied_at,''APPLIED'',''SMURF''');
  if updated=definition or strpos(updated,'s.sanction_type')=0 then raise exception 'UNEXPECTED_SANCTION_HISTORY'; end if;
  execute updated;
  definition:=pg_get_functiondef('public.get_my_pending_sanctions()'::regprocedure);
  updated:=replace(definition,'select s.id,s.sanction_type,s.cards_removed',
    'select s.id,case when s.metadata->>''action''=''FARM_WARNING'' then ''FARM_WARNING'' else s.sanction_type end,s.cards_removed');
  if updated=definition then raise exception 'UNEXPECTED_PENDING_SANCTIONS'; end if;
  execute updated;
end
$history$;
notify pgrst,'reload schema';
commit;
