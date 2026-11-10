begin;
create table public.profile_featured_selection (
  user_id uuid primary key references auth.users(id) on delete cascade,
  binder_keys text[] not null check(cardinality(binder_keys)<=100),
  updated_at timestamptz not null default now()
);
alter table public.profile_featured_selection enable row level security;
revoke all on public.profile_featured_selection from public,anon,authenticated,service_role;

create function public.set_profile_featured_selection(p_binder_keys text[],p_folder_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); keys text[];
begin
  perform public.assert_player_not_banned();
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if p_binder_keys is null or p_folder_ids is null or cardinality(p_binder_keys)>100 or cardinality(p_folder_ids)>100
    or array_position(p_binder_keys,null) is not null or array_position(p_folder_ids,null) is not null
    then raise exception 'FEATURED_SELECTION_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('license-folders:'||viewer::text,0));
  select coalesce(array_agg(key order by key),'{}'::text[]) into keys
    from (select distinct public.canonical_binder_key(key) key from unnest(p_binder_keys) key) canonical;
  if exists(select 1 from unnest(keys) key where not exists(select 1 from public.catalogue_binder_links where binder_key=key))
    or exists(select 1 from unnest(p_folder_ids) requested(folder_id) where not exists(select 1 from public.license_folders f where f.id=requested.folder_id and f.user_id=viewer))
    then raise exception 'FEATURED_SELECTION_INVALID';end if;
  insert into public.profile_featured_selection(user_id,binder_keys) values(viewer,keys)
    on conflict(user_id) do update set binder_keys=excluded.binder_keys,updated_at=now();
  update public.license_folders set featured=(id=any(p_folder_ids)),updated_at=now()
    where user_id=viewer and featured is distinct from (id=any(p_folder_ids));
end $$;

create function public.get_profile_featured_items(p_owner_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); owner_id uuid:=coalesce(p_owner_id,auth.uid()); keys text[];
begin
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if not public.can_view_collection(viewer,owner_id) then raise exception 'PROFILE_PRIVATE';end if;
  keys:=coalesce((select binder_keys from public.profile_featured_selection where user_id=owner_id),
    array(select distinct binder_key from public.binder_favorite_keys(owner_id) order by binder_key limit 100));
  return (
    with chosen as materialized(select distinct public.canonical_binder_key(key) binder_key from unnest(keys) key),
    owned as materialized(select distinct card_id from public.user_cards where user_id=owner_id),
    catalogue as materialized(select l.* from public.catalogue_binder_links l join chosen using(binder_key)),
    binders as (
      select l.binder_key id,'binder'::text kind,l.binder_key,min(l.display_name) license,
        count(distinct l.card_id)::integer total,count(distinct o.card_id)::integer owned,
        (array_agg(c.image_url order by case c.rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,c.id)
          filter(where nullif(btrim(c.image_url),'') is not null))[1] image
      from catalogue l join public.cards c on c.id=l.card_id left join owned o on o.card_id=l.card_id group by l.binder_key
    ), folders as (
      select f.id::text id,'folder'::text kind,'folder:'||f.id::text binder_key,f.name license,
        count(c.id)::integer total,count(o.card_id)::integer owned,
        (array_agg(c.image_url order by case c.rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,c.id)
          filter(where nullif(btrim(c.image_url),'') is not null))[1] image
      from public.license_folders f left join public.license_folder_cards fc on fc.folder_id=f.id
      left join public.cards c on c.id=fc.card_id left join owned o on o.card_id=c.id
      where f.user_id=owner_id and f.featured group by f.id
    ), items as materialized(select * from binders union all select * from folders)
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'binderKey',binder_key,'license',license,
        'total',total,'owned',owned,'percent',coalesce(least(100,round(owned::numeric*100/nullif(total,0))),0),'image',image)
        order by kind desc,license,id) from items),'[]'::jsonb),
      'binderKeys',coalesce((select jsonb_agg(id order by id) from items where kind='binder'),'[]'::jsonb),
      'folderIds',coalesce((select jsonb_agg(id order by id) from items where kind='folder'),'[]'::jsonb)
    )
  );
end $$;
revoke all on function public.set_profile_featured_selection(text[],uuid[]),public.get_profile_featured_items(uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_profile_featured_selection(text[],uuid[]),public.get_profile_featured_items(uuid) to authenticated;
do $export$ declare source text;marker text:='return result;';begin
  source:=pg_get_functiondef('public.build_data_export(uuid,uuid)'::regprocedure);
  if strpos(source,marker)=0 then raise exception 'FEATURED_EXPORT_PATCH_MISMATCH';end if;
  source:=replace(source,marker,$body$
    result:=result || jsonb_build_object('profile_featured_selection',
      (select to_jsonb(s)-'user_id' from public.profile_featured_selection s where user_id=p_user_id));
    if (select coalesce(sum(case when jsonb_typeof(value)='array' then jsonb_array_length(value)
      when jsonb_typeof(value)='object' then 1 else 0 end),0) from jsonb_each(result))>100000
      or octet_length(result::text)>26214400 then raise exception 'EXPORT_TOO_LARGE';end if;
    return result;$body$);execute source;
end $export$;
notify pgrst,'reload schema';
commit;
