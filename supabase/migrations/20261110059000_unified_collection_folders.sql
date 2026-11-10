-- One folder catalogue for collection, licenses and profile. Existing IDs,
-- instance assignments, featured selections and personal covers are preserved.
begin;
set local lock_timeout='3s';
alter table public.license_folders alter column binder_key drop not null;

insert into public.license_folders(id,user_id,binder_key,name,created_at,updated_at)
  select id,user_id,null,nom,created_at,created_at from public.folders on conflict(id) do nothing;
insert into public.license_folder_cards(folder_id,card_id)
  select distinct folder_id,card_id from public.user_cards where folder_id is not null on conflict do nothing;
insert into public.folders(id,user_id,nom)
  select id,user_id,id::text from public.license_folders on conflict(id) do nothing;
create or replace function public.save_license_folder(p_id uuid,p_binder_key text,p_name text,p_card_ids uuid[],p_featured boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); chosen text:=case when nullif(btrim(p_binder_key),'') is null then null else public.canonical_binder_key(p_binder_key) end; result uuid; existing public.license_folders%rowtype;
begin
  perform public.assert_player_not_banned();
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then raise exception 'LICENSE_FOLDER_NAME_INVALID';end if;
  if p_card_ids is null or cardinality(p_card_ids)>500 or array_position(p_card_ids,null) is not null then raise exception 'LICENSE_FOLDER_CARDS_INVALID';end if;
  if p_featured is null then raise exception 'LICENSE_FOLDER_CARDS_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('license-folders:'||viewer::text,0));
  if p_id is not null then
    select * into existing from public.license_folders where id=p_id and user_id=viewer for update;
    if not found then raise exception 'LICENSE_FOLDER_NOT_FOUND';end if;

  elsif (select count(*) from public.license_folders where user_id=viewer)>=100 then raise exception 'LICENSE_FOLDER_LIMIT';end if;
  if exists(select 1 from unnest(p_card_ids) requested(card_id) where not exists(select 1 from public.cards c where c.id=requested.card_id)) then raise exception 'LICENSE_FOLDER_CARDS_INVALID';end if;
  if exists(select 1 from public.license_folders where user_id=viewer and binder_key is not distinct from chosen
    and lower(btrim(name))=lower(btrim(p_name)) and id is distinct from p_id) then raise exception 'LICENSE_FOLDER_NAME_TAKEN';end if;
  if p_id is null then
    insert into public.license_folders(user_id,binder_key,name,featured) values(viewer,chosen,btrim(p_name),p_featured) returning id into result;
  else
    update public.license_folders set name=btrim(p_name),featured=p_featured,binder_key=chosen,updated_at=now() where id=p_id returning id into result;
  end if;
  delete from public.license_folder_cards where folder_id=result;
  insert into public.license_folder_cards(folder_id,card_id) select result,id from unnest(p_card_ids) id group by id;
  update public.user_cards set folder_id=null where user_id=viewer and folder_id=result and not(card_id=any(p_card_ids));
  -- Keep the original instance assignment API compatible with unified folder IDs.
  insert into public.folders(id,user_id,nom) values(result,viewer,result::text) on conflict(id) do nothing;
  return result;
