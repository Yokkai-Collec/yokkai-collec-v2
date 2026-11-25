begin;

-- Serve the Gojo GIF from Yokkai so visitors do not fetch it from Tenor.
do $$
declare
  function_definition text;
  updated_definition text;
  tenors_url text := 'https://media1.tenor.com/m/1zjQ5voYjwAAAAd/10-%C4%91i%E1%BB%83m.gif';
  local_artwork text := '/assets/events/blackout/cards/satoru-gojo.gif';
begin
  function_definition := pg_get_functiondef('public.publish_blackout_cards()'::regprocedure);
  updated_definition := replace(function_definition, tenors_url, local_artwork);

  if updated_definition = function_definition
     and position(local_artwork in function_definition) = 0 then
    raise exception 'Unexpected publish_blackout_cards() definition';
  end if;

  if updated_definition <> function_definition then
    execute updated_definition;
  end if;
end;
$$;

update public.cards
set image_url = '/assets/events/blackout/cards/satoru-gojo.gif'
where source = 'manual'
  and source_id = 'blackout-gojo-satoru'
  and event_only
  and rarete_base = 'LR'
  and image_url is distinct from '/assets/events/blackout/cards/satoru-gojo.gif';

commit;
