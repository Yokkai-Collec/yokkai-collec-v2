begin;
set local lock_timeout = '3s';

create schema economy_private;
revoke all on schema economy_private from public, anon, authenticated, service_role;

create table economy_private.settings (
  singleton boolean primary key default true check (singleton),
  starts_at timestamptz not null default clock_timestamp(),
  money_growth numeric not null default 5 check (money_growth between 1 and 1000),
  concentration_points numeric not null default 3 check (concentration_points between 1 and 100),
  price_growth numeric not null default 15 check (price_growth between 1 and 1000),
  progression_points numeric not null default 10 check (progression_points between 1 and 100),
  activity_drop numeric not null default 20 check (activity_drop between 1 and 100),
  min_sales integer not null default 20 check (min_sales between 5 and 1000)
);

create table economy_private.wallet (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  operation_id bigint not null default txid_current(),
  user_id uuid not null,
  delta bigint not null check (delta <> 0),
  kind text not null check (kind in ('source','sink','transfer','reservation','adjustment','unknown')),
  category text not null
);
create index economy_wallet_date_idx on economy_private.wallet (occurred_at);
create index economy_wallet_user_date_idx on economy_private.wallet (user_id, occurred_at);

create table economy_private.operations (
  action text not null check (action in ('listing','sale','cancel','expiry','trade','reversal')),
  subject_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  seller uuid,
  buyer uuid,
  amount bigint not null default 0 check (amount >= 0),
  return_amount bigint not null default 0 check (return_amount >= 0),
  burned bigint not null default 0 check (burned between 0 and amount),
  channel text not null check (channel in ('auction','mystery','black_market','trade')),
  rarity text,
  card_name text,
  franchise text,
  primary key (action, subject_id)
);
create index economy_operations_date_idx on economy_private.operations (occurred_at);

create table economy_private.snapshots (
  day date primary key,
  captured_at timestamptz not null,
  balance_total numeric not null,
  escrow numeric not null,
  trade_holds numeric not null,
  wallet_delta numeric not null,
  eligible integer not null,
  holders integer not null,
  active_players integer not null,
  new_players integer not null,
  veteran_players integer not null,
  top10 numeric,
  active_top10 numeric,
  new_median numeric,
  veteran_median numeric,
  card_cohorts jsonb
);
alter table economy_private.settings enable row level security;
alter table economy_private.wallet enable row level security;
alter table economy_private.operations enable row level security;
alter table economy_private.snapshots enable row level security;
revoke all on all tables in schema economy_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema economy_private from public, anon, authenticated, service_role;

-- The context is used only for a whitelist of actual server routines. Do not
-- store the stack, SQL text, user input or security metadata in the journal.
create function economy_private.capture_wallet() returns trigger
language plpgsql security definer set search_path = '' as $$
declare amount bigint; player uuid; caller text; category text; kind text;
begin
  if tg_op = 'DELETE' then
    player := old.user_id; amount := -old.karas_balance::bigint;
    kind := 'adjustment'; category := 'account_closed';
  elsif tg_op = 'INSERT' then
    player := new.user_id; amount := new.karas_balance::bigint;
    kind := 'source'; category := 'opening_balance';
  else
    player := new.user_id; amount := new.karas_balance::bigint - old.karas_balance::bigint;
    if amount = 0 then return null; end if;
    get diagnostics caller = pg_context;
    select c.kind, c.category into kind, category
    from (values
      ('claim_mission_milestone', 'source',
        case current_setting('yokkai_economy.mission_period',true) when 'daily' then 'mission_daily'
          when 'weekly' then 'mission_weekly' else 'mission' end, 1),
      ('(claim_achievement|claim_achievement_upgrade|claim_catalogue_achievement|claim_legacy_transcendence_reward)', 'source','achievement',2),
      ('(discard_collection_card|discard_collection_cards)', 'source','card_recycle',3),
      ('(discard_regular_pack_card|discard_decision_pack_card|discard_decision_pack|keep_decision_pack_card)', 'source','pack_recycle',4),
      ('settle_referral_events', 'source','referral_event',5),
      ('redeem_karas_gift_code', 'source','gift_code',6),
      ('buy_blackout_packs', 'sink','blackout_pack',7),
      ('place_bid', 'reservation',case when amount < 0 then 'auction_hold' else 'auction_outbid' end,8),
      ('settle_expired_auctions', 'transfer','auction_settlement',9),
      ('anticheat_settle_trade', 'transfer','trade_settlement',10),
      ('(admin_apply_anticheat_asset_recovery|recover_anticheat_referral_sponsor_assets|admin_apply_smurf_sanction|admin_apply_deleted_smurf_recovery|admin_apply_sanction|admin_apply_deleted_account_sanction|admin_compensate_anticheat_recovery|recover_black_market_cards|apply_account_ban_core|prepare_account_deletion_without_billing|admin_delete_card_core|admin_remove_player_card)', 'adjustment','administrative',11)
    ) c(pattern,kind,category,priority)
    where caller ~ ('(^|\n)PL/pgSQL function (public\.)?' || c.pattern || '\(')
      and (c.kind <> 'source' or amount > 0) and (c.kind <> 'sink' or amount < 0)
    order by c.priority limit 1;
    kind := coalesce(kind,'unknown'); category := coalesce(category,'unclassified');
  end if;
  if amount <> 0 then
    insert into economy_private.wallet(user_id,delta,kind,category) values (player,amount,kind,category);
  end if;
  return null;