end $$;
create or replace function public.delete_license_folder(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_player_not_banned();
  update public.user_cards set folder_id=null where folder_id=p_id and user_id=auth.uid();
  delete from public.folders where id=p_id and user_id=auth.uid();
  delete from public.license_folders where id=p_id and user_id=auth.uid();
  if not found then raise exception 'LICENSE_FOLDER_NOT_FOUND';end if;
end $$;
create or replace function public.get_license_folders(p_owner_id uuid,p_binder_key text,p_featured_only boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); owner_id uuid:=coalesce(p_owner_id,auth.uid()); result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if not public.can_view_collection(viewer,owner_id) then raise exception 'PROFILE_PRIVATE';end if;
  with selected as materialized (
    select * from public.license_folders f where user_id=owner_id
      and (p_binder_key is null or public.canonical_binder_key(f.binder_key)=public.canonical_binder_key(p_binder_key) or exists(select 1 from public.license_folder_cards fc join public.catalogue_binder_links bl on bl.card_id=fc.card_id where fc.folder_id=f.id and bl.binder_key=public.canonical_binder_key(p_binder_key)))
      and (viewer=owner_id or featured) and (not coalesce(p_featured_only,false) or featured)
    order by created_at,id
  ), owned as materialized(select distinct card_id from public.user_cards where user_id=owner_id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'binderKey',f.binder_key,'name',f.name,'featured',f.featured,
    'total',(select count(*) from public.license_folder_cards where folder_id=f.id),
    'owned',(select count(*) from public.license_folder_cards c join owned o on o.card_id=c.card_id where folder_id=f.id),
    'image',(select c.image_url from public.license_folder_cards link join public.cards c on c.id=link.card_id
      where folder_id=f.id and nullif(btrim(c.image_url),'') is not null
      order by case c.rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,c.id limit 1),
    'cardIds',case when viewer=owner_id and not coalesce(p_featured_only,false) then (select coalesce(jsonb_agg(card_id order by card_id),'[]'::jsonb) from public.license_folder_cards where folder_id=f.id) else '[]'::jsonb end
  ) order by created_at,id),'[]'::jsonb) into result from selected f;
  return result;
end $$;
create or replace function public.get_license_folder_cards(p_id uuid,p_query text,p_owned_only boolean,p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare folder public.license_folders%rowtype; viewer uuid:=auth.uid();
begin
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if p_id is not null then
  select * into folder from public.license_folders where id=p_id;
  if not found or (viewer<>folder.user_id and not folder.featured) then raise exception 'LICENSE_FOLDER_NOT_FOUND';end if;
  if not public.can_view_collection(viewer,folder.user_id) then raise exception 'PROFILE_PRIVATE';end if;
  else
    folder.user_id:=viewer;
  end if;
  return (
    with all_cards as materialized (
      select c.*,exists(select 1 from public.user_cards uc where uc.user_id=folder.user_id and uc.card_id=c.id) owned
      from public.cards c where p_id is null or exists(select 1 from public.license_folder_cards link where link.card_id=c.id and link.folder_id=p_id)
    ), matching as materialized (
      select * from all_cards where (not coalesce(p_owned_only,false) or owned)
        and not exists(select 1 from regexp_split_to_table(lower(btrim(coalesce(p_query,''))),'[[:space:]]+') term
          where term<>'' and not (nom ilike '%'||term||'%' or franchise ilike '%'||term||'%'))
    ), page as (
      select * from matching order by case rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,nom,id
      offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,24),1),60)
    ) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'name',nom,'category',categorie,'anime',franchise,'rarity',rarete_base,'image',image_url,'owned',owned)
      order by case rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,nom,id) from page),'[]'::jsonb),
      'total',(select count(*) from matching),'binderTotal',(select count(*) from all_cards),'binderOwned',(select count(*) from all_cards where owned))
  );
