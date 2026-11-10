begin;

-- The V2 VHS / CRT scene is accepted explicitly by current deployments. The
-- application also maps it to the retired `cosmos` storage value for older
-- databases that still enforce the preceding scene allow-list.
do $migration$
declare definition text; previous text;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  previous := $old$('velvet','marble','lightning','flames','mist','aurora','embers','frost','cyber','cosmos','sakura','feathers')$old$;
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'SHOWCASE_SCENE_VALIDATION_CHANGED';
  end if;
  execute replace(
    definition,
    previous,
    $new$('velvet','marble','lightning','flames','mist','aurora','embers','frost','cyber','cosmos','sakura','feathers','vhs')$new$
  );
end;
$migration$;

notify pgrst, 'reload schema';
commit;
