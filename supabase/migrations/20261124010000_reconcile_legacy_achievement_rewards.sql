begin;
set local lock_timeout='3s';

-- Historical completion proves an unchanged condition, even after cards leave
-- the collection. Changed conditions still require their own catalogue progress.
create or replace function public.get_achievement_catalogue()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  player uuid := auth.uid();
  catalogue jsonb;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.user_profiles where user_id=player for update;
  if not found then raise exception 'PROFILE_MISSING'; end if;

  insert into public.user_catalogue_achievements(user_id,achievement_id,completed_at)
  select player,earned.achievement_id,earned.completed_at
  from public.user_achievements earned
  join public.achievements original on original.id=earned.achievement_id
  join public.achievement_catalogue current on current.id=original.id
  where earned.user_id=player and earned.completed_at is not null
    and replace(current.condition_type,'catalog_','')=original.condition_type
    and current.condition_value=original.condition_value
    and current.condition_categorie is not distinct from original.condition_categorie
  on conflict(user_id,achievement_id) do update set completed_at=excluded.completed_at
    where public.user_catalogue_achievements.completed_at is null;

  catalogue := public.get_achievement_catalogue_before_legacy_reward();
  return (
    select jsonb_agg(
      case when original.id is not null and item->>'completedAt' is null
        then jsonb_set(item,'{upgradeReward}',to_jsonb(
          case when earned.completed_at is not null and earned.claimed_at is null
            then original.karas_reward else 0 end))
        else item end order by position)
    from jsonb_array_elements(catalogue) with ordinality as entries(item,position)
    left join public.achievements original on original.id=item->>'id'
    left join public.user_achievements earned
      on earned.user_id=player and earned.achievement_id=original.id
  );
end;
$$;

-- Reuse the guarded recovery and its row-first legacy claim lock order for
-- every historical id, not only Transcendence. Preserve the remaining bonus.
do $recovery$
declare
  definition text := pg_get_functiondef('public.claim_achievement_upgrade(text)'::regprocedure);
  marker text := 'if p_achievement_id=''transcendance'' and not exists (';
begin
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then
    raise exception 'LEGACY_ACHIEVEMENT_RECOVERY_PATCH_MISMATCH';
  end if;
  execute replace(definition,marker,
    'if exists(select 1 from public.achievements where id=p_achievement_id) and not exists (');
end;
$recovery$;

commit;
