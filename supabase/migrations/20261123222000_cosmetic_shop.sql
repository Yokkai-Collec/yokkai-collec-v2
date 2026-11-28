begin;
set local lock_timeout = '3s';

create table public.card_cosmetic_offers (
  id text primary key,
  kind text not null check (kind in ('animation', 'filter', 'back')),
  price integer not null check (price > 0),
  unique (id, kind)
);
insert into public.card_cosmetic_offers(id, kind, price) values
  ('prism_sweep', 'animation', 450), ('ember_aura', 'animation', 900),
  ('silver_screen', 'filter', 250), ('violet_dusk', 'filter', 400),
  ('obsidian_seal', 'back', 650), ('astral_atlas', 'back', 1200);

create table public.card_cosmetic_purchases (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  cosmetic_id text not null references public.card_cosmetic_offers(id),
  price_paid integer not null check (price_paid > 0),
  purchased_at timestamptz not null default clock_timestamp(),
  primary key (user_id, cosmetic_id)
);

create table public.card_cosmetic_equipment (
  card_id uuid not null references public.user_cards(id) on delete cascade,
  user_id uuid not null,
  kind text not null,
  cosmetic_id text not null,
  primary key (card_id, kind),
  foreign key (user_id, cosmetic_id) references public.card_cosmetic_purchases(user_id, cosmetic_id) on delete cascade,
  foreign key (cosmetic_id, kind) references public.card_cosmetic_offers(id, kind)
);
create index card_cosmetic_equipment_owner_idx on public.card_cosmetic_equipment(user_id);

alter table public.card_cosmetic_offers enable row level security;
alter table public.card_cosmetic_purchases enable row level security;
alter table public.card_cosmetic_equipment enable row level security;
revoke all on public.card_cosmetic_offers, public.card_cosmetic_purchases, public.card_cosmetic_equipment from public, anon, authenticated, service_role;

create function public.clear_transferred_card_cosmetics() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.card_cosmetic_equipment where card_id = new.id;
  return new;
end;
$$;
revoke all on function public.clear_transferred_card_cosmetics() from public, anon, authenticated, service_role;
create trigger clear_transferred_card_cosmetics
  after update of user_id on public.user_cards
  for each row when (old.user_id is distinct from new.user_id)
  execute function public.clear_transferred_card_cosmetics();

create function public.get_card_cosmetic_shop() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare player uuid := auth.uid(); balance integer;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  select p.karas_balance into balance from public.user_profiles p where p.user_id = player;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  return jsonb_build_object(
    'balance', balance,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'price', o.price,
        'owned', purchased.cosmetic_id is not null) order by o.kind, o.price, o.id)
      from public.card_cosmetic_offers o
      left join public.card_cosmetic_purchases purchased on purchased.cosmetic_id = o.id and purchased.user_id = player
    ), '[]'::jsonb)
  );
end;
$$;

create function public.buy_card_cosmetic(p_cosmetic_id text, p_expected_price integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare player uuid := auth.uid(); item_price integer;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  if exists(select 1 from public.account_deletion_log where user_id = player) then raise exception 'ACCOUNT_DELETED'; end if;

  select price into item_price from public.card_cosmetic_offers where id = p_cosmetic_id for share;
  if not found then raise exception 'COSMETIC_UNAVAILABLE'; end if;
  perform 1 from public.user_profiles where user_id = player for update;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  perform public.assert_player_not_banned();

  if exists(select 1 from public.card_cosmetic_purchases where user_id = player and cosmetic_id = p_cosmetic_id) then
    return public.get_card_cosmetic_shop();
  end if;
  if p_expected_price is distinct from item_price then raise exception 'COSMETIC_PRICE_CHANGED'; end if;
  perform public.debit_karas(player, item_price);
  insert into public.card_cosmetic_purchases(user_id, cosmetic_id, price_paid)
    values (player, p_cosmetic_id, item_price);
  return public.get_card_cosmetic_shop();
end;
$$;

create function public.get_my_card_cosmetics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare player uuid := auth.uid();
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  return jsonb_build_object(
    'owned', coalesce((select jsonb_agg(cosmetic_id order by cosmetic_id)
      from public.card_cosmetic_purchases where user_id = player), '[]'::jsonb),
    'equipped', coalesce((select jsonb_object_agg(card_id, loadout) from (
      select e.card_id, jsonb_object_agg(e.kind, e.cosmetic_id) loadout
      from public.card_cosmetic_equipment e
      join public.user_cards c on c.id = e.card_id and c.user_id = player
      where e.user_id = player group by e.card_id
    ) cards), '{}'::jsonb)
  );
end;
$$;

create function public.set_card_cosmetic(p_card_id uuid, p_kind text, p_cosmetic_id text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare player uuid := auth.uid();
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  if exists(select 1 from public.account_deletion_log where user_id = player) then raise exception 'ACCOUNT_DELETED'; end if;
  if p_kind is null or p_kind not in ('animation', 'filter', 'back') then raise exception 'INVALID_COSMETIC_KIND'; end if;

  perform 1 from public.user_cards where id = p_card_id and user_id = player for update;
  if not found then raise exception 'CARD_NOT_OWNED'; end if;
  perform public.assert_player_not_banned();

  if p_cosmetic_id is null then
    delete from public.card_cosmetic_equipment where card_id = p_card_id and kind = p_kind;
    return;
  end if;
  if not exists(select 1 from public.card_cosmetic_purchases p
      join public.card_cosmetic_offers o on o.id = p.cosmetic_id
      where p.user_id = player and o.id = p_cosmetic_id and o.kind = p_kind) then
    raise exception 'COSMETIC_NOT_OWNED';
  end if;
  insert into public.card_cosmetic_equipment(card_id, user_id, kind, cosmetic_id)
    values (p_card_id, player, p_kind, p_cosmetic_id)
  on conflict (card_id, kind) do update set cosmetic_id = excluded.cosmetic_id, user_id = excluded.user_id;
end;
$$;

revoke all on function public.get_card_cosmetic_shop(), public.buy_card_cosmetic(text, integer),
  public.get_my_card_cosmetics(), public.set_card_cosmetic(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.get_card_cosmetic_shop(), public.buy_card_cosmetic(text, integer),
  public.get_my_card_cosmetics(), public.set_card_cosmetic(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