end;
$$;
revoke all on function economy_private.capture_wallet() from public, anon, authenticated, service_role;

create function economy_private.mark_mission_period() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform set_config('yokkai_economy.mission_period',new.period,true);
  return null;
end;
$$;
revoke all on function economy_private.mark_mission_period() from public, anon, authenticated, service_role;
create trigger economy_mission_period after insert on public.user_milestone_claims
for each row execute function economy_private.mark_mission_period();

-- One entry per domain event. Bids only change escrow and are never sales.
create function economy_private.capture_auction() returns trigger
language plpgsql security definer set search_path = '' as $$
declare action_name text; instrument text; actual_amount bigint := 0; sink_amount bigint := 0;
  info jsonb; card_rarity text; title text; series text; caller text;
begin
  if tg_op='DELETE' then
    if old.status='active' then
      insert into economy_private.operations(action,subject_id,seller,buyer,channel)
      values ('cancel',old.id,old.seller_id,old.buyer_id,case when old.is_mystery then 'mystery'
        when old.is_black_market then 'black_market' else 'auction' end) on conflict do nothing;
    end if;
    return null;
  end if;
  instrument := case when new.is_mystery then 'mystery'
    when new.is_black_market then 'black_market' else 'auction' end;
  if tg_op = 'INSERT' then
    if new.status not in ('active','sold','canceled','cancelled','expired') then return null; end if;
    insert into economy_private.operations(action,subject_id,occurred_at,seller,channel)
    values('listing',new.id,new.created_at,new.seller_id,instrument) on conflict do nothing;
    if new.status = 'active' then return null; end if;
  elsif new.status is not distinct from old.status then
    return null;
  end if;

  if new.status='sold' and new.buyer_id is not null then
    action_name := 'sale'; actual_amount := new.current_price;
    if new.is_mystery or new.black_market_stock_id is not null then
      sink_amount := actual_amount;
    end if;
    info := new.card_snapshot;
    if info->>'rarity' is null and new.card_instance_id is not null then
      select u.rarity::text,c.nom,c.franchise into card_rarity,title,series
      from public.user_cards u join public.cards c on c.id=u.card_id
      where u.id=new.card_instance_id;
    end if;
  elsif tg_op='UPDATE' and old.status='sold' and new.status in ('canceled','cancelled','expired') then
    action_name := 'reversal'; actual_amount := old.current_price;
  elsif new.status in ('canceled','cancelled') then
    action_name := 'cancel';
  elsif new.status='expired' then
    get diagnostics caller = pg_context;
    action_name := case when caller ~ '(^|\n)PL/pgSQL function (public\.)?cancel_auction\('
      or (tg_op='UPDATE' and old.buyer_id is not null and new.buyer_id is null)
      then 'cancel' else 'expiry' end;
  else return null;
  end if;
  insert into economy_private.operations(action,subject_id,seller,buyer,amount,burned,channel,rarity,card_name,franchise)
  values (action_name,new.id,new.seller_id,new.buyer_id,actual_amount,sink_amount,instrument,
    coalesce(info->>'rarity',card_rarity),coalesce(info->>'name',title),coalesce(info->>'anime',series))
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function economy_private.capture_auction() from public, anon, authenticated, service_role;

