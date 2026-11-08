begin;
set local lock_timeout = '5s';

alter table public.user_profiles add column discord_reward_dismissed_at timestamptz;

create function public.get_discord_reward_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return jsonb_build_object(
    'claimed', exists(select 1 from public.discord_reward_claims where user_id = auth.uid()),
    'dismissed', coalesce((select discord_reward_dismissed_at is not null
      from public.user_profiles where user_id = auth.uid()), true)
  );
end;
$$;
revoke all on function public.get_discord_reward_status() from public, anon, authenticated, service_role;
grant execute on function public.get_discord_reward_status() to authenticated;

create function public.dismiss_discord_reward_prompt() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_player_not_banned();
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.user_profiles set discord_reward_dismissed_at = coalesce(discord_reward_dismissed_at, clock_timestamp())
    where user_id = auth.uid();
end;
$$;
revoke all on function public.dismiss_discord_reward_prompt() from public, anon, authenticated, service_role;
grant execute on function public.dismiss_discord_reward_prompt() to authenticated;

-- No FK/cascade: deleting an account or unlinking Discord cannot reset a claim.
-- Only the minimal anti-abuse receipt is kept, never OAuth credentials.
create table public.discord_reward_claims (
  user_id uuid primary key,
  discord_id text not null unique check (discord_id ~ '^[0-9]{17,20}$'),
  claimed_at timestamptz not null default clock_timestamp()
);
alter table public.discord_reward_claims enable row level security;
revoke all on public.discord_reward_claims from public, anon, authenticated, service_role;
grant select on public.discord_reward_claims to authenticated;
create policy discord_reward_own_receipt on public.discord_reward_claims
  for select to authenticated using (user_id = (select auth.uid()));

-- The trusted server verifies Discord membership before calling this function.
-- Both unique constraints and the credit commit together, including concurrent calls.
create function public.claim_discord_reward(p_user_id uuid, p_discord_id text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_discord_id is null or p_discord_id !~ '^[0-9]{17,20}$' then
    raise exception 'INVALID_DISCORD_ID';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || p_user_id::text, 0));
  if exists(select 1 from public.account_deletion_log where user_id = p_user_id) then
    raise exception 'ACCOUNT_DELETED';
  end if;
  perform 1 from auth.users u where u.id = p_user_id
    and u.email_confirmed_at is not null
    and coalesce((to_jsonb(u)->>'banned_until')::timestamptz, '-infinity') <= now()
    for share;
  if not found then raise exception 'ACCOUNT_UNAVAILABLE'; end if;

  insert into public.discord_reward_claims(user_id, discord_id)
    values(p_user_id, p_discord_id) on conflict do nothing;
  if not found then
    if exists(select 1 from public.discord_reward_claims where user_id = p_user_id) then
      return 'already-claimed';
    end if;
    return 'discord-used';
  end if;
  update public.user_profiles set bonus_regular_packs = bonus_regular_packs + 5
    where user_id = p_user_id;
  if not found then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
  return 'claimed';
end;
$$;
revoke all on function public.claim_discord_reward(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_discord_reward(uuid, text) to service_role;

-- Keep the existing export reservation, snapshot and size limits.
alter function public.build_data_export(uuid, uuid) rename to build_data_export_without_discord_reward;
revoke all on function public.build_data_export_without_discord_reward(uuid, uuid) from public, anon, authenticated, service_role;
create function public.build_data_export(p_user_id uuid, p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare result jsonb;
begin
  select public.build_data_export_without_discord_reward(p_user_id, p_request_id) || jsonb_build_object(
    'discord_reward', (select jsonb_build_object('discord_id', discord_id, 'claimed_at', claimed_at)
      from public.discord_reward_claims where user_id = p_user_id),
    'discord_reward_prompt', (select jsonb_build_object('dismissed_at', discord_reward_dismissed_at)
      from public.user_profiles where user_id = p_user_id)
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
