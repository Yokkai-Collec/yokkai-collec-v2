begin;
do $$
declare
  loser uuid := '20000000-0000-4000-8000-000000000001';
  winner uuid := '20000000-0000-4000-8000-000000000002';
  spectator uuid := '20000000-0000-4000-8000-000000000003';
  auction uuid; empty_auction uuid; item jsonb; copies bigint; definition text; stamp text; deadline timestamptz;
begin
  insert into auth.users(id,raw_user_meta_data) values
    (loser,'{"pseudo":"MysteryLoser"}'),(winner,'{"pseudo":"MysteryWinner"}'),(spectator,'{"pseudo":"MysterySpectator"}');
  update public.user_profiles set karas_balance=1000 where user_id in (loser,winner,spectator);
  insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values ('mystery-test','Mystery test','Anime','Mystery test','LR','https://example.test/card.png','test');
  insert into public.auctions(is_mystery,mystery_week,starting_price,current_price,duration_minutes,ends_at)
    values(true,'2099-01-07',50,50,1440,clock_timestamp()+interval '24 hours') returning id into auction;
  assert (select card_instance_id is null and card_snapshot is null from public.auctions where id=auction), 'card exists before closure';
  perform set_config('request.jwt.claim.sub',spectator::text,true);
  item:=public.get_auction(auction);
  assert item->'card'='null'::jsonb and (item->>'isMystery')::boolean, 'API leaks card';
  assert exists(select 1 from jsonb_array_elements(public.browse_auctions_page()->'items') a where a->>'id'=auction::text and a->'card'='null'::jsonb), 'browse hides event or leaks card';
  assert not has_function_privilege('authenticated','public.create_weekly_mystery_auction()','execute'), 'client can create event';
  assert not has_table_privilege('authenticated','public.auctions','select'), 'raw auction read exposed';
  begin
    update public.auctions set card_snapshot='{}' where id=auction;
    raise exception 'active mystery accepts a card';
  exception when check_violation then null; end;
  perform set_config('request.jwt.claim.sub',loser::text,true);
  perform public.place_bid(auction,60);
  deadline:=clock_timestamp()+interval '2 minutes';
  update public.auctions set ends_at=deadline where id=auction;
  perform set_config('request.jwt.claim.sub',winner::text,true);
  perform public.place_bid(auction,70);
  assert (select ends_at=deadline from public.auctions where id=auction), 'mystery duration extended';
  assert (select count(*)=1 from public.notifications where user_id=loser and reference_id=auction and type='outbid'), 'outbid notification missing';
  assert (select karas_balance=1000 from public.user_profiles where user_id=loser), 'loser not refunded';
  assert (select karas_balance=930 from public.user_profiles where user_id=winner), 'winner not debited';
  -- Deleted accounts leave anonymized losing bids; they must not block closing.
  insert into public.bids(auction_id,bidder_id,amount) values(auction,spectator,10);
  update public.bids set bidder_id=null where auction_id=auction and bidder_id=spectator;
  select count(*) into copies from public.user_cards;
  update public.auctions set ends_at=clock_timestamp()-interval '1 second' where id=auction;
  perform public.settle_expired_auctions();
  assert (select status='sold' and card_snapshot is not null from public.auctions where id=auction), 'no revelation';
  assert (select count(*)=copies+1 from public.user_cards), 'wrong copy count';
  assert exists(select 1 from public.auctions a join public.user_cards u on u.id=a.card_instance_id
    where a.id=auction and u.user_id=winner and not u.is_shiny and not u.is_evolved
      and u.card_id=(a.card_snapshot->>'id')::uuid), 'wrong award';
  assert (select sum(karas_balance)=2930 from public.user_profiles where user_id in(loser,winner,spectator)), 'Karas not burned';
  assert (select count(*)=2 from public.notifications where reference_id=auction and type='mystery_auction_result'), 'participant results missing';
  item:=public.list_notifications();
  assert exists(select 1 from jsonb_array_elements(item) n where n->>'type'='mystery_auction_result' and n->>'cardName' is not null), 'notification revelation missing';
  perform set_config('request.jwt.claim.sub',spectator::text,true);
  assert public.get_auction(auction)->'card'->>'id' is not null, 'spectator cannot see reveal';
  perform public.settle_expired_auctions();
  assert (select count(*)=copies+1 from public.user_cards), 'duplicate settlement';
  insert into public.auctions(is_mystery,mystery_week,starting_price,current_price,duration_minutes,ends_at)
    values(true,'2099-01-14',50,50,1440,clock_timestamp()-interval '1 second') returning id into empty_auction;
  perform public.settle_expired_auctions();
  assert (select status='expired' and card_instance_id is null and card_snapshot->>'id' is not null from public.auctions where id=empty_auction), 'no-bid revelation failed';
  assert (select count(*)=copies+1 from public.user_cards), 'unsold card awarded';
  assert exists(select 1 from cron.job where jobname='weekly-mystery-auction'
    and schedule=case when current_setting('cron.timezone',true)='Europe/Paris' then '0 20 * * 3' else '0 * * * *' end
    and command='select public.create_weekly_mystery_auction();' and active), 'weekly job missing';

  -- Exercise the REAL creator with a fixed server clock, rolled back below.
  definition:=pg_get_functiondef('public.create_weekly_mystery_auction()'::regprocedure);
  foreach stamp in array array['2099-01-07 19:00:00+00','2099-07-08 18:00:00+00'] loop
    execute replace(definition,'clock_timestamp()',quote_literal(stamp)||'::timestamptz');
    -- Fixtures already use Jan 7; remove it solely within this rollback test.
    delete from public.notifications where reference_id in(select id from public.auctions where mystery_week=(stamp::timestamptz at time zone 'Europe/Paris')::date);
    delete from public.auctions where mystery_week=(stamp::timestamptz at time zone 'Europe/Paris')::date;
    perform public.create_weekly_mystery_auction();
    perform public.create_weekly_mystery_auction();
    assert (select count(*)=1 from public.auctions where mystery_week=(stamp::timestamptz at time zone 'Europe/Paris')::date), 'creator not idempotent across DST';
    assert (select ends_at-created_at=interval '24 hours' and card_snapshot is null and card_instance_id is null
      from public.auctions where mystery_week=(stamp::timestamptz at time zone 'Europe/Paris')::date), 'wrong duration or premature draw';
  end loop;
  execute replace(definition,'clock_timestamp()',quote_literal('2099-07-08 17:00:00+00')||'::timestamptz');
  select count(*) into copies from public.auctions;
  perform public.create_weekly_mystery_auction();
  assert (select count(*)=copies from public.auctions), 'event created outside Paris hour';

  definition:=pg_get_functiondef('public.get_mystery_auction_event()'::regprocedure);
  foreach stamp in array array['2026-03-25 20:00:00+00','2026-10-21 20:00:00+00'] loop
    execute replace(definition,'statement_timestamp()',quote_literal(stamp)||'::timestamptz');
    item:=public.get_mystery_auction_event();
    assert (item->>'nextStartsAt')::timestamptz=case when stamp like '2026-03%' then '2026-04-01 18:00:00+00'::timestamptz else '2026-10-28 19:00:00+00'::timestamptz end, 'next countdown ignores DST';
  end loop;
end $$;
rollback;
