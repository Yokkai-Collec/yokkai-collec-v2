-- LR variants share duplicates; Shiny is inherited from any consumed copy.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.user_cards drop constraint user_cards_evolved_variant_check;
alter table public.user_cards add constraint user_cards_evolved_variant_check
  check (not is_evolved or (rarity='SSR' and is_shiny) or rarity='LR');

CREATE OR REPLACE FUNCTION public.evolve_lr_card(p_card_instance_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_player_not_banned();
 perform set_config('game.progress_action','evolution',true);

declare
  player_id uuid := auth.uid(); target_card public.cards%rowtype;
  selected_count integer; evolved_id uuid; evolved_at timestamptz := clock_timestamp(); inherited_image text; result_shiny boolean;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_card_instance_ids is null or cardinality(p_card_instance_ids) <> 3
    or array_ndims(p_card_instance_ids) <> 1 or array_lower(p_card_instance_ids,1) <> 1
    or (select count(distinct id) from unnest(p_card_instance_ids) as ids(id)) <> 3 then
    raise exception 'THREE_DISTINCT_LR_COPIES_REQUIRED' using errcode='P0001';
  end if;
  perform owned.id from public.user_cards owned
    where owned.user_id=player_id and owned.id=any(p_card_instance_ids)
    order by owned.id for update;
  select c.* into target_card from public.user_cards owned join public.cards c on c.id=owned.card_id
    where owned.id=p_card_instance_ids[1] and owned.user_id=player_id
      and c.rarete_base='LR' and not owned.is_evolved;
  if not found then raise exception 'INVALID_LR_COPIES' using errcode='P0001'; end if;
  select count(*) into selected_count from public.user_cards owned
    where owned.id=any(p_card_instance_ids) and owned.user_id=player_id
      and owned.card_id=target_card.id and not owned.is_evolved;
  if selected_count <> 3 then raise exception 'INVALID_LR_COPIES' using errcode='P0001'; end if;
  if exists(select 1 from public.user_cards where id=any(p_card_instance_ids) and is_locked) then
    raise exception 'CARD_LOCKED' using errcode='P0001';
  end if;
  if exists(select 1 from public.auctions where card_instance_id=any(p_card_instance_ids) and status='active') then
    raise exception 'CARD_FROZEN' using errcode='P0001';
  end if;
  select owned.custom_image_url into inherited_image from public.user_cards owned
    where owned.user_id=player_id and owned.id=any(p_card_instance_ids) and owned.custom_image_url is not null
    order by array_position(p_card_instance_ids,owned.id) limit 1;
  select bool_or(owned.is_shiny) into result_shiny from public.user_cards owned
    where owned.user_id=player_id and owned.id=any(p_card_instance_ids);
  delete from public.user_cards where user_id=player_id and id=any(p_card_instance_ids);
  insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner,custom_image_url)
    values(player_id,target_card.id,evolved_at,'LR',result_shiny,true,false,inherited_image) returning id into evolved_id;
  return jsonb_build_object('id',target_card.id,'name',target_card.nom,'category',target_card.categorie,
    'anime',target_card.franchise,'rarity','LR','image',coalesce(inherited_image,target_card.image_url),'catalogueImage',target_card.image_url,
    'customImageUrl',inherited_image,'instanceId',evolved_id,'obtainedAt',evolved_at,'shiny',result_shiny,
    'isEvolved',true,'isFirstOwner',false,'locked',false,'folderId',null);
