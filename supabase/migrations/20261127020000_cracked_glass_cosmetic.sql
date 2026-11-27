begin;

insert into public.card_cosmetic_offers(id, kind, price)
values ('cracked_glass', 'animation', 900)
on conflict (id) do nothing;

commit;
