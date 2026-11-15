begin;

-- Resolve the exhibited copy, including an Infinity that inherited a #1.
-- Only the existing auction readers can call this helper on behalf of players.
create function public.auction_first_lr_copy_source(p_instance_id uuid)
returns text language sql stable strict set search_path='' as $$
  select case when bool_or(source='mint') then 'mint' when count(*)>0 then 'legacy' end
  from (
    select source from public.first_lr_copies where card_instance_id=p_instance_id
    union all
    select source from public.first_lr_copies where evolved_instance_id=p_instance_id
  ) copies;
$$;
revoke all on function public.auction_first_lr_copy_source(uuid)
  from public, anon, authenticated, service_role;

-- Preserve filters, pagination, auction snapshots and grants. Only the card
-- projection changes, after the browse page has selected its listings.
do $migration$
declare
  target regprocedure;
  definition text;
  card_alias text;
  rarity_alias text;
  previous text;
  replacement text;
begin
  for target, card_alias, rarity_alias in select * from (values
    ('public.browse_auctions_page(integer,text,text,text,text,text)'::regprocedure,'a','a'),
    ('public.list_auctions_page(jsonb,integer)'::regprocedure,'a','a'),
    ('public.list_auctions()'::regprocedure,'uc','c'),
    ('public.get_auction(uuid)'::regprocedure,'uc','c')
  ) readers(signature, card_alias, rarity_alias)
  loop
    definition := pg_get_functiondef(target);
    previous := format($fragment$'isEvolved',%s.is_evolved)$fragment$,card_alias);
    replacement := format($fragment$'isEvolved',%s.is_evolved,'firstLrCopy',
        case when %s.rarete_base='LR' then public.auction_first_lr_copy_source(a.card_instance_id) end)$fragment$,card_alias,rarity_alias);
    if array_length(string_to_array(definition,previous),1) <> 2 then
      raise exception 'AUCTION_FIRST_LR_DEFINITION_CHANGED: %',target;
    end if;
    execute replace(definition,previous,replacement);
  end loop;
end $migration$;

notify pgrst, 'reload schema';
commit;
