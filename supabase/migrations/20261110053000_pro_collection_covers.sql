begin;
alter table public.profile_media_assets drop constraint profile_media_assets_purpose_check;
alter table public.profile_media_assets add constraint profile_media_assets_purpose_check
  check(purpose in ('avatar','banner','background','card-back','collection-cover'));

create table public.collection_covers (
  user_id uuid not null references auth.users(id) on delete cascade,
  target_key text not null check(length(target_key) between 1 and 300),
  media_url text not null,
  updated_at timestamptz not null default now(),
  primary key(user_id,target_key)
);
alter table public.collection_covers enable row level security;
revoke all on public.collection_covers from public,anon,authenticated,service_role;

-- Invoked only inside the definer readers/writer; never exposed as an RPC.
create function public.collection_cover_key(p_key text) returns text
language sql stable set search_path='' as $$
  select case when left(p_key,7)='folder:' then p_key
    else public.canonical_binder_key(coalesce(
      (select min(binder_key) from public.catalogue_binder_links where display_name=p_key),p_key)) end
$$;
revoke all on function public.collection_cover_key(text) from public,anon,authenticated,service_role;

create function public.set_collection_cover(p_target_key text,p_media_url text) returns void
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); target text;
begin
  perform public.assert_player_not_banned();
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if p_target_key is null or length(p_target_key)>300 then raise exception 'COLLECTION_COVER_INVALID';end if;
  target:=public.collection_cover_key(p_target_key);
  perform pg_advisory_xact_lock(hashtextextended('collection-covers:'||viewer::text,0));
  if left(target,7)='folder:' then
    if not exists(select 1 from public.license_folders where user_id=viewer and 'folder:'||id::text=target)
      then raise exception 'COLLECTION_COVER_INVALID';end if;
  elsif not exists(select 1 from public.catalogue_binder_links where binder_key=target) then
    raise exception 'COLLECTION_COVER_INVALID';
  end if;
  -- Removing a customization remains possible after Pro expires.
  if p_media_url is null then
    delete from public.collection_covers where user_id=viewer and target_key=target;
    return;
  end if;
  if not public.billing_has_game_pro(viewer) then raise exception 'PRO_REQUIRED';end if;
  -- Accept fresh uploads or an asset already referenced by a cover.
  perform 1 from public.profile_media_assets where user_id=viewer and public_url=p_media_url
    and purpose='collection-cover' and (created_at>clock_timestamp()-interval '24 hours'
      or exists(select 1 from public.collection_covers where user_id=viewer and media_url=p_media_url)) for update;
  if not found then raise exception 'COLLECTION_COVER_INVALID';end if;
  if not exists(select 1 from public.collection_covers where user_id=viewer and target_key=target)
    and (select count(*) from public.collection_covers where user_id=viewer)>=200
    then raise exception 'COLLECTION_COVER_LIMIT';end if;
  insert into public.collection_covers(user_id,target_key,media_url) values(viewer,target,p_media_url)
    on conflict(user_id,target_key) do update set media_url=excluded.media_url,updated_at=now();
end $$;

create function public.get_collection_covers(p_owner_id uuid,p_target_keys text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); owner_id uuid:=coalesce(p_owner_id,auth.uid());
begin
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if p_target_keys is null or cardinality(p_target_keys)>200 or array_position(p_target_keys,null) is not null
    or exists(select 1 from unnest(p_target_keys) k where length(k)>300)
    then raise exception 'COLLECTION_COVER_INVALID';end if;
  if not public.can_view_collection(viewer,owner_id) then raise exception 'PROFILE_PRIVATE';end if;
  if not public.billing_has_game_pro(owner_id) then return '{}'::jsonb;end if;
  return coalesce((select jsonb_object_agg(k,c.media_url) from (select distinct unnest(p_target_keys) k) requested
    join public.collection_covers c on c.user_id=owner_id and c.target_key=public.collection_cover_key(k)
    where left(c.target_key,7)<>'folder:' or exists(select 1 from public.license_folders f
      where f.user_id=owner_id and 'folder:'||f.id::text=c.target_key and (viewer=owner_id or f.featured))), '{}'::jsonb);
end $$;
revoke all on function public.set_collection_cover(text,text),public.get_collection_covers(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function public.set_collection_cover(text,text),public.get_collection_covers(uuid,text[]) to authenticated;

create function public.remove_deleted_folder_cover() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.collection_covers where user_id=old.user_id and target_key='folder:'||old.id::text;
  return old;
end $$;
revoke all on function public.remove_deleted_folder_cover() from public,anon,authenticated,service_role;
create trigger remove_deleted_folder_cover after delete on public.license_folders
  for each row execute function public.remove_deleted_folder_cover();

do $cleanup$ declare original text; changed text;begin
  original:=pg_get_functiondef('public.claim_stale_profile_media(uuid)'::regprocedure);
  changed:=replace(original,'select avatar_url as url from public.user_profiles where user_id=p_user_id',
    'select media_url as url from public.collection_covers where user_id=p_user_id
      union all select avatar_url as url from public.user_profiles where user_id=p_user_id');
  if original=changed then raise exception 'COLLECTION_COVER_CLEANUP_PATCH_MISMATCH';end if;
  execute changed;
end $cleanup$;
do $export$ declare original text;changed text;begin
  original:=pg_get_functiondef('public.build_data_export(uuid,uuid)'::regprocedure);
  changed:=replace(original,'return result;', $body$
    result:=result || jsonb_build_object('collection_covers',coalesce((select jsonb_agg(to_jsonb(c)-'user_id')
      from public.collection_covers c where user_id=p_user_id),'[]'::jsonb));
    if (select coalesce(sum(case when jsonb_typeof(value)='array' then jsonb_array_length(value)
      when jsonb_typeof(value)='object' then 1 else 0 end),0) from jsonb_each(result))>100000
      or octet_length(result::text)>26214400 then raise exception 'EXPORT_TOO_LARGE';end if;
    return result;$body$);
  if original=changed then raise exception 'COLLECTION_COVER_EXPORT_PATCH_MISMATCH';end if;
  execute changed;
end $export$;
notify pgrst,'reload schema';
commit;
