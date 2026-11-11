begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
set local check_function_bodies=on;

-- A network observation is a short-lived, salted IP proof and a device
-- observation is a first-party browser-token hash.  Neither value is ever
-- returned to the client or included in a Discord payload.  A trade between
-- two accounts sharing either proof is the actionable signal.
alter table public.anticheat_events drop constraint anticheat_events_event_type_check;
alter table public.anticheat_events add constraint anticheat_events_event_type_check check(event_type in(
  'account_registered','trade_created','trade_accepted','trade_declined','trade_cancelled',
  'auction_created','auction_bid','auction_sold','auction_expired','referral_rewarded',
  'network_identity_shared','trade_shared_network_identity','referral_network_review','referral_network_enforcement',
  'trade_shared_identity','automatic_trade_sanction'
));

-- Each accepted trade can be sanctioned only once. The immutable receipt is
-- deliberately separate from the older manual recovery receipts: this action
-- bans the most recently created account and cancels pending offers, but never
-- moves cards or Karas.
create table public.anticheat_automatic_trade_sanctions (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null unique references public.trade_offers(id) on delete restrict,
  first_user_id uuid not null,
  second_user_id uuid not null,
  primary_user_id uuid not null,
  banned_user_id uuid not null,
  shared_network boolean not null,
  shared_device boolean not null,
  primary_warning_number integer not null check(primary_warning_number>=1),
  primary_suspended_until timestamptz,
  applied_at timestamptz not null default clock_timestamp(),
  check(first_user_id<>second_user_id),
  check(primary_user_id in(first_user_id,second_user_id)),
  check(banned_user_id in(first_user_id,second_user_id)),
  check(primary_user_id<>banned_user_id),
  check(shared_network or shared_device)
);
alter table public.anticheat_automatic_trade_sanctions enable row level security;
revoke all on public.anticheat_automatic_trade_sanctions from public,anon,authenticated,service_role;
create index anticheat_auto_trade_sanctions_user_idx
  on public.anticheat_automatic_trade_sanctions(first_user_id,applied_at desc);
create index anticheat_auto_trade_sanctions_second_user_idx
  on public.anticheat_automatic_trade_sanctions(second_user_id,applied_at desc);
create trigger anticheat_auto_trade_sanctions_immutable
  before update or delete on public.anticheat_automatic_trade_sanctions
  for each row execute function public.prevent_anticheat_ledger_mutation();

create or replace function public.anticheat_reason_weight(p_reason text) returns integer
language sql immutable set search_path='' as $$
  select case p_reason
    when 'ONE_WAY_TRADE_SOURCE' then 3
    when 'ONE_WAY_TRADE_BENEFICIARY' then 12
    when 'TRADE_VALUE_IMBALANCE' then 6
    when 'LARGE_KARA_TRANSFER' then 5
    when 'EXTREME_AUCTION_BID' then 8
    when 'REFERRAL_REWARD_BURST' then 10
    when 'NEW_ACCOUNT_ECONOMIC_ACTIVITY' then 8
    when 'SHARED_NETWORK_IDENTITY' then 3
    when 'TRADE_SHARED_NETWORK_IDENTITY' then 20
    when 'TRADE_SHARED_DEVICE_IDENTITY' then 20
    when 'AUTOMATIC_TRADE_SANCTION' then 100
    else 0
  end
$$;
revoke all on function public.anticheat_reason_weight(text)
  from public,anon,authenticated,service_role;

create or replace function public.anticheat_reason_cap(p_reason text) returns integer
language sql immutable set search_path='' as $$
  select case p_reason
    when 'ONE_WAY_TRADE_SOURCE' then 6
    when 'ONE_WAY_TRADE_BENEFICIARY' then 24
    when 'TRADE_VALUE_IMBALANCE' then 18
    when 'LARGE_KARA_TRANSFER' then 15
    when 'EXTREME_AUCTION_BID' then 16
    when 'REFERRAL_REWARD_BURST' then 20
    when 'NEW_ACCOUNT_ECONOMIC_ACTIVITY' then 16
    when 'SHARED_NETWORK_IDENTITY' then 9
    when 'TRADE_SHARED_NETWORK_IDENTITY' then 60
    when 'TRADE_SHARED_DEVICE_IDENTITY' then 60
    when 'AUTOMATIC_TRADE_SANCTION' then 100
    else 0
  end
