begin;
set local lock_timeout = '3s';

-- Keep retired offers linked to existing orders, copies and card equipment.
alter table public.card_cosmetic_offers add column for_sale boolean not null default true;
update public.card_cosmetic_offers set for_sale = false where id = 'prism_sweep';

insert into public.card_cosmetic_offers(id, kind, price) values
  ('showcase_velvet', 'animation', 900),
  ('showcase_cyber', 'animation', 900),
  ('showcase_lightning', 'animation', 900),
  ('showcase_mist', 'animation', 900),
  ('showcase_sakura', 'animation', 900),
  ('showcase_embers', 'animation', 900),
  ('showcase_frost', 'animation', 900),
  ('showcase_feathers', 'animation', 900),
  ('showcase_vhs', 'animation', 900);

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
      where o.for_sale
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.buy_card_cosmetic(
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

  select price into item_price from public.card_cosmetic_offers where id = p_cosmetic_id and for_sale for share;
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

commit;
