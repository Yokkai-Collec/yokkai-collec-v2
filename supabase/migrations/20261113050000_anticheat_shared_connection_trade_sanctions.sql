begin;
set local lock_timeout='5s';

alter table public.account_sanctions drop constraint account_sanctions_sanction_type_check;
alter table public.account_sanctions add constraint account_sanctions_sanction_type_check check(sanction_type in(
  'AFFILIATE_ABUSE_SANCTION','AFFILIATE_ABUSE_WARNING_WITH_PENALTY','AFFILIATE_ABUSE_WARNING',
  'AFFILIATE_ABUSE_NETWORK_WARNING','FARM_BAN','FARM_SUSPENSION',
  'SHARED_TRADE_BAN','SHARED_TRADE_WARNING','SHARED_TRADE_SUSPENSION'
));
alter table public.account_sanctions drop constraint account_sanctions_reason_check;
alter table public.account_sanctions add constraint account_sanctions_reason_check check(
  (sanction_type in('SHARED_TRADE_BAN','SHARED_TRADE_WARNING','SHARED_TRADE_SUSPENSION') and reason='SHARED_TRADE_CONNECTION')
  or (sanction_type not in('SHARED_TRADE_BAN','SHARED_TRADE_WARNING','SHARED_TRADE_SUSPENSION') and reason='AFFILIATE_ABUSE')
);
alter table public.account_sanctions drop constraint account_sanctions_type_relation_check;
alter table public.account_sanctions add constraint account_sanctions_type_relation_check check(
  (sanction_type='AFFILIATE_ABUSE_SANCTION' and card_action='PROVEN_ASSET_REMOVAL' and kara_action='ADMIN_DISCIPLINARY_PENALTY')
  or (sanction_type='AFFILIATE_ABUSE_WARNING_WITH_PENALTY' and card_action='NONE' and kara_action='ADMIN_DISCIPLINARY_PENALTY')
  or (sanction_type in('AFFILIATE_ABUSE_WARNING','AFFILIATE_ABUSE_NETWORK_WARNING','FARM_BAN','FARM_SUSPENSION',
    'SHARED_TRADE_BAN','SHARED_TRADE_WARNING','SHARED_TRADE_SUSPENSION') and card_action='NONE' and kara_action='NONE')
);
create index account_sanctions_shared_trade_active
  on public.account_sanctions(user_id,sanction_type,applied_at desc,id)
  where status='APPLIED' and sanction_type in('SHARED_TRADE_WARNING','SHARED_TRADE_SUSPENSION');

create function public.anticheat_trade_shares_connection(p_offer public.trade_offers)
returns boolean language sql stable set search_path='' as $$
  select exists(
    select 1 from public.anticheat_network_observations a
    join public.anticheat_network_observations b using(network_identity)
    where a.user_id=p_offer.from_user and b.user_id=p_offer.to_user
      and least(a.last_seen_at,b.last_seen_at)>=now()-interval '7 days'
  ) and exists(
    select 1 from public.anticheat_device_observations a
    join public.anticheat_device_observations b using(device_identity)
    where a.user_id=p_offer.from_user and b.user_id=p_offer.to_user
      and least(a.last_seen_at,b.last_seen_at)>=now()-interval '7 days'
  )
$$;

create or replace function public.anticheat_trade_needs_review(p_offer public.trade_offers)
returns boolean language sql stable security definer set search_path='' as $$
  select ((cardinality(p_offer.offered_card_ids)=0 and p_offer.offered_karas=0)
    <> (cardinality(p_offer.requested_card_ids)=0 and p_offer.requested_karas=0))
    and public.anticheat_trade_shares_connection(p_offer)
$$;

create function public.apply_shared_connection_trade_sanctions(p_offer public.trade_offers)
returns boolean language plpgsql set search_path='' as $$
declare
  accounts uuid[];
  primary_id uuid;
  secondary_id uuid;
  primary_created timestamptz;
  secondary_created timestamptz;
  ban_audit_id bigint;
  cancelled_id uuid;
  suspension_receipt uuid;
  warning_ids uuid[];
  stamp timestamptz;
  details jsonb;
