begin;
set local lock_timeout='3s';

-- Same auction, bids, escrow and minute settlement; no parallel marketplace.
alter table public.auctions add column is_mystery boolean not null default false,
  add column mystery_week date;
create unique index auctions_mystery_week on public.auctions(mystery_week) where is_mystery;
alter table public.auctions add constraint auctions_mystery_shape check (
  (not is_mystery and mystery_week is null) or
  (is_mystery and seller_id is null and mystery_week is not null
    and extract(isodow from mystery_week)=3 and starting_price=50 and duration_minutes=1440
    and (status<>'active' or (card_instance_id is null and card_snapshot is null)))
);

-- Extend the current constraint rather than lose notification types added elsewhere.
do $$ declare definition text; begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.notifications'::regclass and conname='notifications_type_check';
  if definition is null then raise exception 'NOTIFICATION_CONSTRAINT_MISSING'; end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute 'alter table public.notifications add constraint notifications_type_check check (type in (''mystery_auction_started'',''mystery_auction_result'') or ('||substring(definition from 8 for char_length(definition)-8)||'))';
end $$;

create function public.create_weekly_mystery_auction() returns void
language plpgsql volatile security definer set search_path='' as $$
declare local_now timestamp:=clock_timestamp() at time zone 'Europe/Paris'; auction_id uuid; starts timestamptz;
begin
  if extract(isodow from local_now)<>3 or extract(hour from local_now)<>20 then return; end if;
  starts:=(local_now::date+time '20:00') at time zone 'Europe/Paris';
  insert into public.auctions(is_mystery,mystery_week,starting_price,current_price,duration_minutes,ends_at,created_at)
    values(true,local_now::date,50,50,1440,starts+interval '24 hours',starts)
    on conflict (mystery_week) where is_mystery do nothing returning id into auction_id;
  if auction_id is null then return; end if;
  insert into public.notifications(user_id,type,reference_id)
    select user_id,'mystery_auction_started',auction_id from public.user_profiles
    on conflict do nothing;
end $$;
revoke all on function public.create_weekly_mystery_auction() from public,anon,authenticated,service_role;

-- cron.timezone is cluster-wide and requires a restart to change:
-- https://github.com/citusdata/pg_cron#setting-up-pg_cron
-- Use a weekly job only when it is ALREADY Europe/Paris; otherwise hourly,
-- with a server-side Paris clock check and a unique Wednesday key.
select cron.schedule('weekly-mystery-auction',
  case when current_setting('cron.timezone',true)='Europe/Paris' then '0 20 * * 3' else '0 * * * *' end,
  'select public.create_weekly_mystery_auction();');

create or replace function public.notify_auction_sold() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status='active' and new.status='sold' and new.seller_id is not null then
    insert into public.notifications(user_id,type,reference_id) values(new.seller_id,'auction_sold',new.id) on conflict do nothing;
  end if;
  return new;
end $$;