$$;
revoke all on function public.anticheat_reason_cap(text)
  from public,anon,authenticated,service_role;

create function public.apply_automatic_trade_sanction(
  p_trade_id uuid,p_first_user_id uuid,p_second_user_id uuid,
  p_shared_network boolean,p_shared_device boolean
) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare
  stamp timestamptz:=clock_timestamp();
  v_primary_user_id uuid;
  v_banned_user_id uuid;
  v_primary_warning_number integer;
  v_primary_suspended_until timestamptz;
  sanction_id uuid;
  sanction_event_id bigint;
begin
  if p_trade_id is null or p_first_user_id is null or p_second_user_id is null
    or p_first_user_id=p_second_user_id
    or not(coalesce(p_shared_network,false) or coalesce(p_shared_device,false)) then
    return false;
  end if;

  -- Never automate action against an operator account.  The linked-trade
  -- signal is still recorded and sent to Discord for a human decision.
  if exists(select 1 from public.admin_users where user_id in(p_first_user_id,p_second_user_id)) then
    return false;
  end if;

  perform 1 from public.trade_offers
    where id=p_trade_id and status='accepted'
      and ((from_user=p_first_user_id and to_user=p_second_user_id)
        or (from_user=p_second_user_id and to_user=p_first_user_id))
    for update;
  if not found then return false; end if;

  -- The later-created account is the automatic-ban target. The deterministic
  -- UUID tie-breaker keeps the action auditable even for legacy rows lacking
  -- an auth created_at value.
  select u.id into v_banned_user_id
  from auth.users u
  where u.id in(p_first_user_id,p_second_user_id)
  order by coalesce((to_jsonb(u)->>'created_at')::timestamptz,'epoch'::timestamptz) desc,u.id desc
  limit 1;
  if v_banned_user_id is null then return false; end if;
  v_primary_user_id:=case when v_banned_user_id=p_first_user_id then p_second_user_id else p_first_user_id end;
  select count(*)::integer+1 into v_primary_warning_number
    from public.anticheat_automatic_trade_sanctions s
    where s.primary_user_id=v_primary_user_id;
  if v_primary_warning_number>=3 then
    v_primary_suspended_until:=stamp+interval '2 days';
  end if;

  insert into public.anticheat_automatic_trade_sanctions(
    trade_id,first_user_id,second_user_id,primary_user_id,banned_user_id,
    shared_network,shared_device,primary_warning_number,primary_suspended_until,applied_at
  ) values(
    p_trade_id,p_first_user_id,p_second_user_id,v_primary_user_id,v_banned_user_id,
    coalesce(p_shared_network,false),coalesce(p_shared_device,false),
    v_primary_warning_number,v_primary_suspended_until,stamp
  ) on conflict(trade_id) do nothing returning id into sanction_id;
  if sanction_id is null then return false; end if;

  -- Ban only the newest account. Pending offers involving either linked
  -- account are stopped without touching cards or Karas from settled trades.
  update auth.users set
    banned_until='infinity'::timestamptz,
    updated_at=stamp
  where id=v_banned_user_id;
  if to_regclass('auth.sessions') is not null then
    delete from auth.sessions where user_id=v_banned_user_id;
  end if;
  if v_primary_suspended_until is not null then
    update auth.users set
      banned_until=case when banned_until is null or banned_until<v_primary_suspended_until
        then v_primary_suspended_until else banned_until end,
      updated_at=stamp
    where id=v_primary_user_id;
    if to_regclass('auth.sessions') is not null then
      delete from auth.sessions where user_id=v_primary_user_id;
    end if;
  end if;
  update public.trade_offers set status='cancelled',updated_at=stamp
    where status='pending' and (from_user in(p_first_user_id,p_second_user_id)
      or to_user in(p_first_user_id,p_second_user_id));

  insert into public.anticheat_events(
    event_type,actor_user_id,counterparty_user_id,subject_id,metadata,occurred_at
  ) values(
    'automatic_trade_sanction',p_first_user_id,p_second_user_id,p_trade_id,
    jsonb_build_object(
      'automatic',true,'sharedNetwork',coalesce(p_shared_network,false),
      'sharedDevice',coalesce(p_shared_device,false),'bannedUserId',v_banned_user_id,
      'primaryWarningNumber',v_primary_warning_number,
      'primarySuspendedUntil',v_primary_suspended_until,
      'sanction',case when v_primary_suspended_until is null
        then 'newest_account_banned' else 'newest_account_banned_primary_suspended' end
    ),stamp
  ) returning id into sanction_event_id;
  insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
    values
      (sanction_event_id,p_first_user_id,100,array['AUTOMATIC_TRADE_SANCTION']),
      (sanction_event_id,p_second_user_id,100,array['AUTOMATIC_TRADE_SANCTION']);
  insert into public.anticheat_cases(
    user_id,risk_score,event_count,reason_codes,first_flagged_at,last_flagged_at,status,updated_at
  ) values
    (p_first_user_id,100,1,array['AUTOMATIC_TRADE_SANCTION'],stamp,stamp,'open',stamp),
    (p_second_user_id,100,1,array['AUTOMATIC_TRADE_SANCTION'],stamp,stamp,'open',stamp)
  on conflict(user_id) do update set
    risk_score=public.anticheat_cases.risk_score+excluded.risk_score,
    event_count=public.anticheat_cases.event_count+1,
    reason_codes=(select coalesce(array_agg(distinct reason order by reason),'{}'::text[])
      from unnest(public.anticheat_cases.reason_codes||excluded.reason_codes) reason),
    last_flagged_at=excluded.last_flagged_at,status='open',reviewed_at=null,reviewed_by=null,updated_at=stamp;
  return true;
