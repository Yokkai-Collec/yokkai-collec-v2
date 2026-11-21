begin;

alter table public.gta_sunset_event add column midnight_credits_through date;

-- Existing players already earned these slots under the midnight schedule.
update public.gta_sunset_event
set midnight_credits_through = least(
  (statement_timestamp() at time zone 'Europe/Paris')::date,
  ((ends_at - interval '1 microsecond') at time zone 'Europe/Paris')::date
);

create function public.gta_sunset_pack_schedule(p_event public.gta_sunset_event)
returns table (pack_day date, credit_at timestamptz)
language sql stable set search_path = '' as $$
  select days.pack_day, credit.credit_at
  from generate_series(
    0, ((p_event).ends_at at time zone 'Europe/Paris')::date - (p_event).starts_on
  ) as offsets(day_number)
  cross join lateral (select (p_event).starts_on + offsets.day_number as pack_day) days
  cross join lateral (
    select (days.pack_day + case
      when days.pack_day <= (p_event).midnight_credits_through then time '00:00'
      else time '20:00'
    end) at time zone 'Europe/Paris' as credit_at
  ) credit
  where credit.credit_at <= (p_event).ends_at;
$$;

create function public.gta_sunset_pack_days(
  p_player uuid, p_event public.gta_sunset_event, p_at timestamptz
)
returns date[] language sql stable set search_path = '' as $$
  select array(
    select credit.pack_day
    from auth.users u
    cross join public.gta_sunset_pack_schedule(p_event) credit
    where u.id = p_player
      and credit.credit_at <= p_at
      and credit.pack_day >= coalesce(
        ((to_jsonb(u)->>'created_at')::timestamptz at time zone 'Europe/Paris')::date,
        (p_event).starts_on
      )
      and not exists (
        select from public.gta_sunset_openings o
        where o.user_id = p_player
          and o.event_start = (p_event).starts_on
          and o.opening_day = credit.pack_day
      )
    order by credit.pack_day
  );
$$;

revoke all on function public.gta_sunset_pack_schedule(public.gta_sunset_event),
  public.gta_sunset_pack_days(uuid, public.gta_sunset_event, timestamptz)
  from public, anon, authenticated, service_role;

-- The feed and the locked opening path use the same credit timestamps and
-- retain the pack's calendar day as its idempotency key.
do $patch$
declare
  old_credit_call constant text := 'public.gta_sunset_pack_days(player, event.starts_on, today)';
  new_credit_call constant text := 'public.gta_sunset_pack_days(player, event, stamp)';
  definition text;
  updated text;
begin
  definition := pg_get_functiondef('public.get_gta_sunset_event()'::regprocedure);
  updated := replace(definition, old_credit_call, new_credit_call);
  updated := replace(updated,
    $before$  today date := (stamp at time zone 'Europe/Paris')::date;
$before$, '');
  updated := replace(updated,
    $before$'nextResetAt', (today + 1)::timestamp at time zone 'Europe/Paris',$before$,
    $after$'nextResetAt', (
      select min(credit_at) from public.gta_sunset_pack_schedule(event)
      where credit_at > stamp
    ),$after$);
  if strpos(updated, new_credit_call) = 0
    or strpos(updated, 'public.gta_sunset_pack_schedule(event)') = 0
    or strpos(updated, 'today date') > 0 then
    raise exception 'Sunset event credit patch no longer matches';
  end if;
  execute updated;

  definition := pg_get_functiondef('public.open_gta_sunset_booster(date)'::regprocedure);
  updated := replace(definition, old_credit_call, new_credit_call);
  updated := replace(updated, $before$  today date;
$before$, '');
  updated := replace(updated, $before$  today := (stamp at time zone 'Europe/Paris')::date;
$before$, '');
  if strpos(updated, new_credit_call) = 0
    or strpos(updated, 'today date') > 0 or strpos(updated, 'today :=') > 0 then
    raise exception 'Sunset opening credit patch no longer matches';
  end if;
  execute updated;
end
$patch$;

drop function public.gta_sunset_pack_days(uuid, date, date);

notify pgrst, 'reload schema';
commit;
