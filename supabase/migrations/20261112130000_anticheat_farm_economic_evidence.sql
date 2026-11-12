begin;
set local lock_timeout='5s';

create table public.anticheat_farm_evidence (
  cluster_id uuid primary key,
  evaluated_cluster_at timestamptz not null,
  evaluated_at timestamptz not null default clock_timestamp(),
  beneficiary_id uuid,
  secondary_ids uuid[] not null default '{}',
  risk_score integer not null check(risk_score between 0 and 100),
  confidence text not null check(confidence in('INSUFFICIENT','CORROBORATED')),
  decision text not null check(decision in('INVESTIGATE','ECONOMICALLY_CONFIRMED')),
  evidence jsonb not null check(jsonb_typeof(evidence)='object')
);
alter table public.anticheat_farm_evidence enable row level security;
revoke all on public.anticheat_farm_evidence from public,anon,authenticated,service_role;

-- Chronological instance-level graph. A provenance gap or removal ends a
-- chain. Only recorded sales and accepted trades carry economic evidence.
create function public.trace_anticheat_pack_edges(p_members uuid[],p_since timestamptz)
returns table(
  card_instance_id uuid,opening_id uuid,originator uuid,opened_at timestamptz,
  edge_id bigint,occurred_at timestamptz,hop integer,from_user_id uuid,to_user_id uuid,
  transfer_type text,trade_offer_id uuid,auction_id uuid,sale_karas integer,
  path uuid[],gift_chain boolean,cycle boolean
)
language sql stable security definer set search_path='' as $$
  with recursive openings as materialized (
    select o.id,o.opened_by,o.opened_at
    from unnest(p_members) as m(id)
    cross join lateral (
      select pack.id,pack.opened_by,pack.opened_at
      from public.regular_pack_openings pack
      where pack.opened_by=m.id and pack.opened_at>=p_since
        and pack.source in('timed','referral_reward')
      order by pack.opened_at desc,pack.id limit 30
    ) o
  ), seeds as materialized (
    select c.card_instance_id,o.id,o.opened_by,o.opened_at
    from openings o join public.regular_pack_opening_cards c on c.pack_opening_id=o.id
    where c.original_owner_id=o.opened_by
  ), walk as (
    select s.card_instance_id,s.id,s.opened_by,s.opened_at,0::bigint edge_id,
      s.opened_at occurred_at,0 hop,null::uuid from_user_id,s.opened_by to_user_id,
      null::text transfer_type,null::uuid trade_offer_id,null::uuid auction_id,null::integer sale_karas,
      array[s.opened_by] path,true gift_chain,false cycle
    from seeds s
    union all
    select w.card_instance_id,w.id,w.opened_by,w.opened_at,e.id,e.occurred_at,w.hop+1,
      e.from_user_id,e.to_user_id,e.transfer_type,e.trade_offer_id,e.auction_id,e.sale_karas,
      w.path||e.to_user_id,
      w.gift_chain and e.to_user_id=any(p_members) and coalesce(
        (t.from_user=e.from_user_id and t.to_user=e.to_user_id
          and e.card_instance_id=any(t.offered_card_ids)
          and cardinality(t.requested_card_ids)=0 and t.requested_karas=0)
        or (t.to_user=e.from_user_id and t.from_user=e.to_user_id
          and e.card_instance_id=any(t.requested_card_ids)
          and cardinality(t.offered_card_ids)=0 and t.offered_karas=0),false
      ),
      e.to_user_id=any(w.path)
    from walk w
    cross join lateral (
      select edge.*
      from public.regular_pack_card_transfers edge
      where edge.card_instance_id=w.card_instance_id
        and (edge.occurred_at,edge.id)>(w.occurred_at,w.edge_id)
      order by edge.occurred_at,edge.id limit 1
    ) e
    left join public.trade_offers t on t.id=e.trade_offer_id and t.status='accepted'
    where w.hop<6 and not w.cycle and e.from_user_id=w.to_user_id
      and e.to_user_id is not null and e.transfer_type in('trade','auction_sale')
  )
  select * from walk where hop>0
$$;

create function public.evaluate_anticheat_farm_evidence()
returns integer language plpgsql security definer set search_path='' as $$
declare
  cohort record;
  members uuid[];
  findings record;
  processed integer:=0;
