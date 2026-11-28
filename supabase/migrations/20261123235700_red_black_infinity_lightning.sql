insert into public.card_cosmetic_offers (id, kind, price) values
  ('infinity_lightning_red', 'animation', 900),
  ('infinity_lightning_black', 'animation', 900)
on conflict (id) do nothing;
