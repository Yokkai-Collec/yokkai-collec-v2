begin;
set local lock_timeout='3s';

-- Every acquisition path inserts an instance or changes its owner/card.
create or replace function public.remove_owned_card_from_wishlist()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.wishlists where user_id=new.user_id and card_id=new.card_id;
  return new;
end; $$;

-- Catch up wishes kept by the previous acquisition policy.
delete from public.wishlists w
where exists (
  select 1 from public.user_cards uc
  where uc.user_id=w.user_id and uc.card_id=w.card_id
);

commit;
