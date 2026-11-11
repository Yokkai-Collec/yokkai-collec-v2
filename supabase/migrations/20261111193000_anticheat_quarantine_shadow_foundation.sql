begin;
set local lock_timeout='5s';

-- This is an additive, disabled-by-default foundation. It deliberately does
-- not reserve an asset, change an offer state, or apply a sanction. A future
-- reviewed migration will insert a pre-settlement admission decision into
-- respond_trade_offer before any card or Kara mutation.
create table public.anticheat_runtime_flags (
  flag text primary key check(flag in (
    'discord_alerts_v2',
    'graph_detection_v2',
    'risk_score_v2_shadow',
    'quarantine_shadow',
    'quarantine_enforcement',
    'advanced_recovery',
    'automatic_sanctions'
  )),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb check(jsonb_typeof(config)='object'),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid
);
alter table public.anticheat_runtime_flags enable row level security;
revoke all on public.anticheat_runtime_flags from public,anon,authenticated,service_role;
insert into public.anticheat_runtime_flags(flag) values
  ('discord_alerts_v2'),('graph_detection_v2'),('risk_score_v2_shadow'),
  ('quarantine_shadow'),('quarantine_enforcement'),('advanced_recovery'),
  ('automatic_sanctions');

create table public.anticheat_quarantines (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check(subject_type in ('trade','auction','kara_transfer','referral')),
  subject_id uuid not null,
  status text not null check(status in ('SHADOW','PENDING_ANALYSIS','AWAITING_REVIEW','RELEASED','CANCELLED','EXPIRED')),
  sender_user_id uuid,
  recipient_user_id uuid,
  case_user_id uuid,
  risk_score integer not null default 0 check(risk_score>=0 and risk_score<=100000),
  evidence_confidence text not null check(evidence_confidence in ('LOW','CORROBORATED','HIGH','DETERMINISTIC')),
  economic_severity text not null check(economic_severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  reason_codes text[] not null default '{}',
  asset_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(asset_snapshot)='object'),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  terminal_at timestamptz,
  version integer not null default 1 check(version>0),
  check((status in ('RELEASED','CANCELLED','EXPIRED')) = (terminal_at is not null)),
  unique(subject_type,subject_id)
);
alter table public.anticheat_quarantines enable row level security;
revoke all on public.anticheat_quarantines from public,anon,authenticated,service_role;
create index anticheat_quarantines_review_idx
  on public.anticheat_quarantines(status,expires_at,created_at)
  where status in ('PENDING_ANALYSIS','AWAITING_REVIEW');
create index anticheat_quarantines_accounts_idx
  on public.anticheat_quarantines(sender_user_id,recipient_user_id,created_at desc);

create table public.anticheat_quarantine_audit (
  id bigint generated always as identity primary key,
  quarantine_id uuid not null references public.anticheat_quarantines(id) on delete restrict,
  action text not null check(action in ('CREATED_SHADOW','ANALYSIS_QUEUED','AWAITING_REVIEW','RELEASED','CANCELLED','EXPIRED','ADMIN_REVIEWED','ACTION_REJECTED')),
  actor_user_id uuid,
  idempotency_key text not null,
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  created_at timestamptz not null default clock_timestamp(),
  unique(quarantine_id,idempotency_key)
);
alter table public.anticheat_quarantine_audit enable row level security;
revoke all on public.anticheat_quarantine_audit from public,anon,authenticated,service_role;
revoke all on sequence public.anticheat_quarantine_audit_id_seq from public,anon,authenticated,service_role;
create trigger anticheat_quarantine_audit_immutable
  before update or delete on public.anticheat_quarantine_audit
  for each row execute function public.prevent_anticheat_ledger_mutation();
create index anticheat_quarantine_audit_quarantine_idx
  on public.anticheat_quarantine_audit(quarantine_id,created_at,id);

create function public.anticheat_runtime_flag_enabled(p_flag text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select enabled from public.anticheat_runtime_flags where flag=p_flag),false)
$$;
revoke all on function public.anticheat_runtime_flag_enabled(text) from public,anon,authenticated,service_role;

-- The trigger is observation-only and defaults to off. It records only the
-- conclusion (two corroborating signals), never a network HMAC or device hash.
create function public.capture_trade_quarantine_shadow()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  shared_network boolean;
  shared_device boolean;
  quarantine_id uuid;
  severity text;
