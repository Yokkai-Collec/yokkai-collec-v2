begin;

alter table public.gta_sunset_event
  add column bonus_credit_at timestamptz
  check (
    bonus_credit_at >= (starts_on::timestamp at time zone 'Europe/Paris')
    and bonus_credit_at <= ends_at
  );

update public.gta_sunset_event
set bonus_credit_at = timestamp '2026-11-21 20:00:00' at time zone 'Europe/Paris',
    lr_rate_per_card = (1 - power(0.8::numeric, 1::numeric / 6)) / 2
where starts_on = date '2026-11-21'
  and ends_at = timestamp '2026-11-25 20:00:00' at time zone 'Europe/Paris';

create or replace function public.gta_sunset_pack_schedule(p_event public.gta_sunset_event)
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
  where credit.credit_at <= (p_event).ends_at
  union all
  -- Reserve a distinct opening key so the bonus can share launch day.
  select (p_event).starts_on - 1, (p_event).bonus_credit_at
  where (p_event).bonus_credit_at is not null;
$$;

create or replace function public.gta_sunset_pack_days(
  p_player uuid, p_event public.gta_sunset_event, p_at timestamptz
)
returns date[] language sql stable set search_path = '' as $$
  select array(
    select credit.pack_day
    from auth.users u
    cross join public.gta_sunset_pack_schedule(p_event) credit
    where u.id = p_player
      and credit.credit_at <= p_at
      and p_at < (p_event).ends_at + interval '24 hours'
      and (credit.credit_at at time zone 'Europe/Paris')::date >= coalesce(
        ((to_jsonb(u)->>'created_at')::timestamptz at time zone 'Europe/Paris')::date,
        (p_event).starts_on
      )
      and not exists (
        select from public.gta_sunset_openings o
        where o.user_id = p_player
          and o.event_start = (p_event).starts_on
          and o.opening_day = credit.pack_day
      )
    order by credit.credit_at, credit.pack_day
  );
$$;

do $patch$
declare
  definition text := pg_get_functiondef('public.get_gta_sunset_event()'::regprocedure);
  updated text;
begin
  updated := replace(definition, $before$'endsAt', event.ends_at,$before$,
    $after$'endsAt', event.ends_at,
    'packsExpireAt', event.ends_at + interval '24 hours',$after$);
  if updated = definition then raise exception 'Sunset expiry patch no longer matches'; end if;
  execute updated;
end
$patch$;

notify pgrst, 'reload schema';
commit;