begin
  if not public.anticheat_runtime_flag_enabled('graph_detection_v2')
    or not public.anticheat_runtime_flag_enabled('cluster_investigation') then return 0; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('evaluate-anticheat-farm-evidence')) then
    return 0;
  end if;
  for cohort in
    select c.id,c.network_identity,c.evaluated_at,c.account_count,s.observation_days,s.critical_count
    from public.anticheat_network_clusters c cross join public.anticheat_cluster_settings s
    left join public.anticheat_farm_evidence f on f.cluster_id=c.id
    where c.investigation_state='REVIEWED_SIGNALS' and
      (f.evaluated_cluster_at is null or f.evaluated_cluster_at<c.evaluated_at)
    order by f.evaluated_at nulls first,c.account_count desc,c.id limit 10
  loop
    select array(
      select n.user_id from public.anticheat_network_observations n join auth.users u on u.id=n.user_id
      where n.network_identity=cohort.network_identity
        and n.last_seen_at>=now()-make_interval(days=>cohort.observation_days)
      order by n.user_id limit 101
    ) into members;
    if cardinality(members)>100 then
      insert into public.anticheat_farm_evidence(
        cluster_id,evaluated_cluster_at,risk_score,confidence,decision,evidence
      ) values(cohort.id,cohort.evaluated_at,0,'INSUFFICIENT','INVESTIGATE',
        jsonb_build_object('reason','COHORT_REQUIRES_MANUAL_REVIEW'))
      on conflict(cluster_id) do update set evaluated_cluster_at=excluded.evaluated_cluster_at,
        evaluated_at=clock_timestamp(),beneficiary_id=null,secondary_ids='{}',
        risk_score=0,confidence=excluded.confidence,decision=excluded.decision,evidence=excluded.evidence;
      processed:=processed+1;
      continue;
    end if;
    with edges as materialized (
      select * from public.trace_anticheat_pack_edges(members,now()-interval '30 days')
    ), donors as materialized (
      select distinct on(r.referrer_id,r.referred_id)
        r.referrer_id beneficiary,r.referred_id secondary,r.id referral_id,u.created_at,
        e.card_instance_id,e.opening_id,e.edge_id,e.hop,e.path
      from public.referrals r join auth.users u on u.id=r.referred_id
      join edges e on e.originator=r.referred_id and e.to_user_id=r.referrer_id
      where r.rewarded_at is not null and r.referrer_id=any(members) and r.referred_id=any(members)
        and u.created_at>=now()-interval '30 days'
        and e.opened_at between u.created_at and u.created_at+interval '72 hours'
        and e.occurred_at<=u.created_at+interval '7 days'
        and e.gift_chain and not e.cycle and e.hop<=3
        and not exists(select 1 from edges later
          where later.card_instance_id=e.card_instance_id and later.hop>e.hop and later.cycle)
      order by r.referrer_id,r.referred_id,e.hop,e.edge_id
    ), strongest as (
      select a.beneficiary,count(*)::integer donor_count,
        array_agg(d.secondary order by d.secondary) secondary_ids,
        jsonb_agg(jsonb_build_object('secondary',d.secondary,'referral',d.referral_id,
          'card',d.card_instance_id,'opening',d.opening_id,'edge',d.edge_id,'path',d.path)
          order by d.secondary) proofs
      from donors a join donors d on d.beneficiary=a.beneficiary
        and d.created_at between a.created_at and a.created_at+interval '24 hours'
      group by a.beneficiary,a.secondary
      order by count(*) desc,a.beneficiary,a.secondary limit 1
    )
    select s.beneficiary,coalesce(s.donor_count,0) donor_count,
      coalesce(s.secondary_ids,'{}'::uuid[]) secondary_ids,
      jsonb_build_object(
        'proofs',coalesce(s.proofs,'[]'::jsonb),
        'indirectCards',(select count(distinct e.card_instance_id) from edges e where e.hop>1),
        'cycleCards',(select count(distinct e.card_instance_id) from edges e where e.cycle),
        'auctionSales',(select count(*) from edges e where e.transfer_type='auction_sale')
      ) evidence
    into findings from (select 1) base left join strongest s on true;

    insert into public.anticheat_farm_evidence(
      cluster_id,evaluated_cluster_at,beneficiary_id,secondary_ids,risk_score,confidence,decision,evidence
    ) values(
      cohort.id,cohort.evaluated_at,findings.beneficiary,findings.secondary_ids,
      least(100,findings.donor_count*25),
      case when findings.donor_count>=3 then 'CORROBORATED' else 'INSUFFICIENT' end,
      case when cardinality(members)>=cohort.critical_count and findings.donor_count>=3
        then 'ECONOMICALLY_CONFIRMED' else 'INVESTIGATE' end,
      findings.evidence
    ) on conflict(cluster_id) do update set evaluated_cluster_at=excluded.evaluated_cluster_at,
      evaluated_at=clock_timestamp(),beneficiary_id=excluded.beneficiary_id,secondary_ids=excluded.secondary_ids,
      risk_score=excluded.risk_score,confidence=excluded.confidence,
      decision=excluded.decision,evidence=excluded.evidence;
    processed:=processed+1;
  end loop;
  return processed;
end;
$$;
revoke all on function public.trace_anticheat_pack_edges(uuid[],timestamptz),
  public.evaluate_anticheat_farm_evidence() from public,anon,authenticated,service_role;

-- Reuse the current admin DTO; only aggregate conclusions and case evidence
-- are joined. Network and device pseudonyms stay private.
do $cluster_dto$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.admin_list_anticheat_clusters(uuid)'::regprocedure);
  updated:=replace(definition,'''state'',c.investigation_state,''beneficiary'',p.pseudo,',
    '''state'',c.investigation_state,''beneficiary'',coalesce(b.pseudo,p.pseudo),
     ''farmDecision'',f.decision,''farmConfidence'',f.confidence,''farmRisk'',f.risk_score,
     ''farmEvidence'',case when p_id is not null then f.evidence end,');
  updated:=replace(updated,'left join public.user_profiles p on p.user_id=c.probable_beneficiary',
    'left join public.user_profiles p on p.user_id=c.probable_beneficiary
     left join public.anticheat_farm_evidence f on f.cluster_id=c.id
     left join public.user_profiles b on b.user_id=f.beneficiary_id');
  if updated=definition or strpos(updated,'''farmDecision''')=0
    or strpos(updated,'f.cluster_id=c.id')=0 then raise exception 'UNEXPECTED_CLUSTER_DTO'; end if;
  execute updated;
end
$cluster_dto$;
select cron.schedule('evaluate-anticheat-farm-evidence','2-59/5 * * * *',
  'select public.evaluate_anticheat_farm_evidence();');
notify pgrst,'reload schema';
commit;
