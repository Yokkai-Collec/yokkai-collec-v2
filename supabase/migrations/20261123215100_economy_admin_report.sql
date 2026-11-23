begin;

-- Financial flow summaries count wallet deltas or a documented escrow burn,
-- never the bid debit and the settlement as two monetary losses.
create view economy_private.flows as
select occurred_at, 'w:'||id::text as operation, user_id, kind,category,
  delta,abs(delta) amount
from economy_private.wallet where kind in ('source','sink','adjustment','unknown')
union all
select occurred_at,'s:'||subject_id::text,buyer,'sink',channel||'_settlement',-burned,burned
from economy_private.operations where action='sale' and burned>0;

create function economy_private.flows_between(p_from timestamptz,p_to timestamptz)
returns table(created numeric,destroyed numeric,adjustments numeric,unknown_delta numeric,unknown_count bigint)
language sql stable set search_path = '' as $$
  select coalesce(sum(amount) filter(where kind='source'),0),
    coalesce(sum(amount) filter(where kind='sink'),0),
    coalesce(sum(delta) filter(where kind='adjustment'),0),
    coalesce(sum(delta) filter(where kind='unknown'),0),
    count(*) filter(where kind='unknown')
  from economy_private.flows where occurred_at>=p_from and occurred_at<p_to
$$;

create function economy_private.market_sales(p_from timestamptz,p_to timestamptz,p_search text)
returns setof economy_private.operations language sql stable set search_path = '' as $$
  select h.* from economy_private.history h
  where h.action='sale' and h.channel='auction' and h.amount>0
    and h.occurred_at>=p_from and h.occurred_at<p_to
    and not exists (select 1 from economy_private.operations r where r.action='reversal' and r.subject_id=h.subject_id)
    and (p_search='' or strpos(lower(coalesce(h.card_name,'')||' '||coalesce(h.franchise,'')),lower(p_search))>0)
$$;

-- Only completed operations. Count each directional leg once even when both
-- sides gave Kara. Seller credits are paired with escrow, not wallet gains.
create function economy_private.transfer_legs(p_from timestamptz,p_to timestamptz)
returns table(occurred_at timestamptz,sender uuid,recipient uuid,amount bigint)
language sql stable set search_path = '' as $$
  select h.occurred_at,leg.sender,leg.recipient,leg.amount
  from economy_private.history h cross join lateral (
    select h.seller,h.buyer,h.amount where h.action='trade'
    union all select h.buyer,h.seller,h.return_amount where h.action='trade'
    union all select h.buyer,h.seller,h.amount where h.action='sale' and h.channel='auction'
      and not exists (select 1 from economy_private.operations r where r.action='reversal' and r.subject_id=h.subject_id)
  ) leg(sender,recipient,amount)
  where h.occurred_at>=p_from and h.occurred_at<p_to and leg.amount>0
$$;

