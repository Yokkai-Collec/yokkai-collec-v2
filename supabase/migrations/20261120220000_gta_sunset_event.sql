begin;

alter table public.cards add column event_only boolean not null default false;

-- Keep event exclusives out of existing randomized rewards.
do $$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('public.open_regular_pack()', 'into pool_sizes from public.cards;', 'into pool_sizes from public.cards where not event_only;'),
    ('public.open_regular_pack()', 'where rarete_base=rarities[rarity_index]', 'where rarete_base=rarities[rarity_index] and not event_only'),
    ('public.open_decision_pack()', 'into pool_sizes from public.cards;', 'into pool_sizes from public.cards where not event_only;'),
    ('public.open_decision_pack()', 'where rarete_base=rarities[rarity_index]', 'where rarete_base=rarities[rarity_index] and not event_only'),
    ('public.settle_expired_auctions()', 'from public.cards order by random()', 'from public.cards where not event_only order by random()'),
    ('public.settle_referral_events()', 'from public.cards where rarete_base=''LR'' order by random()', 'from public.cards where rarete_base=''LR'' and not event_only order by random()')
  ) as patches(target, before, after)
  loop
    definition := pg_get_functiondef(patch.target::regprocedure);
    if strpos(definition, patch.before) = 0 then
      raise exception 'Sunset reward pool patch no longer matches %', patch.target;
    end if;
    execute replace(definition, patch.before, patch.after);
  end loop;

  definition := pg_get_functiondef('public.settle_expired_auctions()'::regprocedure);
  execute replace(replace(definition,
    'from public.cards where rarete_base=''LR'' order by random()',
    'from public.cards where rarete_base=''LR'' and not event_only order by random()'),
    'from public.cards where rarete_base<>''LR'' order by random()',
    'from public.cards where rarete_base<>''LR'' and not event_only order by random()');
end;
$$;

create table public.gta_sunset_event (
  singleton boolean primary key default true check (singleton),
  starts_on date not null,
  jason_card_id uuid not null references public.cards(id),
  lucia_card_id uuid not null references public.cards(id),
  check (jason_card_id <> lucia_card_id)
);

create table public.gta_sunset_openings (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_start date not null,
  opening_day date not null,
  cards jsonb not null,
  primary key (user_id, event_start, opening_day)
);

alter table public.gta_sunset_event enable row level security;
alter table public.gta_sunset_openings enable row level security;
revoke all on public.gta_sunset_event, public.gta_sunset_openings from public, anon, authenticated, service_role;

create function public.get_gta_sunset_event()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  player uuid := auth.uid();
  stamp timestamptz := statement_timestamp();
  today date := (stamp at time zone 'Europe/Paris')::date;
  event public.gta_sunset_event%rowtype;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into event from public.gta_sunset_event;
  if not found then return null; end if;

  return jsonb_build_object(
    'serverNow', extract(epoch from stamp) * 1000,
    'startsAt', event.starts_on::timestamp at time zone 'Europe/Paris',
    'endsAt', (event.starts_on + 3)::timestamp at time zone 'Europe/Paris',
    'nextResetAt', (today + 1)::timestamp at time zone 'Europe/Paris',
    'featured', (
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.nom, 'category', c.categorie, 'anime', c.franchise,
        'rarity', c.rarete_base, 'image', c.image_url
      ) order by featured.position)
      from unnest(array[event.jason_card_id, event.lucia_card_id]) with ordinality featured(card_id, position)
      join public.cards c on c.id = featured.card_id
    ),
    'openedCards', (
      select cards from public.gta_sunset_openings
      where user_id = player and event_start = event.starts_on and opening_day = today
    )
  );
end;
$$;

create function public.open_gta_sunset_booster()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player uuid := auth.uid();
  stamp timestamptz;
  today date;
  event public.gta_sunset_event%rowtype;
  roll double precision;
  bonus_id uuid;
  card_ids uuid[];
  picked public.cards%rowtype;
  copy_id uuid;
  first_owner boolean;
  result jsonb := '[]'::jsonb;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Serialize retries and protect the grant against account deletion.
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('gta-sunset:' || player::text, 0));
  perform public.assert_player_not_banned();

  stamp := clock_timestamp();
  today := (stamp at time zone 'Europe/Paris')::date;
  select * into event from public.gta_sunset_event;
  if not found or today < event.starts_on or today >= event.starts_on + 3 then
    raise exception 'GTA_SUNSET_EVENT_CLOSED';
  end if;

  select cards into result from public.gta_sunset_openings
  where user_id = player and event_start = event.starts_on and opening_day = today;
  if found then return result; end if;
  result := '[]'::jsonb;

  if (select count(*) from public.cards
      where id in (event.jason_card_id, event.lucia_card_id) and event_only and rarete_base = 'LR') <> 2 then
    raise exception 'GTA_SUNSET_CARD_CONFIGURATION';
  end if;

  roll := random();
  bonus_id := case when roll < 0.05 then event.jason_card_id when roll < 0.10 then event.lucia_card_id end;
  card_ids := array(
    select id from public.cards
    where not event_only and rarete_base in ('C', 'R', 'SR')
    order by random()
    limit case when bonus_id is null then 3 else 2 end
  );
  if bonus_id is not null then card_ids := array_append(card_ids, bonus_id); end if;
  if cardinality(card_ids) <> 3 then raise exception 'CATALOGUE_INCOMPLETE'; end if;

  for picked in
    select c.* from unnest(card_ids) with ordinality drawn(card_id, position)
    join public.cards c on c.id = drawn.card_id order by drawn.position
  loop
    first_owner := picked.rarete_base = 'LR';
    insert into public.user_cards(user_id, card_id, date_obtention, rarity, is_shiny, is_evolved, is_first_owner)
    values (player, picked.id, stamp, picked.rarete_base, false, false, first_owner)
    returning id into copy_id;

    result := result || jsonb_build_array(jsonb_build_object(
      'id', picked.id, 'name', picked.nom, 'category', picked.categorie, 'anime', picked.franchise,
      'liveFranchise', true, 'rarity', picked.rarete_base, 'image', picked.image_url,
      'catalogueImage', picked.image_url, 'customImageUrl', null, 'instanceId', copy_id,
      'obtainedAt', stamp, 'shiny', false, 'isEvolved', false, 'isFirstOwner', first_owner,
      'folderId', null
    ));
  end loop;

  insert into public.gta_sunset_openings(user_id, event_start, opening_day, cards)
  values (player, event.starts_on, today, result);
  return result;
end;
$$;

revoke all on function public.get_gta_sunset_event(), public.open_gta_sunset_booster()
from public, anon, authenticated, service_role;
grant execute on function public.get_gta_sunset_event(), public.open_gta_sunset_booster()
to authenticated;

notify pgrst, 'reload schema';
commit;
