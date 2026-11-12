begin;
set local lock_timeout='5s';

-- Report the exact blocking dossiers. A reviewer closes them separately and
-- regenerates the sanction preview; a sanction never silently releases a hold.
create function public.with_anticheat_sanction_hold_conflicts(p_preview jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  payer uuid:=(p_preview#>>'{primary,userId}')::uuid;
  planned_debit bigint:=coalesce((p_preview#>>'{recovery,karas}')::bigint,0);
  balance bigint:=coalesce((p_preview#>>'{primary,karasBalance}')::bigint,0);
  conflicts jsonb;
begin
  with reserved_cards as (
    select h.quarantine_id,count(*)::integer as cards
    from jsonb_array_elements_text(coalesce(p_preview#>'{recovery,cardIds}','[]')) as asset(id)
    join public.anticheat_trade_card_holds h on h.card_id=asset.id::uuid
    group by h.quarantine_id
  ), reserved_karas as (
    select h.quarantine_id,h.amount
    from public.anticheat_trade_kara_holds h
    where h.user_id=payer and planned_debit>0 and balance-planned_debit<(
      select coalesce(sum(x.amount),0) from public.anticheat_trade_kara_holds x where x.user_id=payer
    )
  ), affected as (
    select coalesce(c.quarantine_id,k.quarantine_id) id,coalesce(c.cards,0) cards,coalesce(k.amount,0) karas
    from reserved_cards c full join reserved_karas k using(quarantine_id)
  )
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') into conflicts from affected a;
  if jsonb_array_length(conflicts)=0 then
    return p_preview #- '{recovery,quarantineConflicts}';
  end if;
  return jsonb_set(
    jsonb_set(p_preview,'{recovery,quarantineConflicts}',conflicts),
    '{eligible}',to_jsonb(false)
  );
end;
$$;
revoke all on function public.with_anticheat_sanction_hold_conflicts(jsonb)
  from public,anon,authenticated,service_role;

-- Preserve current preview tokens, receipts and authorization logic. The
-- unified and deleted paths already hash the recovery object into the token.
do $preview$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.admin_preview_smurf_sanction(uuid,uuid)'::regprocedure);
  updated:=replace(definition,'return result;',
    'return public.with_anticheat_sanction_hold_conflicts(result);');
  if updated=definition then raise exception 'UNEXPECTED_SMURF_PREVIEW'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.admin_preview_sanction(uuid,text,uuid,uuid[])'::regprocedure);
  updated:=replace(definition,'result:=result||jsonb_build_object(''previewToken''',
    'result:=public.with_anticheat_sanction_hold_conflicts(result);
     result:=result||jsonb_build_object(''previewToken''');
  if updated=definition then raise exception 'UNEXPECTED_UNIFIED_PREVIEW'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.admin_preview_deleted_account_sanction(uuid,uuid[])'::regprocedure);
  updated:=replace(definition,'return result||jsonb_build_object(''previewToken''',
    'result:=public.with_anticheat_sanction_hold_conflicts(result);
     return result||jsonb_build_object(''previewToken''');
  if updated=definition then raise exception 'UNEXPECTED_DELETED_PREVIEW'; end if;
  execute updated;
end
$preview$;

notify pgrst,'reload schema';
commit;
