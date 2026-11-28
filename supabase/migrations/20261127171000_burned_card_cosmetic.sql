begin;

insert into public.card_cosmetic_offers(id, kind, price)
values ('burned_card', 'animation', 900)
on conflict (id) do nothing;

commit;
