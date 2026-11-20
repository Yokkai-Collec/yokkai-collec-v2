begin;
set local lock_timeout = '5s';

alter table public.auctions drop constraint black_market_edition_terms;
alter table public.auctions add constraint black_market_edition_terms check (
  black_market_day is null or (
    is_black_market and duration_minutes = 720
    and ends_at >= (((black_market_day + 1)::timestamp) at time zone 'Europe/Paris')
    and card_snapshot is not null and coalesce(card_snapshot->>'rarity', '') in ('LR', 'SSR')
  )
);

create function public.black_market_bid_increment(p_rarity text) returns integer
language sql immutable strict set search_path = '' as $$
  select case p_rarity when 'LR' then 1000 when 'SSR' then 500 end;
$$;
revoke all on function public.black_market_bid_increment(text) from public, anon, authenticated, service_role;

create function public.admin_schedule_black_market_edition(
  p_day date, p_card_ids uuid[], p_starting_prices integer[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  previous public.black_market_editions%rowtype;
  previous_prices jsonb := '{}';
  opens timestamptz := (p_day + time '12:00') at time zone 'Europe/Paris';
  closes timestamptz := ((p_day + 1)::timestamp) at time zone 'Europe/Paris';
  inserted_count integer;
  scheduled_prices jsonb;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform 1 from public.black_market_config where singleton and enabled for update;
  if not found then raise exception 'BLACK_MARKET_DISABLED'; end if;
  if p_day is null or not isfinite(p_day) or opens <= clock_timestamp() then raise exception 'BLACK_MARKET_INVALID_DAY'; end if;
  if p_card_ids is null or cardinality(p_card_ids) not between 1 and 60
    or cardinality(p_card_ids) <> (select count(distinct id) from unnest(p_card_ids) ids(id))
  then raise exception 'BLACK_MARKET_INVALID_SELECTION'; end if;
  if p_starting_prices is not null and (
    cardinality(p_starting_prices) <> cardinality(p_card_ids)
    or exists (select 1 from unnest(p_starting_prices) prices(amount) where amount is null or amount < 10)
  ) then raise exception 'BLACK_MARKET_INVALID_STARTING_PRICE'; end if;

  select * into previous from public.black_market_editions where starts_at > clock_timestamp()
    order by starts_at limit 1 for update;
  if found then
    perform 1 from public.auctions where black_market_day = previous.opening_day order by id for update;
    if previous.starts_at <= clock_timestamp() or exists (
      select 1 from public.auctions where black_market_day = previous.opening_day and buyer_id is not null
    ) then raise exception 'BLACK_MARKET_EDITION_STARTED'; end if;
    if p_starting_prices is null then
      select coalesce(jsonb_object_agg(black_market_stock_id::text, starting_price), '{}') into previous_prices
      from public.auctions where black_market_day = previous.opening_day and status = 'active';
    end if;
    delete from public.auctions where black_market_day = previous.opening_day;
    delete from public.black_market_editions where opening_day = previous.opening_day;
  end if;

  insert into public.black_market_editions(opening_day) values (p_day);
  with scheduled as (
    insert into public.auctions(black_market_stock_id, starting_price, current_price, duration_minutes,
      ends_at, is_black_market, card_snapshot, black_market_day)
    select s.card_instance_id, prices.amount, prices.amount, 720, closes, true,
      public.black_market_card_snapshot(s.card_instance_id, s.card_id, s.rarity, s.is_shiny, s.is_evolved), p_day
    from public.black_market_stock s
    join unnest(p_card_ids, p_starting_prices) requested(id, amount) on requested.id = s.card_instance_id
    cross join lateral (select coalesce(requested.amount, (previous_prices->>s.card_instance_id::text)::integer,
      public.black_market_bid_increment(s.rarity::text)) as amount) prices
    where s.card_id is not null
      and not exists (select 1 from public.auctions a
        where a.black_market_stock_id = s.card_instance_id and a.status = 'active')
      and not exists (select 1 from public.anticheat_trade_card_holds h where h.card_id = s.card_instance_id)
    order by s.card_instance_id for update of s
    returning black_market_stock_id, starting_price
  )
  select count(*), jsonb_object_agg(black_market_stock_id::text, starting_price)
  into inserted_count, scheduled_prices from scheduled;
  if inserted_count <> cardinality(p_card_ids) then raise exception 'BLACK_MARKET_CARD_UNAVAILABLE'; end if;
  if opens <= clock_timestamp() then raise exception 'BLACK_MARKET_EDITION_STARTED'; end if;
  insert into public.admin_audit_logs(admin_user_id, action, metadata)
  values (auth.uid(), 'black_market.open', jsonb_build_object('openingDay', p_day, 'cardIds', p_card_ids,
    'startingPrices', scheduled_prices));
end $$;

-- Existing callers can keep scheduling with the rarity defaults and any saved prices.
create or replace function public.admin_schedule_black_market_edition(p_day date, p_card_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_player_not_banned();
  perform public.admin_schedule_black_market_edition(p_day, p_card_ids, null::integer[]);
end $$;
revoke all on function public.admin_schedule_black_market_edition(date, uuid[], integer[])
  from public, anon, authenticated, service_role;
grant execute on function public.admin_schedule_black_market_edition(date, uuid[], integer[]) to authenticated;

do $patch$
declare original text; updated text;
begin
  original := pg_get_functiondef('public.admin_get_black_market_stock()'::regprocedure);
  updated := replace(original, '''isEvolved'', q.is_evolved)', '''isEvolved'', q.is_evolved, ''startingPrice'', q.starting_price)');
  if updated = original then raise exception 'BLACK_MARKET_STOCK_PRICE_PAYLOAD_PATCH_MISSING'; end if;
  original := updated;
  updated := replace(original, 'coalesce(a.black_market_day = future.opening_day, false) as selected',
    'coalesce(a.black_market_day = future.opening_day, false) as selected, a.starting_price');
  if updated = original then raise exception 'BLACK_MARKET_STOCK_PRICE_LOOKUP_PATCH_MISSING'; end if;
  execute updated;

  original := pg_get_functiondef('public.place_bid(uuid,integer)'::regprocedure);
  updated := replace(original, 'old_price::bigint + sale.starting_price *',
    'old_price::bigint + public.black_market_bid_increment(sale.card_snapshot->>''rarity'') *');
  if updated = original then raise exception 'BLACK_MARKET_RARITY_INCREMENT_PATCH_MISSING'; end if;
  execute updated;

  original := pg_get_functiondef('public.get_auction(uuid)'::regprocedure);
  updated := replace(original, '''bidIncrement'',case when a.black_market_day is not null then a.starting_price end,',
    '''startingPrice'',case when a.black_market_day is not null then a.starting_price end,' ||
    '''bidIncrement'',case when a.black_market_day is not null then public.black_market_bid_increment(a.card_snapshot->>''rarity'') end,');
  if updated = original then raise exception 'BLACK_MARKET_RARITY_INCREMENT_PAYLOAD_PATCH_MISSING'; end if;
  original := updated;
  updated := replace(original, 'a.starting_price * (2 + a.black_market_late_raises::bigint)',
    'public.black_market_bid_increment(a.card_snapshot->>''rarity'') * (2 + a.black_market_late_raises::bigint)');
  if updated = original then raise exception 'BLACK_MARKET_LATE_INCREMENT_PAYLOAD_PATCH_MISSING'; end if;
  execute updated;
end $patch$;

notify pgrst, 'reload schema';
commit;