end; $$;
revoke all on function public.apply_automatic_trade_sanction(uuid,uuid,uuid,boolean,boolean)
  from public,anon,authenticated,service_role;

-- Replace the former IP-only observation trigger with one immutable event that
-- records which short-lived proofs matched.  A single trade yields one signal
-- and at most one automatic sanction, even when both proofs match.
drop trigger if exists capture_trade_network_anticheat_event on public.trade_offers;
create or replace function public.capture_trade_network_anticheat_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  stamp timestamptz:=clock_timestamp();
  shared_network boolean:=false;
  shared_device boolean:=false;
  event_id bigint;
  reasons text[]:='{}';
begin
  if old.status is not distinct from new.status or new.status<>'accepted' then return new; end if;
  select exists(
    select 1 from public.anticheat_network_observations source
    join public.anticheat_network_observations recipient
      on recipient.network_identity=source.network_identity
    where source.user_id=new.from_user and recipient.user_id=new.to_user
      and source.last_seen_at>=stamp-interval '7 days'
      and recipient.last_seen_at>=stamp-interval '7 days'
  ) into shared_network;
  select exists(
    select 1 from public.anticheat_device_observations source
    join public.anticheat_device_observations recipient
      on recipient.device_identity=source.device_identity
    where source.user_id=new.from_user and recipient.user_id=new.to_user
      and source.last_seen_at>=stamp-interval '7 days'
      and recipient.last_seen_at>=stamp-interval '7 days'
  ) into shared_device;
  if not(shared_network or shared_device) then return new; end if;
  if shared_network then reasons:=array_append(reasons,'TRADE_SHARED_NETWORK_IDENTITY'); end if;
  if shared_device then reasons:=array_append(reasons,'TRADE_SHARED_DEVICE_IDENTITY'); end if;

  insert into public.anticheat_events(
    event_type,actor_user_id,counterparty_user_id,subject_id,metadata,occurred_at
  ) values(
    'trade_shared_identity',new.from_user,new.to_user,new.id,
    jsonb_build_object('retentionDays',7,'sharedNetwork',shared_network,'sharedDevice',shared_device),stamp
  ) on conflict do nothing returning id into event_id;
  if event_id is not null then
    insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes)
      values(event_id,new.from_user,40,reasons),(event_id,new.to_user,40,reasons);
    insert into public.anticheat_cases(
      user_id,risk_score,event_count,reason_codes,first_flagged_at,last_flagged_at,status,updated_at
    ) values
      (new.from_user,40,1,reasons,stamp,stamp,'open',stamp),
      (new.to_user,40,1,reasons,stamp,stamp,'open',stamp)
    on conflict(user_id) do update set
      risk_score=public.anticheat_cases.risk_score+excluded.risk_score,
      event_count=public.anticheat_cases.event_count+1,
      reason_codes=(select coalesce(array_agg(distinct reason order by reason),'{}'::text[])
        from unnest(public.anticheat_cases.reason_codes||excluded.reason_codes) reason),
      last_flagged_at=excluded.last_flagged_at,status='open',reviewed_at=null,reviewed_by=null,updated_at=stamp;
  end if;
  perform public.apply_automatic_trade_sanction(
    new.id,new.from_user,new.to_user,shared_network,shared_device
  );
  return new;
