begin;

-- Extend the existing private guard without changing ownership, Pro access,
-- deletion checks, rate limiting or any media validation.
do $migration$
declare definition text; previous text; replacement text;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  previous := $old$'showcaseColor','backgroundUrl'$old$;
  replacement := $new$'showcaseColor','showcaseScene','showcaseLayout','showcaseIntensity','showcaseTitle','showcaseDescription','backgroundUrl'$new$;
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'SHOWCASE_DESIGN_KEYS_CHANGED';
  end if;
  definition := replace(definition,previous,replacement);
  previous := $old$  foreach k in array array['backgroundUrl','cardBackUrl'] loop$old$;
  replacement := $new$
  if new.style ? 'showcaseScene' and (jsonb_typeof(new.style->'showcaseScene')<>'string' or new.style->>'showcaseScene' not in ('velvet','stars','marble')) then raise exception 'PROFILE_STYLE_INVALID'; end if;
  if new.style ? 'showcaseLayout' and (jsonb_typeof(new.style->'showcaseLayout')<>'string' or new.style->>'showcaseLayout' not in ('row','fan','spotlight')) then raise exception 'PROFILE_STYLE_INVALID'; end if;
  if new.style ? 'showcaseIntensity' then
    if jsonb_typeof(new.style->'showcaseIntensity')<>'number' then raise exception 'PROFILE_STYLE_INVALID'; end if;
    if (new.style->>'showcaseIntensity')::numeric not between 0 and 100 or trunc((new.style->>'showcaseIntensity')::numeric)<>(new.style->>'showcaseIntensity')::numeric then raise exception 'PROFILE_STYLE_INVALID'; end if;
  end if;
  foreach k in array array['showcaseTitle','showcaseDescription'] loop
    if new.style ? k then
      if jsonb_typeof(new.style->k)<>'string' or char_length(new.style->>k)>(case when k='showcaseTitle' then 60 else 160 end) or (new.style->>k) ~ '[[:cntrl:]]' then raise exception 'PROFILE_STYLE_INVALID'; end if;
    end if;
  end loop;
  foreach k in array array['backgroundUrl','cardBackUrl'] loop$new$;
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'SHOWCASE_DESIGN_VALIDATION_CHANGED';
  end if;
  execute replace(definition,previous,replacement);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
