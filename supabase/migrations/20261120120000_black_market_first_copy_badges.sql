begin;

do $patch$
declare
  definition text;
  updated text;
begin
  definition := pg_get_functiondef('public.admin_get_black_market_stock()'::regprocedure);
  updated := replace(definition,
    $before$'startingPrice', q.starting_price)$before$,
    $after$'startingPrice', q.starting_price,
      'firstLrCopy', case when q.rarity = 'LR' then public.auction_first_lr_copy_source(q.card_instance_id) end)$after$);
  if updated = definition then raise exception 'BLACK_MARKET_STOCK_FIRST_COPY_PATCH_MISSING'; end if;
  execute updated;

  definition := pg_get_functiondef('public.get_black_market_event()'::regprocedure);
  updated := replace(definition,
    $before$'rarity', copy.rarity
    ) order by d.nom, a.id)$before$,
    $after$'rarity', copy.rarity
    ) || case when a.card_snapshot->>'firstLrCopy' in ('legacy', 'mint')
      then jsonb_build_object('firstLrCopy', a.card_snapshot->'firstLrCopy',
        'shiny', copy.is_shiny, 'isEvolved', copy.is_evolved)
      else '{}'::jsonb end order by d.nom, a.id)$after$);
  if updated = definition then raise exception 'BLACK_MARKET_PREVIEW_FIRST_COPY_PATCH_MISSING'; end if;
  execute updated;

  definition := pg_get_functiondef('public.get_black_market_activity()'::regprocedure);
  updated := replace(definition,
    $before$'isEvolved', coalesce(a.card_snapshot->'isEvolved', 'false'::jsonb)$before$,
    $after$'isEvolved', coalesce(a.card_snapshot->'isEvolved', 'false'::jsonb),
          'firstLrCopy', a.card_snapshot->'firstLrCopy'$after$);
  if updated = definition then raise exception 'BLACK_MARKET_RESULTS_FIRST_COPY_PATCH_MISSING'; end if;
  execute updated;
end $patch$;

notify pgrst, 'reload schema';
commit;
