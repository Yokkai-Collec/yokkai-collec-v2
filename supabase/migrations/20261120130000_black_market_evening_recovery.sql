begin;
set local lock_timeout = '5s';

create or replace function public.recover_black_market_cards(p_user_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  candidate_ids uuid[];
  auction_ids uuid[];
  trade_ids uuid[];
  eligible_ids uuid[];
  cancelled_auctions uuid[] := '{}';
  cancelled_trades uuid[];
  refunded_karas bigint := 0;
  sale record;
  copies uuid[];
  lr integer;
  ssr integer;
begin
  perform 1 from public.black_market_config where singleton and enabled for update;
  if not found then raise exception 'BLACK_MARKET_DISABLED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:' || p_user_id::text, 0));

  select array(
    select c.id from public.user_cards c
    where c.user_id = p_user_id and c.rarity in ('LR', 'SSR')
      and not exists (select 1 from public.black_market_stock s where s.card_instance_id = c.id)
      and not exists (select 1 from public.anticheat_trade_card_holds h where h.card_id = c.id)
  ) into candidate_ids;

  -- Match the auction and trade lock order before acquiring any balances or cards.
  select array(
    select a.id from public.auctions a
    where a.status = 'active' and a.card_instance_id = any(candidate_ids)
    order by a.id for update
  ) into auction_ids;
  select array(
    select o.id from public.trade_offers o
    where o.status = 'pending' and (o.offered_card_ids && candidate_ids or o.requested_card_ids && candidate_ids)
    order by o.id for update
  ) into trade_ids;

  perform 1 from auth.users where id = p_user_id and banned_until = 'infinity'::timestamptz for update;
  if not found then raise exception 'BLACK_MARKET_PERMANENT_BAN_REQUIRED'; end if;
  if not exists (select 1 from public.black_market_bans where user_id = p_user_id
    and banned_at <= clock_timestamp() - interval '14 days') then raise exception 'BLACK_MARKET_WAITING_PERIOD'; end if;

  perform 1 from public.user_profiles where user_id = p_user_id or user_id in (
    select buyer_id from public.auctions where id = any(auction_ids)
  ) order by user_id for no key update;
  select array(
    select c.id from public.user_cards c
    where c.id = any(candidate_ids) and c.user_id = p_user_id and c.rarity in ('LR', 'SSR')
      and not exists (select 1 from public.anticheat_trade_card_holds h where h.card_id = c.id)
    order by c.id for update of c
  ) into eligible_ids;

  for sale in
    select id, buyer_id, current_price from public.auctions
    where id = any(auction_ids) and card_instance_id = any(eligible_ids) and status = 'active'
    order by id
  loop
    if sale.buyer_id is not null then
      perform public.credit_karas(sale.buyer_id, sale.current_price);
      refunded_karas := refunded_karas + sale.current_price;
    end if;
    update public.auctions set status = 'expired', buyer_id = null, current_price = starting_price
    where id = sale.id;
    cancelled_auctions := array_append(cancelled_auctions, sale.id);
  end loop;

  with cancelled as (
    update public.trade_offers o set status = 'cancelled', updated_at = clock_timestamp()
    where o.id = any(trade_ids) and o.status = 'pending'
      and (o.offered_card_ids && eligible_ids or o.requested_card_ids && eligible_ids)
    returning o.id
  )
  select coalesce(array_agg(id order by id), '{}') into cancelled_trades from cancelled;

  with stashed as (
    insert into public.black_market_stock(card_instance_id, source_user_id, recovered_by, card_id, rarity, is_shiny, is_evolved)
    select c.id, p_user_id, p_actor, c.card_id, c.rarity, c.is_shiny, c.is_evolved
    from public.user_cards c where c.id = any(eligible_ids)
      and cardinality(public.black_market_recovery_blocks(c.id)) = 0
    returning card_instance_id, rarity
  )
  select coalesce(array_agg(card_instance_id), '{}'), count(*) filter (where rarity = 'LR'),
    count(*) filter (where rarity = 'SSR') into copies, lr, ssr from stashed;

  if cardinality(copies) > 0 then
    perform public.black_market_detach_copies(copies);
  end if;
  if cardinality(copies || cancelled_auctions || cancelled_trades) > 0 then
    insert into public.admin_audit_logs(admin_user_id, action, metadata)
    values (p_actor, 'black_market.recover', jsonb_build_object(
      'sourceUserId', p_user_id, 'cardIds', copies, 'automatic', p_actor is null,
      'cancelledAuctionIds', cancelled_auctions, 'cancelledTradeIds', cancelled_trades,
      'refundedKaras', refunded_karas));
  end if;
  return jsonb_build_object('recovered', cardinality(copies), 'lr', lr, 'ssr', ssr, 'remaining', (
    select count(*) from public.user_cards c where user_id = p_user_id and rarity in ('LR', 'SSR')
      and not exists (select 1 from public.black_market_stock s where s.card_instance_id = c.id)
  ));
end $$;

-- A contended account is deferred by the worker before it can hold up the job.
alter function public.recover_due_black_market_cards() set lock_timeout = '5s';

-- pg_cron uses UTC here. Only the slot that is 20:00 in Paris runs the worker.
select cron.schedule('black-market-recovery', '0 18,19 * * *',
  'select public.recover_due_black_market_cards() where extract(hour from statement_timestamp() at time zone ''Europe/Paris'') = 20;');

commit;
