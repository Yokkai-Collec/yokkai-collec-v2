insert into public.card_cosmetic_offers (id, kind, price)
values
  ('violet_mist', 'back', 650),
  ('midnight_sakura', 'back', 1200)
on conflict (id) do nothing;
