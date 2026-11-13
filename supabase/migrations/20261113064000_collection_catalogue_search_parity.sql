begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- The collection page must use the same searchable card fields as the
-- catalogue. In particular, a card's secondary licence is searchable in the
-- catalogue through card_franchises, so it must work from a player's own
-- collection as well. Categories are filters, never free-text search terms.
create or replace function public.collection_ranked_copies(
  p_player uuid, p_query text, p_categories text[], p_rarities text[],
  p_shiny_only boolean, p_folder text, p_auction_only boolean, p_locked_only boolean, p_sort text)
returns table(group_key text, global_rank bigint, copy jsonb, newest_rank bigint)
language plpgsql stable security definer set search_path='' as $$
declare terms text[]:=array(select term from unnest(regexp_split_to_array(
  lower(btrim(regexp_replace(coalesce(p_query,''),'[,%()]',' ','g'))),'\s+')) term where term<>'');
begin
  return query
  with copies as (
    select uc.id,uc.card_id,uc.date_obtention,uc.is_shiny,uc.is_evolved,uc.is_first_owner,uc.is_locked,
      uc.folder_id,uc.custom_image_url,c.nom,c.categorie,c.franchise,c.rarete_base,c.image_url,
      exists(select 1 from public.auctions a where a.card_instance_id=uc.id and a.seller_id=p_player and a.status='active') frozen,
      case c.rarete_base::text when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end rarity_rank,
      case when uc.is_shiny then 0 else 1 end shiny_rank,
      floor(extract(epoch from date_trunc('milliseconds',uc.date_obtention))*1000)::bigint obtained_ms
    from public.user_cards uc join public.cards c on c.id=uc.card_id
    where uc.user_id=p_player
  ), filtered as (
    select * from copies x
    where not exists(select 1 from unnest(terms) term where not (
        position(term in lower(x.nom))>0
        or position(term in lower(coalesce(x.franchise,'')))>0
        or exists(
          select 1 from public.card_franchises links
          where links.card_id=x.card_id
            and position(term in lower(links.franchise))>0
        )))
      and (coalesce(cardinality(p_categories),0)=0 or x.categorie=any(p_categories))
      and (coalesce(cardinality(p_rarities),0)=0 or x.rarete_base::text=any(p_rarities))
      and (not coalesce(p_shiny_only,false) or x.is_shiny or x.is_evolved)
      and (p_folder is null or (p_folder='unfiled' and x.folder_id is null and not exists(select 1 from public.license_folder_cards fc join public.license_folders f on f.id=fc.folder_id where f.user_id=p_player and fc.card_id=x.card_id)) or x.folder_id::text=p_folder or exists(select 1 from public.license_folder_cards fc join public.license_folders f on f.id=fc.folder_id where f.user_id=p_player and fc.folder_id::text=p_folder and fc.card_id=x.card_id))
      and (not coalesce(p_auction_only,false) or x.frozen)
      and (not coalesce(p_locked_only,false) or x.is_locked)
  )
  select x.card_id::text||':'||x.rarete_base::text||':'||case when x.is_evolved then 'evolved' when x.is_shiny and x.rarete_base<>'LR' then 'shiny' else 'normal' end,
    row_number() over (order by
      case p_sort when 'recent' then -x.obtained_ms when 'oldest' then x.obtained_ms end,
      case when p_sort='name' then x.nom collate public.yk_card_name end,
      x.rarity_rank, x.shiny_rank,
      case when p_sort is distinct from 'name' then x.nom collate public.yk_card_name end,
      x.id::text collate "C"),
    jsonb_build_object('instanceId',x.id,'id',x.card_id,'name',x.nom,'category',x.categorie,
      'anime',nullif(x.franchise,''),'rarity',x.rarete_base,'image',coalesce(nullif(x.custom_image_url,''),x.image_url),
      'catalogueImage',x.image_url,'customImageUrl',x.custom_image_url,'obtainedAt',x.date_obtention,
      'shiny',x.is_shiny,'isEvolved',x.is_evolved,'isFirstOwner',x.is_first_owner,'locked',x.is_locked,
      'folderId',x.folder_id,'frozen',x.frozen),
    row_number() over (partition by x.card_id,x.rarete_base,x.is_evolved,x.is_shiny and not x.is_evolved and x.rarete_base<>'LR'
      order by x.obtained_ms desc, x.id::text collate "C")
  from filtered x;
end; $$;

commit;
