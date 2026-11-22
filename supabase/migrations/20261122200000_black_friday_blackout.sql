begin;

insert into public.cards
  (source, source_id, nom, categorie, franchise, rarete_base, image_url, event_only)
values
  ('manual', 'blackout-sung-jinwoo', 'Sung Jin-Woo (Blackout)', 'ANIME/MANGA', 'Solo Leveling', 'LR', '/assets/events/blackout/cards/sung-jinwoo.webp', true),
  ('manual', 'blackout-ryomen-sukuna', 'Ryomen Sukuna (Blackout)', 'ANIME/MANGA', 'JUJUTSU KAISEN', 'LR', '/assets/events/blackout/cards/ryomen-sukuna.webp', true),
  ('manual', 'blackout-goku-black', 'Goku Black (Blackout)', 'ANIME/MANGA', 'Dragon Ball Super', 'LR', '/assets/events/blackout/cards/goku-black.webp', true),
  ('manual', 'blackout-itachi-uchiha', 'Itachi Uchiha (Blackout)', 'ANIME/MANGA', 'Naruto', 'LR', '/assets/events/blackout/cards/itachi-uchiha.webp', true),
  ('manual', 'blackout-ichigo-kurosaki', 'Ichigo Kurosaki (Blackout)', 'ANIME/MANGA', 'Bleach', 'LR', '/assets/events/blackout/cards/ichigo-kurosaki.webp', true),
  ('manual', 'blackout-sosuke-aizen', 'Sōsuke Aizen (Blackout)', 'ANIME/MANGA', 'Bleach', 'LR', '/assets/events/blackout/cards/sosuke-aizen.webp', true),
  ('manual', 'blackout-guts', 'Guts (Blackout)', 'ANIME/MANGA', 'Berserk', 'LR', '/assets/events/blackout/cards/guts.webp', true),
  ('manual', 'blackout-sasuke-uchiha', 'Sasuke Uchiha (Blackout)', 'ANIME/MANGA', 'Naruto', 'LR', '/assets/events/blackout/cards/sasuke-uchiha.webp', true),
  ('manual', 'blackout-ken-kaneki', 'Ken Kaneki (Blackout)', 'ANIME/MANGA', 'Tokyo Ghoul', 'LR', '/assets/events/blackout/cards/ken-kaneki.webp', true),
  ('manual', 'blackout-eren-yeager', 'Eren Yeager (Blackout)', 'ANIME/MANGA', 'Attack on Titan', 'LR', '/assets/events/blackout/cards/eren-yeager.webp', true)
on conflict (source, source_id) do update
set nom = excluded.nom, image_url = excluded.image_url
where cards.event_only and cards.rarete_base = 'LR'
  and (cards.nom, cards.image_url) is distinct from (excluded.nom, excluded.image_url);

do $$
begin
  if exists (
    select 1
    from (values
    ('blackout-sung-jinwoo', 'Sung Jin-Woo (Blackout)', '/assets/events/blackout/cards/sung-jinwoo.webp'),
    ('blackout-ryomen-sukuna', 'Ryomen Sukuna (Blackout)', '/assets/events/blackout/cards/ryomen-sukuna.webp'),
    ('blackout-goku-black', 'Goku Black (Blackout)', '/assets/events/blackout/cards/goku-black.webp'),
    ('blackout-itachi-uchiha', 'Itachi Uchiha (Blackout)', '/assets/events/blackout/cards/itachi-uchiha.webp'),
    ('blackout-ichigo-kurosaki', 'Ichigo Kurosaki (Blackout)', '/assets/events/blackout/cards/ichigo-kurosaki.webp'),
    ('blackout-sosuke-aizen', 'Sōsuke Aizen (Blackout)', '/assets/events/blackout/cards/sosuke-aizen.webp'),
    ('blackout-guts', 'Guts (Blackout)', '/assets/events/blackout/cards/guts.webp'),
    ('blackout-sasuke-uchiha', 'Sasuke Uchiha (Blackout)', '/assets/events/blackout/cards/sasuke-uchiha.webp'),
    ('blackout-ken-kaneki', 'Ken Kaneki (Blackout)', '/assets/events/blackout/cards/ken-kaneki.webp'),
    ('blackout-eren-yeager', 'Eren Yeager (Blackout)', '/assets/events/blackout/cards/eren-yeager.webp')
    ) as expected(source_id, nom, image_url)
    where not exists (
      select 1 from public.cards c
      where c.source = 'manual' and c.source_id = expected.source_id
        and c.nom = upper(expected.nom) and c.image_url = expected.image_url
        and c.event_only and c.rarete_base = 'LR'
    )
  ) then
    raise exception 'Blackout source IDs conflict with an existing card';
  end if;