end $$;
create or replace function public.create_folder(p_name text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare id uuid;begin
  perform public.assert_player_not_banned();
  if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
  id:=public.save_license_folder(null,null,p_name,'{}'::uuid[],false);
  return jsonb_build_object('id',id,'name',btrim(p_name));
end $$;
create or replace function public.delete_folder(p_folder_id uuid) returns void language plpgsql volatile security definer set search_path='' as $$
begin
  perform public.assert_player_not_banned();
  if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
  -- Legacy rows can still be read by old clients during rollout.
  if exists(select 1 from public.license_folders where id=p_folder_id and user_id=auth.uid()) then
    perform public.delete_license_folder(p_folder_id);
  else
    update public.user_cards set folder_id=null where folder_id=p_folder_id and user_id=auth.uid();
    delete from public.folders where id=p_folder_id and user_id=auth.uid();
    if not found then raise exception 'FOLDER_NOT_FOUND';end if;
  end if;
end $$;
create or replace function public.move_cards_to_folder(
  p_card_instance_ids uuid[],
  p_folder_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  moved_count integer;
begin
  perform public.assert_player_not_banned();
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if coalesce(cardinality(p_card_instance_ids), 0) < 1
    or cardinality(p_card_instance_ids) > 500
    or array_position(p_card_instance_ids, null) is not null then
    raise exception 'INVALID_CARD_SELECTION' using errcode = 'P0001';
  end if;

  if p_folder_id is not null and not exists (
    select 1
    from public.folders
    where id = p_folder_id and user_id = auth.uid()
  ) then
    raise exception 'FOLDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from unnest(p_card_instance_ids) as requested(id)
    where not exists (
      select 1
      from public.user_cards
      where user_cards.id = requested.id and user_cards.user_id = auth.uid()
    )
  ) then
    raise exception 'CARD_NOT_OWNED' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('license-folders:'||auth.uid()::text,0));
  insert into public.license_folders(id,user_id,binder_key,name)
    select f.id,f.user_id,null,f.nom from public.folders f where f.id=p_folder_id and f.user_id=auth.uid() on conflict(id) do nothing;
  delete from public.license_folder_cards fc using public.user_cards uc
    where uc.id=any(p_card_instance_ids) and uc.user_id=auth.uid() and fc.folder_id=uc.folder_id and fc.card_id=uc.card_id
    and not exists(select 1 from public.user_cards other where other.user_id=uc.user_id and other.folder_id=uc.folder_id and other.card_id=uc.card_id and not(other.id=any(p_card_instance_ids)));
  if p_folder_id is not null then
    insert into public.license_folder_cards(folder_id,card_id)
      select p_folder_id,card_id from public.user_cards where user_id=auth.uid() and id=any(p_card_instance_ids) group by card_id on conflict do nothing;
  end if;
  update public.user_cards
  set folder_id = p_folder_id
  where user_id = auth.uid() and id = any(p_card_instance_ids);

  get diagnostics moved_count = row_count;
  return moved_count;
end;
$$;


create or replace function public.move_card_to_folder(p_card_instance_id uuid,p_folder_id uuid default null) returns void language plpgsql volatile security definer set search_path='' as $$
begin
  perform public.assert_player_not_banned();
  perform public.move_cards_to_folder(array[p_card_instance_id],p_folder_id);
end $$;
-- Extend the existing bounded collection reader and counters. No new SQL rights.
do $patch$ declare source text; marker text;begin
 source:=pg_get_functiondef('public.collection_ranked_copies(uuid,text,text[],text[],boolean,text,boolean,boolean,text)'::regprocedure);
 marker:='(p_folder is null or (p_folder=''unfiled'' and x.folder_id is null) or x.folder_id::text=p_folder)';
 if strpos(source,marker)=0 then raise exception 'UNIFIED_FOLDER_FILTER_PATCH_MISMATCH';end if;
 source:=replace(source,marker,$body$(p_folder is null or (p_folder='unfiled' and x.folder_id is null and not exists(select 1 from public.license_folder_cards fc join public.license_folders f on f.id=fc.folder_id where f.user_id=p_player and fc.card_id=x.card_id)) or x.folder_id::text=p_folder or exists(select 1 from public.license_folder_cards fc join public.license_folders f on f.id=fc.folder_id where f.user_id=p_player and fc.folder_id::text=p_folder and fc.card_id=x.card_id))$body$);
 execute source;
 source:=pg_get_functiondef('public.get_collection_counts()'::regprocedure);
 source:=replace(source,'uc.is_locked, uc.folder_id,','uc.is_locked, uc.folder_id, uc.card_id,');
 source:=replace(source,'from copies where folder_id is null','from copies cp where folder_id is null and not exists(select 1 from public.license_folder_cards fc join public.license_folders f on f.id=fc.folder_id where f.user_id=player and fc.card_id=cp.card_id)');
 marker:='select folder_id,count(distinct group_key) n from copies where folder_id is not null group by folder_id';
 if strpos(source,marker)=0 then raise exception 'UNIFIED_FOLDER_COUNTS_PATCH_MISMATCH';end if;
 source:=replace(source,marker,$body$select memberships.folder_id,count(distinct cp.group_key) n from copies cp join lateral (
   select cp.folder_id where cp.folder_id is not null union select fc.folder_id from public.license_folder_cards fc join public.license_folders f on f.id=fc.folder_id where f.user_id=player and fc.card_id=cp.card_id
 ) memberships on true group by memberships.folder_id$body$);
 execute source;
end $patch$;
notify pgrst,'reload schema';
commit;
