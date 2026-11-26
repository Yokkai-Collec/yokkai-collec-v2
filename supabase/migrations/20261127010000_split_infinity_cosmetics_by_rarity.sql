begin;
set local lock_timeout = '3s';

lock table public.card_cosmetic_purchases, public.card_cosmetic_equipment
  in share row exclusive mode;

-- Keep the existing offer IDs for LR Infinity and give SSR its own offers.
insert into public.card_cosmetic_offers(id, kind, price, for_sale)
select id || '_ssr', kind, price, for_sale
from public.card_cosmetic_offers
where (id = 'infinity_lightning' or starts_with(id, 'infinity_lightning_')
  or starts_with(id, 'infinity_reflection_'))
  and right(id, 4) <> '_ssr'
on conflict (id) do nothing;

-- Preserve existing SSR Infinity equips by moving the corresponding owned copies.
create temporary table infinity_cosmetic_transfers on commit drop as
with equipped as (
  select e.user_id, e.cosmetic_id, count(*)::integer as quantity
  from public.card_cosmetic_equipment e
  join public.user_cards uc on uc.id = e.card_id and uc.user_id = e.user_id
  join public.cards c on c.id = uc.card_id
  where uc.is_evolved and c.rarete_base = 'SSR'
    and (e.cosmetic_id = 'infinity_lightning'
      or starts_with(e.cosmetic_id, 'infinity_lightning_')
      or starts_with(e.cosmetic_id, 'infinity_reflection_'))
    and right(e.cosmetic_id, 4) <> '_ssr'
  group by e.user_id, e.cosmetic_id
)
select p.user_id, p.cosmetic_id, p.purchased_at, e.quantity,
  greatest(1, floor(p.price_paid::numeric * e.quantity / p.quantity)::bigint) as price_paid
from equipped e
join public.card_cosmetic_purchases p using (user_id, cosmetic_id);

insert into public.card_cosmetic_purchases as p (user_id, cosmetic_id, purchased_at, quantity, price_paid)
select user_id, cosmetic_id || '_ssr', purchased_at, quantity, price_paid
from pg_temp.infinity_cosmetic_transfers
on conflict (user_id, cosmetic_id) do update
set quantity = p.quantity + excluded.quantity, price_paid = p.price_paid + excluded.price_paid;

update public.card_cosmetic_equipment e
set cosmetic_id = e.cosmetic_id || '_ssr'
from public.user_cards uc join public.cards c on c.id = uc.card_id,
  pg_temp.infinity_cosmetic_transfers moved
where uc.id = e.card_id and uc.user_id = e.user_id and uc.is_evolved and c.rarete_base = 'SSR'
  and moved.user_id = e.user_id and moved.cosmetic_id = e.cosmetic_id;

delete from public.card_cosmetic_purchases p
using pg_temp.infinity_cosmetic_transfers moved
where moved.user_id = p.user_id and moved.cosmetic_id = p.cosmetic_id
  and moved.quantity = p.quantity;

update public.card_cosmetic_purchases p
set quantity = p.quantity - moved.quantity, price_paid = greatest(1, p.price_paid - moved.price_paid)
from pg_temp.infinity_cosmetic_transfers moved
where moved.user_id = p.user_id and moved.cosmetic_id = p.cosmetic_id
  and moved.quantity < p.quantity;

create or replace function public.can_equip_card_cosmetic(
  p_cosmetic_id text, p_rarity public.card_rarity, p_is_evolved boolean
) returns boolean
language sql immutable strict set search_path = '' as $$
  select case
    when p_cosmetic_id = 'silver_screen' then p_rarity = 'SSR'
    when p_cosmetic_id = 'violet_dusk' then p_rarity = 'LR'
    when p_cosmetic_id = 'infinity_lightning'
      or starts_with(p_cosmetic_id, 'infinity_lightning_')
      or starts_with(p_cosmetic_id, 'infinity_reflection_')
      then p_is_evolved and p_rarity = case right(p_cosmetic_id, 4)
        when '_ssr' then 'SSR'::public.card_rarity else 'LR'::public.card_rarity end
    else true
  end;
$$;

commit;
