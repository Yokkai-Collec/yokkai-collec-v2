begin;
set local lock_timeout = '5s';

create or replace function public.get_license_folder_cards(
  p_id uuid, p_query text, p_owned_only boolean, p_offset integer, p_limit integer
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  folder public.license_folders%rowtype;
  viewer uuid := auth.uid();
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_id is not null then
    select * into folder from public.license_folders where id = p_id;
    if not found or (viewer <> folder.user_id and not folder.featured) then
      raise exception 'LICENSE_FOLDER_NOT_FOUND';
    end if;
    if not public.can_view_collection(viewer, folder.user_id) then
      raise exception 'PROFILE_PRIVATE';
    end if;
  else
    folder.user_id := viewer;
  end if;

  return (
    with all_cards as materialized (
      select c.*, exists (
        select 1 from public.user_cards uc
        where uc.user_id = folder.user_id and uc.card_id = c.id
      ) owned
      from public.cards c
      where p_id is null or exists (
        select 1 from public.license_folder_cards link
        where link.card_id = c.id and link.folder_id = p_id
      )
    ), matching as materialized (
      select * from all_cards
      where (not coalesce(p_owned_only, false) or owned)
        and not exists (
          select 1 from regexp_split_to_table(lower(btrim(coalesce(p_query, ''))), '[[:space:]]+') term
          where term <> '' and not (nom ilike '%' || term || '%' or franchise ilike '%' || term || '%')
        )
    ), page as (
      select * from matching
      order by case rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end, nom, id
      offset greatest(coalesce(p_offset, 0), 0)
      limit least(greatest(coalesce(p_limit, 24), 1), 60)
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.nom, 'category', c.categorie, 'anime', c.franchise,
          'rarity', c.rarete_base, 'image', coalesce(art.custom_image_url, c.image_url),
          'catalogueImage', c.image_url, 'customImageUrl', art.custom_image_url, 'owned', c.owned
        ) order by case c.rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end, c.nom, c.id)
        from page c
        left join lateral (
          select uc.custom_image_url
          from public.user_cards uc
          where p_id is not null and c.owned and uc.user_id = folder.user_id and uc.card_id = c.id
            and nullif(btrim(uc.custom_image_url), '') is not null
          order by uc.date_obtention desc, uc.id desc
          limit 1
        ) art on true
      ), '[]'::jsonb),
      'total', (select count(*) from matching),
      'binderTotal', (select count(*) from all_cards),
      'binderOwned', (select count(*) from all_cards where owned)
    )
  );
end;
$$;

commit;
