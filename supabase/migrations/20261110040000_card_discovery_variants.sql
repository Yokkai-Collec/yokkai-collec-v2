begin;

-- A normal LR and its Shiny LR are separate collectibles. Discovery must not
-- combine their owners, market history or active listings.
drop function public.get_card_discovery(uuid,integer,integer);
create function public.get_card_discovery(
  p_card_id uuid,
  p_owner_offset integer default 0,
  p_owner_limit integer default 12,
  p_is_shiny boolean default false
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  player_id uuid:=auth.uid();
  result jsonb;
  safe_limit integer:=least(greatest(coalesce(p_owner_limit,12),1),30);
  safe_offset integer:=greatest(coalesce(p_owner_offset,0),0);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select jsonb_build_object(
    'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'liveFranchise',true,
      'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url,'shiny',p_is_shiny),
    'marketValue',(select avg(a.current_price)::numeric(12,2)
      from public.auctions a join public.user_cards sold_uc on sold_uc.id=a.card_instance_id
      where a.status='sold' and sold_uc.card_id=c.id
        and sold_uc.is_shiny is not distinct from p_is_shiny),
    'activeAuctionId',(select a.id
      from public.auctions a join public.user_cards auc_uc on auc_uc.id=a.card_instance_id
      where a.status='active' and auc_uc.card_id=c.id
        and auc_uc.is_shiny is not distinct from p_is_shiny order by a.ends_at limit 1),
    'wishlisted',exists(select 1 from public.wishlists w where w.user_id=player_id and w.card_id=c.id),
    'ownerCount',(select count(distinct uc.user_id) from public.user_cards uc
      where uc.card_id=c.id and uc.is_shiny is not distinct from p_is_shiny
        and public.can_view_collection(player_id,uc.user_id)),
    'owners',coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.user_id,'pseudo',o.pseudo,'copies',o.copies,'isFriend',o.is_friend
    ) order by o.is_friend desc,o.pseudo,o.user_id)
      from (select uc.user_id,p.pseudo,count(*) copies,
        public.friendship_state(player_id,uc.user_id)='accepted' is_friend
        from public.user_cards uc join public.user_profiles p on p.user_id=uc.user_id
        where uc.card_id=c.id and uc.is_shiny is not distinct from p_is_shiny
          and public.can_view_collection(player_id,uc.user_id)
        group by uc.user_id,p.pseudo order by is_friend desc,p.pseudo,uc.user_id
        offset safe_offset limit safe_limit
      ) o),'[]'::jsonb)
  ) into result from public.cards c where c.id=p_card_id;
  if result is null then raise exception 'CARD_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $$;
revoke all on function public.get_card_discovery(uuid,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.get_card_discovery(uuid,integer,integer,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
