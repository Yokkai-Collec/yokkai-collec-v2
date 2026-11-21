begin;

alter table public.gta_sunset_event
  add column ends_at timestamptz,
  add column lr_rate_per_card numeric not null default 0.025
    check (lr_rate_per_card between 0 and 0.5);

update public.gta_sunset_event
set ends_at = (starts_on + 3)::timestamp at time zone 'Europe/Paris';

-- Preserve previously opened packs when moving this edition's start by a day.
update public.gta_sunset_openings
set event_start = date '2026-11-21'
where event_start = date '2026-11-20'
  and exists (
    select 1 from public.gta_sunset_event where starts_on = date '2026-11-20'
  );

update public.gta_sunset_event
set starts_on = date '2026-11-21',
    ends_at = timestamp '2026-11-25 20:00:00' at time zone 'Europe/Paris'
where starts_on in (date '2026-11-20', date '2026-11-21');

alter table public.gta_sunset_event
  alter column ends_at set not null,
  add check (ends_at > (starts_on::timestamp at time zone 'Europe/Paris'));

do $$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    (
      'public.gta_sunset_pack_days(uuid,date,date)',
      'generate_series(0, 2)',
      $replace$generate_series(0, (
        select ((e.ends_at - interval '1 microsecond') at time zone 'Europe/Paris')::date - p_start
        from public.gta_sunset_event e where e.starts_on = p_start
      ))$replace$
    ),
    (
      'public.get_gta_sunset_event()',
      '''endsAt'', (event.starts_on + 3)::timestamp at time zone ''Europe/Paris'',',
      $replace$'endsAt', event.ends_at,
    'lrRatePerCard', event.lr_rate_per_card,$replace$
    ),
    (
      'public.open_gta_sunset_booster(date)',
      'case when roll < 0.05 then event.jason_card_id when roll < 0.10 then event.lucia_card_id end',
      'case when roll < event.lr_rate_per_card then event.jason_card_id when roll < 2 * event.lr_rate_per_card then event.lucia_card_id end'
    )
  ) as patches(target, before, after)
  loop
    definition := pg_get_functiondef(patch.target::regprocedure);
    if strpos(definition, patch.before) = 0 then
      raise exception 'Sunset schedule patch no longer matches %', patch.target;
    end if;
    execute replace(definition, patch.before, patch.after);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
