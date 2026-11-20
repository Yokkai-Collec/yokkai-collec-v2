begin;
set local lock_timeout = '5s';

-- A stock entry keeps provenance after sale. A non-null card_id means the
-- original instance is currently held by the event, outside user collections.
alter table public.black_market_stock
  add column card_id uuid references public.cards(id) on delete restrict,
  add column rarity public.card_rarity,
  add column is_shiny boolean,
  add column is_evolved boolean,
  add constraint black_market_stock_card_shape check (
    (card_id is null and rarity is null and is_shiny is null and is_evolved is null)
    or (card_id is not null and rarity is not null and rarity in ('SSR', 'LR')
      and is_shiny is not null and is_evolved is not null)
  );

alter table public.auctions
  add column black_market_stock_id uuid references public.black_market_stock(card_instance_id) on delete restrict,
  drop constraint auctions_black_market_shape;

create function public.black_market_card_snapshot(
  p_id uuid, p_card_id uuid, p_rarity public.card_rarity, p_shiny boolean, p_evolved boolean
) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.nom, 'category', c.categorie,
    'anime', c.franchise, 'liveFranchise', true, 'rarity', p_rarity,
    'image', c.image_url, 'catalogueImage', c.image_url, 'shiny', p_shiny, 'isEvolved', p_evolved,
    'firstLrCopy', case when p_rarity = 'LR' then public.auction_first_lr_copy_source(p_id) end)
  from public.cards c where c.id = p_card_id;
$$;
revoke all on function public.black_market_card_snapshot(uuid, uuid, public.card_rarity, boolean, boolean)
  from public, anon, authenticated, service_role;

-- Keep closed auction detail readable when its collection FK is cleared by
-- the move. Sold Black Market results already have a snapshot.
create function public.black_market_detach_copies(p_ids uuid[])
returns void language plpgsql set search_path = '' as $$
begin
  update public.auctions a set card_snapshot = public.black_market_card_snapshot(c.id, c.card_id, c.rarity, c.is_shiny, c.is_evolved)
  from public.user_cards c where c.id = any(p_ids) and a.card_instance_id = c.id and a.card_snapshot is null;
  update public.user_cards set is_locked = false where id = any(p_ids) and is_locked;
  delete from public.user_cards where id = any(p_ids);
end $$;
revoke all on function public.black_market_detach_copies(uuid[]) from public, anon, authenticated, service_role;

drop trigger black_market_card_custody on public.user_cards;

-- Migrate only inventory still in custody. Preserve edition/auction IDs,
-- bids and snapshots, while leaving previously awarded cards with their buyers.
update public.black_market_stock s set
  card_id = c.card_id, rarity = c.rarity, is_shiny = c.is_shiny, is_evolved = c.is_evolved
from public.user_cards c
where c.id = s.card_instance_id and c.user_id = s.official_user_id
  and not exists (select 1 from public.auctions a where a.id = s.auction_id and a.status = 'sold');

update public.auctions a set black_market_stock_id = s.card_instance_id, card_instance_id = null, seller_id = null
from public.black_market_stock s
where a.is_black_market and a.status = 'active'
  and a.card_instance_id = s.card_instance_id and s.card_id is not null;

select public.black_market_detach_copies(array(
  select card_instance_id from public.black_market_stock where card_id is not null order by card_instance_id
));

alter table public.auctions add constraint auctions_black_market_shape check (
  (is_black_market and not is_mystery and (status <> 'active' or (
    black_market_stock_id is not null and seller_id is null and card_instance_id is null
  ))) or (not is_black_market and black_market_stock_id is null)
);
create unique index auctions_one_active_stock_card on public.auctions(black_market_stock_id)
  where black_market_stock_id is not null and status = 'active';

create or replace function public.guard_black_market_card() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.black_market_stock where card_instance_id = new.id and card_id is not null)
  then raise exception 'BLACK_MARKET_CARD_RESERVED'; end if;
  return new;
end $$;
create trigger black_market_card_custody before insert on public.user_cards
  for each row execute function public.guard_black_market_card();

create or replace function public.guard_black_market_listing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_black_market and new.status = 'active' and not exists (
    select 1 from public.black_market_stock s cross join public.black_market_config cfg
    where s.card_instance_id = new.black_market_stock_id and s.card_id is not null and cfg.singleton and cfg.enabled
  ) then raise exception 'BLACK_MARKET_CARD_UNAVAILABLE'; end if;
  return new;
end $$;

