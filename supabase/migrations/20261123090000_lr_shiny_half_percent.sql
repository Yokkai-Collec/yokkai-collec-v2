begin;

-- Halve the Shiny chance on new LR drops. Existing cards and pending choices keep their results.
do $migration$
declare
  routine text;
  definition text;
  previous text;
  replacement text;
begin
  foreach routine in array array[
    'public.open_regular_pack()',
    'public.open_decision_pack()',
    'public.get_game_info()',
    'public.settle_referral_events()'
  ] loop
    definition := pg_get_functiondef(routine::regprocedure);
    if routine = 'public.get_game_info()' then
      previous := $old$'shinyRate', 1$old$;
      replacement := $new$'shinyRate', 0.5$new$;
    elsif routine = 'public.settle_referral_events()' then
      previous := $old$shiny:=random()<0.01;$old$;
      replacement := $new$shiny:=random()<0.005;$new$;
    else
      previous := $old$shiny:=selected_card.rarete_base='LR' and random()<.01;$old$;
      replacement := $new$shiny:=selected_card.rarete_base='LR' and random()<.005;$new$;
    end if;
    if (length(definition) - length(replace(definition, previous, ''))) / length(previous) <> 1 then
      raise exception 'SHINY_RATE_DEFINITION_CHANGED: %', routine;
    end if;
    execute replace(definition, previous, replacement);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
