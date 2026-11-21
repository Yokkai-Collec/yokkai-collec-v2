begin;

insert into public.cards
  (source, source_id, nom, categorie, franchise, rarete_base, image_url, event_only)
values
  ('manual', 'gta-sunset-jason', 'Jason Duval (Sunset Edition)', 'VIDEO GAMES', 'GTA VI', 'LR', '/assets/events/gta-sunset/jason.png', true),
  ('manual', 'gta-sunset-lucia', 'Lucia Caminos (Sunset Edition)', 'VIDEO GAMES', 'GTA VI', 'LR', '/assets/events/gta-sunset/lucia.png', true)
on conflict (source, source_id) do update
set nom = excluded.nom
where cards.event_only
  and cards.rarete_base = 'LR'
  and cards.image_url = excluded.image_url
  and cards.nom is distinct from excluded.nom;

do $$
declare
  jason_id uuid;
  lucia_id uuid;
begin
  select id into strict jason_id from public.cards
  where source = 'manual' and source_id = 'gta-sunset-jason'
    and nom = 'JASON DUVAL (SUNSET EDITION)' and rarete_base = 'LR'
    and event_only and image_url = '/assets/events/gta-sunset/jason.png';

  select id into strict lucia_id from public.cards
  where source = 'manual' and source_id = 'gta-sunset-lucia'
    and nom = 'LUCIA CAMINOS (SUNSET EDITION)' and rarete_base = 'LR'
    and event_only and image_url = '/assets/events/gta-sunset/lucia.png';

  insert into public.gta_sunset_event (
    starts_on, ends_at, jason_card_id, lucia_card_id, midnight_credits_through,
    bonus_credit_at, lr_rate_per_card
  )
  values (
    date '2026-11-21',
    timestamp '2026-11-25 20:00:00' at time zone 'Europe/Paris',
    jason_id,
    lucia_id,
    date '2026-11-21',
    timestamp '2026-11-21 20:00:00' at time zone 'Europe/Paris',
    (1 - power(0.8::numeric, 1::numeric / 6)) / 2
  )
  on conflict (singleton) do nothing;

  if not exists (
    select 1 from public.gta_sunset_event
    where jason_card_id = jason_id and lucia_card_id = lucia_id
  ) then
    raise exception 'This Sunset edition is already configured with other card IDs';
  end if;
end;
$$;

commit;