create function public.admin_get_economy(
  p_section text default 'overview', p_days integer default 30, p_bucket text default 'day',
  p_active boolean default true, p_page integer default 0, p_query text default ''
) returns jsonb language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare
  stamp timestamptz := statement_timestamp();
  settings economy_private.settings%rowtype;
  from_at timestamptz; previous_at timestamptz; covered_at timestamptz;
  snapshot7 economy_private.snapshots%rowtype; snapshot30 economy_private.snapshots%rowtype;
  initial economy_private.snapshots%rowtype; latest economy_private.snapshots%rowtype;
  current_wallet numeric; current_escrow numeric; money numeric; market_since timestamptz;
  result jsonb;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_days is null or p_days not in (0,1,7,30,90) or p_bucket is null or p_bucket not in ('day','week','month')
    or p_section is null or p_section not in ('overview','flows','distribution','players','market','cohorts','activity','risks')
    or p_active is null or p_page is null or p_page not between 0 and 9999
    or p_query is null or length(p_query)>80 then raise exception 'INVALID_ECONOMY_FILTER'; end if;

  select * into strict settings from economy_private.settings;
  from_at := case when p_days=0 then '-infinity'::timestamptz else stamp-make_interval(days=>p_days) end;
  previous_at := case when p_days=0 then from_at else from_at-make_interval(days=>p_days) end;
  covered_at := greatest(from_at,settings.starts_at);
  if p_section in ('overview','risks') then
    select * into initial from economy_private.snapshots order by day limit 1;
    select * into latest from economy_private.snapshots order by day desc limit 1;
    select * into snapshot7 from economy_private.snapshots where day=stamp::date-7;
    select * into snapshot30 from economy_private.snapshots where day=stamp::date-30;
    select coalesce(sum(balance),0),coalesce(sum(escrow),0) into current_wallet,current_escrow from economy_private.holdings;
    money := current_wallet+current_escrow;
  end if;

  if p_section in ('market','risks') then
    select least(settings.starts_at,min(occurred_at)) into market_since
    from public.anticheat_events where event_type='auction_sold';
  end if;

  case p_section
  when 'overview' then
    select jsonb_build_object(
      'money',money::text,'wallet',current_wallet::text,'escrow',current_escrow::text,
      'tradeHolds',(select coalesce(sum(amount::bigint),0)::text from public.anticheat_trade_kara_holds),
      'after7', (money-snapshot7.balance_total-snapshot7.escrow)::text,
      'after30',(money-snapshot30.balance_total-snapshot30.escrow)::text,
      'previousMoney',(previous.balance_total+previous.escrow)::text,
      'baselineAt',previous.captured_at,
      'previousActive',case when p_days=30 then previous.active_players end,
      'growthChange',round(
        100*(money-previous.balance_total-previous.escrow)/nullif(previous.balance_total+previous.escrow,0)
        - 100*((previous.balance_total+previous.escrow)-(prior_snapshot.balance_total+prior_snapshot.escrow))
          /nullif(prior_snapshot.balance_total+prior_snapshot.escrow,0),2
      ),
      'growth',round(100*(money-previous.balance_total-previous.escrow)/nullif(previous.balance_total+previous.escrow,0),2),
      'growth7',round(100*(money-snapshot7.balance_total-snapshot7.escrow)/nullif(snapshot7.balance_total+snapshot7.escrow,0),2),
      'growth30',round(100*(money-snapshot30.balance_total-snapshot30.escrow)/nullif(snapshot30.balance_total+snapshot30.escrow,0),2),
      'created',f.created::text,'destroyed',f.destroyed::text,'net',(f.created-f.destroyed)::text,
      'adjustments',f.adjustments::text,'unknown',f.unknown_delta::text,'unclassified',f.unknown_count,
      'previous',case when p_days>0 and previous_at>=settings.starts_at then
        jsonb_build_object('created',prior.created::text,'destroyed',prior.destroyed::text,'net',(prior.created-prior.destroyed)::text) end,
      'active',(select count(*) from economy_private.holdings where last_seen_at is not null and last_seen_at>=from_at),
      'eligible',(select count(*) from economy_private.holdings),
      'holders',(select count(*) from economy_private.holdings where total>0),
      'average',(select round(avg(total),2)::text from economy_private.holdings),
      'median',(select ((percentile_disc(.5) within group(order by total)::numeric+
        percentile_disc(.5) within group(order by total desc))/2)::text from economy_private.holdings),
      'reconciledAt',latest.captured_at,
      'walletDiscrepancy',(latest.balance_total-initial.balance_total-latest.wallet_delta+initial.wallet_delta)::text,
      'series',(select coalesce(jsonb_agg(jsonb_build_object('at',s.captured_at,'value',(s.balance_total+s.escrow)::text) order by s.day),'[]')
        from (select * from economy_private.snapshots where captured_at>=covered_at order by day desc limit 400)s)
    ) into result
    from economy_private.flows_between(covered_at,stamp) f
    cross join economy_private.flows_between(previous_at,from_at) prior
    left join lateral (
      select * from economy_private.snapshots
      where (p_days=0 and day=initial.day) or (p_days>0 and day=stamp::date-p_days)
      limit 1
    ) previous on true
    left join economy_private.snapshots prior_snapshot on p_days>0 and prior_snapshot.day=stamp::date-2*p_days;

  when 'flows' then
    with events as materialized (
      select * from economy_private.flows where occurred_at>=covered_at and occurred_at<stamp
    ), ranked as (
      select kind,category,sum(amount)::text amount,count(distinct operation) operations,count(distinct user_id) players,
        round(100*sum(amount)/nullif(sum(sum(amount)) over(partition by kind),0),2) share
      from events group by kind,category
    ), buckets as (
      select date_trunc(p_bucket,occurred_at) at,
        coalesce(sum(amount) filter(where kind='source'),0)::text created,
        coalesce(sum(amount) filter(where kind='sink'),0)::text destroyed,
        coalesce(sum(delta) filter(where kind in ('source','sink')),0)::text net
      from events group by 1 order by 1 desc limit 400
    ), trend as (
      select date_trunc(p_bucket,occurred_at) at,kind,category,sum(amount)::text amount
      from events where occurred_at >= (select min(at) from buckets)
      group by 1,2,3
    )
    select jsonb_build_object(
      'categories',(select coalesce(jsonb_agg(to_jsonb(r) order by kind,amount::numeric desc),'[]') from ranked r),
      'series',(select coalesce(jsonb_agg(to_jsonb(buckets) order by at),'[]') from buckets),
      'trend',(select coalesce(jsonb_agg(to_jsonb(trend) order by at),'[]') from trend)
    ) into result;

  when 'distribution' then
    with ranked as (
      select total,row_number() over(order by total,user_id) n,count(*) over() size,
        sum(total) over(order by total,user_id) cumulative,sum(total) over() wealth
      from economy_private.holdings where not p_active or last_seen_at>=stamp-interval '30 days'
    ), summary as (
      select count(*) players,coalesce(sum(total),0)::text money,round(avg(total),2)::text average,
        ((percentile_disc(.5) within group(order by total)::numeric+
          percentile_disc(.5) within group(order by total desc))/2)::text median,
        round(100*sum(total) filter(where n>size-ceil(size*.01))/nullif(sum(total),0),2) top1,
        round(100*sum(total) filter(where n>size-ceil(size*.05))/nullif(sum(total),0),2) top5,
        round(100*sum(total) filter(where n>size-ceil(size*.10))/nullif(sum(total),0),2) top10,
        round(100*coalesce(sum(total) filter(where n<=floor(size*.5)),0)/nullif(sum(total),0),2) bottom50,
        round(2*sum(n::numeric*total)/nullif(max(size)*sum(total),0)-(max(size)+1)::numeric/nullif(max(size),0),4) gini
      from ranked
    ), points as (
      select g.pct population,
        case when r.wealth>0 then round(100*r.cumulative/r.wealth,4) end wealth
      from generate_series(0,100,5) g(pct)
      left join ranked r on r.n=ceil(g.pct*r.size/100.0)
    )
    select to_jsonb(summary)||jsonb_build_object('activeOnly',p_active,'lorenz',
      (select jsonb_agg(jsonb_build_object('population',population,'wealth',case when population=0 and summary.money::numeric>0 then 0 else wealth end) order by population) from points))
    into result from summary;

  when 'players' then
    with pool as materialized (
      select * from economy_private.holdings where not p_active or last_seen_at>=stamp-interval '30 days'
    ), page as materialized (
      select * from pool order by total desc,user_id limit 25 offset p_page*25
    ), coverage as (select greatest(settings.starts_at,stamp-interval '30 days') since),
    spending as (
      select f.user_id,coalesce(sum(f.amount) filter(where kind='source'),0)::text created,
        coalesce(sum(f.amount) filter(where kind='sink'),0)::text spent
      from economy_private.flows f join page p using(user_id)
      where f.occurred_at>=(select since from coverage) group by f.user_id
    ), legs as materialized (select * from economy_private.transfer_legs(stamp-interval '30 days',stamp)),
    totals as (
      select p.user_id,coalesce((select sum(amount) from legs where sender=p.user_id),0)::text sent,
        coalesce((select sum(amount) from legs where recipient=p.user_id),0)::text received
      from page p
    )
    select jsonb_build_object('page',p_page,'pageSize',25,'total',(select count(*) from pool),'since',(select since from coverage),'rows',
      (select coalesce(jsonb_agg(jsonb_build_object(
        'id',p.user_id,'player',p.pseudo,'balance',p.balance::text,'total',p.total::text,
        'share',round(100*p.total/nullif((select sum(total) from pool),0),3),
        'created',coalesce(s.created,'0'),'spent',coalesce(s.spent,'0'),'sent',t.sent,'received',t.received,
        'joined',p.created_at,'lastSeen',p.last_seen_at) order by p.total desc,p.user_id),'[]')
      from page p left join spending s using(user_id) join totals t using(user_id))
    ) into result;

  when 'market' then
    with sales as materialized (select * from economy_private.market_sales(least(from_at,stamp-interval '60 days'),stamp,p_query)),
    stats as (
      select coalesce(rarity,'unknown') rarity,count(*) sales,round(avg(amount),2)::text average,
        round(percentile_cont(.5) within group(order by amount)::numeric,2)::text median,min(amount)::text lowest,
        max(amount)::text highest,sum(amount)::text volume
      from sales where occurred_at>=from_at group by 1
    ), comparisons as (
      select coalesce(rarity,'unknown') rarity,
        percentile_disc(.5) within group(order by amount) filter(where occurred_at>=stamp-interval '7 days') median7,
        percentile_disc(.5) within group(order by amount) filter(where occurred_at<stamp-interval '7 days' and occurred_at>=stamp-interval '14 days') old7,
        percentile_disc(.5) within group(order by amount) filter(where occurred_at>=stamp-interval '30 days') median30,
        percentile_disc(.5) within group(order by amount) filter(where occurred_at<stamp-interval '30 days') old30
      from sales where occurred_at>=stamp-interval '60 days' group by 1
    ), series as (
      select date_trunc(p_bucket,occurred_at) at,coalesce(rarity,'unknown') rarity,
        round(percentile_cont(.5) within group(order by amount)::numeric,2)::text median,count(*) sales
      from sales where occurred_at>=from_at group by 1,2 order by 1 desc limit 2400
    )
    select jsonb_build_object('stats',(select coalesce(jsonb_agg(to_jsonb(s)||
       jsonb_build_object('change7',case when market_since<=stamp-interval '14 days' then round(100*(median7-old7)::numeric/nullif(old7,0),2) end,
         'change30',case when market_since<=stamp-interval '60 days' then round(100*(median30-old30)::numeric/nullif(old30,0),2) end) order by rarity),'[]')
       from stats s join comparisons c using(rarity)),
      'series',(select coalesce(jsonb_agg(to_jsonb(series) order by at,rarity),'[]') from series)) into result;

  when 'cohorts' then
    with members as materialized (select *,economy_private.cohort(created_at,stamp) generation from economy_private.holdings),
    groups as (
      select generation,count(*) players,round(avg(total),2)::text average,
        ((percentile_disc(.5) within group(order by total)::numeric+
          percentile_disc(.5) within group(order by total desc))/2)::text median
      from members group by generation
    ), flows_by_age as (
      select m.generation,coalesce(sum(f.amount) filter(where kind='source'),0)::text created,
        coalesce(sum(f.amount) filter(where kind='sink'),0)::text spent
      from members m join economy_private.flows f using(user_id)
      where f.occurred_at>=covered_at and f.occurred_at<stamp group by m.generation
    ), incoming as (
      select m.generation,sum(l.amount)::text received from economy_private.transfer_legs(from_at,stamp) l
      join members m on m.user_id=l.recipient group by m.generation
    ), sales as (
      select m.generation,count(*) sales
      from economy_private.history h join members m on m.user_id=h.seller
      where h.action='sale' and h.channel='auction' and h.occurred_at>=from_at and h.occurred_at<stamp
        and not exists(select 1 from economy_private.operations r where r.action='reversal' and r.subject_id=h.subject_id)
      group by m.generation
    ), cards as (
      select s.captured_at,s.card_cohorts from economy_private.snapshots s
      where s.card_cohorts is not null order by s.day desc limit 1
    )
    select jsonb_build_object('cohorts',
      (select jsonb_agg(to_jsonb(g)||jsonb_build_object('created',coalesce(f.created,'0'),'spent',coalesce(f.spent,'0'),
        'received',coalesce(i.received,'0'),'sales',coalesce(s.sales,0)) order by g.generation)
      from groups g left join flows_by_age f using(generation) left join incoming i using(generation) left join sales s using(generation)),
      'cards',(select card_cohorts from cards),'cardsAt',(select captured_at from cards),
      'catchup',round(100*(select median::numeric from groups where generation='new')/
        nullif((select median::numeric from groups where generation='veteran'),0),2))
    into result;

  when 'activity' then
    with events as materialized (select * from economy_private.history where occurred_at>=from_at and occurred_at<stamp),
    settled as materialized (
      select * from events e where action='sale'
        and not exists(select 1 from economy_private.operations r where r.action='reversal' and r.subject_id=e.subject_id)
    ), trades as (select * from events where action='trade' and amount+return_amount>0),
    transfers as (
      select occurred_at,'trade' channel,amount+return_amount amount from trades
      union all select occurred_at,channel,amount from settled
    ), player_transfers as (
      select * from transfers where channel in ('auction','trade')
    ), series as (
      select date_trunc(p_bucket,occurred_at) at,channel,count(*) operations,sum(amount)::text amount
      from transfers group by 1,2 order by 1 desc limit 1600
    )
    select jsonb_build_object(
      'listed',(select count(*) from events where action='listing'),
      'cancelled',(select count(*) from events where action='cancel'),
      'reversed',(select count(*) from events where action='reversal'),
      'sold',(select count(*) from settled),
      'volume',(select coalesce(sum(amount),0)::text from settled),
      'median',(select round(percentile_cont(.5) within group(order by amount)::numeric,2)::text from settled),
      'buyers',(select count(distinct buyer) from settled),'sellers',(select count(distinct seller) from settled),
      'rarities',(select coalesce(jsonb_object_agg(rarity,amount),'{}') from
        (select coalesce(rarity,'unknown') rarity,count(*) amount from settled group by 1) by_rarity),
      'transferCount',(select count(*) from player_transfers),
      'transferVolume',(select coalesce(sum(amount),0)::text from player_transfers),
      'transferMedian',(select round(percentile_cont(.5) within group(order by amount)::numeric,2)::text from player_transfers),
      'tradeCount',(select count(*) from trades),
      'tradeVolume',(select coalesce(sum(amount+return_amount),0)::text from trades),
      'tradeMedian',(select round(percentile_cont(.5) within group(order by amount+return_amount)::numeric,2)::text from trades),
      'senders',(select count(distinct sender) from economy_private.transfer_legs(from_at,stamp)),
      'recipients',(select count(distinct recipient) from economy_private.transfer_legs(from_at,stamp)),
      'directTransfers',null,
      'series',(select coalesce(jsonb_agg(to_jsonb(series) order by at,channel),'[]') from series))
    into result;

  when 'risks' then
    with current_sales as materialized (select * from economy_private.market_sales(stamp-interval '30 days',stamp,'')),
    previous_sales as materialized (select * from economy_private.market_sales(stamp-interval '60 days',stamp-interval '30 days','')),
    market as (
      select (select count(*) from current_sales) n,(select count(*) from previous_sales) old_n,
        (select sum(amount) from current_sales) volume,(select sum(amount) from previous_sales) old_volume,
        (select count(distinct buyer) from current_sales) buyers,(select count(distinct buyer) from previous_sales) old_buyers,
        (select count(*) from current_sales where rarity='LR') lr_n,
        (select count(*) from previous_sales where rarity='LR') lr_old_n,
        (select percentile_cont(.5) within group(order by amount)::numeric from current_sales where rarity='LR') price,
        (select percentile_cont(.5) within group(order by amount)::numeric from previous_sales where rarity='LR') old_price
    ), values_now as (
      select round(100*(money-snapshot30.balance_total-snapshot30.escrow)/nullif(snapshot30.balance_total+snapshot30.escrow,0),2) money_growth,
        case when snapshot30.active_players>=20 and
          (select count(*) from economy_private.holdings where last_seen_at>=stamp-interval '30 days')>=20
          then economy_private.top_share(true,.10,stamp)-snapshot30.active_top10 end concentration,
        case when latest.veteran_median>0 and snapshot30.veteran_median>0
          and least(latest.new_players,latest.veteran_players,snapshot30.new_players,snapshot30.veteran_players)>=5
          then round(100*(snapshot30.new_median/snapshot30.veteran_median-latest.new_median/latest.veteran_median),2)
        end catchup,
        case when market_since<=stamp-interval '60 days' and lr_n>=settings.min_sales and lr_old_n>=settings.min_sales
          then round(100*(price-old_price)::numeric/nullif(old_price,0),2) end prices,
        case when market_since<=stamp-interval '60 days' and n>=settings.min_sales and old_n>=settings.min_sales
          then least(round(100*(old_volume-volume)/nullif(old_volume,0),2),
            round(100*(old_buyers-buyers)::numeric/nullif(old_buyers,0),2)) end activity
      from market
    )
    select jsonb_build_object('alerts',jsonb_build_array(
      jsonb_build_object('key','money','value',v.money_growth,'threshold',settings.money_growth,'alert',v.money_growth>=settings.money_growth),
      jsonb_build_object('key','concentration','value',v.concentration,'threshold',settings.concentration_points,'alert',v.concentration>=settings.concentration_points),
      jsonb_build_object('key','progression','value',v.catchup,'threshold',settings.progression_points,'alert',v.catchup>=settings.progression_points),
      jsonb_build_object('key','prices','value',v.prices,'threshold',settings.price_growth,'alert',v.prices>=settings.price_growth,'samples',m.lr_n,'previousSamples',m.lr_old_n),
      jsonb_build_object('key','activity','value',v.activity,'threshold',settings.activity_drop,'alert',v.activity>=settings.activity_drop,'samples',m.n,'previousSamples',m.old_n)),
      'minSales',settings.min_sales)
    into result from values_now v cross join market m;
  end case;
  return result || jsonb_build_object('asOf',stamp,'startsAt',settings.starts_at,'marketSince',market_since,'partial',from_at<settings.starts_at and p_days>0,'days',p_days);
end;
$$;

create function public.admin_set_economy_thresholds(
  p_money numeric,p_concentration numeric,p_prices numeric,p_progression numeric,p_activity numeric,p_min_sales integer
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  update economy_private.settings set money_growth=p_money,concentration_points=p_concentration,
    price_growth=p_prices,progression_points=p_progression,activity_drop=p_activity,min_sales=p_min_sales
  where singleton;
end;
$$;
revoke all on all functions in schema economy_private from public, anon, authenticated, service_role;
revoke all on all tables in schema economy_private from public, anon, authenticated, service_role;
revoke all on function public.admin_get_economy(text,integer,text,boolean,integer,text),
  public.admin_set_economy_thresholds(numeric,numeric,numeric,numeric,numeric,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_economy(text,integer,text,boolean,integer,text),
  public.admin_set_economy_thresholds(numeric,numeric,numeric,numeric,numeric,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
