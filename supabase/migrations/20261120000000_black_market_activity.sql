begin;

create table public.black_market_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
create index black_market_reminders_card_idx on public.black_market_reminders(card_id);
alter table public.black_market_reminders enable row level security;
revoke all on public.black_market_reminders from public, anon, authenticated, service_role;

create function public.set_black_market_reminder(p_card_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare player_id uuid := auth.uid();
begin
  perform public.assert_player_not_banned();
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_card_id is null or p_enabled is null then raise exception 'BLACK_MARKET_CARD_UNAVAILABLE'; end if;

  if not p_enabled then
    delete from public.black_market_reminders where user_id = player_id and card_id = p_card_id;
    return;
  end if;

  if not exists (
    select 1 from public.black_market_editions e
    join public.auctions a on a.black_market_day = e.opening_day and a.status = 'active'
    join public.user_cards c on c.id = a.card_instance_id
    where e.starts_at > clock_timestamp() and c.card_id = p_card_id
  ) then
    raise exception 'BLACK_MARKET_CARD_UNAVAILABLE';
  end if;

  insert into public.black_market_reminders(user_id, card_id)
  values(player_id, p_card_id) on conflict do nothing;
end $$;

-- Reuse the notification bell and its link to the specific auction.
do $notifications$
declare definition text; signature regprocedure;
begin
  select pg_get_constraintdef(oid) into strict definition from pg_constraint
  where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
  alter table public.notifications drop constraint notifications_type_check;
  execute 'alter table public.notifications add constraint notifications_type_check check (type=''black_market_card_open'' or (' ||
    substring(definition from 8 for char_length(definition)-8) || '))';
  foreach signature in array array[
    'public.list_notifications(integer)'::regprocedure,
    'public.get_push_notification(uuid,timestamptz)'::regprocedure
  ] loop
    definition := pg_get_functiondef(signature);
    if strpos(definition, '''wishlist_card_on_auction'',''outbid''') = 0 then
      raise exception 'BLACK_MARKET_NOTIFICATION_PATCH_MISSING: %', signature;
    end if;
    execute replace(definition, '''wishlist_card_on_auction'',''outbid''',
      '''wishlist_card_on_auction'',''black_market_card_open'',''outbid''');
  end loop;
end
$notifications$;

create function public.send_black_market_reminders() returns void
language plpgsql security definer set search_path='' as $$
begin
  with lots as materialized (
    select distinct on (c.card_id) c.card_id, a.id
    from public.black_market_editions e
    join public.auctions a on a.black_market_day = e.opening_day and a.status = 'active'
    join public.user_cards c on c.id = a.card_instance_id
    where statement_timestamp() >= e.starts_at and statement_timestamp() < e.ends_at
    order by c.card_id, a.starting_price, a.id
  ), claimed as (
    delete from public.black_market_reminders r using lots
    where r.card_id = lots.card_id returning r.user_id, lots.id
  )
  insert into public.notifications(user_id, type, reference_id)
  select claimed.user_id, 'black_market_card_open', claimed.id
  from claimed join auth.users u on u.id = claimed.user_id
  where coalesce(u.banned_until, '-infinity'::timestamptz) <= statement_timestamp()
  on conflict do nothing;
end;
$$;

select cron.schedule('black-market-opening-reminders', '* * * * *',
  'select public.send_black_market_reminders();');

create function public.get_black_market_activity() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  player_id uuid := auth.uid();
  last_edition public.black_market_editions%rowtype;
  results jsonb;
begin
  perform public.assert_player_not_banned();
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into last_edition from public.black_market_editions
  where ends_at <= statement_timestamp() order by ends_at desc limit 1;

  if found then
    select jsonb_build_object(
      'endsAt', last_edition.ends_at,
      'openingDay', last_edition.opening_day,
      'settling', exists(select 1 from public.auctions
        where black_market_day = last_edition.opening_day and status = 'active'),
      'lots', coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'amount', a.current_price, 'sold', a.status = 'sold',
        'bidStatus', case when a.status = 'sold' and a.buyer_id = player_id then 'won'
          when a.has_bid then 'outbid' end,
        'card', jsonb_build_object(
          'id', a.card_snapshot->>'id', 'name', a.card_snapshot->>'name',
          'category', a.card_snapshot->>'category', 'anime', a.card_snapshot->>'anime',
          'image', a.card_snapshot->>'image', 'rarity', a.card_snapshot->>'rarity',
          'shiny', coalesce(a.card_snapshot->'shiny', 'false'::jsonb),
          'isEvolved', coalesce(a.card_snapshot->'isEvolved', 'false'::jsonb)
        )
      ) order by a.current_price desc, a.id), '[]'::jsonb)
    ) into results
    from (
      select sale.*, exists(select 1 from public.bids b
        where b.auction_id = sale.id and b.bidder_id = player_id) as has_bid
      from public.auctions sale
      where sale.black_market_day = last_edition.opening_day and sale.status in ('sold', 'expired')
    ) a
    where a.status = 'sold' or a.has_bid;
  end if;

  return jsonb_build_object(
    'lastEdition', results,
    'reminderCardIds', coalesce((select jsonb_agg(r.card_id order by r.card_id)
      from public.black_market_reminders r where r.user_id = player_id), '[]'::jsonb)
  );
end $$;

revoke all on function public.set_black_market_reminder(uuid, boolean),
  public.get_black_market_activity(), public.send_black_market_reminders()
  from public, anon, authenticated, service_role;
grant execute on function public.set_black_market_reminder(uuid, boolean),
  public.get_black_market_activity() to authenticated;

do $export$
declare source text := pg_get_functiondef('public.build_data_export(uuid,uuid)'::regprocedure);
begin
  if strpos(source, 'return result;') = 0 then raise exception 'BLACK_MARKET_EXPORT_PATCH_MISSING'; end if;
  execute replace(source, 'return result;', $body$
    select result || jsonb_build_object('black_market_reminders', coalesce((
      select jsonb_agg(jsonb_build_object('card_id', r.card_id, 'created_at', r.created_at)
        order by r.created_at, r.card_id)
      from public.black_market_reminders r where r.user_id = p_user_id
    ), '[]'::jsonb)) into result;
    if (select coalesce(sum(case when jsonb_typeof(value) = 'array' then jsonb_array_length(value)
      when jsonb_typeof(value) = 'object' then 1 else 0 end), 0) from jsonb_each(result)) > 100000
      or octet_length(result::text) > 26214400 then raise exception 'EXPORT_TOO_LARGE'; end if;
    return result;
  $body$);
end
$export$;

notify pgrst, 'reload schema';
commit;