end;
$$;

create table public.blackout_purchases (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  request_id uuid not null,
  purchase_day date not null,
  quantity integer not null check (quantity between 1 and 3),
  primary key (user_id, request_id)
);

create table public.blackout_openings (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  request_id uuid not null,
  credit_slot integer,
  cards jsonb not null,
  primary key (user_id, request_id),
  unique (user_id, credit_slot)
);

alter table public.blackout_purchases enable row level security;
alter table public.blackout_openings enable row level security;
revoke all on public.blackout_purchases, public.blackout_openings
  from public, anon, authenticated, service_role;

create function public.blackout_schedule()
returns table (opens_at timestamptz, closes_at timestamptz)
language sql immutable set search_path = '' as $$
  select timestamptz '2026-11-26 20:00:00 Europe/Paris',
         timestamptz '2026-11-30 21:00:00 Europe/Paris';
$$;

create function public.blackout_free_slots(p_player uuid, p_at timestamptz)
returns integer[] language sql stable set search_path = '' as $$
  select array(
    select day * 2 + slot
    from public.blackout_schedule() s
    cross join generate_series(0, 4) day
    cross join generate_series(1, case when public.billing_has_game_pro(p_player) then 2 else 1 end) slot
    join auth.users u on u.id = p_player
    where p_at < s.closes_at
      and p_at >= s.opens_at + make_interval(days => day)
      and (u.created_at at time zone 'Europe/Paris')::date
        <= (s.opens_at at time zone 'Europe/Paris')::date + day
      and not exists (
        select from public.blackout_openings o
        where o.user_id = p_player and o.credit_slot = day * 2 + slot
      )
    order by slot, day
  );
$$;

create function public.blackout_wallet(p_player uuid, p_at timestamptz)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'balance', p.karas_balance,
    'boughtToday', purchased.today,
    'reserve', case when p_at >= s.opens_at and p_at < s.closes_at
      then purchased.total - used.total + cardinality(public.blackout_free_slots(p_player, p_at))
      else 0 end,
    'purchasesOpen', p_at >= s.opens_at and p_at < s.closes_at,
    'price', 750, 'dailyLimit', 3
  )
  from public.user_profiles p
  cross join public.blackout_schedule() s
  cross join lateral (
    select coalesce(sum(quantity), 0) total, coalesce(sum(quantity) filter (
      where purchase_day = (p_at at time zone 'Europe/Paris')::date
    ), 0) today
    from public.blackout_purchases where user_id = p_player
  ) purchased
  cross join lateral (
    select count(*) total from public.blackout_openings
    where user_id = p_player and credit_slot is null
  ) used
  where p.user_id = p_player;
$$;

create function public.blackout_lr_rate()
returns double precision language sql immutable set search_path = '' as $$
  select 1 - power(0.85::double precision, 1.0 / 25);
$$;

create function public.blackout_featured_cards()
returns setof public.cards language sql stable set search_path = '' as $$
  select c.* from public.cards c where c.source = 'manual'
    and c.source_id like 'blackout-%' and c.event_only and c.rarete_base = 'LR';
$$;

create function public.get_blackout_event()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'serverNow', extract(epoch from statement_timestamp()) * 1000,
    'startsAt', s.opens_at, 'endsAt', s.closes_at, 'packsExpireAt', s.closes_at,
    'nextResetAt', (select min(s.opens_at + make_interval(days => n))
      from generate_series(0, 4) n where s.opens_at + make_interval(days => n) > statement_timestamp()),
    'lrRatePerPack', public.blackout_lr_rate(),
    'availableDays', (select coalesce(jsonb_agg(n::text), '[]'::jsonb)
      from generate_series(1, (wallet ->> 'reserve')::integer) n),
    'wallet', wallet,
    'openedCards', null,
    'featured', (select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.nom, 'category', c.categorie, 'anime', c.franchise,
      'rarity', c.rarete_base, 'image', c.image_url
    ) order by c.nom) from public.blackout_featured_cards() c)
  )
  from public.blackout_schedule() s
  cross join lateral public.blackout_wallet(auth.uid(), statement_timestamp()) wallet
  where auth.uid() is not null and wallet is not null
    and statement_timestamp() >= s.opens_at and statement_timestamp() < s.closes_at;
$$;

