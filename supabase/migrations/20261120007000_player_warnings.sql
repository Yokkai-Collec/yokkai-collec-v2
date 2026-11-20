begin;
set local lock_timeout = '5s';

create table public.player_warnings (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(),
  acknowledged_at timestamptz
);
create index player_warnings_recipient on public.player_warnings(user_id, created_at, id);
create index player_warnings_pending on public.player_warnings(user_id, created_at, id)
  where acknowledged_at is null;
create index player_warnings_issuer on public.player_warnings(created_by);

alter table public.player_warnings enable row level security;
revoke all on public.player_warnings from public, anon, authenticated, service_role;
grant select (id, user_id, reason, created_at, acknowledged_at)
  on public.player_warnings to authenticated;
create policy player_warnings_read_own on public.player_warnings
  for select to authenticated using (user_id = (select auth.uid()));

create function public.admin_send_player_warning(p_id uuid, p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  issuer uuid := auth.uid();
  trimmed text := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_id is null or p_user_id is null or p_reason is null or char_length(p_reason) > 500 or trimmed = ''
  then raise exception 'INVALID_PLAYER_WARNING'; end if;

  insert into public.player_warnings(id, user_id, created_by, reason)
    values (p_id, p_user_id, issuer, trimmed) on conflict (id) do nothing;
  if not found and not exists (
    select 1 from public.player_warnings w
    where w.id = p_id and w.user_id = p_user_id and w.created_by = issuer and w.reason = trimmed
  ) then
    raise exception 'INVALID_PLAYER_WARNING';
  end if;
end $$;

create function public.acknowledge_player_warning(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_player_not_banned();
  update public.player_warnings
    set acknowledged_at = clock_timestamp()
    where id = p_id and user_id = auth.uid() and acknowledged_at is null;
  return found or exists (
    select 1 from public.player_warnings where id = p_id and user_id = auth.uid()
  );
end $$;

revoke all on function public.admin_send_player_warning(uuid, uuid, text),
  public.acknowledge_player_warning(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_send_player_warning(uuid, uuid, text),
  public.acknowledge_player_warning(uuid) to authenticated;

do $realtime$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.player_warnings;
  end if;
end
$realtime$;

do $export$
declare
  source text := pg_get_functiondef('public.build_data_export(uuid,uuid)'::regprocedure);
  marker constant text := 'return result;';
begin
  if array_length(string_to_array(source, marker), 1) <> 2 then
    raise exception 'PLAYER_WARNING_EXPORT_PATCH_MISMATCH';
  end if;
  execute replace(source, marker, $body$
    select result || jsonb_build_object('player_warnings', coalesce((
      select jsonb_agg(jsonb_build_object('reason', w.reason, 'created_at', w.created_at,
        'acknowledged_at', w.acknowledged_at) order by w.created_at, w.id)
      from public.player_warnings w where w.user_id = p_user_id
    ), '[]'::jsonb)) into result;
    if (select coalesce(sum(case when jsonb_typeof(value) = 'array' then jsonb_array_length(value)
      when jsonb_typeof(value) = 'object' then 1 else 0 end), 0) from jsonb_each(result)) > 100000
      or octet_length(result::text) > 26214400 then raise exception 'EXPORT_TOO_LARGE'; end if;
    return result;
  $body$);
end
$export$;

notify pgrst, 'reload schema';
commit;
