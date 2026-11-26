begin;
set local lock_timeout = '3s';

create function public.can_equip_card_cosmetic(
  p_cosmetic_id text, p_rarity public.card_rarity, p_is_evolved boolean
) returns boolean
language sql immutable strict set search_path = '' as $$
  select case
    when p_cosmetic_id = 'silver_screen' then p_rarity = 'SSR'
    when p_cosmetic_id = 'violet_dusk' then p_rarity = 'LR'
    when p_cosmetic_id = 'infinity_lightning'
      or starts_with(p_cosmetic_id, 'infinity_lightning_')
      or starts_with(p_cosmetic_id, 'infinity_reflection_')
      then p_is_evolved and p_rarity in ('SSR', 'LR')
    else true
  end;
$$;
revoke all on function public.can_equip_card_cosmetic(text, public.card_rarity, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.set_card_cosmetic(p_card_id uuid, p_kind text, p_cosmetic_id text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player uuid := auth.uid(); card_rarity public.card_rarity; card_is_evolved boolean; owned_quantity integer;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  if exists(select 1 from public.account_deletion_log where user_id = player) then raise exception 'ACCOUNT_DELETED'; end if;
  if p_kind is null or p_kind not in ('animation', 'filter') then raise exception 'INVALID_COSMETIC_KIND'; end if;

  select uc.rarity, uc.is_evolved into card_rarity, card_is_evolved
  from public.user_cards uc
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
  join public.card_cosmetic_offers o on o.id = p.cosmetic_id and o.kind = p_kind
  where p.user_id = player and o.id = p_cosmetic_id
  for update of p;
  if not found then raise exception 'COSMETIC_NOT_OWNED'; end if;
  if not public.can_equip_card_cosmetic(p_cosmetic_id, card_rarity, card_is_evolved) then
    raise exception 'COSMETIC_CARD_INELIGIBLE';
  end if;
  if (select count(*) from public.card_cosmetic_equipment e
      where e.user_id = player and e.cosmetic_id = p_cosmetic_id and e.card_id <> p_card_id) >= owned_quantity then
    raise exception 'COSMETIC_COPIES_EXHAUSTED';
  end if;

  insert into public.card_cosmetic_equipment(card_id, user_id, kind, cosmetic_id)
    values (p_card_id, player, p_kind, p_cosmetic_id)
  on conflict (card_id, kind) do update set cosmetic_id = excluded.cosmetic_id, user_id = excluded.user_id;
  return public.get_my_card_cosmetics();
end;
$$;

-- Release previously equipped copies that no longer match their card.
delete from public.card_cosmetic_equipment e
using public.user_cards uc
where e.card_id = uc.id
  and not public.can_equip_card_cosmetic(e.cosmetic_id, uc.rarity, uc.is_evolved);

commit;