create function public.buy_blackout_packs(p_quantity integer, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player uuid := auth.uid();
  stamp timestamptz;
  wallet jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_request is null or p_quantity is null or p_quantity not between 1 and 3 then
    raise exception 'INVALID_PACK_QUANTITY';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('blackout:' || player::text, 0));
  perform public.assert_player_not_banned();
  stamp := clock_timestamp();
  wallet := public.blackout_wallet(player, stamp);
  if exists (select from public.blackout_purchases where user_id = player and request_id = p_request) then
    return wallet;
  end if;
  if not coalesce((wallet ->> 'purchasesOpen')::boolean, false) then
    raise exception 'BLACKOUT_SHOP_CLOSED';
  end if;
  if p_quantity + (wallet ->> 'boughtToday')::integer > (wallet ->> 'dailyLimit')::integer then
    raise exception 'BLACKOUT_DAILY_LIMIT';
  end if;
  if (select count(*) from public.blackout_featured_cards()) <> 10
    or (select count(*) from public.cards where not event_only and rarete_base in ('C', 'R', 'SR')) < 3 then
    raise exception 'CATALOGUE_INCOMPLETE';
  end if;
  perform public.debit_karas(player, p_quantity * (wallet ->> 'price')::integer);
  insert into public.blackout_purchases (user_id, request_id, purchase_day, quantity)
    values (player, p_request, (stamp at time zone 'Europe/Paris')::date, p_quantity);
  return public.blackout_wallet(player, stamp);
end;
$$;

create function public.open_blackout_booster(p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player uuid := auth.uid();
  stamp timestamptz;
  slot integer;
  legendary_id uuid;
  card_ids uuid[];
  picked public.cards%rowtype;
  copy_id uuid;
  result jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_request is null then raise exception 'INVALID_PACK_REQUEST'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('blackout:' || player::text, 0));
  perform public.assert_player_not_banned();
  select cards into result from public.blackout_openings where user_id = player and request_id = p_request;
  if found then return result; end if;

  stamp := clock_timestamp();
  if coalesce((public.blackout_wallet(player, stamp) ->> 'reserve')::integer, 0) < 1 then
    raise exception 'BLACKOUT_NO_PACKS';
  end if;
  slot := (public.blackout_free_slots(player, stamp))[1];

  if (select count(*) from public.blackout_featured_cards()) <> 10 then
    raise exception 'CATALOGUE_INCOMPLETE';
  end if;
  if random() < public.blackout_lr_rate() then
    select id into legendary_id from public.blackout_featured_cards() order by random() limit 1;
  end if;
  card_ids := array(
    select id from public.cards where not event_only and rarete_base in ('C', 'R', 'SR')
    order by random() limit case when legendary_id is null then 3 else 2 end
  );
  if legendary_id is not null then card_ids := array_append(card_ids, legendary_id); end if;
  if cardinality(card_ids) <> 3 then raise exception 'CATALOGUE_INCOMPLETE'; end if;

  result := '[]'::jsonb;
  for picked in
    select c.* from unnest(card_ids) with ordinality drawn(card_id, position)
    join public.cards c on c.id = drawn.card_id order by drawn.position
  loop
    insert into public.user_cards(user_id, card_id, date_obtention, rarity, is_shiny, is_evolved, is_first_owner)
    values (player, picked.id, stamp, picked.rarete_base, false, false, picked.id = legendary_id and legendary_id is not null)
    returning id into copy_id;

    result := result || jsonb_build_array(jsonb_build_object(
      'id', picked.id, 'name', picked.nom, 'category', picked.categorie, 'anime', picked.franchise,
      'liveFranchise', true, 'rarity', picked.rarete_base, 'image', picked.image_url,
      'catalogueImage', picked.image_url, 'customImageUrl', null, 'instanceId', copy_id,
      'obtainedAt', stamp, 'shiny', false, 'isEvolved', false,
      'isFirstOwner', picked.id = legendary_id and legendary_id is not null, 'folderId', null
    ));
  end loop;
  insert into public.blackout_openings (user_id, request_id, credit_slot, cards)
    values (player, p_request, slot, result);
  return result;
end;
$$;

revoke all on function public.blackout_schedule(), public.blackout_free_slots(uuid, timestamptz),
  public.blackout_wallet(uuid, timestamptz), public.blackout_lr_rate(), public.blackout_featured_cards(),
  public.get_blackout_event(), public.buy_blackout_packs(integer, uuid), public.open_blackout_booster(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_blackout_event(), public.buy_blackout_packs(integer, uuid),
  public.open_blackout_booster(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
