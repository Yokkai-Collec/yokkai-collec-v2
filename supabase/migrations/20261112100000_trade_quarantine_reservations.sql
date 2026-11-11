begin;
set local lock_timeout='5s';

alter table public.trade_offers drop constraint trade_offers_status_check;
alter table public.trade_offers add constraint trade_offers_status_check
  check(status in ('pending','accepted','declined','countered','cancelled','quarantined'));

create table public.anticheat_trade_card_holds (
  card_id uuid primary key,
  quarantine_id uuid not null references public.anticheat_quarantines(id)
);
create index anticheat_trade_card_holds_case_idx
  on public.anticheat_trade_card_holds(quarantine_id);

create table public.anticheat_trade_kara_holds (
  quarantine_id uuid not null references public.anticheat_quarantines(id),
  user_id uuid not null,
  amount integer not null check(amount>0),
  primary key(quarantine_id,user_id)
);
create index anticheat_trade_kara_holds_user_idx
  on public.anticheat_trade_kara_holds(user_id);

alter table public.anticheat_trade_card_holds enable row level security;
alter table public.anticheat_trade_kara_holds enable row level security;
revoke all on public.anticheat_trade_card_holds,public.anticheat_trade_kara_holds
  from public,anon,authenticated,service_role;

-- These guards remain active while any reservations exist, even after admission
-- is disabled. Writers serialize on the inventory/profile row before checking.
create function public.guard_quarantined_trade_card()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.anticheat_trade_card_holds where card_id=old.id) then
    raise exception 'TRADE_CARD_FROZEN' using errcode='P0001';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create trigger guard_quarantined_trade_card_transfer
  before update of user_id,card_id on public.user_cards for each row
  when (old.user_id is distinct from new.user_id or old.card_id is distinct from new.card_id)
  execute function public.guard_quarantined_trade_card();
create trigger guard_quarantined_trade_card_delete
  before delete on public.user_cards for each row
  execute function public.guard_quarantined_trade_card();

create function public.guard_quarantined_trade_listing()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='active' then
    perform 1 from public.user_cards where id=new.card_instance_id for update;
    if exists(select 1 from public.anticheat_trade_card_holds where card_id=new.card_instance_id) then
      raise exception 'TRADE_CARD_FROZEN' using errcode='P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_quarantined_trade_listing
  before insert or update of status,card_instance_id on public.auctions for each row
  execute function public.guard_quarantined_trade_listing();

create function public.guard_quarantined_trade_kara()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.karas_balance < coalesce((
    select sum(amount) from public.anticheat_trade_kara_holds where user_id=old.user_id
  ),0) then
    raise exception 'TRADE_INSUFFICIENT_KARAS' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger guard_quarantined_trade_kara
  before update of karas_balance on public.user_profiles for each row
  when (new.karas_balance<old.karas_balance)
  execute function public.guard_quarantined_trade_kara();

-- Shared network and browser plus a one-way economic transfer warrants review.
-- It does not establish fraud. No automatic punitive verdict uses this rule.
create function public.anticheat_trade_needs_review(p_offer public.trade_offers)
returns boolean language sql stable security definer set search_path='' as $$
  select
    ((cardinality(p_offer.offered_card_ids)=0 and p_offer.offered_karas=0)
     <> (cardinality(p_offer.requested_card_ids)=0 and p_offer.requested_karas=0))
    and exists(
      select 1 from public.anticheat_network_observations a
      join public.anticheat_network_observations b using(network_identity)
      where a.user_id=p_offer.from_user and b.user_id=p_offer.to_user
        and least(a.last_seen_at,b.last_seen_at)>=now()-interval '7 days'
    )
    and exists(
      select 1 from public.anticheat_device_observations a
      join public.anticheat_device_observations b using(device_identity)
      where a.user_id=p_offer.from_user and b.user_id=p_offer.to_user
        and least(a.last_seen_at,b.last_seen_at)>=now()-interval '7 days'
    )
