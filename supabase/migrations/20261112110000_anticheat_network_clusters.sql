begin;
set local lock_timeout='5s';

alter table public.anticheat_runtime_flags drop constraint anticheat_runtime_flags_flag_check;
alter table public.anticheat_runtime_flags add constraint anticheat_runtime_flags_flag_check
  check(flag in ('discord_alerts_v2','graph_detection_v2','risk_score_v2_shadow','quarantine_shadow',
    'quarantine_enforcement','advanced_recovery','automatic_sanctions','automatic_decisions_paused',
    'quarantine_auto_release','ip_cluster_detection','cluster_investigation'));
insert into public.anticheat_runtime_flags(flag) values('ip_cluster_detection'),('cluster_investigation');

create table public.anticheat_cluster_settings (
  singleton boolean primary key default true check(singleton),
  observation_days integer not null default 7 check(observation_days between 1 and 30),
  alert_count integer not null default 3 check(alert_count>=3),
  critical_count integer not null default 4 check(critical_count>alert_count),
  enhanced_count integer not null default 6 check(enhanced_count>critical_count),
  priority_count integer not null default 10 check(priority_count>enhanced_count)
);
insert into public.anticheat_cluster_settings default values;

create table public.anticheat_network_clusters (
  id uuid primary key default gen_random_uuid(),
  network_identity text not null unique,
  account_count integer not null,
  recent_account_count integer not null,
  active_account_count integer not null,
  referral_count integer not null default 0,
  internal_trades integer not null default 0,
  one_way_trades integer not null default 0,
  transferred_cards bigint not null default 0,
  transferred_karas bigint not null default 0,
  probable_beneficiary uuid,
  priority text not null check(priority in('INVESTIGATE','CRITICAL','ENHANCED','PRIORITY')),
  investigation_state text not null check(investigation_state in('PENDING','REVIEWED_SIGNALS')),
  evaluated_at timestamptz not null default clock_timestamp()
);
alter table public.anticheat_events drop constraint anticheat_events_event_type_check;
alter table public.anticheat_events add constraint anticheat_events_event_type_check check(event_type in(
  'account_registered','trade_created','trade_accepted','trade_declined','trade_cancelled',
  'auction_created','auction_bid','auction_sold','auction_expired','referral_rewarded',
  'network_identity_shared','trade_shared_network_identity','referral_network_review','referral_network_enforcement',
  'network_cluster_threshold'
));
create unique index anticheat_network_cluster_threshold_once
  on public.anticheat_events(subject_id,((metadata->>'tier')))
  where event_type='network_cluster_threshold';

alter table public.anticheat_cluster_settings enable row level security;
alter table public.anticheat_network_clusters enable row level security;
revoke all on public.anticheat_cluster_settings,public.anticheat_network_clusters
  from public,anon,authenticated,service_role;

