begin;

-- Record the production correction for the closed, transitional Mystery lot.
-- Keep its recorded draw inputs intact and omit them from the public detail.
do $patch$
declare
  original text := pg_get_functiondef('public.get_auction(uuid)'::regprocedure);
  usual constant text := $old$'mysteryLrChance',a.mystery_lr_chance,'mysteryMisses',a.mystery_misses,$old$;
  historical constant text := $new$'mysteryLrChance',case when a.id = '34bd1c8e-1f45-41cb-b72d-60f93c20f8f5'::uuid then null else a.mystery_lr_chance end,'mysteryMisses',case when a.id = '34bd1c8e-1f45-41cb-b72d-60f93c20f8f5'::uuid then null else a.mystery_misses end,$new$;
begin
  if strpos(original, historical) > 0 then return; end if;
  if strpos(original, usual) = 0 then raise exception 'MYSTERY_HISTORICAL_ODDS_PATCH_MISSING'; end if;
  execute replace(original, usual, historical);
end
$patch$;

notify pgrst, 'reload schema';
commit;
