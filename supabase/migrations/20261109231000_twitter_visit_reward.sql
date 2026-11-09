begin;
set local lock_timeout = '5s';

-- A visit reward, deliberately not a verified follow. No Twitter identity or token.
-- Keep the minimal receipt while the offer is available, including after deletion.
create table public.twitter_reward_claims (
  user_id uuid primary key,
  claimed_at timestamptz not null default clock_timestamp()
);
alter table public.twitter_reward_claims enable row level security;
revoke all on public.twitter_reward_claims from public, anon, authenticated, service_role;
grant select on public.twitter_reward_claims to authenticated;
create policy twitter_reward_own_receipt on public.twitter_reward_claims
  for select to authenticated using (user_id = (select auth.uid()));

create function public.claim_twitter_visit_reward() returns text
language plpgsql security definer set search_path = '' as $$
declare player uuid := auth.uid();
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  if exists(select 1 from public.account_deletion_log where user_id = player) then
    raise exception 'ACCOUNT_DELETED';
  end if;
  perform 1 from auth.users where id = player and email_confirmed_at is not null for share;
  if not found then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
  insert into public.twitter_reward_claims(user_id) values(player) on conflict do nothing;
  if not found then return 'already-claimed'; end if;
  update public.user_profiles set bonus_regular_packs = bonus_regular_packs + 5 where user_id = player;
  if not found then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
  return 'claimed';
end;
$$;
revoke all on function public.claim_twitter_visit_reward() from public, anon, authenticated, service_role;
grant execute on function public.claim_twitter_visit_reward() to authenticated;

alter function public.build_data_export(uuid, uuid) rename to build_data_export_without_twitter_reward;
revoke all on function public.build_data_export_without_twitter_reward(uuid, uuid) from public, anon, authenticated, service_role;
create function public.build_data_export(p_user_id uuid, p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare result jsonb;
begin
  select public.build_data_export_without_twitter_reward(p_user_id, p_request_id) || jsonb_build_object(
    'twitter_reward', (select jsonb_build_object('claimed_at', claimed_at)
      from public.twitter_reward_claims where user_id = p_user_id)
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
