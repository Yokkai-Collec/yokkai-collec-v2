begin;
set local lock_timeout='5s';

alter table public.anticheat_quarantines
  add column analysis_outcome text check(analysis_outcome in(
    'CRITICAL_UNRESOLVED','SIGNALS_UNRESOLVED','INSUFFICIENT_EVIDENCE','ANALYSIS_ERROR'
  )),
  add column analysis_retry_at timestamptz,
  add column review_due_at timestamptz;

create function public.reassess_quarantined_trade(
  p_offer public.trade_offers,p_quarantine public.anticheat_quarantines
)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  if p_quarantine.economic_severity='CRITICAL' or p_quarantine.risk_score>=80
    or exists(
      select 1 from public.anticheat_cases c
      where c.user_id in(p_offer.from_user,p_offer.to_user) and c.status='open' and c.risk_score>=80
    ) then
    return 'CRITICAL_UNRESOLVED';
  end if;
  if public.anticheat_trade_needs_review(p_offer) then
    return 'SIGNALS_UNRESOLVED';
  end if;
  -- A missing or expired network observation is not affirmative clearance.
  return 'INSUFFICIENT_EVIDENCE';
end;
$$;
revoke all on function public.reassess_quarantined_trade(public.trade_offers,public.anticheat_quarantines)
  from public,anon,authenticated,service_role;

create or replace function public.expire_active_trade_quarantines()
returns integer language plpgsql security definer set search_path='' as $$
declare
  item record;
  q public.anticheat_quarantines%rowtype;
  offer public.trade_offers%rowtype;
  outcome text;
  failure_code text;
  handled integer:=0;
begin
  if not public.anticheat_runtime_flag_enabled('quarantine_auto_release')
    or public.anticheat_runtime_flag_enabled('automatic_decisions_paused') then return 0; end if;

  for item in
    select entry.id,o.id as offer_id
    from public.anticheat_quarantines entry join public.trade_offers o on o.id=entry.subject_id
    where entry.subject_type='trade' and entry.status in('PENDING_ANALYSIS','AWAITING_REVIEW')
      and entry.expires_at<=now() and o.status='quarantined'
      and (entry.analysis_outcome is null or entry.analysis_retry_at<=now())
    order by coalesce(entry.analysis_retry_at,entry.expires_at),entry.id
    limit 25 for update of o skip locked
  loop
    select * into strict q from public.anticheat_quarantines where id=item.id for update;
    select * into strict offer from public.trade_offers where id=item.offer_id;
    failure_code:=null;
    begin
      outcome:=public.reassess_quarantined_trade(offer,q);
      if outcome is null or outcome not in(
        'CRITICAL_UNRESOLVED','SIGNALS_UNRESOLVED','INSUFFICIENT_EVIDENCE'
      ) then
        raise exception 'UNEXPECTED_QUARANTINE_ANALYSIS_RESULT';
      end if;
    exception when others then
      outcome:='ANALYSIS_ERROR';
      failure_code:=sqlstate;
    end;

    update public.anticheat_quarantines
      set status='AWAITING_REVIEW',analysis_outcome=outcome,
        analysis_retry_at=case when outcome='ANALYSIS_ERROR' and
          (q.review_due_at is null or q.review_due_at>now()) then now()+interval '30 minutes' end,
        review_due_at=coalesce(q.review_due_at,now()+interval '24 hours'),
        updated_at=clock_timestamp(),
        version=version+case when q.analysis_outcome is distinct from outcome then 1 else 0 end
      where id=q.id;

    if q.analysis_outcome is distinct from outcome then
      insert into public.anticheat_quarantine_audit(
        quarantine_id,action,idempotency_key,details
      ) values(
        q.id,case when failure_code is null then 'AWAITING_REVIEW' else 'ACTION_REJECTED' end,
        'deadline-review:'||(q.version+1),
        jsonb_strip_nulls(jsonb_build_object('outcome',outcome,'sqlState',failure_code))
      );
      if failure_code is not null then
        raise log 'Anti-cheat quarantine analysis failed for case %, SQLSTATE %',q.id,failure_code;
      end if;
    end if;
    handled:=handled+1;
  end loop;
  return handled;
end;
$$;

-- The owner change is written before acceptance. Recognize a held offer in
-- both provenance triggers so a release records exactly one exact trade edge.
do $provenance$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.record_referral_pack_card_transfer()'::regprocedure);
  updated:=replace(definition,'t.status=''pending''','t.status in(''pending'',''quarantined'')');
  if updated=definition then raise exception 'UNEXPECTED_PACK_TRANSFER_TRIGGER'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.record_referral_pack_trade()'::regprocedure);
  updated:=replace(definition,'old.status <> ''pending''','old.status not in(''pending'',''quarantined'')');
  if updated=definition then raise exception 'UNEXPECTED_PACK_TRADE_TRIGGER'; end if;
  execute updated;
end
$provenance$;

do $quarantine_dto$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.admin_list_anticheat_quarantines(text,integer,integer)'::regprocedure);
  updated:=replace(definition,'''version'',q.version',
    '''version'',q.version,''analysisOutcome'',q.analysis_outcome,''reviewDueAt'',q.review_due_at');
  if updated=definition then raise exception 'UNEXPECTED_QUARANTINE_DTO'; end if;
  execute updated;
end
$quarantine_dto$;

notify pgrst,'reload schema';
commit;
