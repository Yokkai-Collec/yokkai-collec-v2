insert into public.card_cosmetic_offers (id, kind, price) values
  ('infinity_reflection_violet', 'animation', 900),
  ('infinity_reflection_blue', 'animation', 900),
  ('infinity_reflection_red', 'animation', 900),
  ('infinity_reflection_gold', 'animation', 900)
on conflict (id) do nothing;
