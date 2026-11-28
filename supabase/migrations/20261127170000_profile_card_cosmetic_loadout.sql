begin;

create or replace function public.profile_card_json(c public.cards, uc public.user_cards)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.nom, 'category', c.categorie, 'liveFranchise', true,
    'anime', c.franchise, 'rarity', c.rarete_base,
    'image', coalesce(uc.custom_image_url, c.image_url), 'catalogueImage', c.image_url,
    'customImageUrl', uc.custom_image_url, 'instanceId', uc.id,
    'obtainedAt', uc.date_obtention, 'shiny', uc.is_shiny, 'isEvolved', uc.is_evolved,
    'isFirstOwner', uc.is_first_owner, 'folderId', uc.folder_id,
    'cosmetics', coalesce((
      select jsonb_object_agg(e.kind, e.cosmetic_id)
      from public.card_cosmetic_equipment e
      where e.card_id = uc.id and e.user_id = uc.user_id
        and e.kind in ('animation', 'filter')
    ), '{}'::jsonb)
  );
$$;

commit;
