begin;
set local lock_timeout = '3s';

alter table public.card_cosmetic_purchases
  add column quantity integer not null default 1 check (quantity > 0),
  alter column price_paid type bigint;

create table public.card_cosmetic_orders (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  request_id uuid not null,
  cosmetic_id text not null references public.card_cosmetic_offers(id),
  quantity integer not null check (quantity > 0),
  unit_price integer not null check (unit_price > 0),
  primary key (user_id, request_id)
);
alter table public.card_cosmetic_orders enable row level security;
revoke all on public.card_cosmetic_orders from public, anon, authenticated, service_role;

-- Legacy purchases grant one copy. Keep one existing placement per purchase.
with placements as (
  select card_id, kind, row_number() over (
    partition by user_id, cosmetic_id order by card_id
  ) as position
  from public.card_cosmetic_equipment
)
delete from public.card_cosmetic_equipment e
using placements p
where e.card_id = p.card_id and e.kind = p.kind and p.position > 1;

create index card_cosmetic_equipment_owner_cosmetic_idx
  on public.card_cosmetic_equipment(user_id, cosmetic_id);

create or replace function public.get_card_cosmetic_shop() returns jsonb
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
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'kind', o.kind, 'price', o.price,
        'quantity', coalesce(p.quantity, 0),
        'available', coalesce(p.quantity, 0) - (
          select count(*) from public.card_cosmetic_equipment e
          where e.user_id = player and e.cosmetic_id = o.id
        )
      ) order by o.kind, o.price, o.id)
      from public.card_cosmetic_offers o
      left join public.card_cosmetic_purchases p on p.cosmetic_id = o.id and p.user_id = player
    ), '[]'::jsonb)
  );
end;
$$;

drop function public.buy_card_cosmetic(text, integer);
create function public.buy_card_cosmetic(
  p_cosmetic_id text, p_expected_price integer, p_quantity integer, p_request uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  player uuid := auth.uid();
  item_price integer;
  balance integer;
  total bigint;
  previous_order public.card_cosmetic_orders%rowtype;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_quantity is null or p_quantity <= 0 or p_request is null then
    raise exception 'INVALID_COSMETIC_QUANTITY';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  if exists(select 1 from public.account_deletion_log where user_id = player) then raise exception 'ACCOUNT_DELETED'; end if;

  select p.karas_balance into balance from public.user_profiles p where p.user_id = player for update;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  perform public.assert_player_not_banned();

  select * into previous_order from public.card_cosmetic_orders
  where user_id = player and request_id = p_request;
  if found then
    if (previous_order.cosmetic_id, previous_order.unit_price, previous_order.quantity)
      is distinct from (p_cosmetic_id, p_expected_price, p_quantity) then
      raise exception 'COSMETIC_REQUEST_MISMATCH';
    end if;
    return public.get_card_cosmetic_shop();
  end if;

  select price into item_price from public.card_cosmetic_offers where id = p_cosmetic_id for share;
  if not found then raise exception 'COSMETIC_UNAVAILABLE'; end if;
  if p_expected_price is distinct from item_price then raise exception 'COSMETIC_PRICE_CHANGED'; end if;
  total := item_price::bigint * p_quantity;
  if total > balance then raise exception 'INSUFFICIENT_KARAS'; end if;

  perform public.debit_karas(player, total::integer);
  insert into public.card_cosmetic_purchases as inventory (user_id, cosmetic_id, price_paid, quantity)
    values (player, p_cosmetic_id, total, p_quantity)
    on conflict (user_id, cosmetic_id) do update
      set quantity = inventory.quantity + excluded.quantity,
          price_paid = inventory.price_paid + excluded.price_paid;
  insert into public.card_cosmetic_orders (user_id, request_id, cosmetic_id, quantity, unit_price)
    values (player, p_request, p_cosmetic_id, p_quantity, item_price);
  return public.get_card_cosmetic_shop();
end;
$$;

create or replace function public.get_my_card_cosmetics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare player uuid := auth.uid();
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  return jsonb_build_object(
    'copies', coalesce((
      select jsonb_object_agg(p.cosmetic_id, jsonb_build_object(
        'quantity', p.quantity, 'available', p.quantity - (
          select count(*) from public.card_cosmetic_equipment e
          where e.user_id = player and e.cosmetic_id = p.cosmetic_id
        )
      ))
      from public.card_cosmetic_purchases p where p.user_id = player
    ), '{}'::jsonb),
    'equipped', coalesce((select jsonb_object_agg(card_id, loadout) from (
      select e.card_id, jsonb_object_agg(e.kind, e.cosmetic_id) loadout
      from public.card_cosmetic_equipment e
      join public.user_cards c on c.id = e.card_id and c.user_id = player
      where e.user_id = player group by e.card_id
    ) cards), '{}'::jsonb),
    'specialEditions', coalesce((
      select jsonb_agg(distinct uc.card_id order by uc.card_id)
      from public.user_cards uc
      join public.cards c on c.id = uc.card_id
      where uc.user_id = player and c.event_only
    ), '[]'::jsonb)
  );
end;
$$;

drop function public.set_card_cosmetic(uuid, text, text);
create function public.set_card_cosmetic(p_card_id uuid, p_kind text, p_cosmetic_id text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player uuid := auth.uid(); lightning_eligible boolean; owned_quantity integer;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  if exists(select 1 from public.account_deletion_log where user_id = player) then raise exception 'ACCOUNT_DELETED'; end if;
  if p_kind is null or p_kind not in ('animation', 'filter', 'back') then raise exception 'INVALID_COSMETIC_KIND'; end if;

  select uc.is_shiny or uc.is_evolved or c.event_only into lightning_eligible
  from public.user_cards uc join public.cards c on c.id = uc.card_id
  where uc.id = p_card_id and uc.user_id = player
  for update of uc;
  if not found then raise exception 'CARD_NOT_OWNED'; end if;
  perform public.assert_player_not_banned();

  if p_cosmetic_id is null then
    delete from public.card_cosmetic_equipment where card_id = p_card_id and kind = p_kind;
    return public.get_my_card_cosmetics();
  end if;

  -- Serialize competing equips of the same item across different cards.
  select p.quantity into owned_quantity from public.card_cosmetic_purchases p
  join public.card_cosmetic_offers o on o.id = p.cosmetic_id
  where p.user_id = player and o.id = p_cosmetic_id and o.kind = p_kind
  for update of p;
  if not found then raise exception 'COSMETIC_NOT_OWNED'; end if;
  if p_cosmetic_id = 'infinity_lightning' and not lightning_eligible then
    raise exception 'COSMETIC_CARD_INELIGIBLE';
  end if;
  if (select count(*) from public.card_cosmetic_equipment
      where user_id = player and cosmetic_id = p_cosmetic_id and card_id <> p_card_id) >= owned_quantity then
    raise exception 'COSMETIC_COPIES_EXHAUSTED';
  end if;

  insert into public.card_cosmetic_equipment(card_id, user_id, kind, cosmetic_id)
    values (p_card_id, player, p_kind, p_cosmetic_id)
  on conflict (card_id, kind) do update set cosmetic_id = excluded.cosmetic_id, user_id = excluded.user_id;
  return public.get_my_card_cosmetics();
end;
$$;

revoke all on function public.buy_card_cosmetic(text, integer, integer, uuid), public.set_card_cosmetic(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.buy_card_cosmetic(text, integer, integer, uuid), public.set_card_cosmetic(uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
