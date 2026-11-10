begin;
create table public.license_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  binder_key text not null,
  name text not null check(char_length(btrim(name)) between 1 and 60),
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index license_folders_name_idx on public.license_folders(user_id,binder_key,lower(btrim(name)));
create table public.license_folder_cards (
  folder_id uuid not null references public.license_folders(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  primary key(folder_id,card_id)
);
alter table public.license_folders enable row level security;
alter table public.license_folder_cards enable row level security;
revoke all on public.license_folders,public.license_folder_cards from public,anon,authenticated,service_role;

create function public.save_license_folder(p_id uuid,p_binder_key text,p_name text,p_card_ids uuid[],p_featured boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); chosen text:=public.canonical_binder_key(p_binder_key); result uuid; existing public.license_folders%rowtype;
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
    if public.canonical_binder_key(existing.binder_key) is distinct from chosen then raise exception 'LICENSE_FOLDER_CARDS_INVALID';end if;
  elsif (select count(*) from public.license_folders where user_id=viewer)>=100 then raise exception 'LICENSE_FOLDER_LIMIT';end if;
  if not exists(select 1 from public.catalogue_binder_links where binder_key=chosen) then raise exception 'BINDER_NOT_FOUND';end if;
  if exists(select 1 from unnest(p_card_ids) id where not exists(
    select 1 from public.catalogue_binder_links links where links.binder_key=chosen and links.card_id=id
  )) then raise exception 'LICENSE_FOLDER_CARDS_INVALID';end if;
  if exists(select 1 from public.license_folders where user_id=viewer and binder_key=chosen
    and lower(btrim(name))=lower(btrim(p_name)) and id is distinct from p_id) then raise exception 'LICENSE_FOLDER_NAME_TAKEN';end if;
  if p_id is null then
    insert into public.license_folders(user_id,binder_key,name,featured) values(viewer,chosen,btrim(p_name),p_featured) returning id into result;
  else
    update public.license_folders set name=btrim(p_name),featured=p_featured,binder_key=chosen,updated_at=now() where id=p_id returning id into result;
  end if;
  delete from public.license_folder_cards where folder_id=result;
  insert into public.license_folder_cards(folder_id,card_id) select result,id from unnest(p_card_ids) id group by id;
  return result;
end $$;

create function public.delete_license_folder(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_player_not_banned();
  delete from public.license_folders where id=p_id and user_id=auth.uid();
  if not found then raise exception 'LICENSE_FOLDER_NOT_FOUND';end if;
end $$;

create function public.get_license_folders(p_owner_id uuid,p_binder_key text,p_featured_only boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); owner_id uuid:=coalesce(p_owner_id,auth.uid()); result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if not public.can_view_collection(viewer,owner_id) then raise exception 'PROFILE_PRIVATE';end if;
  with selected as materialized (
    select * from public.license_folders f where user_id=owner_id
      and (p_binder_key is null or public.canonical_binder_key(f.binder_key)=public.canonical_binder_key(p_binder_key))
      and (viewer=owner_id or featured) and (not coalesce(p_featured_only,false) or featured)
    order by created_at,id limit 100
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

create function public.get_license_folder_cards(p_id uuid,p_query text,p_owned_only boolean,p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare folder public.license_folders%rowtype; viewer uuid:=auth.uid();
begin
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  select * into folder from public.license_folders where id=p_id;
  if not found or (viewer<>folder.user_id and not folder.featured) then raise exception 'LICENSE_FOLDER_NOT_FOUND';end if;
  if not public.can_view_collection(viewer,folder.user_id) then raise exception 'PROFILE_PRIVATE';end if;
  return (
    with all_cards as materialized (
      select c.*,exists(select 1 from public.user_cards uc where uc.user_id=folder.user_id and uc.card_id=c.id) owned
      from public.license_folder_cards link join public.cards c on c.id=link.card_id where link.folder_id=p_id
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
revoke all on function public.save_license_folder(uuid,text,text,uuid[],boolean),public.delete_license_folder(uuid),
  public.get_license_folders(uuid,text,boolean),public.get_license_folder_cards(uuid,text,boolean,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.save_license_folder(uuid,text,text,uuid[],boolean),public.delete_license_folder(uuid),
  public.get_license_folders(uuid,text,boolean),public.get_license_folder_cards(uuid,text,boolean,integer,integer) to authenticated;

-- Extend the existing server-only export without creating another API entry point.
do $export$ declare source text; marker text:='return result;';begin
  source:=pg_get_functiondef('public.build_data_export(uuid,uuid)'::regprocedure);
  if strpos(lower(source),marker)=0 then raise exception 'LICENSE_FOLDER_EXPORT_PATCH_MISMATCH';end if;
  source:=replace(source,marker,$body$
    result:=result || jsonb_build_object(
      'license_folders',(select coalesce(jsonb_agg(to_jsonb(f)-'user_id'),'[]'::jsonb) from public.license_folders f where user_id=p_user_id),
      'license_folder_cards',(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.license_folder_cards c join public.license_folders f on f.id=c.folder_id where f.user_id=p_user_id));
    if (select coalesce(sum(case when jsonb_typeof(value)='array' then jsonb_array_length(value)
      when jsonb_typeof(value)='object' then 1 else 0 end),0) from jsonb_each(result))>100000
      or octet_length(result::text)>26214400 then raise exception 'EXPORT_TOO_LARGE';end if;
    return result;$body$);
  execute source;
end $export$;
notify pgrst,'reload schema';
commit;