-- Patch CURRENT definitions to preserve lock ordering, bans, maintenance fences,
-- wishlist intent, live franchises, ownership counts and all existing ACLs.
do $patch$
declare definition text; updated text; target regprocedure;
begin
  target:='public.capture_auction_anticheat_event()'::regprocedure;
  definition:=pg_get_functiondef(target);
  updated:=replace(definition, 'if tg_op=''INSERT'' then',
    'if new.is_mystery and new.buyer_id is null then return new; end if; if tg_op=''INSERT'' then');
  updated:=replace(updated,'event_name,new.seller_id,new.buyer_id',
    'event_name,coalesce(new.seller_id,new.buyer_id),case when new.is_mystery then null else new.buyer_id end');
  if updated=definition then raise exception 'MYSTERY_AUDIT_PATCH_MISSING'; end if;
  execute updated;

  target:='public.settle_expired_auctions()'::regprocedure;
  definition:=pg_get_functiondef(target);
  updated:=replace(definition,'declare sale record;', 'declare sale record; drawn public.cards%rowtype; snapshot jsonb; copy_id uuid;');
  updated:=replace(updated,'if sale.buyer_id is null then', $branch$
    if sale.is_mystery then
      -- No card was selected or persisted before this locked closing transaction.
      select * into strict drawn from public.cards order by random() limit 1;
      snapshot:=jsonb_build_object('id',drawn.id,'name',drawn.nom,'category',drawn.categorie,
        'anime',drawn.franchise,'liveFranchise',true,'rarity',drawn.rarete_base,
        'image',drawn.image_url,'catalogueImage',drawn.image_url,'shiny',false,'isEvolved',false);
      copy_id:=null;
      if sale.buyer_id is not null then
        perform 1 from public.user_profiles where user_id=sale.buyer_id for update;
        -- Identical insertion path and normal-variant flags to pack awards:
        -- user_cards acquisition triggers handle collection/achievement progress.
        insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
          values(sale.buyer_id,drawn.id,clock_timestamp(),drawn.rarete_base,false,false,drawn.rarete_base='LR')
          returning id into copy_id;
      end if;
      update public.auctions set status=case when sale.buyer_id is null then 'expired' else 'sold' end,
        card_snapshot=snapshot,card_instance_id=copy_id where id=sale.id;
      -- Escrow was already debited by place_bid: no seller credit burns it.
      insert into public.notifications(user_id,type,reference_id)
        select distinct bidder_id,'mystery_auction_result',sale.id from public.bids where auction_id=sale.id and bidder_id is not null
        on conflict do nothing;
    elsif sale.buyer_id is null then$branch$);
  if updated=definition or strpos(updated,'into strict drawn')=0 then raise exception 'MYSTERY_SETTLEMENT_PATCH_MISSING'; end if;
  execute updated;

  target:='public.place_bid(uuid,integer)'::regprocedure;
  definition:=pg_get_functiondef(target);
  updated:=replace(definition,'when ends_at-clock_timestamp()<interval ''5 minutes''',
    'when not sale.is_mystery and ends_at-clock_timestamp()<interval ''5 minutes''');
  if updated=definition then raise exception 'MYSTERY_BID_PATCH_MISSING'; end if;
  execute updated;

  target:='public.prepare_account_deletion_without_billing(uuid)'::regprocedure;
  definition:=pg_get_functiondef(target);
  updated:=replace(definition,'ends_at=case when ends_at<clock_timestamp()+interval ''3 minutes''',
    'ends_at=case when not sale.is_mystery and ends_at<clock_timestamp()+interval ''3 minutes''');
  updated:=replace(updated,'where uc.id=a.card_instance_id and (',
    'where not a.is_mystery and uc.id=a.card_instance_id and (');
  if updated=definition then raise exception 'MYSTERY_DELETION_PATCH_MISSING'; end if;
  execute updated;

  foreach target in array array['public.get_auction(uuid)'::regprocedure,
    'public.browse_auctions_page(integer,text,text,text,text,text)'::regprocedure,
    'public.list_auctions_page(jsonb,integer)'::regprocedure,'public.list_auctions()'::regprocedure] loop
    definition:=pg_get_functiondef(target);
    updated:=replace(definition,'c.id is not null or a.card_snapshot is not null',
      'a.is_mystery or c.id is not null or a.card_snapshot is not null');
    updated:=replace(updated,'''id'',a.id,''card'',','''id'',a.id,''isMystery'',a.is_mystery,''card'',');
    updated:=replace(updated,'case when c.id is not null then jsonb_build_object(',
      'case when a.is_mystery then a.card_snapshot when c.id is not null then jsonb_build_object(');
    updated:=replace(updated,'case when a.card_id is not null then jsonb_build_object(',
      'case when a.is_mystery then a.card_snapshot when a.card_id is not null then jsonb_build_object(');
    if updated=definition or strpos(updated,'''isMystery''')=0 then raise exception 'MYSTERY_READER_PATCH_MISSING: %',target; end if;
    execute updated;
  end loop;

  foreach target in array array['public.list_notifications(integer)'::regprocedure,
    'public.get_push_notification(uuid,timestamptz)'::regprocedure] loop
    definition:=pg_get_functiondef(target);
    updated:=replace(definition,'''cardName'',c.nom', '''cardName'',coalesce(c.nom,a.card_snapshot->>''name'')');
    updated:=replace(updated,'''auction_chat_mention'') and a.id=n.reference_id',
      '''auction_chat_mention'',''mystery_auction_started'',''mystery_auction_result'') and a.id=n.reference_id');
    if updated=definition or strpos(updated,'''mystery_auction_result''')=0 then raise exception 'MYSTERY_NOTIFICATION_PATCH_MISSING'; end if;
    execute updated;
  end loop;
end $patch$;

-- The banner uses the same detail RPC as the auction page. Calendar calculations
-- stay on the server, including both DST transitions; the UI only counts down.
create function public.get_mystery_auction_event() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare local_now timestamp:=statement_timestamp() at time zone 'Europe/Paris';
  next_day date; next_start timestamptz; latest uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  next_day:=local_now::date+((3-extract(isodow from local_now)::integer+7)%7);
  if next_day=local_now::date and local_now::time>=time '20:00' then next_day:=next_day+7; end if;
  next_start:=(next_day+time '20:00') at time zone 'Europe/Paris';
  select id into latest from public.auctions where is_mystery order by mystery_week desc limit 1;
  return jsonb_build_object('nextStartsAt',next_start,'isWednesday',extract(isodow from local_now)=3,
    'auction',case when latest is not null then public.get_auction(latest) end);
end $$;
revoke all on function public.get_mystery_auction_event() from public,anon,authenticated,service_role;
grant execute on function public.get_mystery_auction_event() to authenticated;
notify pgrst,'reload schema';
commit;
