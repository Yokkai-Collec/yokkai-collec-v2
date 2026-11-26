begin;
set local lock_timeout = '3s';

create table public.invocation_card_backs (
  user_id uuid primary key,
  cosmetic_id text not null,
  kind text generated always as ('back'::text) stored,
  foreign key (user_id, cosmetic_id) references public.card_cosmetic_purchases(user_id, cosmetic_id) on delete cascade,
  foreign key (cosmetic_id, kind) references public.card_cosmetic_offers(id, kind)
);
alter table public.invocation_card_backs enable row level security;
revoke all on public.invocation_card_backs from public, anon, authenticated, service_role;
grant select on public.invocation_card_backs to authenticated;
create policy "Players read their own invocation card back"
  on public.invocation_card_backs for select to authenticated
  using (user_id = (select auth.uid()));

-- Retain one existing selection per player and leave every purchase intact.
insert into public.invocation_card_backs(user_id, cosmetic_id)
select distinct on (e.user_id) e.user_id, e.cosmetic_id
from public.card_cosmetic_equipment e
join public.user_cards c on c.id = e.card_id and c.user_id = e.user_id
where e.kind = 'back'
order by e.user_id, e.card_id;

delete from public.card_cosmetic_equipment where kind = 'back';
alter table public.card_cosmetic_equipment
  add constraint card_cosmetic_equipment_front_only check (kind in ('animation', 'filter'));

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
    'invocationBack', (select b.cosmetic_id from public.invocation_card_backs b where b.user_id = player),
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
      where o.for_sale or (o.kind = 'back' and p.cosmetic_id is not null)
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
  item_kind text;
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

  select price, kind into item_price, item_kind from public.card_cosmetic_offers where id = p_cosmetic_id and for_sale for share;
  if not found then raise exception 'COSMETIC_UNAVAILABLE'; end if;
  if p_expected_price is distinct from item_price then raise exception 'COSMETIC_PRICE_CHANGED'; end if;
  if item_kind = 'back' then
    if p_quantity <> 1 then raise exception 'INVALID_COSMETIC_QUANTITY'; end if;
    if exists (select 1 from public.card_cosmetic_purchases
      where user_id = player and cosmetic_id = p_cosmetic_id)
    then raise exception 'COSMETIC_ALREADY_OWNED'; end if;
  end if;
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

create or replace function public.set_card_cosmetic(p_card_id uuid, p_kind text, p_cosmetic_id text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player uuid := auth.uid(); lightning_eligible boolean; owned_quantity integer;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  if exists(select 1 from public.account_deletion_log where user_id = player) then raise exception 'ACCOUNT_DELETED'; end if;
  if p_kind is null or p_kind not in ('animation', 'filter') then raise exception 'INVALID_COSMETIC_KIND'; end if;

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
  if not lightning_eligible and (
    p_cosmetic_id = 'infinity_lightning' or starts_with(p_cosmetic_id, 'infinity_lightning_')
  ) then
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

create function public.set_my_invocation_card_back(p_cosmetic_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare player uuid := auth.uid();
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  if exists(select 1 from public.account_deletion_log where user_id = player) then raise exception 'ACCOUNT_DELETED'; end if;

  if p_cosmetic_id is null then
    delete from public.invocation_card_backs where user_id = player;
  else
    perform 1 from public.card_cosmetic_purchases p
    join public.card_cosmetic_offers o on o.id = p.cosmetic_id and o.kind = 'back'
    where p.user_id = player and p.cosmetic_id = p_cosmetic_id;
    if not found then raise exception 'COSMETIC_NOT_OWNED'; end if;

    insert into public.invocation_card_backs(user_id, cosmetic_id)
    values (player, p_cosmetic_id)
    on conflict (user_id) do update set cosmetic_id = excluded.cosmetic_id;
  end if;
  return public.get_card_cosmetic_shop();
end;
$$;

revoke all on function public.set_my_invocation_card_back(text) from public, anon, authenticated, service_role;
grant execute on function public.set_my_invocation_card_back(text) to authenticated;

notify pgrst, 'reload schema';
commit;
