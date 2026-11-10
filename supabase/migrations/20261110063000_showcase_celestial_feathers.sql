begin;

-- New profiles may save the explicit scene name. The application keeps an
-- aurora compatibility mapping for older deployments that still enforce the
-- preceding allow-list.
do $migration$
declare definition text; previous text;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  previous := $old$('velvet','marble','lightning','flames','mist','aurora','embers','frost','cyber','cosmos','sakura')$old$;
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'SHOWCASE_SCENE_VALIDATION_CHANGED';
  end if;
  execute replace(
    definition,
    previous,
    $new$('velvet','marble','lightning','flames','mist','aurora','embers','frost','cyber','cosmos','sakura','feathers')$new$
  );
end;
$migration$;

notify pgrst, 'reload schema';
commit;
