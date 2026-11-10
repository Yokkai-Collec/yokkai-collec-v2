-- Guard the framing entry point before validation or delegated cover writes.
begin;

create or replace function public.set_collection_cover_framed(
  p_target_key text,p_media_url text,p_frame jsonb default null
) returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); target text;
begin
  perform public.assert_player_not_banned();
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

commit;
