begin;
set local lock_timeout = '3s';

-- Extend the existing STABLE export in place: preserve every prior projection,
-- owner/ACL and snapshot guard without adding another delegation level.
do $export$
declare source text; marker text := 'return result;';
begin
  source := pg_get_functiondef('public.build_data_export(uuid,uuid)'::regprocedure);
  if (length(source) - length(replace(source, marker, ''))) / length(marker) <> 1 then
    raise exception 'PLAYER_TITLES_EXPORT_PATCH_MISMATCH';
  end if;
  execute replace(source, marker, $body$
    select result || jsonb_build_object(
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
  $body$);
end;
$export$;

notify pgrst, 'reload schema';
commit;
