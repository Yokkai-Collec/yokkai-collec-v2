begin;

create table public.black_market_editions (
 opening_day date primary key,
 starts_at timestamptz generated always as ((opening_day+time '12:00') at time zone 'Europe/Paris') stored,
 ends_at timestamptz generated always as (((opening_day+1)::timestamp) at time zone 'Europe/Paris') stored
);
alter table public.black_market_editions enable row level security;
revoke all on public.black_market_editions from public,anon,authenticated,service_role;
alter table public.auctions add column black_market_day date references public.black_market_editions(opening_day);
alter table public.auctions add constraint black_market_edition_terms check (
 black_market_day is null or (
   is_black_market and duration_minutes=720
   and ends_at=(((black_market_day+1)::timestamp) at time zone 'Europe/Paris')
   and card_snapshot is not null and coalesce(card_snapshot->>'rarity','') in ('LR','SSR')
   and starting_price=case card_snapshot->>'rarity' when 'LR' then 1000 else 500 end
 ));
create index auctions_black_market_edition on public.auctions(black_market_day,id) where black_market_day is not null;

-- Replacing an upcoming edition is atomic. The pre-created lots reserve the exact
-- inventory copies and are excluded from the public API until the shared opening.
drop function public.admin_open_black_market_auction(uuid,integer,integer);
create function public.admin_schedule_black_market_edition(p_day date,p_card_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare
 official uuid;
 previous public.black_market_editions%rowtype;
 opens timestamptz:= (p_day+time '12:00') at time zone 'Europe/Paris';
 closes timestamptz:= ((p_day+1)::timestamp) at time zone 'Europe/Paris';
 lot record;
 inserted_id uuid;
 inserted_count integer:=0;
begin
 perform public.assert_player_not_banned();
 if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 select official_user_id into official from public.black_market_config where singleton and enabled for update;
 if official is null then raise exception 'BLACK_MARKET_DISABLED'; end if;
 if p_day is null or not isfinite(p_day) or opens<=clock_timestamp() then raise exception 'BLACK_MARKET_INVALID_DAY'; end if;
 if p_card_ids is null or cardinality(p_card_ids) not between 1 and 60
   or cardinality(p_card_ids)<>(select count(distinct id) from unnest(p_card_ids) ids(id))
 then raise exception 'BLACK_MARKET_INVALID_SELECTION'; end if;
 select * into previous from public.black_market_editions where starts_at>clock_timestamp()
   order by starts_at limit 1 for update;
 if previous.opening_day is not null then
   perform 1 from public.auctions where black_market_day=previous.opening_day order by id for update;
   if previous.starts_at<=clock_timestamp() or exists(
     select 1 from public.auctions where black_market_day=previous.opening_day and buyer_id is not null
   ) then raise exception 'BLACK_MARKET_EDITION_STARTED'; end if;
   update public.black_market_stock set auction_id=null where auction_id in (
     select id from public.auctions where black_market_day=previous.opening_day
   );
   delete from public.auctions where black_market_day=previous.opening_day;
   delete from public.black_market_editions where opening_day=previous.opening_day;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||official::text,0));
 perform 1 from public.user_profiles where user_id=official for update;
 if exists(select 1 from auth.users where id=official and banned_until>clock_timestamp())
 then raise exception 'BLACK_MARKET_INVALID_OFFICIAL'; end if;
 insert into public.black_market_editions(opening_day) values(p_day);
 for lot in
   select c.id,case c.rarity when 'LR' then 1000 else 500 end price,
     jsonb_build_object('id',d.id,'name',d.nom,'category',d.categorie,'anime',d.franchise,'liveFranchise',true,
       'rarity',c.rarity,'image',d.image_url,'catalogueImage',d.image_url,'shiny',c.is_shiny,'isEvolved',c.is_evolved,
       'firstLrCopy',case when c.rarity='LR' then public.auction_first_lr_copy_source(c.id) end) snapshot
   from public.user_cards c join public.black_market_stock s on s.card_instance_id=c.id
   join public.cards d on d.id=c.card_id
   where c.id=any(p_card_ids) and c.user_id=official and s.official_user_id=official
     and c.rarity in('LR','SSR') and not c.is_locked
     and not exists(select 1 from public.auctions a where a.card_instance_id=c.id and a.status='active')
     and not exists(select 1 from public.anticheat_trade_card_holds h where h.card_id=c.id)
   order by c.id for update of c
 loop
   update public.user_cards set custom_image_url=null where id=lot.id;
   insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,
      ends_at,is_black_market,card_snapshot,black_market_day)
   values(lot.id,official,lot.price,lot.price,720,closes,true,lot.snapshot,p_day) returning id into inserted_id;
   update public.black_market_stock set auction_id=inserted_id where card_instance_id=lot.id;
   inserted_count:=inserted_count+1;
 end loop;
 if inserted_count<>cardinality(p_card_ids) then raise exception 'BLACK_MARKET_CARD_UNAVAILABLE'; end if;
 if opens<=clock_timestamp() then raise exception 'BLACK_MARKET_EDITION_STARTED'; end if;
 insert into public.admin_audit_logs(admin_user_id,action,metadata) values(auth.uid(),'black_market.open',
   jsonb_build_object('openingDay',p_day,'cardIds',p_card_ids));
