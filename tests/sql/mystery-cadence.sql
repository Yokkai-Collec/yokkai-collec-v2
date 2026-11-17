begin;
do $$
declare b numeric:=664.0/83229; p numeric; previous numeric:=-1; definition text; stamp text; item jsonb; a uuid; n bigint;
begin
 assert abs(public.mystery_lr_probability(0,b)-b)<0.0000001,'Wrong base rate';
 for i in 0..60 loop
  p:=public.mystery_lr_probability(i,b);
  assert p>=previous and p<=0.8,'Non-monotone or uncapped odds'; previous:=p;
 end loop;
 assert public.mystery_lr_probability(2,b)=0.01,'Day 1';
 assert public.mystery_lr_probability(6,b)=0.015,'Day 3';
 assert public.mystery_lr_probability(14,b)=0.025,'Day 7';
 assert public.mystery_lr_probability(20,b)=0.04,'Day 10';
 assert public.mystery_lr_probability(28,b)=0.06,'Day 14';
 assert public.mystery_lr_probability(36,b)=0.30,'Day 18';
 assert public.mystery_lr_probability(44,b)=0.80,'Day 22';
 assert public.mystery_lr_probability(1,b)>b,'No progress after first reveal';
 assert not has_function_privilege('authenticated','public.mystery_lr_probability(integer,numeric)','execute'),'Client controls probability';

 assert (select next_start='2099-01-08 11:00+00' and finishes='2099-01-08 10:00+00' from public.mystery_auction_window('2099-01-08 10:30+00')),'Morning break';
 assert (select starts='2099-01-08 11:00+00' and finishes='2099-01-08 18:00+00' and next_start='2099-01-08 19:00+00' from public.mystery_auction_window('2099-01-08 11:00+00')),'Noon opening';
 assert (select finishes='2099-01-08 18:00+00' and next_start='2099-01-08 19:00+00' from public.mystery_auction_window('2099-01-08 18:30+00')),'Evening break';
 insert into auth.users(id,raw_user_meta_data) values('21000000-0000-4000-8000-000000000001','{"pseudo":"CadenceViewer"}');
 perform set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
 update public.event_runtime_config set enabled=true;
 insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values
 ('cadence-c','Common','Anime','Test','C','https://example.test/c.png','test'),
 ('cadence-lr','Legend','Anime','Test','LR','https://example.test/lr.png','test');
 definition:=pg_get_functiondef('public.create_daily_mystery_auction()'::regprocedure);
 foreach stamp in array array['2099-01-08 11:00+00','2099-01-08 19:00+00','2099-03-28 19:00+00','2099-10-24 18:00+00'] loop
  update public.auctions set status='expired' where is_mystery and status='active';
  execute replace(definition,'clock_timestamp()',quote_literal(stamp)||'::timestamptz');
  perform public.create_daily_mystery_auction();
  select count(*) into n from public.auctions;
  perform public.create_daily_mystery_auction();
  assert (select count(*)=n from public.auctions),'Duplicate edition';
  select id into a from public.auctions where is_mystery and status='active';
  assert a is not null,'No edition';
  assert (select card_snapshot is null and card_instance_id is null and mystery_lr_chance is not null from public.auctions where id=a),'Early card or missing odds';
  assert (select (ends_at at time zone 'Europe/Paris')::time=case when mystery_slot=12 then time '19:00' else time '11:00' end from public.auctions where id=a),'Wrong deadline';
  if stamp like '2099-03%' then assert (select ends_at-created_at=interval '14 hours' from public.auctions where id=a),'Spring DST'; end if;
  if stamp like '2099-10%' then assert (select ends_at-created_at=interval '16 hours' from public.auctions where id=a),'Autumn DST'; end if;

  select mystery_lr_chance into p from public.auctions where id=a;
  update public.event_runtime_config set mystery_misses=20;
  perform public.create_daily_mystery_auction();
  assert (select mystery_lr_chance=p from public.auctions where id=a),'Active odds changed';
  item:=public.get_auction(a);
  assert item->'card'='null'::jsonb and (item->>'mysteryLrChance')::numeric>0,'Odds RPC or secret';
 end loop;
 execute definition;
 -- Force each random branch deterministically without changing the draw routine.
 update public.auctions set status='expired' where is_mystery and status='active';
 insert into public.auctions(is_mystery,mystery_day,mystery_slot,starting_price,current_price,duration_minutes,ends_at,mystery_lr_chance,mystery_misses)
 values(true,'2099-02-01',12,50,50,420,now()-interval '1 second',0,5) returning id into a;
 update public.event_runtime_config set mystery_misses=5;
 perform public.settle_expired_auctions();
 assert (select card_snapshot->>'rarity'='C' and card_instance_id is null from public.auctions where id=a),'Non-LR no-bid reveal';
 assert (select mystery_misses=6 from public.event_runtime_config),'Miss not advanced';
 perform public.settle_expired_auctions();
 assert (select mystery_misses=6 from public.event_runtime_config),'Double settlement advances pity';
 insert into public.auctions(is_mystery,mystery_day,mystery_slot,starting_price,current_price,duration_minutes,ends_at,mystery_lr_chance,mystery_misses)
 values(true,'2099-02-01',20,50,50,900,now()-interval '1 second',1,6) returning id into a;
 perform public.settle_expired_auctions();
 assert (select card_snapshot->>'rarity'='LR' and card_instance_id is null from public.auctions where id=a),'LR no-bid reveal';
 assert (select mystery_misses=0 from public.event_runtime_config),'LR did not reset';

 -- Each local-date/slot is unique, including concurrent inserts.
 begin
  insert into public.auctions(is_mystery,mystery_day,mystery_slot,starting_price,current_price,duration_minutes,ends_at)
  values(true,'2099-02-01',12,50,50,420,now());
  raise exception 'Duplicate slot allowed';
 exception when unique_violation then null; end;
 -- Both editions of the page-boundary day survive the new cursor.
 insert into public.auctions(is_mystery,mystery_day,mystery_slot,starting_price,current_price,duration_minutes,ends_at,status,card_snapshot)
 select true,date '2080-01-01'+(i/2),case when i%2=0 then 12 else 20 end,50,50,420,now()-interval '1 day','expired',
 '{"id":"archive","name":"Archive","rarity":"LR"}'::jsonb from generate_series(0,12)i;
 item:=public.list_mystery_auction_history_page('2090-01-01');
 assert jsonb_array_length(item->'items')=12,'Unbounded archive';
 assert item->'items'->0->>'day'='2080-01-07','Wrong archive order';
 item:=public.list_mystery_auction_history_page((item->>'nextBefore')::timestamptz);
 assert jsonb_array_length(item->'items')=1 and item->'items'->0->>'day'='2080-01-01','Page skipped same-day reveal';
 assert item->'nextBefore'='null'::jsonb,'Last page cursor';
 assert not has_function_privilege('anon','public.list_mystery_auction_history_page(timestamptz)','execute'),'Public archive';
 assert not has_function_privilege('service_role','public.list_mystery_auction_history_page(timestamptz)','execute'),'Service archive';
 assert not has_table_privilege('authenticated','public.event_runtime_config','update'),'Client alters pity';

end $$;
rollback;