begin
  -- The caller holds the offer and both profiles. A concurrent restriction
  -- or auction must finish before the player can retry this acceptance.
  perform 1 from auth.users where id in(p_offer.from_user,p_offer.to_user)
    order by id for update nowait;
  select array_agg(id order by created_at,id),min(created_at),max(created_at)
    into accounts,primary_created,secondary_created
    from auth.users where id in(p_offer.from_user,p_offer.to_user) and created_at is not null;
  if cardinality(accounts) is distinct from 2 or primary_created is null or primary_created=secondary_created
    or exists(select 1 from public.admin_users where user_id=any(accounts)) then
    return false;
  end if;
  if exists(select 1 from auth.users where id=any(accounts) and banned_until>now()) then
    raise exception 'ACCOUNT_BANNED' using errcode='P0001';
  end if;
  primary_id:=accounts[1];
  secondary_id:=accounts[2];

  perform public.apply_account_ban_core(secondary_id,true,null);
  select id into strict ban_audit_id from public.admin_audit_logs
    where action='player.ban' and metadata->>'target_user_id'=secondary_id::text
    order by id desc limit 1;
  stamp:=clock_timestamp();
  details:=jsonb_build_object('trade',p_offer.id,'primary',primary_id,'secondary',secondary_id);
  update public.trade_offers set status='cancelled',updated_at=stamp where id=p_offer.id;
  insert into public.anticheat_quarantines(subject_type,subject_id,status,sender_user_id,recipient_user_id,
    case_user_id,evidence_confidence,economic_severity,reason_codes,asset_snapshot,metadata,expires_at,terminal_at)
  values('trade',p_offer.id,'CANCELLED',p_offer.from_user,p_offer.to_user,primary_id,'CORROBORATED','MEDIUM',
    array['SHARED_NETWORK_AND_BROWSER_TRADE_SANCTION'],
    jsonb_build_object('offeredCardIds',p_offer.offered_card_ids,'requestedCardIds',p_offer.requested_card_ids,
      'offeredKaras',p_offer.offered_karas,'requestedKaras',p_offer.requested_karas),
    details,stamp,stamp) returning id into cancelled_id;
  insert into public.anticheat_quarantine_audit(quarantine_id,action,idempotency_key,details)
    values(cancelled_id,'CANCELLED','shared-connection-sanctions',details);

  -- Count warnings from earlier incidents, since the most recent suspension.
  select array(
    select w.id from public.account_sanctions w
    where w.user_id=primary_id and w.status='APPLIED' and w.sanction_type='SHARED_TRADE_WARNING'
      and w.applied_at>coalesce((select max(s.applied_at) from public.account_sanctions s
        where s.user_id=primary_id and s.status='APPLIED' and s.sanction_type='SHARED_TRADE_SUSPENSION'),'-infinity')
    order by w.applied_at,w.id limit 3
  ) into warning_ids;
  insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
    cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
  select 'shared-trade:'||p_offer.id||':'||p.user_id,p.user_id,
    case when p.user_id=primary_id then 'SHARED_TRADE_WARNING' else 'SHARED_TRADE_BAN' end,
    'SHARED_TRADE_CONNECTION','NONE','NONE',0,0,p.karas_balance,p.karas_balance,stamp,stamp,'APPLIED',
    details||case when p.user_id=secondary_id then jsonb_build_object('banAuditId',ban_audit_id) else '{}'::jsonb end
  from public.user_profiles p where p.user_id=any(accounts);

  if cardinality(warning_ids)=3 then
    update auth.users set banned_until=stamp+interval '48 hours',updated_at=stamp where id=primary_id;
    delete from auth.sessions where user_id=primary_id;
    insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
      cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
    select 'shared-trade-suspension:'||p_offer.id,primary_id,'SHARED_TRADE_SUSPENSION','SHARED_TRADE_CONNECTION',
      'NONE','NONE',0,0,p.karas_balance,p.karas_balance,stamp,stamp,'APPLIED',
      details||jsonb_build_object('endsAt',stamp+interval '48 hours')
    from public.user_profiles p where p.user_id=primary_id returning id into suspension_receipt;
    insert into public.anticheat_farm_suspensions(user_id,receipt_id,warning_receipts,applied_at,ends_at)
      values(primary_id,suspension_receipt,warning_ids,stamp,stamp+interval '48 hours');
  end if;
  return true;
end;
$$;

