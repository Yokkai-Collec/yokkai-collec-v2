begin;

-- Extend only the scene enum of the existing Pro/ownership guard.
do $migration$
declare definition text; previous text;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  previous := $old$('velvet','stars','marble')$old$;
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'SHOWCASE_SCENE_VALIDATION_CHANGED';
  end if;
  execute replace(definition,previous,$new$('velvet','stars','marble','lightning','flames','mist','aurora','embers')$new$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