create function public.evaluate_anticheat_network_clusters()
returns integer language plpgsql security definer set search_path='' as $$
declare
  cfg public.anticheat_cluster_settings%rowtype;
  cohort record;
  stats record;
  threshold record;
  cluster uuid;
  event_id bigint;
  beneficiary uuid;
  referrals integer;
  cutoff timestamptz;
  investigate boolean;
  evaluated integer:=0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('evaluate-anticheat-network-clusters')) then
    return 0;
  end if;
  select * into strict cfg from public.anticheat_cluster_settings where singleton;
  cutoff:=now()-make_interval(days=>cfg.observation_days);
  delete from public.anticheat_network_clusters c
    where (select count(*) from public.anticheat_network_observations n
      join auth.users u on u.id=n.user_id
      where n.network_identity=c.network_identity and n.last_seen_at>=cutoff)<cfg.alert_count;
  if not public.anticheat_runtime_flag_enabled('ip_cluster_detection') then return 0; end if;
  investigate:=public.anticheat_runtime_flag_enabled('cluster_investigation');
  for cohort in
    select n.network_identity,array_agg(n.user_id order by n.user_id) as members,
      count(*)::integer as accounts,
      (count(*) filter(where u.created_at>=now()-interval '24 hours'))::integer as recent,
      (count(*) filter(where n.last_seen_at>=now()-interval '24 hours'))::integer as active
    from public.anticheat_network_observations n
    join auth.users u on u.id=n.user_id
    left join public.anticheat_network_clusters c using(network_identity)
    where n.last_seen_at>=cutoff
    group by n.network_identity,c.evaluated_at
    having count(*)>=cfg.alert_count
      and (c.evaluated_at is null or c.evaluated_at<=now()-interval '10 minutes')
    order by c.evaluated_at nulls first,count(*) desc,n.network_identity
    limit 25
  loop
    if investigate then
      with recent_trades as materialized (
        select t.*,
          cardinality(t.offered_card_ids)=0 and t.offered_karas=0 as sender_empty,
          cardinality(t.requested_card_ids)=0 and t.requested_karas=0 as receiver_empty
        from public.trade_offers t
        where t.from_user=any(cohort.members) and t.to_user=any(cohort.members)
          and t.status='accepted' and t.created_at>=now()-interval '30 days'
      ), recipients as (
        select case when sender_empty then from_user else to_user end as user_id,count(*) as gifts
        from recent_trades where sender_empty<>receiver_empty group by 1
      )
      select count(*)::integer as trades,
        (count(*) filter(where sender_empty<>receiver_empty))::integer as one_way,
        coalesce(sum(cardinality(offered_card_ids)+cardinality(requested_card_ids)),0) as cards,
        coalesce(sum(offered_karas::bigint+requested_karas),0) as karas,
        (select user_id from recipients order by gifts desc,user_id limit 1) as beneficiary
      into stats from recent_trades;
      select count(*)::integer into referrals from public.referrals r
        where r.referred_id=any(cohort.members) and r.referrer_id=any(cohort.members)
          and r.created_at>=now()-interval '30 days';
      beneficiary:=stats.beneficiary;
    else
      select 0 as trades,0 as one_way,0 as cards,0 as karas into stats;
      referrals:=0;
      beneficiary:=null;
    end if;

    insert into public.anticheat_network_clusters(
      network_identity,account_count,recent_account_count,active_account_count,referral_count,
      internal_trades,one_way_trades,transferred_cards,transferred_karas,probable_beneficiary,
      priority,investigation_state
    ) values(
      cohort.network_identity,cohort.accounts,cohort.recent,cohort.active,referrals,
      stats.trades,stats.one_way,stats.cards,stats.karas,beneficiary,
      case when cohort.accounts>=cfg.priority_count then 'PRIORITY'
           when cohort.accounts>=cfg.enhanced_count then 'ENHANCED'
           when cohort.accounts>=cfg.critical_count then 'CRITICAL' else 'INVESTIGATE' end,
      case when investigate then 'REVIEWED_SIGNALS' else 'PENDING' end
    ) on conflict(network_identity) do update set
      account_count=excluded.account_count,recent_account_count=excluded.recent_account_count,
      active_account_count=excluded.active_account_count,referral_count=excluded.referral_count,
      internal_trades=excluded.internal_trades,one_way_trades=excluded.one_way_trades,
      transferred_cards=excluded.transferred_cards,transferred_karas=excluded.transferred_karas,
      probable_beneficiary=excluded.probable_beneficiary,priority=excluded.priority,
      investigation_state=excluded.investigation_state,evaluated_at=clock_timestamp()
    returning id into cluster;

    for threshold in select * from (values ('alert',cfg.alert_count),('critical',cfg.critical_count)) tiers(tier,minimum)
      where cohort.accounts>=tiers.minimum
    loop
      event_id:=null;
      insert into public.anticheat_events(event_type,actor_user_id,subject_id,metadata)
      values('network_cluster_threshold',cohort.members[1],cluster,jsonb_build_object(
        'tier',threshold.tier,'accounts',cohort.accounts,'recent',cohort.recent,
        'oneWayTrades',stats.one_way,'referrals',referrals,'investigated',investigate
      )) on conflict do nothing returning id into event_id;
      if event_id is not null and public.anticheat_runtime_flag_enabled('discord_alerts_v2') then
        insert into public.anticheat_discord_outbox(event_id,payload)
        values(event_id,jsonb_build_object(
          'allowed_mentions',jsonb_build_object('parse','[]'::jsonb),
          'embeds',jsonb_build_array(jsonb_build_object(
            'title','Yokkai · shared network investigation',
            'url','https://yokkai-collec.com/admin/security?cluster='||cluster||'#anticheat-clusters',
            'description',format('%s accounts · %s created in 24h · %s one-way trades · %s internal referrals',
              cohort.accounts,cohort.recent,stats.one_way,referrals),
            'fields',jsonb_build_array(
              jsonb_build_object('name','Threshold','value',threshold.tier),
              jsonb_build_object('name','Investigation','value',case when investigate then 'Signals reviewed' else 'Pending' end)
            )
          ))
        ));
      end if;
    end loop;
    evaluated:=evaluated+1;
  end loop;
  return evaluated;
end;
$$;

create function public.admin_list_anticheat_clusters(p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,'accountCount',c.account_count,'recentAccountCount',c.recent_account_count,
      'activeAccountCount',c.active_account_count,'referralCount',c.referral_count,
      'internalTrades',c.internal_trades,'oneWayTrades',c.one_way_trades,
      'cards',c.transferred_cards,'karas',c.transferred_karas,'priority',c.priority,
      'state',c.investigation_state,'beneficiary',p.pseudo,
      'members',case when p_id is not null then (
        select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'pseudo',m.pseudo,'createdAt',m.created_at)),'[]'::jsonb)
        from (
          select n.user_id,profile.pseudo,u.created_at
          from public.anticheat_network_observations n join auth.users u on u.id=n.user_id
          left join public.user_profiles profile on profile.user_id=n.user_id
          where n.network_identity=c.network_identity and n.last_seen_at>=now()-make_interval(days=>cfg.observation_days)
          order by u.created_at,n.user_id limit 100
        ) m
      ) else '[]'::jsonb end
    ) order by c.account_count desc,c.id),'[]'::jsonb)
    from (
      select * from public.anticheat_network_clusters
      where p_id is null or id=p_id order by account_count desc,id limit 50
    ) c
    cross join public.anticheat_cluster_settings cfg
    left join public.user_profiles p on p.user_id=c.probable_beneficiary
  );
end;
$$;
revoke all on function public.evaluate_anticheat_network_clusters(),public.admin_list_anticheat_clusters(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_list_anticheat_clusters(uuid) to authenticated;
select cron.schedule('evaluate-anticheat-network-clusters','*/5 * * * *',
  'select public.evaluate_anticheat_network_clusters();');
notify pgrst,'reload schema';
commit;
