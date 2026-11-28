begin;
set local lock_timeout = '3s';

update public.card_cosmetic_offers
set for_sale = false
where id = 'ember_aura';

commit;