drop function public.admin_configure_black_market(uuid, boolean);
create function public.admin_configure_black_market(p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  update public.black_market_config set enabled = p_enabled where singleton;
  insert into public.admin_audit_logs(admin_user_id, action, metadata)
  values (auth.uid(), 'black_market.configure', jsonb_build_object('enabled', p_enabled));
end $$;
revoke all on function public.admin_configure_black_market(boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_configure_black_market(boolean) to authenticated;

create or replace function public.recover_black_market_cards(p_user_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare copies uuid[]; lr integer; ssr integer;
begin
  perform 1 from public.black_market_config where singleton and enabled for update;
  if not found then raise exception 'BLACK_MARKET_DISABLED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:' || p_user_id::text, 0));
  perform 1 from auth.users where id = p_user_id and banned_until = 'infinity'::timestamptz for update;
  if not found then raise exception 'BLACK_MARKET_PERMANENT_BAN_REQUIRED'; end if;
  if not exists (select 1 from public.black_market_bans where user_id = p_user_id
    and banned_at <= clock_timestamp() - interval '14 days') then raise exception 'BLACK_MARKET_WAITING_PERIOD'; end if;
  perform 1 from public.user_profiles where user_id = p_user_id for update;

  with candidates as (
    select c.id, c.card_id, c.rarity, c.is_shiny, c.is_evolved from public.user_cards c
    where c.user_id = p_user_id and c.rarity in ('LR', 'SSR')
      and not exists (select 1 from public.black_market_stock s where s.card_instance_id = c.id)
      and cardinality(public.black_market_recovery_blocks(c.id)) = 0
    order by c.id for update of c
  ), stashed as (
    insert into public.black_market_stock(card_instance_id, source_user_id, recovered_by, card_id, rarity, is_shiny, is_evolved)
    select id, p_user_id, p_actor, card_id, rarity, is_shiny, is_evolved from candidates
    returning card_instance_id, rarity
  )
  select coalesce(array_agg(card_instance_id), '{}'), count(*) filter (where rarity = 'LR'),
    count(*) filter (where rarity = 'SSR') into copies, lr, ssr from stashed;

  if cardinality(copies) > 0 then
    perform public.black_market_detach_copies(copies);
    insert into public.admin_audit_logs(admin_user_id, action, metadata)
    values (p_actor, 'black_market.recover', jsonb_build_object(
      'sourceUserId', p_user_id, 'cardIds', copies, 'automatic', p_actor is null));
  end if;
  return jsonb_build_object('recovered', cardinality(copies), 'lr', lr, 'ssr', ssr, 'remaining', (
    select count(*) from public.user_cards c where user_id = p_user_id and rarity in ('LR', 'SSR')
      and not exists (select 1 from public.black_market_stock s where s.card_instance_id = c.id)
  ));
end $$;

create or replace function public.recover_due_black_market_cards() returns void
language plpgsql security definer set search_path = '' as $$
declare account record; result jsonb; checked integer := 0; lr integer := 0; ssr integer := 0; deferred integer := 0;
begin
  if not exists (select 1 from public.black_market_config where singleton and enabled) then return; end if;
  for account in
    select b.user_id from public.black_market_bans b join auth.users u on u.id = b.user_id
    where b.banned_at <= clock_timestamp() - interval '14 days' and u.banned_until = 'infinity'::timestamptz
      and exists (select 1 from public.user_cards c where c.user_id = b.user_id and c.rarity in ('LR', 'SSR')
        and not exists (select 1 from public.black_market_stock s where s.card_instance_id = c.id))
    order by b.banned_at, b.user_id
  loop
    checked := checked + 1;
    begin
      result := public.recover_black_market_cards(account.user_id, null);
      lr := lr + (result->>'lr')::integer;
      ssr := ssr + (result->>'ssr')::integer;
      if (result->>'remaining')::integer > 0 then deferred := deferred + 1; end if;
    exception when deadlock_detected or lock_not_available then
      deferred := deferred + 1;
      raise warning 'BLACK_MARKET_RECOVERY_DEFERRED %', account.user_id;
    when raise_exception then
      if sqlerrm not in ('BLACK_MARKET_PERMANENT_BAN_REQUIRED', 'BLACK_MARKET_DISABLED', 'BLACK_MARKET_WAITING_PERIOD') then raise; end if;
      deferred := deferred + 1;
    end;
  end loop;
  insert into public.black_market_recovery_runs(checked_accounts, recovered_lr, recovered_ssr, deferred_accounts)
  values (checked, lr, ssr, deferred);
end $$;

create or replace function public.admin_schedule_black_market_edition(p_day date, p_card_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  previous public.black_market_editions%rowtype;
  opens timestamptz := (p_day + time '12:00') at time zone 'Europe/Paris';
  closes timestamptz := ((p_day + 1)::timestamp) at time zone 'Europe/Paris';
  inserted_count integer;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform 1 from public.black_market_config where singleton and enabled for update;
  if not found then raise exception 'BLACK_MARKET_DISABLED'; end if;
  if p_day is null or not isfinite(p_day) or opens <= clock_timestamp() then raise exception 'BLACK_MARKET_INVALID_DAY'; end if;
  if p_card_ids is null or cardinality(p_card_ids) not between 1 and 60
    or cardinality(p_card_ids) <> (select count(distinct id) from unnest(p_card_ids) ids(id))
  then raise exception 'BLACK_MARKET_INVALID_SELECTION'; end if;

  select * into previous from public.black_market_editions where starts_at > clock_timestamp()
    order by starts_at limit 1 for update;
  if found then
    perform 1 from public.auctions where black_market_day = previous.opening_day order by id for update;
    if previous.starts_at <= clock_timestamp() or exists (
      select 1 from public.auctions where black_market_day = previous.opening_day and buyer_id is not null
    ) then raise exception 'BLACK_MARKET_EDITION_STARTED'; end if;
    delete from public.auctions where black_market_day = previous.opening_day;
    delete from public.black_market_editions where opening_day = previous.opening_day;
  end if;

  insert into public.black_market_editions(opening_day) values (p_day);
  insert into public.auctions(black_market_stock_id, starting_price, current_price, duration_minutes,
    ends_at, is_black_market, card_snapshot, black_market_day)
  select s.card_instance_id, prices.amount, prices.amount, 720, closes, true,
    public.black_market_card_snapshot(s.card_instance_id, s.card_id, s.rarity, s.is_shiny, s.is_evolved), p_day
  from public.black_market_stock s
  cross join lateral (select case s.rarity when 'LR' then 1000 else 500 end as amount) prices
  where s.card_instance_id = any(p_card_ids) and s.card_id is not null
    and not exists (select 1 from public.auctions a
      where a.black_market_stock_id = s.card_instance_id and a.status = 'active')
    and not exists (select 1 from public.anticheat_trade_card_holds h where h.card_id = s.card_instance_id)
  order by s.card_instance_id for update of s;
  get diagnostics inserted_count = row_count;
  if inserted_count <> cardinality(p_card_ids) then raise exception 'BLACK_MARKET_CARD_UNAVAILABLE'; end if;
  if opens <= clock_timestamp() then raise exception 'BLACK_MARKET_EDITION_STARTED'; end if;
  insert into public.admin_audit_logs(admin_user_id, action, metadata)
  values (auth.uid(), 'black_market.open', jsonb_build_object('openingDay', p_day, 'cardIds', p_card_ids));
end $$;

create or replace function public.admin_get_black_market_stock() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  future public.black_market_editions%rowtype;
  stamp timestamptz := statement_timestamp();
  local_stamp timestamp := stamp at time zone 'Europe/Paris';
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into future from public.black_market_editions where starts_at > stamp order by starts_at limit 1;
  return jsonb_build_object(
    'enabled', (select enabled from public.black_market_config where singleton),
    'minDay', local_stamp::date + case when local_stamp::time >= time '12:00' then 1 else 0 end,
    'scheduledDay', future.opening_day, 'startsAt', future.starts_at,
    'selectedIds', coalesce((select jsonb_agg(a.black_market_stock_id order by a.id) from public.auctions a
      where a.black_market_day = future.opening_day and a.status = 'active'), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('instanceId', q.card_instance_id,
      'name', q.nom, 'rarity', q.rarity, 'image', q.image_url, 'category', q.categorie,
      'anime', q.franchise, 'shiny', q.is_shiny, 'isEvolved', q.is_evolved)
      order by q.selected desc, q.nom, q.card_instance_id) from (
        select s.*, d.nom, d.categorie, d.franchise, d.image_url,
          coalesce(a.black_market_day = future.opening_day, false) as selected
        from public.black_market_stock s join public.cards d on d.id = s.card_id
        left join public.auctions a on a.black_market_stock_id = s.card_instance_id and a.status = 'active'
        where (a.id is null or a.black_market_day = future.opening_day)
          and not exists (select 1 from public.anticheat_trade_card_holds h where h.card_id = s.card_instance_id)
        order by selected desc, d.nom, s.card_instance_id limit 200
      ) q), '[]'::jsonb),
    'recoveryRuns', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'checkedAt', r.checked_at,
      'checkedAccounts', r.checked_accounts, 'recoveredLR', r.recovered_lr, 'recoveredSSR', r.recovered_ssr,
      'deferredAccounts', r.deferred_accounts) order by r.id desc)
      from (select * from public.black_market_recovery_runs order by id desc limit 20) r), '[]'::jsonb)
  );