create function economy_private.capture_trade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status='accepted' then
    insert into economy_private.operations(action,subject_id,seller,buyer,amount,return_amount,channel)
    values ('trade',new.id,new.from_user,new.to_user,new.offered_karas,new.requested_karas,'trade')
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function economy_private.capture_trade() from public, anon, authenticated, service_role;

-- Eligible population: extant profiles with an extant Auth account. Pro, admin,
-- inactive, banned, and suspected accounts still own their money. Custody tables
-- carry cards, not balances. Auction escrow was already deducted from wallets.
create view economy_private.holdings as
with escrow as (
  select buyer_id,sum(current_price::bigint) amount
  from public.auctions where status='active' and buyer_id is not null group by buyer_id
)
select p.user_id,p.pseudo,(to_jsonb(u)->>'created_at')::timestamptz created_at,p.last_seen_at,p.karas_balance::bigint balance,
  coalesce(e.amount,0) escrow,p.karas_balance::bigint+coalesce(e.amount,0) total
from public.user_profiles p join auth.users u on u.id=p.user_id
left join escrow e on e.buyer_id=p.user_id;

-- Existing observations have actual timestamps. Keep only established event
-- codes and allowed fields. Stop reading them at cutover to avoid counting
-- the same settlement via the new trigger. Deleted/missing card metadata is
-- left null. Archived auction price fields cannot overwrite the event amount.
create view economy_private.history as
with boundary as (select starts_at from economy_private.settings), old_events as (
  select distinct on (event_type,subject_id) e.*
  from public.anticheat_events e cross join boundary b
  where e.occurred_at < b.starts_at and e.subject_id is not null
    and e.event_type in ('auction_sold','trade_accepted')
  order by event_type,subject_id,occurred_at,id
)
select action,subject_id,occurred_at,seller,buyer,amount,return_amount,burned,channel,rarity,card_name,franchise
from economy_private.operations
union all
select 'listing',a.id,a.created_at,a.seller_id,null,0,0,0,
  case when a.is_mystery then 'mystery' when a.is_black_market then 'black_market' else 'auction' end,
  null,null,null
from public.auctions a cross join boundary b
where a.created_at<b.starts_at and not exists(
  select 1 from economy_private.operations p where p.action='listing' and p.subject_id=a.id)
union all
select 'sale',e.subject_id,e.occurred_at,case when a.is_mystery or (a.is_black_market and a.seller_id is null)
  then null else e.actor_user_id end,
  coalesce(e.counterparty_user_id,case when a.is_mystery or (a.is_black_market and a.seller_id is null) then e.actor_user_id end),
  e.amount::bigint,0,0,case when a.is_mystery then 'mystery' when a.is_black_market then 'black_market' else 'auction' end,
  coalesce(a.card_snapshot->>'rarity',u.rarity::text),coalesce(a.card_snapshot->>'name',c.nom),coalesce(a.card_snapshot->>'anime',c.franchise)
from old_events e join public.auctions a on a.id=e.subject_id
left join public.user_cards u on u.id=a.card_instance_id left join public.cards c on c.id=u.card_id
where e.event_type='auction_sold' and a.status='sold'
  and not exists(select 1 from economy_private.operations p where p.action='sale' and p.subject_id=e.subject_id)
union all
select 'trade',e.subject_id,e.occurred_at,e.actor_user_id,e.counterparty_user_id,
  (e.metadata->>'offeredKaras')::bigint,(e.metadata->>'requestedKaras')::bigint,0,'trade',null,null,null
from old_events e where e.event_type='trade_accepted'
  and e.metadata->>'offeredKaras' ~ '^[0-9]{1,10}$' and e.metadata->>'requestedKaras' ~ '^[0-9]{1,10}$'
  and not exists(select 1 from economy_private.operations p where p.action='trade' and p.subject_id=e.subject_id);

create function economy_private.top_share(p_active boolean,p_fraction numeric,p_at timestamptz)
returns numeric language sql stable set search_path = '' as $$
  with ranked as (
    select total,row_number() over(order by total desc,user_id) n,count(*) over() size
    from economy_private.holdings where not p_active or last_seen_at>=p_at-interval '30 days'
  )
  select round(100*sum(total) filter(where n<=ceil(size*p_fraction))/nullif(sum(total),0),2) from ranked
