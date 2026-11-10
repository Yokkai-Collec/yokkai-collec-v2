begin;

-- A binder contains one row per catalogue card, whereas a player can own
-- several copies. Keep its existing ordering/counts but surface the newest
-- personalised image among that player's copies when one exists.
create or replace function public.get_binder_cards_page(
  p_owner_id uuid,p_binder_key text,p_query text,p_category text,p_rarity text,
  p_owned_only boolean,p_offset integer,p_limit integer,p_sort text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid();owner_id uuid:=coalesce(p_owner_id,auth.uid());
  chosen text:=public.canonical_binder_key(p_binder_key);chosen_id uuid;enabled boolean;licensed boolean;
  ordering text:=case when p_sort in ('rarity','name','recent','oldest') then p_sort else 'rarity' end;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if not public.can_view_collection(viewer,owner_id) then raise exception 'PROFILE_PRIVATE';end if;
  if chosen is null or chosen !~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$' then raise exception 'BINDER_KEY_REQUIRED';end if;
  select s.enabled,s.enabled and s.license_grouping_enabled into enabled,licensed from public.anime_series_settings s where singleton;
  select b.id into chosen_id from public.anime_series_binders b where 'series:' || b.id::text=chosen;
  return (
    with filters as materialized (select public.card_filter_values(upper(coalesce(p_category,''))) categories,
      public.card_filter_values(upper(coalesce(p_rarity,''))) rarities),
    terms as materialized (select term from regexp_split_to_table(lower(btrim(coalesce(p_query,''))),'[[:space:]]+') term where term<>''),
    candidate_ids as materialized (
      select f.card_id from public.anime_license_source_rules r join public.card_franchises f on f.franchise=r.source_license
        join public.cards c on c.id=f.card_id where licensed and chosen_id is not null and r.binder_id=chosen_id and c.categorie='ANIME/MANGA'
      union
      select e.card_id from public.anime_series_origin_evidence e join public.anime_series_media_rules r on r.media_id=e.media_id
        left join public.anime_license_media_rules n on n.media_id=e.media_id and licensed
        where enabled and chosen_id is not null and coalesce(n.binder_id,r.binder_id)=chosen_id
      union
      select f.card_id from public.card_franchises f join public.cards c on c.id=f.card_id
        where chosen like 'source:%' and 'source:' || encode(sha256(convert_to(c.categorie || chr(31) || f.franchise,'UTF8')),'hex')=chosen
    ), owned as materialized (
      select uc.card_id,min(uc.date_obtention) as first_obtained,max(uc.date_obtention) as last_obtained,
        (array_agg(uc.custom_image_url order by uc.date_obtention desc,uc.id desc)
          filter (where nullif(btrim(uc.custom_image_url),'') is not null))[1] as custom_image_url
      from public.user_cards uc where uc.user_id=owner_id group by uc.card_id
    ), catalogue as materialized (
      select c.*,o.card_id is not null as owned,o.first_obtained,o.last_obtained,o.custom_image_url,
        case c.rarete_base::text when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end as rarity_order
      from candidate_ids i join public.cards c on c.id=i.card_id left join owned o on o.card_id=c.id
      where (cardinality((select categories from filters))=0 or upper(btrim(c.categorie))=any(((select categories from filters))::text[]))
        and exists(select 1 from public.catalogue_binder_links l where l.card_id=c.id and l.binder_key=chosen offset 0)
    ), matching as materialized (
      select c.* from catalogue c where (not coalesce(p_owned_only,false) or owned)
        and (cardinality((select rarities from filters))=0 or c.rarete_base::text=any(((select rarities from filters))::text[]))
        and not exists(select 1 from terms t where not (c.nom ilike '%' || t.term || '%'
          or coalesce(c.franchise ilike '%' || t.term || '%',false)
          or exists(select 1 from public.card_franchises n where n.card_id=c.id and n.franchise ilike '%' || t.term || '%')))
    ), ordered as materialized (
      select c.*,row_number() over(order by
        case when ordering='recent' then last_obtained end desc nulls last,
        case when ordering='oldest' then first_obtained end asc nulls last,
        case when ordering='name' then nom end,
        rarity_order,nom,id) as position from matching c
    ), page as (select * from ordered order by position offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,24),1),60))
    select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',nom,'category',categorie,
      'anime',franchise,'rarity',rarete_base,'image',coalesce(custom_image_url,image_url),'catalogueImage',image_url,
      'customImageUrl',custom_image_url,'owned',owned) order by position) from page),'[]'::jsonb),
      'total',(select count(*) from matching),'binderTotal',(select count(*) from catalogue),'binderOwned',(select count(*) from catalogue where owned))
  );
end $$;
revoke all on function public.get_binder_cards_page(uuid,text,text,text,text,boolean,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_binder_cards_page(uuid,text,text,text,text,boolean,integer,integer,text) to authenticated;

notify pgrst,'reload schema';
commit;
