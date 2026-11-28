begin;
set local lock_timeout = '3s';

insert into public.card_cosmetic_offers(id, kind, price)
values ('frame_halo', 'animation', 900)
on conflict (id) do nothing;

drop function public.get_collection_groups_page(text,text[],text[],boolean,text,boolean,boolean,text,text,integer,integer,boolean);

create function public.get_collection_groups_page(
  p_query text default '', p_categories text[] default null, p_rarities text[] default null,
  p_shiny_only boolean default false, p_folder text default null, p_auction_only boolean default false,
  p_locked_only boolean default false, p_sort text default 'rarity', p_after text default null,
  p_offset integer default 0, p_limit integer default 24, p_duplicates_only boolean default false,
  p_cosmetic_id text default null, p_cosmetic_equipped_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid(); page_size integer:=least(60,greatest(1,coalesce(p_limit,24))); result jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if coalesce(p_sort,'') not in ('rarity','recent','oldest','name') or char_length(coalesce(p_query,''))>200
    or coalesce(p_offset,0)<0 then raise exception 'COLLECTION_PAGE_INVALID' using errcode='P0001'; end if;
  if p_cosmetic_id is not null and not exists (
    select 1 from public.card_cosmetic_offers
    where id = p_cosmetic_id and kind in ('animation', 'filter')
  ) then raise exception 'COLLECTION_PAGE_INVALID' using errcode='P0001'; end if;
  with ranked as materialized (
    select * from public.collection_ranked_copies(player,p_query,p_categories,p_rarities,
      p_shiny_only,p_folder,p_auction_only,p_locked_only,p_sort) r
    where (not coalesce(p_duplicates_only,false) or r.group_key in (
      select u.card_id::text||':'||c.rarete_base::text||':'||
        case when u.is_evolved then 'evolved' when u.is_shiny and c.rarete_base<>'LR' then 'shiny' else 'normal' end
      from public.user_cards u join public.cards c on c.id=u.card_id
      where u.user_id=player
      group by 1
      having count(*)>1))
      and case
        when p_cosmetic_id is null then true
        when p_cosmetic_equipped_only then exists (
          select 1 from public.card_cosmetic_equipment e
          where e.user_id = player and e.card_id = (r.copy->>'instanceId')::uuid
            and e.cosmetic_id = p_cosmetic_id
        )
        else public.can_equip_card_cosmetic(
          p_cosmetic_id, (r.copy->>'rarity')::public.card_rarity, (r.copy->>'isEvolved')::boolean
        )
      end
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

revoke all on function public.get_collection_groups_page(text,text[],text[],boolean,text,boolean,boolean,text,text,integer,integer,boolean,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.get_collection_groups_page(text,text[],text[],boolean,text,boolean,boolean,text,text,integer,integer,boolean,text,boolean)
  to authenticated;

notify pgrst, 'reload schema';
commit;
