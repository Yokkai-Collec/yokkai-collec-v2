begin;

alter table public.profile_featured_selection
  add column folder_ids uuid[] not null default '{}'::uuid[]
  check(cardinality(folder_ids)<=100);

update public.profile_featured_selection selection
set folder_ids=coalesce((
  select array_agg(folder.id order by folder.name,folder.id)
  from public.license_folders folder
  where folder.user_id=selection.user_id and folder.featured
),'{}'::uuid[])
where cardinality(selection.folder_ids)=0;

create or replace function public.set_profile_featured_selection(p_binder_keys text[],p_folder_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); keys text[]; folders uuid[];
begin
  perform public.assert_player_not_banned();
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if p_binder_keys is null or p_folder_ids is null or cardinality(p_binder_keys)>100 or cardinality(p_folder_ids)>100
    or array_position(p_binder_keys,null) is not null or array_position(p_folder_ids,null) is not null
    then raise exception 'FEATURED_SELECTION_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('license-folders:'||viewer::text,0));
  select coalesce(array_agg(canonical_key order by position),'{}'::text[]) into keys from (
    select public.canonical_binder_key(input.key) canonical_key,min(input.position) position
    from unnest(p_binder_keys) with ordinality input(key,position)
    group by public.canonical_binder_key(input.key)
  ) canonical;
  select coalesce(array_agg(folder_id order by position),'{}'::uuid[]) into folders from (
    select input.folder_id,min(input.position) position
    from unnest(p_folder_ids) with ordinality input(folder_id,position)
    group by input.folder_id
  ) unique_folders;
  if exists(select 1 from unnest(keys) requested(key) where not exists(select 1 from public.catalogue_binder_links where binder_key=requested.key))
    or exists(select 1 from unnest(folders) requested(folder_id) where not exists(select 1 from public.license_folders folder where folder.id=requested.folder_id and folder.user_id=viewer))
    then raise exception 'FEATURED_SELECTION_INVALID';end if;
  insert into public.profile_featured_selection(user_id,binder_keys,folder_ids) values(viewer,keys,folders)
    on conflict(user_id) do update set binder_keys=excluded.binder_keys,folder_ids=excluded.folder_ids,updated_at=now();
  update public.license_folders set featured=(id=any(folders)),updated_at=now()
    where user_id=viewer and featured is distinct from (id=any(folders));
end $$;

create or replace function public.get_profile_featured_items(p_owner_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); owner_id uuid:=coalesce(p_owner_id,auth.uid()); keys text[]; folders uuid[];
begin
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if not public.can_view_collection(viewer,owner_id) then raise exception 'PROFILE_PRIVATE';end if;
  select selection.binder_keys,selection.folder_ids into keys,folders from public.profile_featured_selection selection where selection.user_id=owner_id;
  keys:=coalesce(keys,array(select distinct binder_key from public.binder_favorite_keys(owner_id) order by binder_key limit 100));
  folders:=coalesce(folders,array(select folder.id from public.license_folders folder where folder.user_id=owner_id and folder.featured order by folder.name,folder.id));
  return (
    with binder_order as materialized (
      select public.canonical_binder_key(input.key) binder_key,min(input.position)::integer display_order
      from unnest(keys) with ordinality input(key,position) group by public.canonical_binder_key(input.key)
    ), folder_order as materialized (
      select input.folder_id,min(input.position)::integer display_order
      from unnest(folders) with ordinality input(folder_id,position) group by input.folder_id
    ), owned as materialized (
      select distinct card_id from public.user_cards where user_id=owner_id
    ), catalogue as materialized (
      select link.*,binder_order.display_order from public.catalogue_binder_links link join binder_order using(binder_key)
    ), binders as (
      select link.binder_key id,'binder'::text kind,link.binder_key,min(link.display_order) display_order,min(link.display_name) license,
        count(distinct link.card_id)::integer total,count(distinct owned.card_id)::integer owned,
        (array_agg(card.image_url order by case card.rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,card.id) filter(where nullif(btrim(card.image_url),'') is not null))[1] image
      from catalogue link join public.cards card on card.id=link.card_id left join owned on owned.card_id=link.card_id group by link.binder_key
    ), featured_folders as (
      select folder.id::text id,'folder'::text kind,'folder:'||folder.id::text binder_key,folder_order.display_order,folder.name license,
        count(card.id)::integer total,count(owned.card_id)::integer owned,
        (array_agg(card.image_url order by case card.rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,card.id) filter(where nullif(btrim(card.image_url),'') is not null))[1] image
      from public.license_folders folder join folder_order on folder_order.folder_id=folder.id
      left join public.license_folder_cards folder_card on folder_card.folder_id=folder.id
      left join public.cards card on card.id=folder_card.card_id left join owned on owned.card_id=card.id
      where folder.user_id=owner_id group by folder.id,folder_order.display_order
    ), items as materialized (select * from binders union all select * from featured_folders)
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'binderKey',binder_key,'license',license,'total',total,'owned',owned,'percent',coalesce(least(100,round(owned::numeric*100/nullif(total,0))),0),'image',image) order by kind desc,display_order) from items),'[]'::jsonb),
      'binderKeys',coalesce((select jsonb_agg(id order by display_order) from items where kind='binder'),'[]'::jsonb),
      'folderIds',coalesce((select jsonb_agg(id order by display_order) from items where kind='folder'),'[]'::jsonb)
    )
  );
end $$;

revoke all on function public.set_profile_featured_selection(text[],uuid[]),public.get_profile_featured_items(uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_profile_featured_selection(text[],uuid[]),public.get_profile_featured_items(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
