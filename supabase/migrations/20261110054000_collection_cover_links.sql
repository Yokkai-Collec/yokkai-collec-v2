begin;
-- Retain previously uploaded covers; new links follow the card image hosts.
create or replace function public.set_collection_cover(p_target_key text,p_media_url text) returns void
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
  p_media_url:=nullif(btrim(p_media_url),'');
  if p_media_url is null then
    delete from public.collection_covers where user_id=viewer and target_key=target;
    return;
  end if;
  if not public.billing_has_game_pro(viewer) then raise exception 'PRO_REQUIRED';end if;
  if length(p_media_url)>2048 then raise exception 'COLLECTION_COVER_INVALID';end if;
  if p_media_url !~* '^https://((i[.])?imgur[.]com|i[.]pinimg[.]com)/[^[:space:]]+$' then
    perform 1 from public.profile_media_assets where user_id=viewer and public_url=p_media_url
      and purpose='collection-cover' and (created_at>clock_timestamp()-interval '24 hours'
        or exists(select 1 from public.collection_covers where user_id=viewer and media_url=p_media_url)) for update;
    if not found then raise exception 'COLLECTION_COVER_INVALID';end if;
  end if;
  if not exists(select 1 from public.collection_covers where user_id=viewer and target_key=target)
    and (select count(*) from public.collection_covers where user_id=viewer)>=200
    then raise exception 'COLLECTION_COVER_LIMIT';end if;
  insert into public.collection_covers(user_id,target_key,media_url) values(viewer,target,p_media_url)
    on conflict(user_id,target_key) do update set media_url=excluded.media_url,updated_at=now();
end $$;
revoke all on function public.set_collection_cover(text,text) from public,anon,authenticated,service_role;
grant execute on function public.set_collection_cover(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
