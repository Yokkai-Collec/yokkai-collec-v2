begin;
set local lock_timeout = '3s';

-- Only the authoritative Regular Pack functions can read or update this streak.
-- An absent row means the player has not opened a Regular Pack since launch.
create table public.regular_pack_lr_pity (
  user_id uuid primary key references public.user_profiles(user_id) on delete cascade,
  packs_without_lr smallint not null check (packs_without_lr between 0 and 499)
);
alter table public.regular_pack_lr_pity enable row level security;
revoke all on public.regular_pack_lr_pity from public, anon, authenticated, service_role;

-- Patch the live functions in place to keep existing permissions, timed and
-- bonus inventories, reward provenance, event exclusions, and Shiny odds.
do $migration$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    (
      'public.open_regular_pack()',
      '  opening_id uuid:=gen_random_uuid();',
      $new$  opening_id uuid:=gen_random_uuid();
  pity_streak integer;
  has_lr boolean := false;$new$
    ),
    (
      'public.open_regular_pack()',
      '  for position in 1..5 loop',
      $new$  -- The existing profile lock serializes this read through the streak write,
  -- including each call from open_regular_packs().
  select coalesce((select packs_without_lr from public.regular_pack_lr_pity where user_id = player_id), 0)
    into pity_streak;
  for position in 1..5 loop$new$
    ),
    (
      'public.open_regular_pack()',
      '    select * into selected_card from public.cards where rarete_base=rarities[rarity_index] and not event_only',
      $new$    -- Roll the last slot normally. Upgrade it only if all five rolls would miss LR.
    if position = 5 and pity_streak = 499 and not has_lr and rarity_index <> 5 then
      rarity_index := 5;
    end if;
    has_lr := has_lr or rarity_index = 5;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index] and not event_only$new$
    ),
    (
      'public.open_regular_pack()',
      '  return result;',
      $new$  insert into public.regular_pack_lr_pity (user_id, packs_without_lr)
    values (player_id, case when has_lr then 0 else pity_streak + 1 end)
    on conflict (user_id) do update set packs_without_lr = excluded.packs_without_lr;
  return result;$new$
    ),
    (
      'public.get_regular_pack_status()',
      $old$    'refillSeconds',step$old$,
      $new$    'refillSeconds',step,
    'lrPity',jsonb_build_object(
      'opened',coalesce((select packs_without_lr from public.regular_pack_lr_pity where user_id = player),0),
      'target',500
    )$new$
    )
  ) as patches(routine, before, after)
  loop
    definition := pg_get_functiondef(patch.routine::regprocedure);
    if (length(definition) - length(replace(definition, patch.before, ''))) / length(patch.before) <> 1 then
      raise exception 'REGULAR_PACK_LR_PITY_DEFINITION_CHANGED: % (%)', patch.routine, patch.before;
    end if;
    execute replace(definition, patch.before, patch.after);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
