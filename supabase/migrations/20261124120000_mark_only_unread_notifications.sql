begin;

create or replace function public.mark_notification_read(p_notification_id uuid default null)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  affected integer;
begin
  perform public.assert_player_not_banned();
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;

  update public.notifications
  set read_at = clock_timestamp()
  where user_id = player_id
    and type <> 'mission_completed'
    and read_at is null
    and (p_notification_id is null or id = p_notification_id);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

commit;
