begin;
set local lock_timeout = '3s';

insert into public.card_cosmetic_offers (id, kind, price) values
  ('infinity_lightning_violet', 'animation', 900),
  ('infinity_lightning_blue', 'animation', 900),
  ('infinity_lightning_gold', 'animation', 900)
on conflict (id) do nothing;

create or replace function public.set_card_cosmetic(p_card_id uuid, p_kind text, p_cosmetic_id text)
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

commit;
