begin;

alter table public.black_market_config
  add column idle_status text not null default 'upcoming'
    check (idle_status in ('closed', 'upcoming'));

create function public.admin_set_black_market_idle_status(p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_status is null or p_status not in ('closed', 'upcoming') then
    raise exception 'BLACK_MARKET_INVALID_IDLE_STATUS';
  end if;

  update public.black_market_config set idle_status = p_status
    where singleton and idle_status <> p_status;
  if found then
    insert into public.admin_audit_logs(admin_user_id, action, metadata)
    values (auth.uid(), 'black_market.configure', jsonb_build_object('idleStatus', p_status));
  end if;
end $$;

revoke all on function public.admin_set_black_market_idle_status(text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_black_market_idle_status(text) to authenticated;

do $patch$
declare
  definition text;
  updated text;
begin
  definition := pg_get_functiondef('public.admin_get_black_market_stock()'::regprocedure);
  updated := replace(definition,
    $before$'enabled', (select enabled from public.black_market_config where singleton),$before$,
    $after$'enabled', (select enabled from public.black_market_config where singleton),
    'idleStatus', (select idle_status from public.black_market_config where singleton),$after$);
  if updated = definition then raise exception 'BLACK_MARKET_ADMIN_IDLE_STATUS_PATCH_MISSING'; end if;
  execute updated;

  definition := pg_get_functiondef('public.get_black_market_event()'::regprocedure);
  updated := replace(definition,
    $before$  if edition.opening_day is null and not (
    select enabled from public.black_market_config where singleton
  ) then
    return null;
  end if;

$before$, '');
  if updated = definition then raise exception 'BLACK_MARKET_EMPTY_EDITION_PATCH_MISSING'; end if;
  definition := updated;
  updated := replace(definition,
    $before$'auctions', active_auctions, 'upcomingCards', upcoming_cards$before$,
    $after$'auctions', active_auctions, 'upcomingCards', upcoming_cards,
    'idleStatus', (select idle_status from public.black_market_config where singleton)$after$);
  if updated = definition then raise exception 'BLACK_MARKET_EVENT_IDLE_STATUS_PATCH_MISSING'; end if;
  execute updated;
end $patch$;

notify pgrst, 'reload schema';
commit;
