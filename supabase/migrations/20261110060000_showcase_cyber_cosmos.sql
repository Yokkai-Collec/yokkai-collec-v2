begin;

-- Keep old saved scenes valid while allowing the two replacement showcase
-- atmospheres. The client normalizes marble/aurora to cyber/cosmos on save.
do $migration$
declare definition text; previous text;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  previous := $old$('velvet','stars','marble','lightning','flames','mist','aurora','embers','frost')$old$;
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'SHOWCASE_SCENE_VALIDATION_CHANGED';
  end if;
  execute replace(
    definition,
    previous,
    $new$('velvet','stars','marble','lightning','flames','mist','aurora','embers','frost','cyber','cosmos')$new$
  );
end;
$migration$;

notify pgrst, 'reload schema';
commit;
