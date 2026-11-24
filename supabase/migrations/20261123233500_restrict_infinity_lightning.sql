begin;

create or replace function public.set_card_cosmetic(p_card_id uuid, p_kind text, p_cosmetic_id text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare player uuid := auth.uid(); lightning_eligible boolean;
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
    return;
  end if;
  if not exists(select 1 from public.card_cosmetic_purchases p
      join public.card_cosmetic_offers o on o.id = p.cosmetic_id
      where p.user_id = player and o.id = p_cosmetic_id and o.kind = p_kind) then
    raise exception 'COSMETIC_NOT_OWNED';
  end if;
  if p_cosmetic_id = 'infinity_lightning' and not lightning_eligible then
    raise exception 'COSMETIC_CARD_INELIGIBLE';
  end if;
  insert into public.card_cosmetic_equipment(card_id, user_id, kind, cosmetic_id)
    values (p_card_id, player, p_kind, p_cosmetic_id)
  on conflict (card_id, kind) do update set cosmetic_id = excluded.cosmetic_id, user_id = excluded.user_id;
end;
$$;

create or replace function public.get_my_card_cosmetics() returns jsonb
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

delete from public.card_cosmetic_equipment e
using public.user_cards uc, public.cards c
where e.cosmetic_id = 'infinity_lightning'
  and uc.id = e.card_id and c.id = uc.card_id
  and not (uc.is_shiny or uc.is_evolved or c.event_only);

commit;
