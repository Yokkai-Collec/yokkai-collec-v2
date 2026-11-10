begin;

-- The retired starry-sky scene falls back to Velvet for existing Pro profiles.
update public.profile_customizations
set style = jsonb_set(style, '{showcaseScene}', '"velvet"'::jsonb)
where style->>'showcaseScene' = 'stars';

do $migration$
declare definition text; previous text;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  previous := $old$('velvet','stars','marble','lightning','flames','mist','aurora','embers','frost','cyber','cosmos','sakura')$old$;
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'SHOWCASE_SCENE_VALIDATION_CHANGED';
  end if;
  execute replace(
    definition,
    previous,
    $new$('velvet','marble','lightning','flames','mist','aurora','embers','frost','cyber','cosmos','sakura')$new$
  );
end;
$migration$;

notify pgrst, 'reload schema';
commit;
