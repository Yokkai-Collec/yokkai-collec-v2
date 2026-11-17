begin;
set local lock_timeout='5s';
-- Same auction/escrow/settlement, now keyed by the two local opening slots.
alter table public.auctions add column mystery_slot smallint not null default 20 check(mystery_slot in (12,20)),
 add column mystery_lr_chance numeric check(mystery_lr_chance between 0 and 1),
 add column mystery_misses integer check(mystery_misses>=0);
drop index public.auctions_mystery_day;
create unique index auctions_mystery_day on public.auctions(mystery_day,mystery_slot) where is_mystery;
alter table public.auctions drop constraint auctions_duration_minutes_check;
alter table public.auctions add constraint auctions_duration_minutes_check check(
 duration_minutes in (15,30,60,240,720,1440) or (is_mystery and duration_minutes in (420,900,1380)));
alter table public.auctions drop constraint auctions_mystery_shape;
alter table public.auctions add constraint auctions_mystery_shape check(
 (not is_mystery and mystery_day is null and mystery_lr_chance is null and mystery_misses is null) or
 (is_mystery and seller_id is null and mystery_day is not null and starting_price=50
  and duration_minutes in (420,900,1380,1440)
  and (mystery_lr_chance is null)=(mystery_misses is null)
  and (status<>'active' or (card_instance_id is null and card_snapshot is null))));
alter table public.event_runtime_config add column mystery_misses integer not null default 0 check(mystery_misses>=0);

-- Single calibration source: missed REVEALS, not elapsed days. At 2/day:
-- day 0/base, 1/1%, 3/1.5%, 7/2.5%, 10/4%, 14/6%, 18/30%, 22+/80%.
create function public.mystery_lr_probability(p_misses integer,p_base numeric) returns numeric
language sql immutable set search_path='' as $$
 with points(n,p) as (values(0,p_base),(2,greatest(p_base,0.01)),(6,greatest(p_base,0.015)),
 (14,greatest(p_base,0.025)),(20,greatest(p_base,0.04)),(28,greatest(p_base,0.06)),
 (36,greatest(p_base,0.30)),(44,0.80)),
 segments as(select n,p,lead(n) over(order by n) next_n,lead(p) over(order by n) next_p from points)
 select least(0.80,case when p_misses>=44 then 0.80 else p+(next_p-p)*(greatest(p_misses,0)-n)/(next_n-n) end)
 from segments where n<=greatest(p_misses,0) order by n desc limit 1
$$;
revoke all on function public.mystery_lr_probability(integer,numeric) from public,anon,authenticated,service_role;

-- Pure calendar helper shared by creator/countdown; native Paris rules handle DST.
create function public.mystery_auction_window(p_now timestamptz)
returns table(starts timestamptz,finishes timestamptz,next_start timestamptz,slot smallint)
language sql stable set search_path='' as $$
 with local_clock as(select p_now at time zone 'Europe/Paris' t),
 edition_window as(select t,case when t::time<time '12:00' then t::date-1 else t::date end d,
 case when t::time>=time '12:00' and t::time<time '20:00' then 12 else 20 end s from local_clock)
 select (d+make_time(s,0,0)) at time zone 'Europe/Paris',
 (case when s=12 then d+time '19:00' else d+1+time '11:00' end) at time zone 'Europe/Paris',
 (case when t::time<time '12:00' then t::date+time '12:00'
 when t::time<time '20:00' then t::date+time '20:00' else t::date+1+time '12:00' end) at time zone 'Europe/Paris',s::smallint
 from edition_window
$$;
revoke all on function public.mystery_auction_window(timestamptz) from public,anon,authenticated,service_role;

