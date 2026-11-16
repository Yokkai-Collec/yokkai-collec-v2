begin;
-- Reuse the immutable reveal snapshot; active editions never enter this feed.
create function public.list_mystery_auction_history(p_before date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 perform public.assert_player_not_banned();
 return (
  with candidates as materialized (
   select id,mystery_day,card_snapshot from public.auctions
   where is_mystery and status in ('sold','expired') and card_snapshot is not null
    and (p_before is null or mystery_day<p_before)
   order by mystery_day desc limit 13
  ), page as (select * from candidates order by mystery_day desc limit 12)
  select jsonb_build_object(
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'day',mystery_day,'card',card_snapshot) order by mystery_day desc) from page),'[]'::jsonb),
   'nextBefore',case when (select count(*) from candidates)>12 then (select min(mystery_day) from page) end)
 );
end $$;
revoke all on function public.list_mystery_auction_history(date) from public,anon,authenticated,service_role;
grant execute on function public.list_mystery_auction_history(date) to authenticated;
notify pgrst,'reload schema';
commit;
