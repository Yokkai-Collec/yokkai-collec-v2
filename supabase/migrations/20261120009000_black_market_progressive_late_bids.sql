begin;
set local lock_timeout = '5s';

alter table public.auctions add column black_market_late_raises integer not null default 0
  check (black_market_late_raises >= 0 and (is_black_market or black_market_late_raises = 0));

-- Track accepted late raises on the locked lot. The first bid and rejected
-- offers never advance the ladder, even when inside the extension window.
do $patch$
declare original text; updated text;
begin
  original := pg_get_functiondef('public.place_bid(uuid,integer)'::regprocedure);
  updated := replace(original, 'case when late_black_market_bid then 2 else 1 end',
    'case when late_black_market_bid then 2 + sale.black_market_late_raises::bigint else 1 end');
  if updated = original then raise exception 'BLACK_MARKET_PROGRESSIVE_MINIMUM_PATCH_MISSING'; end if;
  original := updated;
  updated := replace(original, 'update public.auctions set current_price=p_amount,buyer_id=player_id,', $column$
  update public.auctions set current_price=p_amount,buyer_id=player_id,
    black_market_late_raises = black_market_late_raises + (late_black_market_bid and old_buyer is not null)::integer,$column$);
  if updated = original then raise exception 'BLACK_MARKET_PROGRESSIVE_COUNTER_PATCH_MISSING'; end if;
  execute updated;

  original := pg_get_functiondef('public.get_auction(uuid)'::regprocedure);
  updated := replace(original, '''bidIncrement'',case when a.black_market_day is not null then a.starting_price end,',
    '''bidIncrement'',case when a.black_market_day is not null then a.starting_price end,' ||
    '''lateBidIncrement'',case when a.black_market_day is not null then a.starting_price * (2 + a.black_market_late_raises::bigint) end,');
  if updated = original then raise exception 'BLACK_MARKET_PROGRESSIVE_DETAIL_PATCH_MISSING'; end if;
  execute updated;
end $patch$;

notify pgrst, 'reload schema';
commit;
