begin;

-- An opening still belongs to its original credit day. Keep its actual reveal
-- time as well, since older credits can now be opened after newer ones.
alter table public.gta_sunset_openings add column opened_at timestamptz;
update public.gta_sunset_openings
set opened_at = coalesce((cards->0->>'obtainedAt')::timestamptz, opening_day::timestamp at time zone 'Europe/Paris');
alter table public.gta_sunset_openings alter column opened_at set not null;

create function public.gta_sunset_pack_days(p_player uuid, p_start date, p_today date)
returns date[] language sql stable set search_path = '' as $$
  select array(
    select credits.pack_day
    from auth.users u
    cross join lateral (
      select p_start + day_number as pack_day
      from generate_series(0, 2) as days(day_number)
    ) credits
    where u.id = p_player
      and credits.pack_day <= p_today
      and credits.pack_day >= coalesce(((to_jsonb(u)->>'created_at')::timestamptz at time zone 'Europe/Paris')::date, p_start)
      and not exists (
        select from public.gta_sunset_openings o
        where o.user_id = p_player and o.event_start = p_start and o.opening_day = credits.pack_day
      )
    order by credits.pack_day
  );
$$;

revoke all on function public.gta_sunset_pack_days(uuid, date, date) from public, anon, authenticated, service_role;

do $$
declare
  definition text;
  updated text;
begin
  definition := pg_get_functiondef('public.get_gta_sunset_event()'::regprocedure);
  updated := replace(definition, '''openedCards'', (', $patch$
    'availableDays', public.gta_sunset_pack_days(player, event.starts_on, today),
    'openedCards', ($patch$);
  updated := replace(updated,
    'where user_id = player and event_start = event.starts_on and opening_day = today',
    'where user_id = player and event_start = event.starts_on order by opened_at desc, opening_day desc limit 1');
  if strpos(updated, 'availableDays') = 0 or strpos(updated, 'order by opened_at') = 0 then
    raise exception 'Sunset read definition changed';
  end if;
  execute updated;

  -- Reuse the existing draw and card grants. Only credit validation and
  -- recording change. The selected day serves as the exact retry key.
  definition := pg_get_functiondef('public.open_gta_sunset_booster()'::regprocedure);
  updated := replace(definition, 'public.open_gta_sunset_booster()', 'public.open_gta_sunset_booster(p_pack_day date)');
  updated := replace(updated, 'if not found or today < event.starts_on or today >= event.starts_on + 3 then',
    'if not found then');
  updated := replace(updated,
    'where user_id = player and event_start = event.starts_on and opening_day = today;',
    'where user_id = player and event_start = event.starts_on and opening_day = p_pack_day;');
  updated := replace(updated, 'if found then return result; end if;', $patch$if found then return result; end if;
  if p_pack_day is null or not (p_pack_day = any(public.gta_sunset_pack_days(player, event.starts_on, today))) then
    raise exception 'GTA_SUNSET_PACK_UNAVAILABLE';
  end if;$patch$);
  updated := replace(updated, 'event_start, opening_day, cards)', 'event_start, opening_day, cards, opened_at)');
  updated := replace(updated, 'values (player, event.starts_on, today, result);',
    'values (player, event.starts_on, p_pack_day, result, stamp);');
  if strpos(updated, 'p_pack_day date') = 0 or strpos(updated, 'GTA_SUNSET_PACK_UNAVAILABLE') = 0
    or strpos(updated, 'opening_day = p_pack_day') = 0 or strpos(updated, 'p_pack_day, result, stamp') = 0
    or strpos(updated, 'today >= event.starts_on + 3') > 0 or strpos(updated, 'opening_day, cards, opened_at') = 0 then
    raise exception 'Sunset opening definition changed';
  end if;
  execute updated;
end;
$$;

drop function public.open_gta_sunset_booster();
revoke all on function public.open_gta_sunset_booster(date) from public, anon, authenticated, service_role;
grant execute on function public.open_gta_sunset_booster(date) to authenticated;

notify pgrst, 'reload schema';
commit;
