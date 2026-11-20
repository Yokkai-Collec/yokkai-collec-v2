begin;

create or replace function public.get_black_market_event() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  edition public.black_market_editions%rowtype;
  stamp timestamptz := statement_timestamp();
  player_id uuid := auth.uid();
  active_auctions jsonb := '[]'::jsonb;
  upcoming_cards jsonb := '[]'::jsonb;
begin
  perform public.assert_player_not_banned();
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into edition from public.black_market_editions
  where ends_at > stamp order by starts_at limit 1;
  if edition.opening_day is null and not (
    select enabled from public.black_market_config where singleton
  ) then
    return null;
  end if;

  if edition.starts_at > stamp then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.nom, 'category', d.categorie,
      'anime', d.franchise, 'image', d.image_url, 'rarity', copy.rarity
    ) order by d.nom, a.id), '[]'::jsonb)
    into upcoming_cards
    from public.auctions a
    join public.user_cards copy on copy.id = a.card_instance_id
    join public.cards d on d.id = copy.card_id
    where a.black_market_day = edition.opening_day and a.status = 'active';
  elsif edition.opening_day is not null then
    select coalesce(jsonb_agg(
      public.get_auction(a.id) || jsonb_build_object(
        'popularity', coalesce(d.favoris_count, 0),
        'ownedCount', (select count(*) from public.user_cards
          where user_id = player_id and card_id = d.id)
      ) order by a.id
    ), '[]'::jsonb)
    into active_auctions
    from public.auctions a
    join public.user_cards copy on copy.id = a.card_instance_id
    join public.cards d on d.id = copy.card_id
    where a.black_market_day = edition.opening_day and a.status = 'active';
  end if;

  return jsonb_build_object(
    'startsAt', edition.starts_at, 'endsAt', edition.ends_at,
    'auctions', active_auctions, 'upcomingCards', upcoming_cards
  );
end $$;

notify pgrst, 'reload schema';
commit;
