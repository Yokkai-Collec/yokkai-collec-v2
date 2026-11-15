begin;
set local lock_timeout = '3s';

-- Title IDs map to playerTitles.names in the en/fr message catalogs.
-- Rewards are granted by trusted server code only, never by players.
create table public.player_title_catalog (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{0,63}$')
);
insert into public.player_title_catalog(id) values ('collector'), ('reseller'), ('explorer');

create table public.player_title_unlocks (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  title_id text not null references public.player_title_catalog(id),
  unlocked_at timestamptz not null default now(),
  seen_at timestamptz,
  primary key (user_id, title_id)
);
create table public.player_equipped_titles (
  user_id uuid primary key references public.user_profiles(user_id) on delete cascade,
  title_id text not null,
  foreign key (user_id, title_id) references public.player_title_unlocks(user_id, title_id) on delete cascade
);
alter table public.player_title_catalog enable row level security;
alter table public.player_title_unlocks enable row level security;
alter table public.player_equipped_titles enable row level security;
revoke all on public.player_title_catalog, public.player_title_unlocks, public.player_equipped_titles from public, anon, authenticated;
grant select, insert, update, delete on public.player_title_catalog, public.player_title_unlocks, public.player_equipped_titles to service_role;

-- Launch titles are granted to every existing and future profile. Install the
-- trigger before backfilling so concurrent signups cannot miss their grants.
create function public.grant_starter_player_titles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.player_title_unlocks(user_id, title_id)
    values (new.user_id, 'reseller'), (new.user_id, 'explorer')
    on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.grant_starter_player_titles() from public, anon, authenticated, service_role;
create trigger grant_starter_player_titles after insert on public.user_profiles
  for each row execute function public.grant_starter_player_titles();
insert into public.player_title_unlocks(user_id, title_id)
  select user_id, title_id from public.user_profiles
  cross join (values ('reseller'), ('explorer')) starter(title_id)
  on conflict do nothing;

-- Reuse the existing social identity projection. Titles remain visible for
-- Basic players too; only paid style fields depend on Pro entitlement.
create or replace function public.billing_profile_cosmetics(p_user uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object('active', paid, 'style', case when paid then
    coalesce((select style from public.profile_customizations where user_id = p_user), '{}'::jsonb)
    else '{}'::jsonb end,
    'titleId', coalesce((select title_id from public.player_equipped_titles where user_id = p_user), 'collector'))
  from (select public.billing_has_game_pro(p_user) paid) membership;
$$;
revoke all on function public.billing_profile_cosmetics(uuid) from public, anon, authenticated;
grant execute on function public.billing_profile_cosmetics(uuid) to service_role;

-- Preserve the function identity used by Storage policies and the existing
-- privacy, block and membership projection.
create or replace function public.get_profile(p_identifier text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb; owner_id uuid; cosmetics jsonb;
begin
  result := public.billing_base_get_profile(p_identifier);
  owner_id := (result->>'id')::uuid;
  cosmetics := public.billing_profile_cosmetics(owner_id);
  result := result || jsonb_build_object('isPro', (cosmetics->>'active')::boolean, 'profileStyle', cosmetics);
  result := result || jsonb_build_object('titleId', coalesce(
    (select title_id from public.player_equipped_titles where user_id = owner_id), 'collector'));
  if owner_id = auth.uid() then
    result := result || jsonb_build_object('unlockedTitleIds', (
      select jsonb_agg(title_id order by title_id) from (
        select 'collector'::text as title_id
        union select title_id from public.player_title_unlocks where user_id = owner_id
      ) available
    ));
    result := result || jsonb_build_object('unseenTitleIds', coalesce((
      select jsonb_agg(title_id order by title_id) from public.player_title_unlocks
      where user_id = owner_id and seen_at is null and title_id <> 'collector'
    ), '[]'::jsonb));
  end if;
  return result;
end;
$$;
revoke all on function public.get_profile(text) from public, anon, authenticated;
grant execute on function public.get_profile(text) to authenticated;

create function public.equip_player_title(p_title_id text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare player uuid := auth.uid();
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  if exists(select 1 from public.account_deletion_log where user_id = player) then
    raise exception 'ACCOUNT_DELETED';
  end if;
  perform public.get_profile(null);
  if p_title_id = 'collector' then
    delete from public.player_equipped_titles where user_id = player;
  else
    if p_title_id is null or not exists(
      select 1 from public.player_title_unlocks where user_id = player and title_id = p_title_id
    ) then raise exception 'TITLE_NOT_UNLOCKED'; end if;
    insert into public.player_equipped_titles(user_id, title_id) values(player, p_title_id)
      on conflict(user_id) do update set title_id = excluded.title_id;
  end if;
  return p_title_id;
end;
$$;
revoke all on function public.equip_player_title(text) from public, anon, authenticated;
revoke all on function public.equip_player_title(text) from service_role;

create function public.update_profile_appearance_titled(
  p_bio text, p_avatar_url text, p_featured_card_ids uuid[],
  p_banner_card_id uuid, p_banner_url text, p_banner_frame jsonb, p_title_id text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_player_not_banned();
  result := public.update_profile_appearance_framed(p_bio, p_avatar_url, p_featured_card_ids, p_banner_card_id, p_banner_url, p_banner_frame);
  perform public.equip_player_title(p_title_id);
  return result || public.get_profile(null);
end;
$$;
revoke all on function public.update_profile_appearance_titled(text,text,uuid[],uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.update_profile_appearance_titled(text,text,uuid[],uuid,text,jsonb,text) to authenticated;

create function public.mark_player_titles_seen(p_title_ids text[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare player uuid := auth.uid();
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:' || player::text, 0));
  if exists(select 1 from public.account_deletion_log where user_id = player) then
    raise exception 'ACCOUNT_DELETED';
  end if;
  update public.player_title_unlocks set seen_at = now()
  where user_id = player and title_id = any(p_title_ids) and seen_at is null;
end;
$$;
revoke all on function public.mark_player_titles_seen(text[]) from public, anon, authenticated;
grant execute on function public.mark_player_titles_seen(text[]) to authenticated;

notify pgrst, 'reload schema';
commit;