end $$;
revoke all on function public.admin_schedule_black_market_edition(date,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_schedule_black_market_edition(date,uuid[]) to authenticated;

-- Preserve normal auction escrow and settlement. The first bid can match the
-- opening price. Any subsequent bid must raise it by the fixed rarity amount.
do $patch$
declare definition text; updated text;
begin
 definition:=pg_get_functiondef('public.place_bid(uuid,integer)'::regprocedure);
 updated:=replace(definition,'if p_amount<sale.current_price+10 then raise exception ''BID_TOO_LOW'' using errcode=''P0001''; end if;', $bid$
  if sale.is_black_market then
    if not exists(select 1 from public.black_market_editions e where e.opening_day=sale.black_market_day
      and e.starts_at<=clock_timestamp() and clock_timestamp()<e.ends_at)
    then raise exception 'BLACK_MARKET_NOT_OPEN' using errcode='P0001'; end if;
    if p_amount is null or p_amount < (case when sale.buyer_id is null then sale.starting_price::bigint
      else sale.current_price::bigint+sale.starting_price end)
    then raise exception 'BLACK_MARKET_BID_TOO_LOW' using errcode='P0001'; end if;
  elsif p_amount<sale.current_price+10 then raise exception 'BID_TOO_LOW' using errcode='P0001'; end if;$bid$);
 if updated=definition then raise exception 'BLACK_MARKET_BID_PATCH_MISSING'; end if;
 definition:=updated;
 updated:=replace(definition,'when not sale.is_mystery and ends_at-clock_timestamp()',
   'when not sale.is_mystery and not sale.is_black_market and ends_at-clock_timestamp()');
 if updated=definition then raise exception 'BLACK_MARKET_EXTENSION_PATCH_MISSING'; end if;
 updated:=replace(updated,'update public.auctions set current_price=p_amount,buyer_id=player_id,',
   'if sale.is_black_market and sale.ends_at<=clock_timestamp() then raise exception ''BLACK_MARKET_NOT_OPEN'' using errcode=''P0001''; end if;'
   ||chr(10)||'  update public.auctions set current_price=p_amount,buyer_id=player_id,');
 execute updated;

 definition:=pg_get_functiondef('public.prepare_account_deletion_without_billing(uuid)'::regprocedure);
 updated:=replace(definition,'when not sale.is_mystery and ends_at<clock_timestamp()',
   'when not sale.is_mystery and not sale.is_black_market and ends_at<clock_timestamp()');
 if updated=definition then raise exception 'BLACK_MARKET_DELETION_PATCH_MISSING'; end if;
 execute updated;

 definition:=pg_get_functiondef('public.get_auction(uuid)'::regprocedure);
 updated:=replace(definition,'''isBlackMarket'',a.is_black_market,',
   '''isBlackMarket'',a.is_black_market,''bidIncrement'',case when a.black_market_day is not null then a.starting_price end,');
 if updated=definition or strpos(updated,'where a.id=p_auction_id and ')=0 then raise exception 'BLACK_MARKET_DETAIL_PATCH_MISSING'; end if;
 updated:=replace(updated,'where a.id=p_auction_id and ',
   'where a.id=p_auction_id and (not a.is_black_market or a.status<>''active'' or exists(select 1 from public.black_market_editions e where e.opening_day=a.black_market_day and e.starts_at<=statement_timestamp())) and ');
 execute updated;

 definition:=pg_get_functiondef('public.get_profile_active_auctions(uuid,jsonb,integer)'::regprocedure);
 updated:=replace(definition,'where a.seller_id=p_owner_id and a.status=', 'where not a.is_black_market and a.seller_id=p_owner_id and a.status=');
 if updated=definition then raise exception 'BLACK_MARKET_PROFILE_PATCH_MISSING'; end if;
 execute updated;

 definition:=pg_get_functiondef('public.get_card_discovery(uuid,integer,integer,boolean)'::regprocedure);
 updated:=replace(definition,'where a.status=''active'' and auc_uc.card_id=', 'where not a.is_black_market and a.status=''active'' and auc_uc.card_id=');
 if updated=definition then raise exception 'BLACK_MARKET_DISCOVERY_PATCH_MISSING'; end if;
 execute updated;
end $patch$;

-- Reserved lots are not public listings. Avoid sending a link before opening.
drop trigger auctions_notify_wishlists on public.auctions;
create trigger auctions_notify_wishlists after insert on public.auctions
 for each row when (not new.is_black_market) execute function public.notify_wishlist_auction();

create or replace function public.get_black_market_event() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare edition public.black_market_editions%rowtype; stamp timestamptz:=statement_timestamp();
begin
 perform public.assert_player_not_banned();
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into edition from public.black_market_editions where ends_at>stamp order by starts_at limit 1;
 if edition.opening_day is null and not (select enabled from public.black_market_config where singleton) then return null; end if;
 return jsonb_build_object('startsAt',edition.starts_at,'endsAt',edition.ends_at,'auctions',
   case when edition.starts_at<=stamp then coalesce((select jsonb_agg(
     public.get_auction(a.id)||jsonb_build_object('popularity',coalesce(d.favoris_count,0),
       'ownedCount',(select count(*) from public.user_cards where user_id=auth.uid() and card_id=d.id))
     order by a.id)
     from public.auctions a join public.user_cards copy on copy.id=a.card_instance_id
     join public.cards d on d.id=copy.card_id
     where a.black_market_day=edition.opening_day and a.status='active'),'[]'::jsonb)
   else '[]'::jsonb end);
end $$;

create or replace function public.admin_get_black_market_stock() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare future public.black_market_editions%rowtype; stamp timestamptz:=statement_timestamp();
begin
 perform public.assert_player_not_banned();
 if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 select * into future from public.black_market_editions where starts_at>stamp order by starts_at limit 1;
 return (select jsonb_build_object('enabled',cfg.enabled,'officialUserId',cfg.official_user_id,
   'minDay',((stamp at time zone 'Europe/Paris')::date+case when (stamp at time zone 'Europe/Paris')::time>=time '12:00' then 1 else 0 end),
   'scheduledDay',future.opening_day,'startsAt',future.starts_at,
   'selectedIds',coalesce((select jsonb_agg(a.card_instance_id order by a.id) from public.auctions a
     where a.black_market_day=future.opening_day and a.status='active'),'[]'::jsonb),
   'items',coalesce((select jsonb_agg(jsonb_build_object('instanceId',q.id,'name',q.nom,'rarity',q.rarity)
     order by q.selected desc,q.nom,q.id) from (
     select c.id,d.nom,c.rarity,coalesce(a.black_market_day=future.opening_day,false) selected
     from public.black_market_stock s join public.user_cards c on c.id=s.card_instance_id and c.user_id=s.official_user_id
     join public.cards d on d.id=c.card_id
     left join public.auctions a on a.card_instance_id=c.id and a.status='active'
     where s.official_user_id=cfg.official_user_id and not c.is_locked and c.rarity in('LR','SSR')
       and (a.id is null or a.black_market_day=future.opening_day)
       and not exists(select 1 from public.anticheat_trade_card_holds h where h.card_id=c.id)
     order by selected desc,d.nom,c.id limit 200) q),'[]'::jsonb))
   from public.black_market_config cfg where singleton);
end $$;

notify pgrst,'reload schema';
commit;
