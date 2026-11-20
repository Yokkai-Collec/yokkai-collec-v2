begin;

-- Match the worker's exclusions for cards still in the source account.
create function public.black_market_recovery_blocks(p_card_id uuid) returns text[]
language sql stable set search_path = '' as $$
  select array_remove(array[
    case when exists (select 1 from public.auctions
      where card_instance_id = p_card_id and status = 'active') then 'auction' end,
    case when exists (select 1 from public.trade_offers where status = 'pending'
      and (p_card_id = any(offered_card_ids) or p_card_id = any(requested_card_ids))) then 'trade' end,
    case when exists (select 1 from public.anticheat_trade_card_holds
      where card_id = p_card_id) then 'investigation' end
  ], null);
$$;
revoke all on function public.black_market_recovery_blocks(uuid) from public, anon, authenticated, service_role;

create function public.admin_get_black_market_recovery_queue(
  p_page integer default 1, p_user_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  page_size constant integer := 20;
  requested_page integer := greatest(1, coalesce(p_page, 1));
  snapshot_at timestamptz := clock_timestamp();
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;

  if p_user_id is null then
    return (
      with accounts as materialized (
        select b.user_id, p.pseudo, b.banned_at + interval '14 days' as eligible_at
        from public.black_market_bans b
        join auth.users u on u.id = b.user_id and u.banned_until = 'infinity'::timestamptz
        left join public.user_profiles p on p.user_id = b.user_id
        where b.user_id is distinct from (select official_user_id from public.black_market_config where singleton)
          and exists (select 1 from public.user_cards c
            where c.user_id = b.user_id and c.rarity in ('LR', 'SSR')
              and not exists (select 1 from public.black_market_stock s where s.card_instance_id = c.id))
      ), bounds as (
        select count(*) as total, least(requested_page, greatest(1, (count(*) + page_size - 1) / page_size)) as page
        from accounts
      ), current_page as (
        select * from accounts order by eligible_at, user_id
        limit page_size offset (select (page - 1) * page_size from bounds)
      )
      select jsonb_build_object('page', page, 'total', total, 'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', a.user_id, 'pseudo', a.pseudo, 'eligibleAt', a.eligible_at,
          'eligible', a.eligible_at <= snapshot_at,
          'pendingLR', stats.lr, 'pendingSSR', stats.ssr, 'blockedCount', stats.blocked
        ) order by a.eligible_at, a.user_id)
        from current_page a
        cross join lateral (
          select count(*) filter (where c.rarity = 'LR') as lr,
            count(*) filter (where c.rarity = 'SSR') as ssr,
            count(*) filter (where cardinality(public.black_market_recovery_blocks(c.id)) > 0) as blocked
          from public.user_cards c
          where c.user_id = a.user_id and c.rarity in ('LR', 'SSR')
            and not exists (select 1 from public.black_market_stock s where s.card_instance_id = c.id)
        ) stats
      ), '[]'::jsonb)) from bounds
    );
  end if;

  return (
    with blocked_cards as materialized (
      select c.id, d.nom, c.rarity, public.black_market_recovery_blocks(c.id) as reasons
      from public.black_market_bans b
      join auth.users u on u.id = b.user_id and u.banned_until = 'infinity'::timestamptz
      join public.user_cards c on c.user_id = b.user_id and c.rarity in ('LR', 'SSR')
      join public.cards d on d.id = c.card_id
      where b.user_id = p_user_id
        and b.user_id is distinct from (select official_user_id from public.black_market_config where singleton)
        and not exists (select 1 from public.black_market_stock s where s.card_instance_id = c.id)
    ), bounds as (
      select count(*) as total, least(requested_page, greatest(1, (count(*) + page_size - 1) / page_size)) as page
      from blocked_cards where cardinality(reasons) > 0
    ), current_page as (
      select * from blocked_cards where cardinality(reasons) > 0 order by nom, id
      limit page_size offset (select (page - 1) * page_size from bounds)
    )
    select jsonb_build_object('page', page, 'total', total, 'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', nom, 'rarity', rarity, 'reasons', reasons) order by nom, id)
      from current_page
    ), '[]'::jsonb)) from bounds
  );
end $$;
revoke all on function public.admin_get_black_market_recovery_queue(integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_black_market_recovery_queue(integer, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
