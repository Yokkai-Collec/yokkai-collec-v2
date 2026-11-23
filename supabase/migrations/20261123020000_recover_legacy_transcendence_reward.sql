begin;

alter function public.get_achievement_catalogue()
  rename to get_achievement_catalogue_before_legacy_reward;
revoke all on function public.get_achievement_catalogue_before_legacy_reward()
  from public, anon, authenticated, service_role;

create function public.get_achievement_catalogue()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  catalogue jsonb := public.get_achievement_catalogue_before_legacy_reward();
  legacy_reward integer;
begin
  select original.karas_reward into legacy_reward
  from public.user_achievements earned
  join public.achievements original on original.id=earned.achievement_id
  where earned.user_id=auth.uid() and earned.achievement_id='transcendance'
    and earned.completed_at is not null and earned.claimed_at is null;
  if legacy_reward is null then return catalogue; end if;

  return (
    select jsonb_agg(
      case when item->>'id'='transcendance' and item->>'completedAt' is null
        then jsonb_set(item,'{upgradeReward}',to_jsonb(legacy_reward))
        else item end
      order by position
    )
    from jsonb_array_elements(catalogue) with ordinality as entries(item,position)
  );
end;
$$;
revoke all on function public.get_achievement_catalogue()
  from public, anon, authenticated, service_role;
grant execute on function public.get_achievement_catalogue() to authenticated;

create or replace function public.claim_achievement_upgrade(p_achievement_id text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  player uuid := auth.uid();
  bonus public.achievement_upgrade_credits%rowtype;
  balance integer;
  stamp timestamptz := clock_timestamp();
  original jsonb;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;

  if p_achievement_id='transcendance' and not exists (
    select 1 from public.user_catalogue_achievements
    where user_id=player and achievement_id=p_achievement_id and completed_at is not null
  ) then
    -- Keep the legacy claim's row-first locking and reuse its one-time payment.
    original := public.claim_achievement(p_achievement_id);
    insert into public.achievement_upgrade_credits(user_id,achievement_id,reward)
    select player,id,karas_reward-(original->>'reward')::integer
    from public.achievement_catalogue
    where id=p_achievement_id and karas_reward>(original->>'reward')::integer
    on conflict (user_id,achievement_id) do nothing;

    -- Only a catalogue claim sets the displayed catalogue claim timestamp.
    return original || jsonb_build_object('claimedAt',null::timestamptz);
  end if;

  perform 1 from public.user_profiles where user_id=player for update;
  select * into bonus from public.achievement_upgrade_credits
  where user_id=player and achievement_id=p_achievement_id for update;
  if not found then raise exception 'ACHIEVEMENT_LOCKED'; end if;
  if bonus.claimed_at is not null then raise exception 'ACHIEVEMENT_ALREADY_CLAIMED'; end if;

  update public.achievement_upgrade_credits set claimed_at=stamp
  where user_id=player and achievement_id=p_achievement_id;
  balance := public.credit_karas(player,bonus.reward);
  perform public.advance_player_progress(player,'karas_earned',bonus.reward,stamp);
  return jsonb_build_object('balance',balance,'reward',bonus.reward,'claimedAt',stamp);
end;
$$;

commit;