$$;

-- Lock order: offer, then quarantine (for resolution), profiles by ID, cards by ID.
-- Both acceptance paths share ownership, auction and spendable-balance checks.
create function public.anticheat_settle_trade(p_offer public.trade_offers,p_release uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  card_ids uuid[]:=p_offer.offered_card_ids||p_offer.requested_card_ids;
  new_quarantine_id uuid;
  review_minutes integer;
begin
  if public.friendship_state(p_offer.from_user,p_offer.to_user)<>'accepted' then
    raise exception 'FRIENDS_ONLY' using errcode='P0001';
  end if;
  perform 1 from public.user_profiles where user_id in (p_offer.from_user,p_offer.to_user)
    order by user_id for update;
  perform 1 from public.user_cards where id=any(card_ids) order by id for update;

  if exists(select 1 from auth.users u where u.id in (p_offer.from_user,p_offer.to_user)
    and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')>now()) then
    raise exception 'ACCOUNT_BANNED' using errcode='P0001';
  end if;
  if (select count(*) from public.user_cards where user_id=p_offer.from_user and id=any(p_offer.offered_card_ids))
      <>cardinality(p_offer.offered_card_ids)
    or (select count(*) from public.user_cards where user_id=p_offer.to_user and id=any(p_offer.requested_card_ids))
      <>cardinality(p_offer.requested_card_ids) then
    raise exception 'TRADE_CARD_UNAVAILABLE' using errcode='P0001';
  end if;
  if exists(select 1 from public.auctions where status='active' and card_instance_id=any(card_ids))
    or exists(select 1 from public.anticheat_trade_card_holds
      where card_id=any(card_ids) and quarantine_id is distinct from p_release) then
    raise exception 'TRADE_CARD_FROZEN' using errcode='P0001';
  end if;
  if (select count(*) from public.user_profiles where user_id in(p_offer.from_user,p_offer.to_user))<>2
    or exists(
      select 1 from (values (p_offer.from_user,p_offer.offered_karas),
                           (p_offer.to_user,p_offer.requested_karas)) debit(user_id,amount)
      join public.user_profiles p using(user_id)
      where p.karas_balance < debit.amount+coalesce((
        select sum(h.amount) from public.anticheat_trade_kara_holds h
        where h.user_id=debit.user_id and h.quarantine_id is distinct from p_release
      ),0)
    ) then
    raise exception 'TRADE_INSUFFICIENT_KARAS' using errcode='P0001';
  end if;

  if p_release is not null then
    if (select count(*) from public.anticheat_trade_card_holds
      where quarantine_id=p_release and card_id=any(card_ids))<>cardinality(card_ids)
      or exists(
        select 1 from (values (p_offer.from_user,p_offer.offered_karas),
                             (p_offer.to_user,p_offer.requested_karas)) debit(user_id,amount)
        where debit.amount<>coalesce((select amount from public.anticheat_trade_kara_holds
          where quarantine_id=p_release and user_id=debit.user_id),0)
      ) then
      raise exception 'QUARANTINE_HOLD_MISMATCH' using errcode='P0001';
    end if;
    delete from public.anticheat_trade_card_holds where quarantine_id=p_release;
    delete from public.anticheat_trade_kara_holds where quarantine_id=p_release;
  elsif public.anticheat_runtime_flag_enabled('quarantine_enforcement')
    and not public.anticheat_runtime_flag_enabled('automatic_decisions_paused')
    and public.anticheat_trade_needs_review(p_offer) then
    select case when jsonb_typeof(config->'reviewMinutes')='number'
      then least(1440,greatest(5,(config->>'reviewMinutes')::numeric))::integer else 1440 end
      into review_minutes from public.anticheat_runtime_flags where flag='quarantine_enforcement';
    insert into public.anticheat_quarantines(
      subject_type,subject_id,status,sender_user_id,recipient_user_id,case_user_id,
      evidence_confidence,economic_severity,reason_codes,asset_snapshot,expires_at
    ) values (
      'trade',p_offer.id,'AWAITING_REVIEW',p_offer.from_user,p_offer.to_user,p_offer.from_user,
      'CORROBORATED','MEDIUM',array['SHARED_NETWORK_BROWSER_ONE_WAY_TRANSFER'],
      jsonb_build_object('offeredCardIds',p_offer.offered_card_ids,'requestedCardIds',p_offer.requested_card_ids,
        'offeredKaras',p_offer.offered_karas,'requestedKaras',p_offer.requested_karas),
      clock_timestamp()+make_interval(mins=>coalesce(review_minutes,1440))
    ) returning id into new_quarantine_id;
    insert into public.anticheat_trade_card_holds(card_id,quarantine_id)
      select id,new_quarantine_id from unnest(card_ids) as cards(id);
    insert into public.anticheat_trade_kara_holds(quarantine_id,user_id,amount)
      select new_quarantine_id,debit.user_id,debit.amount
      from (values (p_offer.from_user,p_offer.offered_karas),
                   (p_offer.to_user,p_offer.requested_karas)) debit(user_id,amount)
      where debit.amount>0;
    -- Change the locked row versions so a pre-existing repeatable-read
    -- snapshot cannot spend against a balance or card predating the hold.
    update public.user_profiles set karas_balance=karas_balance
      where (user_id=p_offer.from_user and p_offer.offered_karas>0)
         or (user_id=p_offer.to_user and p_offer.requested_karas>0);
    update public.user_cards set is_locked=is_locked where id=any(card_ids);
    insert into public.anticheat_quarantine_audit(quarantine_id,action,idempotency_key)
      values(new_quarantine_id,'AWAITING_REVIEW','admission');
    update public.trade_offers set status='quarantined',updated_at=clock_timestamp() where id=p_offer.id;
    return false;
  end if;

  update public.user_profiles set karas_balance=karas_balance-p_offer.offered_karas+p_offer.requested_karas
    where user_id=p_offer.from_user;
  update public.user_profiles set karas_balance=karas_balance-p_offer.requested_karas+p_offer.offered_karas
    where user_id=p_offer.to_user;
  update public.user_cards set user_id=p_offer.to_user,folder_id=null,is_first_owner=false,date_obtention=clock_timestamp()
    where id=any(p_offer.offered_card_ids);
  update public.user_cards set user_id=p_offer.from_user,folder_id=null,is_first_owner=false,date_obtention=clock_timestamp()
    where id=any(p_offer.requested_card_ids);
  update public.trade_offers set status='accepted',updated_at=clock_timestamp() where id=p_offer.id;
  insert into public.notifications(user_id,type,reference_id)
    values(p_offer.from_user,'trade_offer_accepted',p_offer.id);
  return true;
end;
$$;

alter table public.anticheat_runtime_flags drop constraint anticheat_runtime_flags_flag_check;
alter table public.anticheat_runtime_flags add constraint anticheat_runtime_flags_flag_check
  check(flag in ('discord_alerts_v2','graph_detection_v2','risk_score_v2_shadow','quarantine_shadow',
    'quarantine_enforcement','advanced_recovery','automatic_sanctions','automatic_decisions_paused','quarantine_auto_release'));
insert into public.anticheat_runtime_flags(flag) values('automatic_decisions_paused'),('quarantine_auto_release');

create or replace function public.respond_trade_offer(p_offer_id uuid,p_action text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); offer public.trade_offers%rowtype;
begin
  perform public.assert_player_not_banned();
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_action is null or p_action not in ('accept','decline') then
    raise exception 'INVALID_TRADE_ACTION' using errcode='P0001';
  end if;
  select * into offer from public.trade_offers where id=p_offer_id for update;
  if not found or offer.to_user<>player_id then raise exception 'TRADE_NOT_PENDING' using errcode='P0001'; end if;
  if p_action='accept' and offer.status='quarantined' then return false; end if;
  if offer.status<>'pending' then raise exception 'TRADE_NOT_PENDING' using errcode='P0001'; end if;
  if p_action='decline' then
    update public.trade_offers set status='declined',updated_at=clock_timestamp() where id=offer.id;
    insert into public.notifications(user_id,type,reference_id) values(offer.from_user,'trade_offer_declined',offer.id);
    return false;
  end if;
  return public.anticheat_settle_trade(offer,null);
end;
$$;

create function public.respond_trade_offer_with_status(p_offer_id uuid,p_action text)
returns text language plpgsql security definer set search_path='' as $$
begin
  if public.respond_trade_offer(p_offer_id,p_action) then return 'accepted'; end if;
  return case when p_action='decline' then 'declined' else 'quarantined' end;
end;
$$;
revoke all on function public.respond_trade_offer_with_status(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.respond_trade_offer_with_status(uuid,text) to authenticated;

-- The existing sender cancellation RPC can also withdraw a held offer. Any
-- cancellation through another trusted writer must release its reservations.
create function public.close_cancelled_trade_quarantine()
returns trigger language plpgsql security definer set search_path='' as $$
declare closed_id uuid;
begin
  update public.anticheat_quarantines set status='CANCELLED',terminal_at=clock_timestamp(),
    updated_at=clock_timestamp(),version=version+1
    where subject_type='trade' and subject_id=old.id and status in('PENDING_ANALYSIS','AWAITING_REVIEW')
    returning id into closed_id;
  if closed_id is not null then
    delete from public.anticheat_trade_card_holds where quarantine_id=closed_id;
    delete from public.anticheat_trade_kara_holds where quarantine_id=closed_id;
    insert into public.anticheat_quarantine_audit(quarantine_id,action,actor_user_id,idempotency_key)
      values(closed_id,'CANCELLED',auth.uid(),'offer-withdrawal');
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger close_cancelled_trade_quarantine
  after update on public.trade_offers for each row
  when (old.status='quarantined' and new.status='cancelled')
  execute function public.close_cancelled_trade_quarantine();
create trigger close_deleted_trade_quarantine
  after delete on public.trade_offers for each row when (old.status='quarantined')
  execute function public.close_cancelled_trade_quarantine();

-- Account deletion clears the participant columns before deleting inventory.
-- Close the hold in the same statement so that path can finish normally.
create function public.cancel_quarantined_trade_when_participant_removed()
returns trigger language plpgsql set search_path='' as $$
begin
  new.status:='cancelled';
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;
create trigger cancel_quarantined_trade_when_participant_removed
  before update of from_user,to_user on public.trade_offers for each row
  when (old.status='quarantined' and (new.from_user is null or new.to_user is null))
  execute function public.cancel_quarantined_trade_when_participant_removed();
revoke all on function public.cancel_quarantined_trade_when_participant_removed()
  from public,anon,authenticated,service_role;

create function public.resolve_trade_quarantine(
  p_id uuid,p_version integer,p_action text,p_reason text,p_actor uuid
)
returns text language plpgsql security definer set search_path='' as $$
declare q public.anticheat_quarantines%rowtype; offer public.trade_offers%rowtype; outcome text;
begin
  select o.* into offer from public.anticheat_quarantines entry
    join public.trade_offers o on o.id=entry.subject_id
    where entry.id=p_id and entry.subject_type='trade' for update of o;
  if not found or offer.status<>'quarantined' then raise exception 'QUARANTINE_CHANGED' using errcode='P0001'; end if;
  select * into q from public.anticheat_quarantines where id=p_id for update;
  if q.version is distinct from p_version or q.status not in('PENDING_ANALYSIS','AWAITING_REVIEW') then
    raise exception 'QUARANTINE_CHANGED' using errcode='P0001';
  end if;
  if p_action='release' then
    perform public.anticheat_settle_trade(offer,q.id);
    outcome:='RELEASED';
  else
    delete from public.anticheat_trade_card_holds where quarantine_id=q.id;
    delete from public.anticheat_trade_kara_holds where quarantine_id=q.id;
    outcome:=case when p_action='expire' then 'EXPIRED' else 'CANCELLED' end;
  end if;
  update public.anticheat_quarantines set status=outcome,terminal_at=clock_timestamp(),
    updated_at=clock_timestamp(),version=version+1 where id=q.id;
  if p_action in('cancel','expire') then
    update public.trade_offers set status='cancelled',updated_at=clock_timestamp() where id=offer.id;
    insert into public.notifications(user_id,type,reference_id)
      values(offer.to_user,'trade_offer_cancelled',offer.id),
            (offer.from_user,'trade_offer_declined',offer.id);
  end if;
  insert into public.anticheat_quarantine_audit(quarantine_id,action,actor_user_id,idempotency_key,details)
    values(q.id,outcome,p_actor,'resolution',jsonb_build_object('reason',btrim(p_reason)));
  return outcome;
end;
$$;

create function public.admin_resolve_trade_quarantine(p_id uuid,p_version integer,p_action text,p_reason text)
returns text language plpgsql security definer set search_path='' as $$
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_action is null or p_action not in('release','cancel')
    or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception 'INVALID_QUARANTINE_DECISION' using errcode='P0001';
  end if;
  return public.resolve_trade_quarantine(p_id,p_version,p_action,p_reason,auth.uid());
end;
$$;

-- A deadline can settle a still valid trade. Only definitive business
-- invalidation permits expiry without settlement. Unexpected errors are retried.
create function public.expire_active_trade_quarantines()
returns integer language plpgsql security definer set search_path='' as $$
declare item record; handled integer:=0;
begin
  if not public.anticheat_runtime_flag_enabled('quarantine_auto_release')
    or public.anticheat_runtime_flag_enabled('automatic_decisions_paused') then return 0; end if;
  for item in
    select q.id,q.version
    from public.anticheat_quarantines q join public.trade_offers o on o.id=q.subject_id
    where q.subject_type='trade' and q.status in('PENDING_ANALYSIS','AWAITING_REVIEW')
      and q.expires_at<=clock_timestamp() and o.status='quarantined'
    order by q.expires_at,q.id limit 25 for update of o skip locked
  loop
    begin
      perform public.resolve_trade_quarantine(item.id,item.version,'release','Review deadline reached',null);
      handled:=handled+1;
    exception when raise_exception then
      if sqlerrm in('FRIENDS_ONLY','ACCOUNT_BANNED','TRADE_CARD_UNAVAILABLE') then
        perform public.resolve_trade_quarantine(item.id,item.version,'expire',sqlerrm,null);
        handled:=handled+1;
      else
        insert into public.anticheat_quarantine_audit(quarantine_id,action,idempotency_key,details)
          values(item.id,'ACTION_REJECTED','expiry-retry:'||item.version,jsonb_build_object('reason','SETTLEMENT_RETRY'))
          on conflict(quarantine_id,idempotency_key) do nothing;
      end if;
    end;
  end loop;
  return handled;
end;
$$;

revoke all on function public.guard_quarantined_trade_card(),public.guard_quarantined_trade_listing(),
  public.guard_quarantined_trade_kara(),public.anticheat_trade_needs_review(public.trade_offers),
  public.anticheat_settle_trade(public.trade_offers,uuid),public.close_cancelled_trade_quarantine(),
  public.resolve_trade_quarantine(uuid,integer,text,text,uuid),public.expire_active_trade_quarantines(),
  public.admin_resolve_trade_quarantine(uuid,integer,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_resolve_trade_quarantine(uuid,integer,text,text) to authenticated;
select cron.schedule('expire-active-trade-quarantines','*/5 * * * *',
  'select public.expire_active_trade_quarantines();');

notify pgrst,'reload schema';
commit;
