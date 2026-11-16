begin;
do $$
declare player uuid:=gen_random_uuid(); result jsonb; snapshot jsonb:='{"id":"history-card","name":"History card","rarity":"LR","category":"Anime","image":"https://example.test/card.png"}';
begin
 insert into auth.users(id,raw_user_meta_data) values(player,'{"pseudo":"HistoryViewer"}');
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.list_mystery_auction_history();
  raise exception 'Anonymous history allowed';
 exception when others then
  if sqlerrm<>'AUTH_REQUIRED' then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub',player::text,true);
 assert public.list_mystery_auction_history()->'items'='[]'::jsonb, 'Empty history broken';
 insert into public.auctions(is_mystery,mystery_day,starting_price,current_price,duration_minutes,ends_at,status,card_snapshot)
 select true,date '2025-01-01'+n,50,50,1440,now()-interval '1 day',case when n=0 then 'expired' else 'sold' end,snapshot
 from generate_series(0,12)n;
 -- Overdue but not settled is still secret. Ordinary auctions are never included.
 insert into public.auctions(is_mystery,mystery_day,starting_price,current_price,duration_minutes,ends_at)
 values(true,'2025-02-01',50,50,1440,now()-interval '1 minute');
 insert into public.auctions(seller_id,starting_price,current_price,duration_minutes,ends_at,status,card_snapshot)
 values(player,50,50,1440,now()-interval '1 day','expired',snapshot);
 result:=public.list_mystery_auction_history();
 assert jsonb_array_length(result->'items')=12, 'History page unbounded or secret/ordinary auction included';
 assert result->'items'->0->>'day'='2025-01-13', 'Newest reveal not first';
 assert result->>'nextBefore'='2025-01-02', 'Wrong pagination cursor';
 assert not exists(select 1 from jsonb_array_elements(result->'items')i where i->'card'<>snapshot), 'Snapshot changed';
 result:=public.list_mystery_auction_history((result->>'nextBefore')::date);
 assert jsonb_array_length(result->'items')=1 and result->'items'->0->>'day'='2025-01-01', 'Missing no-bid reveal or repeated page';
 assert result->'nextBefore'='null'::jsonb, 'Last page has cursor';
 assert not has_function_privilege('anon','public.list_mystery_auction_history(date)','execute'), 'Anonymous RPC exposed';
 assert not has_function_privilege('service_role','public.list_mystery_auction_history(date)','execute'), 'Service RPC exposed';
end $$;
rollback;