-- Keep the private function name and existing minute cron: no parallel job.
create or replace function public.create_daily_mystery_auction() returns void
language plpgsql volatile security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); w record; auction_id uuid; misses integer; base numeric;
begin
 if not (select enabled from public.event_runtime_config where singleton) then return; end if;
 select * into w from public.mystery_auction_window(stamp);
 if stamp>=w.finishes then return; end if; -- 11-12 / 19-20 reveal breaks
 perform public.settle_expired_auctions();
 -- Creator and closing use the same private state row; never alter active odds.
 select mystery_misses into misses from public.event_runtime_config where singleton for update;
 if exists(select 1 from public.auctions where is_mystery and (status='active' or
   (mystery_day=(w.starts at time zone 'Europe/Paris')::date and mystery_slot=w.slot))) then return; end if;
 select count(*) filter(where rarete_base='LR')::numeric/nullif(count(*),0) into base from public.cards;
 if base is null then return; end if;
 insert into public.auctions(is_mystery,mystery_day,mystery_slot,starting_price,current_price,duration_minutes,
 ends_at,created_at,mystery_lr_chance,mystery_misses)
 values(true,(w.starts at time zone 'Europe/Paris')::date,w.slot,50,50,case when w.slot=12 then 420 else 900 end,
 w.finishes,w.starts,case when base=0 then 0 when base=1 then 1 else public.mystery_lr_probability(misses,base) end,misses)
 on conflict(mystery_day,mystery_slot) where is_mystery do nothing returning id into auction_id;
 if auction_id is null then return; end if;
 insert into public.notifications(user_id,type,reference_id)
 select user_id,'mystery_auction_started',auction_id from public.user_profiles on conflict do nothing;
end $$;

-- Only replace the random selection, preserving current money, ownership,
-- notifications, retry fences and ACLs. Legacy active editions keep uniform odds.
do $patch$
declare definition text; updated text;
begin
 definition:=pg_get_functiondef('public.settle_expired_auctions()'::regprocedure);
 updated:=replace(definition,'select * into strict drawn from public.cards order by random() limit 1;', $draw$
 if sale.mystery_lr_chance is null then
  select * into strict drawn from public.cards order by random() limit 1;
 else
  perform 1 from public.event_runtime_config where singleton for update;
  -- One Bernoulli roll, then uniform within LR or all non-LR catalogue cards.
  if random()<sale.mystery_lr_chance then
   select * into drawn from public.cards where rarete_base='LR' order by random() limit 1;
  else
   select * into drawn from public.cards where rarete_base<>'LR' order by random() limit 1;
  end if;
  -- Catalogue edits must never strand escrow if the selected group is empty.
  if drawn.id is null then select * into strict drawn from public.cards order by random() limit 1; end if;
  update public.event_runtime_config set mystery_misses=case when drawn.rarete_base='LR' then 0 else mystery_misses+1 end where singleton;
 end if;
 $draw$);
 if updated=definition then raise exception 'MYSTERY_DRAW_PATCH_MISSING'; end if;
 execute updated;
 definition:=pg_get_functiondef('public.get_auction(uuid)'::regprocedure);
 updated:=replace(definition,'''isMystery'',a.is_mystery,','''isMystery'',a.is_mystery,''mysteryLrChance'',a.mystery_lr_chance,''mysteryMisses'',a.mystery_misses,');
 if updated=definition then raise exception 'MYSTERY_ODDS_RPC_PATCH_MISSING'; end if;
 execute updated;
end $patch$;

create or replace function public.get_mystery_auction_event() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare latest uuid; next_start timestamptz;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if not (select enabled from public.event_runtime_config where singleton) then return null; end if;
 select w.next_start into next_start from public.mystery_auction_window(statement_timestamp()) w;
 select id into latest from public.auctions where is_mystery order by mystery_day desc,mystery_slot desc limit 1;
 return jsonb_build_object('nextStartsAt',next_start,'auction',case when latest is not null then public.get_auction(latest) end);
end $$;

-- Preserve the date-cursor RPC for older clients during deployment. The new
-- timestamp cursor includes both reveals on a day, without skipping page edges.
create function public.list_mystery_auction_history_page(p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 perform public.assert_player_not_banned();
 return(with editions as(select id,mystery_day,card_snapshot,
   (mystery_day+make_time(mystery_slot,0,0)) at time zone 'Europe/Paris' edition_at
   from public.auctions where is_mystery and status in ('sold','expired') and card_snapshot is not null),
 candidates as materialized(select * from editions where p_before is null or edition_at<p_before order by edition_at desc limit 13),
 page as(select * from candidates order by edition_at desc limit 12)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'day',mystery_day,'editionAt',edition_at,'card',card_snapshot) order by edition_at desc) from page),'[]'::jsonb),
 'nextBefore',case when (select count(*) from candidates)>12 then (select min(edition_at) from page) end));
end $$;
revoke all on function public.list_mystery_auction_history_page(timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.list_mystery_auction_history_page(timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
