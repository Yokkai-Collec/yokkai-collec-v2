begin;
-- Exclude events before filtering, counters and pagination. Detail, bids,
-- settlement and the dedicated event/history readers stay unchanged.
do $$
declare target regprocedure; definition text; updated text;
begin
 foreach target in array array[
  'public.browse_auctions_page(integer,text,text,text,text,text)'::regprocedure,
  'public.list_auctions_page(jsonb,integer)'::regprocedure,
  'public.list_auctions()'::regprocedure
 ] loop
  definition:=pg_get_functiondef(target);
  updated:=replace(definition,'from public.auctions a',
   'from (select * from public.auctions where not is_mystery) a');
  if updated=definition then raise exception 'MYSTERY_MARKET_PATCH_MISSING: %',target; end if;
  execute updated;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
