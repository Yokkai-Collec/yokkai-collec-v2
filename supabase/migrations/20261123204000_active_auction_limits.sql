begin;
set local lock_timeout = '3s';

-- Raise membership caps without changing the listing lock, expiry check or admin override.
do $migration$
declare
  definition text := pg_get_functiondef('public.create_auction(uuid,integer,integer)'::regprocedure);
  previous text := $old$cap:=case when not public.billing_has_game_pro(player) then 3
    when public.is_current_user_admin() then null else 6 end;$old$;
  replacement text := $new$cap:=case when not public.billing_has_game_pro(player) then 5
    when public.is_current_user_admin() then null else 10 end;$new$;
begin
  if (length(definition) - length(replace(definition, previous, ''))) / length(previous) <> 1 then
    raise exception 'AUCTION_LIMIT_DEFINITION_CHANGED';
  end if;
  execute replace(definition, previous, replacement);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