-- Insert the new decision after normal acceptance checks and before settlement.
-- Take auction locks before profile/card locks to match the existing ban path.
do $settlement$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.anticheat_settle_trade(public.trade_offers,uuid)'::regprocedure);
  updated:=replace(definition,'review_minutes integer;','review_minutes integer;
  enforce_shared_connection boolean;');
  if updated=definition then raise exception 'UNEXPECTED_TRADE_DECLARATIONS'; end if;
  definition:=updated;
  updated:=replace(definition,'  perform 1 from public.user_profiles',
    '  enforce_shared_connection:=p_release is null
    and public.anticheat_runtime_flag_enabled(''automatic_sanctions'')
    and not public.anticheat_runtime_flag_enabled(''automatic_decisions_paused'')
    and public.anticheat_trade_shares_connection(p_offer);
  if enforce_shared_connection then
    perform 1 from public.auctions where status=''active''
      and (seller_id in(p_offer.from_user,p_offer.to_user) or buyer_id in(p_offer.from_user,p_offer.to_user))
      order by id for update nowait;
  end if;
  perform 1 from public.user_profiles');
  if updated=definition then raise exception 'UNEXPECTED_TRADE_LOCKS'; end if;
  definition:=updated;
  updated:=replace(definition,'  if p_release is not null then',
    '  if enforce_shared_connection and public.apply_shared_connection_trade_sanctions(p_offer) then
    return false;
  end if;

  if p_release is not null then');
  if updated=definition then raise exception 'UNEXPECTED_TRADE_SETTLEMENT'; end if;
  definition:=updated;
  updated:=replace(definition,'  elsif public.anticheat_runtime_flag_enabled(''quarantine_enforcement'')',
    '  elsif enforce_shared_connection or (public.anticheat_runtime_flag_enabled(''quarantine_enforcement'')');
  updated:=replace(updated,'    and public.anticheat_trade_needs_review(p_offer) then',
    '    and public.anticheat_trade_needs_review(p_offer)) then');
  updated:=replace(updated,'array[''SHARED_NETWORK_BROWSER_ONE_WAY_TRANSFER'']',
    'array[case when enforce_shared_connection then ''SHARED_NETWORK_BROWSER_ROLES_UNRESOLVED''
      else ''SHARED_NETWORK_BROWSER_ONE_WAY_TRANSFER'' end]');
  if updated=definition then raise exception 'UNEXPECTED_TRADE_REVIEW_FALLBACK'; end if;
  execute updated;
end
$settlement$;

create or replace function public.respond_trade_offer_with_status(p_offer_id uuid,p_action text)
returns text language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_player_not_banned();
  if public.respond_trade_offer(p_offer_id,p_action) then return 'accepted'; end if;
  if p_action='decline' then return 'declined'; end if;
  return (select status from public.trade_offers where id=p_offer_id);
end;
$$;

create function public.queue_shared_trade_sanction_alert()
returns trigger language plpgsql security definer set search_path='' as $$
declare alert_id bigint;
begin
  if not public.anticheat_runtime_flag_enabled('discord_alerts_v2') then return new; end if;
  insert into public.anticheat_events(event_type,actor_user_id,subject_id,metadata)
    values('anticheat_operational_alert',new.user_id,new.id,
      jsonb_build_object('category',new.sanction_type,'trade',new.metadata->'trade',
        'primary',new.metadata->'primary','secondary',new.metadata->'secondary'))
    on conflict do nothing returning id into alert_id;
  if alert_id is not null then
    insert into public.anticheat_discord_outbox(event_id,payload) values(alert_id,'{}');
  end if;
  return new;
end;
$$;
create trigger shared_trade_sanction_alert after insert on public.account_sanctions for each row
  when (new.status='APPLIED' and new.sanction_type in('SHARED_TRADE_BAN','SHARED_TRADE_WARNING','SHARED_TRADE_SUSPENSION'))
  execute function public.queue_shared_trade_sanction_alert();

do $discord$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.format_anticheat_discord_alert()'::regprocedure);
  updated:=replace(definition,'    elsif category in(''FARM_BAN'',''FARM_WARNING'',''FARM_SUSPENSION'') then',
    '    elsif category in(''SHARED_TRADE_BAN'',''SHARED_TRADE_WARNING'',''SHARED_TRADE_SUSPENSION'') then
      subject_title:=case category when ''SHARED_TRADE_BAN'' then ''Compte secondaire banni définitivement''
        when ''SHARED_TRADE_WARNING'' then ''Compte principal averti'' else ''Compte principal suspendu pour 48 h'' end;
      summary:=''Échange annulé avant le transfert. Les deux comptes partagent la même adresse IP et le même navigateur.'';
      accent:=case when category=''SHARED_TRADE_WARNING'' then 15105570 else 15158332 end;
      fields:=jsonb_build_array(
        jsonb_build_object(''name'',''Compte principal (le plus ancien)'',''value'',public.anticheat_discord_profile((e.metadata->>''primary'')::uuid),''inline'',true),
        jsonb_build_object(''name'',''Compte secondaire (le plus récent)'',''value'',public.anticheat_discord_profile((e.metadata->>''secondary'')::uuid),''inline'',true),
        jsonb_build_object(''name'',''Échange annulé'',''value'',e.metadata->>''trade''));
      admin_url:=admin_url||''?user=''||e.actor_user_id;
    elsif category in(''FARM_BAN'',''FARM_WARNING'',''FARM_SUSPENSION'') then');
  if updated=definition then raise exception 'UNEXPECTED_DISCORD_SANCTION_FORMAT'; end if;
  execute updated;
end
$discord$;

do $appeals$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.admin_void_anticheat_warning(uuid,text)'::regprocedure);
  updated:=replace(definition,'''AFFILIATE_ABUSE_WARNING'',''AFFILIATE_ABUSE_NETWORK_WARNING''',
    '''AFFILIATE_ABUSE_WARNING'',''AFFILIATE_ABUSE_NETWORK_WARNING'',''SHARED_TRADE_WARNING''');
  if updated=definition then raise exception 'UNEXPECTED_WARNING_CORRECTION'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.admin_list_anticheat_appeals()'::regprocedure);
  updated:=replace(replace(definition,'''AFFILIATE_ABUSE_WARNING'',''AFFILIATE_ABUSE_NETWORK_WARNING''',
    '''AFFILIATE_ABUSE_WARNING'',''AFFILIATE_ABUSE_NETWORK_WARNING'',''SHARED_TRADE_WARNING'''),
    '''FARM_BAN'',''FARM_SUSPENSION''','''FARM_BAN'',''FARM_SUSPENSION'',''SHARED_TRADE_BAN'',''SHARED_TRADE_SUSPENSION''');
  if updated=definition then raise exception 'UNEXPECTED_APPEAL_LIST'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.admin_restore_anticheat_restriction(uuid,text)'::regprocedure);
  updated:=replace(definition,'''FARM_BAN'',''FARM_SUSPENSION''',
    '''FARM_BAN'',''FARM_SUSPENSION'',''SHARED_TRADE_BAN'',''SHARED_TRADE_SUSPENSION''');
  if updated=definition then raise exception 'UNEXPECTED_RESTRICTION_CORRECTION'; end if;
  definition:=updated;
  updated:=replace(definition,'if target.sanction_type=''FARM_SUSPENSION'' then',
    'if target.sanction_type in(''FARM_SUSPENSION'',''SHARED_TRADE_SUSPENSION'') then');
  if updated=definition then raise exception 'UNEXPECTED_SUSPENSION_CORRECTION'; end if;
  definition:=updated;
  updated:=replace(definition,'ban public.anticheat_farm_bans%rowtype;',
    'ban_restriction_id uuid; expected_ban_audit bigint;');
  if updated=definition then raise exception 'UNEXPECTED_BAN_CORRECTION_DECLARATIONS'; end if;
  definition:=updated;
  updated:=replace(definition,'  select * into strict ban from public.anticheat_farm_bans where receipt_id=target.id;',
    '  if target.sanction_type=''SHARED_TRADE_BAN'' then
    ban_restriction_id:=target.id;
    expected_ban_audit:=(target.metadata->>''banAuditId'')::bigint;
  else
    select b.user_id,b.ban_audit_id into strict ban_restriction_id,expected_ban_audit
    from public.anticheat_farm_bans b where b.receipt_id=target.id;
  end if;');
  if updated=definition then raise exception 'UNEXPECTED_BAN_CORRECTION'; end if;
  execute replace(replace(updated,'ban.id','ban_restriction_id'),'ban.ban_audit_id','expected_ban_audit');

  definition:=pg_get_functiondef('public.reassess_suspension_on_warning_correction()'::regprocedure);
  updated:=replace(definition,'    if (select count(*) from public.anticheat_farm_warnings',
    '    if exists(select 1 from public.account_sanctions r
      where r.id=new.receipt_id and r.sanction_type=''SHARED_TRADE_WARNING'') then
      perform public.correct_anticheat_farm_suspension(item.id,new.admin_id,''A supporting warning was voided'');
    elsif (select count(*) from public.anticheat_farm_warnings');
  if updated=definition then raise exception 'UNEXPECTED_WARNING_REASSESSMENT'; end if;
  execute updated;
end
$appeals$;

revoke all on function public.anticheat_trade_shares_connection(public.trade_offers),
  public.apply_shared_connection_trade_sanctions(public.trade_offers),
  public.queue_shared_trade_sanction_alert() from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
