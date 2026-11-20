begin;

create or replace function public.admin_get_black_market_stock() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  future public.black_market_editions%rowtype;
  stamp timestamptz := statement_timestamp();
  local_stamp timestamp := stamp at time zone 'Europe/Paris';
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;

  select * into future from public.black_market_editions
  where starts_at > stamp order by starts_at limit 1;

  return (
    select jsonb_build_object(
      'enabled', cfg.enabled,
      'officialUserId', cfg.official_user_id,
      'minDay', local_stamp::date + case when local_stamp::time >= time '12:00' then 1 else 0 end,
      'scheduledDay', future.opening_day,
      'startsAt', future.starts_at,
      'selectedIds', coalesce((
        select jsonb_agg(a.card_instance_id order by a.id)
        from public.auctions a where a.black_market_day = future.opening_day and a.status = 'active'
      ), '[]'::jsonb),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'instanceId', q.id, 'name', q.nom, 'rarity', q.rarity,
          'image', q.image_url, 'category', q.categorie, 'anime', q.franchise,
          'shiny', q.is_shiny, 'isEvolved', q.is_evolved
        ) order by q.selected desc, q.nom, q.id)
        from (
          select c.id, d.nom, c.rarity, d.image_url, d.categorie, d.franchise, c.is_shiny, c.is_evolved,
            coalesce(a.black_market_day = future.opening_day, false) as selected
          from public.black_market_stock s
          join public.user_cards c on c.id = s.card_instance_id and c.user_id = s.official_user_id
          join public.cards d on d.id = c.card_id
          left join public.auctions a on a.card_instance_id = c.id and a.status = 'active'
          where s.official_user_id = cfg.official_user_id and not c.is_locked and c.rarity in ('LR','SSR')
            and (a.id is null or a.black_market_day = future.opening_day)
            and not exists (select 1 from public.anticheat_trade_card_holds h where h.card_id = c.id)
          order by selected desc, d.nom, c.id limit 200
        ) q
      ), '[]'::jsonb)
    )
    from public.black_market_config cfg where singleton
  );
end $$;

notify pgrst, 'reload schema';
commit;
