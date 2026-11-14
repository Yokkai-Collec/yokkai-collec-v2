begin;
set local lock_timeout = '3s';

alter function public.build_data_export(uuid, uuid) rename to build_data_export_without_player_titles;
revoke all on function public.build_data_export_without_player_titles(uuid, uuid) from public, anon, authenticated, service_role;

create function public.build_data_export(p_user_id uuid, p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare result jsonb;
begin
  -- Keep reservation/deletion checks and all reads in the same SQL snapshot.
  select public.build_data_export_without_player_titles(p_user_id, p_request_id) || jsonb_build_object(
    'player_title', jsonb_build_object('title_id', coalesce(
      (select title_id from public.player_equipped_titles where user_id = p_user_id), 'collector')),
    'player_titles', coalesce((select jsonb_agg(jsonb_build_object(
      'title_id', title_id, 'unlocked_at', unlocked_at, 'seen_at', seen_at) order by title_id)
      from public.player_title_unlocks where user_id = p_user_id), '[]'::jsonb)
  ) into result;
  if (select coalesce(sum(case when jsonb_typeof(value) = 'array' then jsonb_array_length(value)
      when jsonb_typeof(value) = 'object' then 1 else 0 end), 0) from jsonb_each(result)) > 100000
    or octet_length(result::text) > 26214400 then raise exception 'EXPORT_TOO_LARGE'; end if;
  return result;
end;
$$;
revoke all on function public.build_data_export(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.build_data_export(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
