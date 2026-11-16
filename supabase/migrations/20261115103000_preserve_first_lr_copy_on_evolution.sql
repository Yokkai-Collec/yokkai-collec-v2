begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- The classic and Shiny #1 copies can be consumed by the same evolution.
alter table public.first_lr_copies drop constraint first_lr_copies_evolved_instance_id_key;
create index first_lr_copies_evolved_instance_idx on public.first_lr_copies(evolved_instance_id)
  where evolved_instance_id is not null;

create or replace function public.evolve_lr_card(p_card_instance_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  player_id uuid := auth.uid(); target_card public.cards%rowtype;
  selected_count integer; evolved_id uuid; evolved_at timestamptz := clock_timestamp(); inherited_image text; result_shiny boolean;
begin
  perform public.assert_player_not_banned();
  perform set_config('game.progress_action','evolution',true);
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
  -- Preserve each original variant's provenance when its first copy is consumed.
  update public.first_lr_copies
  set evolved_instance_id=evolved_id
  where card_instance_id=any(p_card_instance_ids) and evolved_instance_id is null;
  return jsonb_build_object('id',target_card.id,'name',target_card.nom,'category',target_card.categorie,
    'anime',target_card.franchise,'rarity','LR','image',coalesce(inherited_image,target_card.image_url),'catalogueImage',target_card.image_url,
    'customImageUrl',inherited_image,'instanceId',evolved_id,'obtainedAt',evolved_at,'shiny',result_shiny,
    'isEvolved',true,'isFirstOwner',false,'locked',false,'folderId',null);
end; $$;

create or replace function public.get_first_lr_copy_badges(p_instance_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid();
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_instance_ids is null or cardinality(p_instance_ids)>500
    or (cardinality(p_instance_ids)>0 and (array_ndims(p_instance_ids)<>1 or array_lower(p_instance_ids,1)<>1)) then
    raise exception 'INVALID_CARD_INSTANCE_IDS';
  end if;
  if array_position(p_instance_ids,null) is not null then raise exception 'INVALID_CARD_INSTANCE_IDS'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('instanceId',copy.id,'source',copy.source)
    order by copy.id),'[]'::jsonb) from (
      select id, case when bool_or(source='mint') then 'mint' else 'legacy' end source
      from (
        select card_instance_id id,source from public.first_lr_copies
        where card_instance_id=any(p_instance_ids)
        union all
        select evolved_instance_id id,source from public.first_lr_copies
        where evolved_instance_id=any(p_instance_ids)
      ) candidates
      group by id
    ) copy);
end; $$;

notify pgrst,'reload schema';
commit;
