begin;
set local lock_timeout = '5s';

alter table public.auctions drop constraint black_market_edition_terms;
alter table public.auctions add constraint black_market_edition_terms check (
  black_market_day is null or (
    is_black_market and duration_minutes = 720
    and ends_at >= (((black_market_day + 1)::timestamp) at time zone 'Europe/Paris')
    and card_snapshot is not null and coalesce(card_snapshot->>'rarity', '') in ('LR', 'SSR')
    and starting_price = case card_snapshot->>'rarity' when 'LR' then 1000 else 500 end
  )
);

-- Use the locked lot's own deadline for both the late minimum and extension.
-- A bid that has to wait for the balance locks is evaluated after that wait.
do $patch$
declare original text; updated text;
begin
  original := pg_get_functiondef('public.place_bid(uuid,integer)'::regprocedure);
  updated := replace(original, 'old_price integer; balance integer;',
    'old_price integer; balance integer; bid_at timestamptz; late_black_market_bid boolean := false;');
  updated := replace(updated,
    'and e.starts_at<=clock_timestamp() and clock_timestamp()<e.ends_at)',
    'and e.starts_at<=clock_timestamp())');
  updated := replace(updated, $before$
    if p_amount is null or p_amount < (case when sale.buyer_id is null then sale.starting_price::bigint
      else sale.current_price::bigint+sale.starting_price end)
    then raise exception 'BLACK_MARKET_BID_TOO_LOW' using errcode='P0001'; end if;
  elsif$before$, '
  elsif');
  updated := replace(updated, '  if old_buyer=player_id then balance:=', $validation$
  if sale.is_black_market then
    bid_at := clock_timestamp();
    if sale.ends_at <= bid_at then raise exception 'BLACK_MARKET_NOT_OPEN' using errcode='P0001'; end if;
    late_black_market_bid := sale.ends_at - bid_at <= interval '3 minutes';
    if p_amount is null or p_amount < (case when old_buyer is null then sale.starting_price::bigint
      else old_price::bigint + sale.starting_price * (case when late_black_market_bid then 2 else 1 end) end)
    then raise exception 'BLACK_MARKET_BID_TOO_LOW' using errcode='P0001'; end if;
  end if;
  if old_buyer=player_id then balance:=$validation$);
  updated := replace(updated, 'ends_at=case when not sale.is_mystery and not sale.is_black_market',
    'ends_at=case when late_black_market_bid then ends_at+interval ''1 minute'' when not sale.is_mystery and not sale.is_black_market');
  if strpos(updated, 'late_black_market_bid := sale.ends_at - bid_at') = 0
    or strpos(updated, 'when late_black_market_bid then ends_at+interval') = 0
    or strpos(updated, 'sale.current_price::bigint+sale.starting_price') > 0
    or strpos(updated, 'clock_timestamp()<e.ends_at') > 0
  then raise exception 'BLACK_MARKET_LATE_BID_PATCH_MISSING'; end if;
  execute updated;

  original := pg_get_functiondef('public.get_black_market_event()'::regprocedure);
  updated := replace(original, 'where ends_at > stamp order by starts_at limit 1;', $current$
  where ends_at > stamp or exists (
    select 1 from public.auctions a where a.black_market_day = black_market_editions.opening_day
      and a.status = 'active' and a.ends_at > stamp
  ) order by starts_at limit 1;$current$);
  if updated = original then raise exception 'BLACK_MARKET_LIVE_EDITION_PATCH_MISSING'; end if;
  updated := replace(updated, $payload$
    where a.black_market_day = edition.opening_day and a.status = 'active';
  end if;

  return jsonb_build_object(
    'startsAt', edition.starts_at, 'endsAt', edition.ends_at,$payload$, $live$
    where a.black_market_day = edition.opening_day and a.status = 'active' and a.ends_at > stamp;
  end if;

  return jsonb_build_object(
    'startsAt', edition.starts_at, 'endsAt', greatest(edition.ends_at, (
      select max(a.ends_at) from public.auctions a
      where a.black_market_day = edition.opening_day and a.status = 'active'
    )),$live$);
  if strpos(updated, 'greatest(edition.ends_at') = 0
  then raise exception 'BLACK_MARKET_LIVE_DEADLINE_PATCH_MISSING'; end if;
  execute updated;

  original := pg_get_functiondef('public.get_black_market_activity()'::regprocedure);
  updated := replace(original, 'where ends_at <= statement_timestamp() order by ends_at desc limit 1;', $archive$
  where ends_at <= statement_timestamp() and not exists (
    select 1 from public.auctions a where a.black_market_day = black_market_editions.opening_day
      and a.status = 'active' and a.ends_at > statement_timestamp()
  ) order by ends_at desc limit 1;$archive$);
  if updated = original then raise exception 'BLACK_MARKET_ARCHIVE_EDITION_PATCH_MISSING'; end if;
  updated := replace(updated, '''endsAt'', last_edition.ends_at,', $deadline$
      'endsAt', greatest(last_edition.ends_at, (
        select max(a.ends_at) from public.auctions a where a.black_market_day = last_edition.opening_day
      )),$deadline$);
  if strpos(updated, 'greatest(last_edition.ends_at') = 0
  then raise exception 'BLACK_MARKET_ARCHIVE_DEADLINE_PATCH_MISSING'; end if;
  execute updated;
end $patch$;

notify pgrst, 'reload schema';
commit;