end;
end
$function$
;

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
      -- JavaScript compares Date.parse() milliseconds.
      floor(extract(epoch from date_trunc('milliseconds',uc.date_obtention))*1000)::bigint obtained_ms
    from public.user_cards uc join public.cards c on c.id=uc.card_id
    where uc.user_id=p_player
  ), filtered as (
    select * from copies x
    where not exists(select 1 from unnest(terms) term where not (
        position(term in lower(x.nom))>0 or position(term in lower(x.categorie))>0
        or position(term in lower(coalesce(x.franchise,'')))>0))
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
    -- Copies inside a group: newest first, then instance id (groupCollection).
    row_number() over (partition by x.card_id,x.rarete_base,x.is_evolved,x.is_shiny and not x.is_evolved and x.rarete_base<>'LR'
      order by x.obtained_ms desc, x.id::text collate "C")
  from filtered x;
end; $$;

create or replace function public.get_collection_counts()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid(); result jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  with copies as (
    select (uc.card_id::text||':'||c.rarete_base::text||':'||case when uc.is_evolved then 'evolved' when uc.is_shiny and c.rarete_base<>'LR' then 'shiny' else 'normal' end) group_key,
      c.rarete_base::text rarity, c.categorie, uc.is_locked, uc.folder_id, uc.card_id,
      exists(select 1 from public.auctions a where a.card_instance_id=uc.id and a.seller_id=player and a.status='active') frozen
    from public.user_cards uc join public.cards c on c.id=uc.card_id where uc.user_id=player
  )
  select jsonb_build_object(
    'copies',(select count(*) from copies),
    'groups',(select count(distinct group_key) from copies),
    'rarities',coalesce((select jsonb_object_agg(rarity,n) from (select rarity,count(distinct group_key) n from copies group by rarity) r),'{}'::jsonb),
    'categories',coalesce((select jsonb_object_agg(categorie,n) from (select categorie,count(distinct group_key) n from copies group by categorie) r),'{}'::jsonb),
    'frozen',(select count(distinct group_key) from copies where frozen),
    'locked',(select count(distinct group_key) from copies where is_locked),
    'unfiled',(select count(distinct group_key) from copies cp where folder_id is null and not exists(select 1 from public.license_folder_cards fc join public.license_folders f on f.id=fc.folder_id where f.user_id=player and fc.card_id=cp.card_id)),
    'folders',coalesce((select jsonb_object_agg(folder_id,n) from (select memberships.folder_id,count(distinct cp.group_key) n from copies cp join lateral (
   select cp.folder_id where cp.folder_id is not null union select fc.folder_id from public.license_folder_cards fc join public.license_folders f on f.id=fc.folder_id where f.user_id=player and fc.card_id=cp.card_id
 ) memberships on true group by memberships.folder_id) r),'{}'::jsonb))
  into result;
  return result;
end; $$;

create or replace function public.get_collection_groups_page(
  p_query text default '', p_categories text[] default null, p_rarities text[] default null,
  p_shiny_only boolean default false, p_folder text default null, p_auction_only boolean default false,
  p_locked_only boolean default false, p_sort text default 'rarity', p_after text default null,
  p_offset integer default 0, p_limit integer default 24, p_duplicates_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid(); page_size integer:=least(60,greatest(1,coalesce(p_limit,24))); result jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if coalesce(p_sort,'') not in ('rarity','recent','oldest','name') or char_length(coalesce(p_query,''))>200
    or coalesce(p_offset,0)<0 then raise exception 'COLLECTION_PAGE_INVALID' using errcode='P0001'; end if;
  with ranked as materialized (
    select * from public.collection_ranked_copies(player,p_query,p_categories,p_rarities,
      p_shiny_only,p_folder,p_auction_only,p_locked_only,p_sort) r
    where not coalesce(p_duplicates_only,false) or r.group_key in (
      select u.card_id::text||':'||c.rarete_base::text||':'||
        case when u.is_evolved then 'evolved' when u.is_shiny and c.rarete_base<>'LR' then 'shiny' else 'normal' end
      from public.user_cards u join public.cards c on c.id=u.card_id
      where u.user_id=player
      group by 1
      having count(*)>1)
  ), groups as (
    select group_key, min(global_rank) position,
      jsonb_agg(copy order by newest_rank) copies
    from ranked group by group_key
  ), ordered as (
    select group_key, copies, row_number() over (order by position) n from groups
  ), start as (
    select coalesce((select n from ordered where group_key=p_after),
      case when p_after is null then coalesce(p_offset,0) else 0 end) n
  ), page as (
    select * from ordered where n>(select n from start) order by n limit page_size+1
  )
  select jsonb_build_object(
    'total',(select count(*) from ordered),
    'offset',(select n from start),
    -- firstOwner covers every copy of the group, whatever the filters.
    'groups',coalesce((select jsonb_agg(jsonb_build_object('key',group_key,'copies',copies,
      'firstOwner',exists(select 1 from public.user_cards u join public.cards c on c.id=u.card_id
        where u.user_id=player and u.card_id=split_part(group_key,':',1)::uuid and c.rarete_base='LR' and u.is_first_owner
          and case split_part(group_key,':',3) when 'evolved' then u.is_evolved
            when 'shiny' then u.is_shiny and not u.is_evolved else (c.rarete_base='LR' or not u.is_shiny) and not u.is_evolved end)) order by n)
      from (select * from page order by n limit page_size) p),'[]'::jsonb),
    'next',case when (select count(*) from page)>page_size
      then (select group_key from page order by n offset page_size-1 limit 1) end)
  into result;
  return result;
end; $$;

notify pgrst,'reload schema';
commit;
