begin;

create function public.lock_collection_cards(p_card_instance_ids uuid[])
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  owned_count integer;
begin
  perform public.assert_player_not_banned();
  if player_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_card_instance_ids), 0) = 0
    or array_position(p_card_instance_ids, null) is not null then
    raise exception 'INVALID_CARD_SELECTION' using errcode = 'P0001';
  end if;

  -- Serialize with auctions and transfers before checking eligibility.
  perform id from public.user_cards
  where user_id = player_id and id = any(p_card_instance_ids)
  order by id
  for update;
  get diagnostics owned_count = row_count;
  if owned_count <> (select count(distinct id) from unnest(p_card_instance_ids) as ids(id)) then
    raise exception 'CARD_NOT_OWNED' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.auctions
    where card_instance_id = any(p_card_instance_ids) and status = 'active'
  ) then
    raise exception 'LOCK_SELECTION_CARD_AT_AUCTION' using errcode = 'P0001';
  end if;

  update public.user_cards set is_locked = true
  where user_id = player_id and id = any(p_card_instance_ids) and not is_locked;
end;
$$;

revoke all on function public.lock_collection_cards(uuid[]) from public, anon;
grant execute on function public.lock_collection_cards(uuid[]) to authenticated;

commit;
