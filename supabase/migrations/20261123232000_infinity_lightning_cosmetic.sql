insert into public.card_cosmetic_offers (id, kind, price)
values ('infinity_lightning', 'animation', 900)
on conflict (id) do nothing;