$$;

create function economy_private.cohort(p_created timestamptz,p_at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select case when p_created is null then 'unknown' when p_created>p_at-interval '8 days' then 'new'
    when p_created>p_at-interval '31 days' then 'recent'
    when p_created>p_at-interval '91 days' then 'intermediate' else 'veteran' end
$$;

-- Atomic snapshot and cumulative reconciliation. Same UTC date can be retried
-- safely. The first capture skips the collection scan while DDL locks are held.
create function economy_private.take_snapshot(p_cards boolean default true)
returns void language plpgsql set search_path = '' as $$
declare stamp timestamptz := greatest(statement_timestamp(),(select starts_at from economy_private.settings));
  utc_day date := (stamp at time zone 'UTC')::date;
begin
  if not pg_try_advisory_xact_lock(419202611,23001) then return; end if;
  if exists(select 1 from economy_private.snapshots where day=utc_day) then return; end if;
  insert into economy_private.snapshots(day,captured_at,balance_total,escrow,trade_holds,wallet_delta,
    eligible,holders,active_players,new_players,veteran_players,top10,active_top10,new_median,veteran_median,card_cohorts)
  with players as materialized (
    select *,economy_private.cohort(created_at,stamp) generation from economy_private.holdings
  )
  select utc_day,stamp,coalesce(sum(balance),0),coalesce(sum(escrow),0),
    coalesce((select sum(amount::bigint) from public.anticheat_trade_kara_holds),0),
    coalesce((select sum(delta) from economy_private.wallet),0),count(*),count(*) filter(where total>0),
    count(*) filter(where last_seen_at>=stamp-interval '30 days'),count(*) filter(where generation='new'),
    count(*) filter(where generation='veteran'),
    economy_private.top_share(false,.10,stamp),economy_private.top_share(true,.10,stamp),
    ((percentile_disc(.5) within group(order by total) filter(where generation='new'))::numeric+
      percentile_disc(.5) within group(order by total desc) filter(where generation='new'))/2,
    ((percentile_disc(.5) within group(order by total) filter(where generation='veteran'))::numeric+
      percentile_disc(.5) within group(order by total desc) filter(where generation='veteran'))/2,
    case when p_cards then (
      select jsonb_agg(to_jsonb(ages) order by ages.generation)
      from (
        select p.generation,count(*) players,round(avg(coalesce(c.cards,0)),2) average,
          round(percentile_cont(.5) within group(order by coalesce(c.cards,0))::numeric,2) median,
          coalesce(sum(c.sr),0)::text sr,coalesce(sum(c.ssr),0)::text ssr,coalesce(sum(c.lr),0)::text lr,
          round(percentile_cont(.5) within group(order by coalesce(c.rare,0))::numeric,2) rare_median
        from players p left join (
          select user_id,count(*) cards,count(*) filter(where rarity='SR') sr,
           count(*) filter(where rarity='SSR') ssr,count(*) filter(where rarity='LR') lr,
           count(*) filter(where rarity in ('SR','SSR','LR')) rare
          from public.user_cards group by user_id
        ) c on c.user_id=p.user_id group by p.generation
      ) ages
    ) end
  from players
  on conflict (day) do nothing;
end;
$$;
revoke all on all functions in schema economy_private from public, anon, authenticated, service_role;
revoke all on all tables in schema economy_private from public, anon, authenticated, service_role;

create trigger economy_wallet_update after update of karas_balance on public.user_profiles
for each row when (old.karas_balance is distinct from new.karas_balance) execute function economy_private.capture_wallet();
create trigger economy_wallet_lifecycle after insert or delete on public.user_profiles
for each row execute function economy_private.capture_wallet();
create trigger economy_auction_event after insert or update of status or delete on public.auctions
for each row execute function economy_private.capture_auction();
create trigger economy_trade_event after insert or update of status on public.trade_offers
for each row when (new.status='accepted') execute function economy_private.capture_trade();

insert into economy_private.settings(singleton) values(true);
select economy_private.take_snapshot(false);
select cron.schedule('economy-daily-snapshot','15,45 * * * *',
  'set statement_timeout = ''60s''; select economy_private.take_snapshot(true);');
commit;
