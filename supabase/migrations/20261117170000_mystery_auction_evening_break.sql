begin;
set local lock_timeout='5s';
-- A 23h nominal duration is system-only; normal auction durations stay unchanged.
alter table public.auctions drop constraint auctions_duration_minutes_check;
alter table public.auctions add constraint auctions_duration_minutes_check
 check(duration_minutes in (15,30,60,240,720,1440) or (is_mystery and duration_minutes=1380));
alter table public.auctions drop constraint auctions_mystery_shape;
alter table public.auctions add constraint auctions_mystery_shape check (
 (not is_mystery and mystery_day is null) or
 (is_mystery and seller_id is null and mystery_day is not null
  and starting_price=50 and duration_minutes in (1380,1440)
  and (status<>'active' or (card_instance_id is null and card_snapshot is null)))
);
-- Keep the existing daily cycle, escrow and minute settlement. Only its
-- bidding deadline moves: 20:00 start, next-day 19:00 close, one-hour break.
create or replace function public.create_daily_mystery_auction() returns void
language plpgsql volatile security definer set search_path='' as $$
declare local_now timestamp:=clock_timestamp() at time zone 'Europe/Paris'; auction_id uuid; starts timestamptz;
begin
  if not (select enabled from public.event_runtime_config where singleton) then return; end if;
  if local_now::time<time '20:00' or exists(select 1 from public.auctions where is_mystery and mystery_day=local_now::date) then return; end if;
  perform public.settle_expired_auctions();
  starts:=(local_now::date+time '20:00') at time zone 'Europe/Paris';
  insert into public.auctions(is_mystery,mystery_day,starting_price,current_price,duration_minutes,ends_at,created_at)
    values(true,local_now::date,50,50,1380,((local_now::date+1)+time '19:00') at time zone 'Europe/Paris',starts)
    on conflict (mystery_day) where is_mystery do nothing returning id into auction_id;
  if auction_id is null then return; end if;
  insert into public.notifications(user_id,type,reference_id)
    select user_id,'mystery_auction_started',auction_id from public.user_profiles
    on conflict do nothing;
end $$;

-- Existing bids remain escrowed. If this deadline has already passed, the
-- existing settlement cron reveals and awards the card on its next tick.
update public.auctions
set duration_minutes=1380,ends_at=((mystery_day+1)+time '19:00') at time zone 'Europe/Paris'
where is_mystery and status='active';
notify pgrst,'reload schema';
commit;
