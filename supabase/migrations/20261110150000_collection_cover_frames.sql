begin;

alter table public.collection_covers
  add column if not exists frame jsonb not null default '{"x":50,"y":50,"zoom":1,"rotation":0}'::jsonb;

create or replace function public.normalize_collection_cover_frame(p_frame jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare frame jsonb:=coalesce(p_frame,'{}'::jsonb); rotation numeric;
begin
  if jsonb_typeof(frame) is distinct from 'object' or octet_length(frame::text)>256
    or exists(select 1 from jsonb_object_keys(frame) key where key not in ('x','y','zoom','rotation'))
    or jsonb_typeof(frame->'x') is distinct from 'number'
    or jsonb_typeof(frame->'y') is distinct from 'number'
    or jsonb_typeof(frame->'zoom') is distinct from 'number'
    then raise exception 'COLLECTION_COVER_FRAME_INVALID'; end if;
  if frame ? 'rotation' and jsonb_typeof(frame->'rotation') is distinct from 'number'
    then raise exception 'COLLECTION_COVER_FRAME_INVALID'; end if;
  rotation:=coalesce((frame->>'rotation')::numeric,0);
  if (frame->>'x')::numeric not between 0 and 100
    or (frame->>'y')::numeric not between 0 and 100
    or (frame->>'zoom')::numeric not between 0.01 and 4
    or rotation not in (0,90,180,270)
    then raise exception 'COLLECTION_COVER_FRAME_INVALID'; end if;
  return jsonb_build_object('x',(frame->>'x')::numeric,'y',(frame->>'y')::numeric,
    'zoom',(frame->>'zoom')::numeric,'rotation',rotation);
end $$;
revoke all on function public.normalize_collection_cover_frame(jsonb) from public,anon,authenticated,service_role;

create function public.reset_collection_cover_frame_on_image_change()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.media_url is distinct from old.media_url then
    new.frame:='{"x":50,"y":50,"zoom":1,"rotation":0}'::jsonb;
  end if;
  return new;
end $$;
revoke all on function public.reset_collection_cover_frame_on_image_change() from public,anon,authenticated,service_role;
create trigger reset_collection_cover_frame_on_image_change
  before update of media_url on public.collection_covers
  for each row execute function public.reset_collection_cover_frame_on_image_change();

-- Keep the original two-argument RPC for old clients. New clients write image
-- and framing metadata in the same transaction through this owner-scoped RPC.
create function public.set_collection_cover_framed(
  p_target_key text,p_media_url text,p_frame jsonb default null
) returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); target text;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.set_collection_cover(p_target_key,p_media_url);
  if p_media_url is null then return; end if;
  target:=public.collection_cover_key(p_target_key);
  update public.collection_covers
    set frame=public.normalize_collection_cover_frame(coalesce(p_frame,'{"x":50,"y":50,"zoom":1,"rotation":0}'::jsonb)),updated_at=now()
    where user_id=viewer and target_key=target;
  if not found then raise exception 'COLLECTION_COVER_INVALID'; end if;
end $$;
revoke all on function public.set_collection_cover_framed(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.set_collection_cover_framed(text,text,jsonb) to authenticated;

create function public.get_collection_cover_frames(p_owner_id uuid,p_target_keys text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); owner_id uuid:=coalesce(p_owner_id,auth.uid());
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_target_keys is null or cardinality(p_target_keys)>200 or array_position(p_target_keys,null) is not null
    or exists(select 1 from unnest(p_target_keys) key where length(key)>300)
    then raise exception 'COLLECTION_COVER_INVALID'; end if;
  if not public.can_view_collection(viewer,owner_id) then raise exception 'PROFILE_PRIVATE'; end if;
  if not public.billing_has_game_pro(owner_id) then return '{}'::jsonb; end if;
  return coalesce((select jsonb_object_agg(requested.key,cover.frame)
    from (select distinct unnest(p_target_keys) key) requested
    join public.collection_covers cover
      on cover.user_id=owner_id and cover.target_key=public.collection_cover_key(requested.key)
    where left(cover.target_key,7)<>'folder:' or exists(
      select 1 from public.license_folders folder
      where folder.user_id=owner_id and 'folder:'||folder.id::text=cover.target_key
        and (viewer=owner_id or folder.featured)
    )), '{}'::jsonb);
end $$;
revoke all on function public.get_collection_cover_frames(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_collection_cover_frames(uuid,text[]) to authenticated;

commit;
