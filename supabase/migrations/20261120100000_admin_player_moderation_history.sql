begin;
set local lock_timeout = '5s';

create index admin_audit_player_restrictions
  on public.admin_audit_logs ((metadata->>'target_user_id'), created_at desc, id desc)
  where action in ('player.ban', 'player.unban');

create function public.admin_get_player_moderation_history(p_user_id uuid, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  page_size constant integer := 10;
  requested_page integer := greatest(1, coalesce(p_page, 1));
  restriction_until timestamptz;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select u.banned_until into restriction_until from auth.users u where u.id = p_user_id;
  if not found then raise exception 'PLAYER_NOT_FOUND'; end if;

  return (
    with receipts as materialized (
      select id, applied_at, notification_seen_at, status, cards_removed, kara_removed,
        coalesce(metadata->>'action', sanction_type) as receipt_type, metadata->>'banAuditId' as ban_audit_id
      from public.account_sanctions where user_id = p_user_id
    ), events as materialized (
      select 'warning:' || w.id as id, 'warning' as kind, w.created_at as occurred_at,
        w.reason, w.created_by as actor_id, w.acknowledged_at,
        null::text as receipt_type, null::text as receipt_state, null::timestamptz as ends_at,
        0 as cards_removed, 0 as karas_removed
      from public.player_warnings w where w.user_id = p_user_id
      union all
      select 'audit:' || a.id, case a.action when 'player.ban' then 'ban' else 'unban' end,
        a.created_at, a.metadata->>'reason', a.admin_user_id, null, null, null, null, 0, 0
      from public.admin_audit_logs a
      where a.action in ('player.ban', 'player.unban') and a.metadata->>'target_user_id' = p_user_id::text
        and not exists (
          select 1 from receipts r left join public.anticheat_farm_bans f on f.receipt_id = r.id
          where f.ban_audit_id = a.id or r.ban_audit_id = a.id::text
        )
      union all
      select 'receipt:' || r.id, 'sanction', r.applied_at, d.reason, null, r.notification_seen_at,
        r.receipt_type, r.status, susp.ends_at, r.cards_removed, r.kara_removed
      from receipts r
      left join public.anticheat_farm_suspensions susp on susp.receipt_id = r.id
      left join public.anticheat_sanction_appeals a on a.receipt_kind = 'ACCOUNT' and a.receipt_id = r.id
      left join public.anticheat_sanction_appeal_decisions d on d.appeal_id = a.id and d.outcome = 'CORRECTION_REQUIRED'
      union all
      select 'smurf:' || s.id, 'smurf', s.applied_at, s.note, s.admin_user_id, null,
        null, null, null, cardinality(s.recovered_card_ids), s.recovered_karas
      from public.anticheat_smurf_sanctions s where s.smurf_user_id = p_user_id
    ), bounds as (
      select count(*) as total, least(requested_page, greatest(1, (count(*) + page_size - 1) / page_size)) as page
      from events
    ), current_page as (
      select * from events order by occurred_at desc, id
        limit page_size offset (select (page - 1) * page_size from bounds)
    )
    select jsonb_build_object(
      'page', page, 'pageCount', greatest(1, (total + page_size - 1) / page_size), 'total', total,
      'restriction', case when restriction_until = 'infinity'::timestamptz then 'permanent'
        when restriction_until > now() then 'temporary' end,
      'restrictionEndsAt', case when restriction_until > now() and isfinite(restriction_until)
        then restriction_until end,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'kind', e.kind, 'occurredAt', e.occurred_at, 'reason', e.reason,
          'actor', p.pseudo, 'acknowledgedAt', e.acknowledged_at, 'receiptType', e.receipt_type,
          'receiptState', e.receipt_state, 'endsAt', e.ends_at,
          'cardsRemoved', e.cards_removed, 'karasRemoved', e.karas_removed
        ) order by e.occurred_at desc, e.id)
        from current_page e left join public.user_profiles p on p.user_id = e.actor_id
      ), '[]'::jsonb)
    ) from bounds
  );
end
$$;

revoke all on function public.admin_get_player_moderation_history(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_player_moderation_history(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