begin
  if not public.anticheat_runtime_flag_enabled('quarantine_shadow')
    or tg_op<>'UPDATE'
    or old.status='accepted'
    or new.status<>'accepted' then
    return new;
  end if;

  select exists(
    select 1
    from public.anticheat_network_observations a
    join public.anticheat_network_observations b
      on b.network_identity=a.network_identity
     and b.user_id=new.to_user
    where a.user_id=new.from_user
      and a.last_seen_at>=clock_timestamp()-interval '7 days'
      and b.last_seen_at>=clock_timestamp()-interval '7 days'
  ) into shared_network;
  select exists(
    select 1
    from public.anticheat_device_observations a
    join public.anticheat_device_observations b
      on b.device_identity=a.device_identity
     and b.user_id=new.to_user
    where a.user_id=new.from_user
      and a.last_seen_at>=clock_timestamp()-interval '7 days'
      and b.last_seen_at>=clock_timestamp()-interval '7 days'
  ) into shared_device;
  if not (shared_network and shared_device) then return new; end if;

  severity:=case when greatest(new.offered_karas,new.requested_karas)>=5000 then 'HIGH' else 'MEDIUM' end;
  insert into public.anticheat_quarantines(
    subject_type,subject_id,status,sender_user_id,recipient_user_id,case_user_id,
    risk_score,evidence_confidence,economic_severity,reason_codes,asset_snapshot,metadata,expires_at
  ) values (
    'trade',new.id,'SHADOW',new.from_user,new.to_user,new.from_user,
    0,'CORROBORATED',severity,array['SHARED_NETWORK_AND_BROWSER_WITH_ACCEPTED_TRADE'],
    jsonb_build_object('offeredCardIds',new.offered_card_ids,'requestedCardIds',new.requested_card_ids,
      'offeredKaras',new.offered_karas,'requestedKaras',new.requested_karas),
    jsonb_build_object('mode','shadow','retentionDays',7),clock_timestamp()+interval '30 minutes'
  ) on conflict(subject_type,subject_id) do nothing returning id into quarantine_id;
  if quarantine_id is not null then
    insert into public.anticheat_quarantine_audit(quarantine_id,action,idempotency_key,details)
    values(quarantine_id,'CREATED_SHADOW','created:'||new.id::text,
      jsonb_build_object('mode','shadow','reason','corroborated-connection-after-accepted-trade'));
  end if;
  return new;
end;
$$;
revoke all on function public.capture_trade_quarantine_shadow() from public,anon,authenticated,service_role;
create trigger capture_trade_quarantine_shadow
  after update of status on public.trade_offers
  for each row execute function public.capture_trade_quarantine_shadow();

create function public.expire_anticheat_shadow_quarantines()
returns integer language plpgsql security definer set search_path='' as $$
declare item record; affected integer:=0;
begin
  for item in
    select id,version from public.anticheat_quarantines
    where status='SHADOW' and expires_at<=clock_timestamp()
    order by expires_at,id limit 100 for update skip locked
  loop
    update public.anticheat_quarantines
      set status='EXPIRED',terminal_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1
      where id=item.id and status='SHADOW' and version=item.version;
    if found then
      insert into public.anticheat_quarantine_audit(quarantine_id,action,idempotency_key,details)
      values(item.id,'EXPIRED','shadow-expired:'||item.id::text,jsonb_build_object('mode','shadow'))
      on conflict(quarantine_id,idempotency_key) do nothing;
      affected:=affected+1;
    end if;
  end loop;
  return affected;
end;
$$;
revoke all on function public.expire_anticheat_shadow_quarantines() from public,anon,authenticated,service_role;
select cron.schedule('expire-anticheat-shadow-quarantines','*/5 * * * *','select public.expire_anticheat_shadow_quarantines();');

create function public.admin_list_anticheat_quarantines(
  p_status text default '',p_limit integer default 50,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  p_status:=upper(btrim(coalesce(p_status,'')));
  if p_status not in ('','SHADOW','PENDING_ANALYSIS','AWAITING_REVIEW','RELEASED','CANCELLED','EXPIRED') then
    raise exception 'INVALID_QUARANTINE_STATUS' using errcode='P0001';
  end if;
  p_limit:=least(greatest(coalesce(p_limit,50),1),100);
  p_offset:=greatest(coalesce(p_offset,0),0);
  with filtered as materialized (
    select q.*,sender.pseudo sender_pseudo,recipient.pseudo recipient_pseudo
    from public.anticheat_quarantines q
    left join public.user_profiles sender on sender.user_id=q.sender_user_id
    left join public.user_profiles recipient on recipient.user_id=q.recipient_user_id
    where p_status='' or q.status=p_status
  ), page as materialized (
    select * from filtered
    order by case when status='AWAITING_REVIEW' then 0 when status='PENDING_ANALYSIS' then 1 else 2 end,
      expires_at,created_at,id limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',q.id,'subjectType',q.subject_type,'subjectId',q.subject_id,
      'status',q.status,'sender',jsonb_build_object('id',q.sender_user_id,'pseudo',coalesce(q.sender_pseudo,'Deleted player')),
      'recipient',jsonb_build_object('id',q.recipient_user_id,'pseudo',coalesce(q.recipient_pseudo,'Deleted player')),
      'riskScore',q.risk_score,'confidence',q.evidence_confidence,'economicSeverity',q.economic_severity,
      'reasonCodes',q.reason_codes,'createdAt',q.created_at,'expiresAt',q.expires_at,'version',q.version,
      'cardCount',coalesce(jsonb_array_length(q.asset_snapshot->'offeredCardIds'),0)
        +coalesce(jsonb_array_length(q.asset_snapshot->'requestedCardIds'),0),
      'karas',coalesce((q.asset_snapshot->>'offeredKaras')::bigint,0)
        +coalesce((q.asset_snapshot->>'requestedKaras')::bigint,0)
    ) order by case when q.status='AWAITING_REVIEW' then 0 when q.status='PENDING_ANALYSIS' then 1 else 2 end,
      q.expires_at,q.created_at,q.id) from page q),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'awaitingReview',(select count(*) from public.anticheat_quarantines where status='AWAITING_REVIEW')
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_list_anticheat_quarantines(text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_list_anticheat_quarantines(text,integer,integer) to authenticated;

notify pgrst,'reload schema';
commit;