end $$;

-- Keep all other settlement paths and the existing lock/transaction retry.
-- System sales consume the paid Karas, as Mystery Auction already does.
do $patch$
declare source text; updated text; target regprocedure;
begin
  target := 'public.settle_expired_auctions()'::regprocedure;
  source := pg_get_functiondef(target);
  updated := replace(source, 'snapshot jsonb; copy_id uuid;', 'snapshot jsonb; copy_id uuid; stashed public.black_market_stock%rowtype;');
  if updated = source then raise exception 'BLACK_MARKET_SETTLEMENT_STOCK_PATCH_MISSING'; end if;
  updated := replace(updated, 'elsif sale.buyer_id is null then', $branch$
    elsif sale.black_market_stock_id is not null and sale.buyer_id is not null then
      perform 1 from public.user_profiles where user_id = sale.buyer_id for update;
      select * into stashed from public.black_market_stock
      where card_instance_id = sale.black_market_stock_id and card_id is not null for update;
      if not found then raise exception 'BLACK_MARKET_CARD_UNAVAILABLE'; end if;
      update public.black_market_stock set card_id = null, rarity = null, is_shiny = null, is_evolved = null
      where card_instance_id = sale.black_market_stock_id;
      insert into public.user_cards(id, user_id, card_id, rarity, is_shiny, is_evolved, is_first_owner)
      values (stashed.card_instance_id, sale.buyer_id, stashed.card_id, stashed.rarity, stashed.is_shiny, stashed.is_evolved, false);
      update public.auctions set status = 'sold', card_instance_id = sale.black_market_stock_id where id = sale.id;
      insert into public.notifications(user_id, type, reference_id)
      values (sale.buyer_id, 'auction_won', sale.id) on conflict do nothing;
    elsif sale.buyer_id is null then$branch$);
  if strpos(updated, 'where card_instance_id = sale.black_market_stock_id') = 0 then raise exception 'BLACK_MARKET_SETTLEMENT_PATCH_MISSING'; end if;
  execute updated;

  foreach target in array array['public.get_black_market_event()'::regprocedure,
    'public.set_black_market_reminder(uuid, boolean)'::regprocedure, 'public.send_black_market_reminders()'::regprocedure] loop
    source := pg_get_functiondef(target);
    updated := replace(replace(source,
      'join public.user_cards copy on copy.id = a.card_instance_id',
      'join public.black_market_stock copy on copy.card_instance_id = a.black_market_stock_id'),
      'join public.user_cards c on c.id = a.card_instance_id',
      'join public.black_market_stock c on c.card_instance_id = a.black_market_stock_id');
    if updated = source then raise exception 'BLACK_MARKET_STOCK_READER_PATCH_MISSING: %', target; end if;
    execute updated;
  end loop;

  source := pg_get_functiondef('public.admin_get_black_market_recovery_queue(integer, uuid)'::regprocedure);
  updated := replace(replace(source,
    'where b.user_id is distinct from (select official_user_id from public.black_market_config where singleton)', 'where true'),
    'and b.user_id is distinct from (select official_user_id from public.black_market_config where singleton)', '');
  if updated = source or strpos(updated, 'official_user_id') > 0 then raise exception 'BLACK_MARKET_QUEUE_PATCH_MISSING'; end if;
  execute updated;

  source := pg_get_functiondef('public.capture_auction_anticheat_event()'::regprocedure);
  updated := replace(source, 'new.is_mystery', '(new.is_mystery or (new.is_black_market and new.seller_id is null))');
  if updated = source then raise exception 'BLACK_MARKET_AUCTION_EVENT_PATCH_MISSING'; end if;
  execute updated;
end $patch$;

alter table public.black_market_stock drop column auction_id, drop column official_user_id;
alter table public.black_market_config drop column official_user_id;

notify pgrst, 'reload schema';
commit;