end; $$;
revoke all on function public.capture_trade_network_anticheat_event()
  from public,anon,authenticated,service_role;
create unique index anticheat_events_shared_identity_trade_unique
  on public.anticheat_events(subject_id) where event_type='trade_shared_identity';
create trigger capture_trade_network_anticheat_event
  after update of status on public.trade_offers
  for each row execute function public.capture_trade_network_anticheat_event();

-- Discord is intentionally quiet for value imbalances, one-way trades and
-- every other generic risk signal.  It receives only an account-link trade
-- alert and the (separate) automatic-sanction receipt that follows it.
create or replace function public.queue_anticheat_discord_alert() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_row public.anticheat_events%rowtype; actor_name text; counterparty_name text;
  link_evidence text; sanction_evidence text; alert_payload jsonb;
begin
  if new.risk_points<=0 then return new; end if;
  select * into event_row from public.anticheat_events where id=new.event_id;
  if not found or event_row.event_type not in('trade_shared_identity','automatic_trade_sanction') then
    return new;
  end if;
  select coalesce(p.pseudo,'Joueur') into actor_name from public.user_profiles p where p.user_id=event_row.actor_user_id;
  select coalesce(p.pseudo,'Joueur') into counterparty_name from public.user_profiles p where p.user_id=event_row.counterparty_user_id;
  link_evidence:=array_to_string(array_remove(array[
    case when coalesce((event_row.metadata->>'sharedNetwork')::boolean,false) then 'même IP' end,
    case when coalesce((event_row.metadata->>'sharedDevice')::boolean,false) then 'même appareil' end
  ],null), ' · ');
  sanction_evidence:=format('Compte le plus récent banni définitivement · avertissement #%s%s',
    coalesce(event_row.metadata->>'primaryWarningNumber','1'),
    case when event_row.metadata->>'primarySuspendedUntil' is not null
      then ' · compte principal suspendu 48 h' else '' end);
  alert_payload:=jsonb_build_object(
    'allowed_mentions',jsonb_build_object('parse','{}'::text[]),
    'embeds',jsonb_build_array(jsonb_build_object(
      'title',case when event_row.event_type='automatic_trade_sanction'
        then 'Yokkai · sanction automatique appliquée'
        else 'Yokkai · échange entre comptes liés détecté' end,
      'description',format('%s ↔ %s',coalesce(actor_name,'Joueur'),coalesce(counterparty_name,'Joueur')),
      'color',case when event_row.event_type='automatic_trade_sanction' then 15158332 else 16744192 end,
      'fields',jsonb_build_array(
        jsonb_build_object('name','Détection','value',coalesce(link_evidence,'compte lié'),'inline',false),
        jsonb_build_object('name',case when event_row.event_type='automatic_trade_sanction' then 'Sanction' else 'Échange' end,
          'value',case when event_row.event_type='automatic_trade_sanction'
            then sanction_evidence else format('Échange #%s',event_row.subject_id) end,'inline',false)
      ),
      'timestamp',event_row.occurred_at
    ))
  );
  insert into public.anticheat_discord_outbox(event_id,payload)
    values(new.event_id,alert_payload)
  on conflict(event_id) do update set payload=excluded.payload
    where public.anticheat_discord_outbox.dispatched_at is null;
  return new;
end; $$;
revoke all on function public.queue_anticheat_discord_alert()
  from public,anon,authenticated,service_role;

-- Keep the bounded admin event filter aligned with the two new immutable
-- records without replacing its later account-status enrichments.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.admin_list_anticheat_events(uuid,text,integer,integer)'::regprocedure);
  if position('''network_identity_shared'',''trade_shared_network_identity'',''referral_network_review'',''referral_network_enforcement''' in definition)=0 then
    raise exception 'ANTICHEAT_EVENT_FILTER_PATCH_MISMATCH';
  end if;
  definition:=replace(
    definition,
    '''network_identity_shared'',''trade_shared_network_identity'',''referral_network_review'',''referral_network_enforcement''',
    '''network_identity_shared'',''trade_shared_network_identity'',''trade_shared_identity'',''automatic_trade_sanction'',''referral_network_review'',''referral_network_enforcement'''
  );
  execute definition;
end $$;

notify pgrst,'reload schema';
commit;
