begin;

create or replace function public.get_black_market_activity() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  player_id uuid := auth.uid();
  last_edition public.black_market_editions%rowtype;
  results jsonb;
begin
  perform public.assert_player_not_banned();
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into last_edition from public.black_market_editions
  where ends_at <= statement_timestamp() order by ends_at desc limit 1;

  if found then
    with sold_lots as materialized (
      select id, buyer_id, current_price, card_snapshot from public.auctions
      where black_market_day = last_edition.opening_day and status = 'sold'
    ), winners as materialized (
      select p.user_id, p.pseudo, p.avatar_url,
        public.billing_profile_cosmetics(p.user_id)#>>'{style,avatarFrame}' as avatar_frame
      from (select distinct buyer_id from sold_lots) buyers
      join public.user_profiles p on p.user_id = buyers.buyer_id
    )
    select jsonb_build_object(
      'endsAt', last_edition.ends_at,
      'openingDay', last_edition.opening_day,
      'settling', exists(select 1 from public.auctions
        where black_market_day = last_edition.opening_day and status = 'active'),
      'lots', coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'amount', a.current_price, 'sold', true,
        'winnerName', winner.pseudo,
        'winnerAvatarUrl', winner.avatar_url,
        'winnerAvatarFrame', winner.avatar_frame,
        'bidStatus', case when a.buyer_id = player_id then 'won' end,
        'card', jsonb_build_object(
          'id', a.card_snapshot->>'id', 'name', a.card_snapshot->>'name',
          'category', a.card_snapshot->>'category', 'anime', a.card_snapshot->>'anime',
          'image', a.card_snapshot->>'image', 'rarity', a.card_snapshot->>'rarity',
          'shiny', coalesce(a.card_snapshot->'shiny', 'false'::jsonb),
          'isEvolved', coalesce(a.card_snapshot->'isEvolved', 'false'::jsonb)
        )
      ) order by a.current_price desc, a.id), '[]'::jsonb)
    ) into results
    from sold_lots a
    left join winners winner on winner.user_id = a.buyer_id;
  end if;

  return jsonb_build_object(
    'lastEdition', results,
    'reminderCardIds', coalesce((select jsonb_agg(r.card_id order by r.card_id)
      from public.black_market_reminders r where r.user_id = player_id), '[]'::jsonb)
  );
end $$;

notify pgrst, 'reload schema';
commit;
