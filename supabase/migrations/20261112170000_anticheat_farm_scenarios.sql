begin;
set local lock_timeout='5s';

create index anticheat_trade_scenario_sender_idx on public.trade_offers(from_user,created_at desc)
  where status='accepted' and (offered_karas>0 or requested_karas>0);
create index anticheat_trade_scenario_recipient_idx on public.trade_offers(to_user,created_at desc)
  where status='accepted' and (offered_karas>0 or requested_karas>0);

create function public.anticheat_additional_farm_scenarios(p_members uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
  with edges as materialized (
    select * from public.trace_anticheat_pack_edges(p_members,now()-interval '30 days')
  ), gift_cards as materialized (
    select distinct on(e.card_instance_id) e.*
    from edges e join public.regular_pack_openings p on p.id=e.opening_id and p.source='timed'
    join auth.users u on u.id=e.originator
    cross join lateral (select (to_jsonb(u)->>'created_at')::timestamptz as stamp) signup
    where e.gift_chain and not e.cycle and e.hop<=3
      and signup.stamp>=now()-interval '30 days'
      and e.opened_at between signup.stamp and signup.stamp+interval '72 hours'
      and e.occurred_at<=signup.stamp+interval '7 days'
      and not exists(select 1 from edges x where x.card_instance_id=e.card_instance_id and x.cycle)
    order by e.card_instance_id,e.hop desc
  ), gifts_by_donor as (
    select g.originator secondary,g.to_user_id beneficiary,
      count(*)::integer cards,count(distinct g.opening_id)::integer openings,
      count(distinct g.trade_offer_id)::integer transfers,
      jsonb_agg(jsonb_build_object('card',g.card_instance_id,'opening',g.opening_id,
        'path',g.path,'edge',g.edge_id,'secondary',g.originator) order by g.edge_id) proofs
    from gift_cards g group by g.originator,g.to_user_id
  ), timed_donors as (
    select g.* from gifts_by_donor g
    where g.cards>=2 and g.openings>=2 and g.transfers>=2 and g.cards*4>=3*(
      select sum(other.cards) from gifts_by_donor other where other.secondary=g.secondary
    )
  ), timed_case as (
    select beneficiary,array_agg(secondary order by secondary) secondaries,
      count(*)::integer donors,sum(cards)::integer cards,jsonb_agg(proofs order by secondary) proofs
    from timed_donors group by beneficiary having count(*)>=3
    order by count(*) desc,sum(cards) desc,beneficiary limit 1
  ), referral_donors as materialized (
    select r.referrer_id beneficiary,r.referred_id secondary,r.id referral_id,signup.stamp as created_at,
      d.device_identity,d.device_count,used.openings
    from public.referrals r join auth.users u on u.id=r.referred_id
    cross join lateral (select (to_jsonb(u)->>'created_at')::timestamptz as stamp) signup
    cross join lateral (
      select count(*) filter(where o.source='referral_reward' and o.referral_id=r.id
        and o.beneficiary_role='referred')::integer openings,count(*)::integer total
      from public.regular_pack_openings o
      where o.opened_by=r.referred_id and o.opened_at between signup.stamp and signup.stamp+interval '72 hours'
    ) used
    cross join lateral (
      select x.device_identity, count(*) over() device_count
      from public.anticheat_device_observations x
      where x.user_id=r.referred_id and x.last_seen_at>=now()-interval '7 days'
    ) d
    where r.rewarded_at is not null and r.referrer_id=any(p_members) and r.referred_id=any(p_members)
      and signup.stamp>=now()-interval '30 days'
      and r.rewarded_at between signup.stamp and signup.stamp+interval '24 hours'
      and used.openings>=2 and used.openings*4>=used.total*3
  ), referral_case as (
    select a.beneficiary,array_agg(b.secondary order by b.secondary) secondaries,
      count(*)::integer donors,
      jsonb_agg(jsonb_build_object('secondary',b.secondary,'referral',b.referral_id,
        'consumedPacks',b.openings) order by b.secondary) proofs
    from referral_donors a join referral_donors b on b.beneficiary=a.beneficiary
      and b.device_identity=a.device_identity
      and b.created_at between a.created_at and a.created_at+interval '24 hours'
    where a.device_count=1 and b.device_count=1
    group by a.beneficiary,a.secondary,a.device_identity having count(*)>=3
    order by count(*) desc,a.beneficiary,a.secondary limit 1
  ), kara_moves as materialized (
    select t.id,
      case when t.offered_karas>0 then t.from_user else t.to_user end payer,
      case when t.offered_karas>0 then t.to_user else t.from_user end recipient,
      greatest(t.offered_karas,t.requested_karas) amount
    from public.trade_offers t
    where t.from_user=any(p_members) and t.to_user=any(p_members)
      and t.status='accepted' and t.created_at>=now()-interval '30 days'
      and cardinality(t.offered_card_ids)=0 and cardinality(t.requested_card_ids)=0
      and ((t.offered_karas>0)<>(t.requested_karas>0))
  ), kara_pairs as (
    select m.payer,m.recipient,count(*)::integer transfers,sum(m.amount)::bigint gross,
      (array_agg(m.id order by m.id))[1:20] trade_ids
    from kara_moves m group by m.payer,m.recipient
  ), kara_donors as (
    select p.*,p.gross-coalesce(r.gross,0) as net
    from kara_pairs p left join kara_pairs r on r.payer=p.recipient and r.recipient=p.payer
    where p.transfers>=3 and p.gross-coalesce(r.gross,0)>=1000
      and p.gross*4>=3*(select sum(o.gross) from kara_pairs o where o.payer=p.payer)
  ), auction_signals as (
    select distinct a.seller_id,a.id,a.card_instance_id,a.current_price
    from edges e join public.auctions a on a.id=e.auction_id and a.status='sold'
      and a.card_instance_id=e.card_instance_id and a.seller_id=e.from_user_id and a.buyer_id=e.to_user_id
    where e.transfer_type='auction_sale' and a.current_price=e.sale_karas
      and a.seller_id=any(p_members) and a.buyer_id=any(p_members)
      and a.current_price>=500 and a.current_price>=3*a.starting_price::bigint
      and (select count(distinct b.bidder_id) from public.bids b
        where b.auction_id=a.id and b.bidder_id=any(p_members))>=2
      and exists(select 1 from edges x where x.card_instance_id=e.card_instance_id and x.cycle)
  ), kara_case as (
    select d.recipient beneficiary,array_agg(d.payer order by d.payer) secondaries,
      count(*)::integer donors,sum(d.net) as net,
      jsonb_agg(jsonb_build_object('secondary',d.payer,'tradeIds',d.trade_ids,'netKaras',d.net)
        order by d.payer) proofs,
      (select jsonb_agg(jsonb_build_object('auction',a.id,'card',a.card_instance_id,
         'karas',a.current_price) order by a.id) from (
        select * from auction_signals s where s.seller_id=d.recipient order by s.id limit 20
      ) a) auctions
    from kara_donors d group by d.recipient having count(*)>=3
    order by count(*) desc,sum(d.net) desc,d.recipient limit 1
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'B',(select jsonb_build_object('beneficiary',beneficiary,'secondaries',secondaries,'score',least(100,donors*25),
      'confidence','CORROBORATED','decision','ECONOMICALLY_CONFIRMED','cards',cards,'proofs',proofs) from timed_case),
    'C',(select jsonb_build_object('beneficiary',beneficiary,'secondaries',secondaries,'score',least(100,donors*25),
      'confidence','CORROBORATED','decision','ECONOMICALLY_CONFIRMED','proofs',proofs) from referral_case),
    'D',(select jsonb_strip_nulls(jsonb_build_object('beneficiary',beneficiary,'secondaries',secondaries,
      'score',case when auctions is null then least(75,donors*20) else least(100,donors*25) end,
      'confidence',case when auctions is null then 'INSUFFICIENT' else 'CORROBORATED' end,
      'decision',case when auctions is null then 'INVESTIGATE' else 'ECONOMICALLY_CONFIRMED' end,
      'netKaras',net,'proofs',proofs,'auctions',auctions)) from kara_case)
  ))
$$;

create function public.attach_anticheat_farm_scenarios(
  p_cluster uuid,p_members uuid[],p_critical_count integer
)
returns void language plpgsql security definer set search_path='' as $$
declare current_case public.anticheat_farm_evidence%rowtype;
  findings jsonb:='{}';
  selected jsonb;
  selected_key text;
begin
  select * into strict current_case from public.anticheat_farm_evidence where cluster_id=p_cluster;
  if cardinality(p_members)>=greatest(4,p_critical_count) then
    findings:=public.anticheat_additional_farm_scenarios(p_members);
  end if;
  if current_case.decision='ECONOMICALLY_CONFIRMED' then
    findings:=findings||jsonb_build_object('A',jsonb_build_object(
      'beneficiary',current_case.beneficiary_id,'secondaries',current_case.secondary_ids,
      'score',current_case.risk_score,'confidence',current_case.confidence,'decision',current_case.decision,
      'proofs',current_case.evidence->'proofs'));
    selected_key:='A';
  else
    select item.key,item.value into selected_key,selected from jsonb_each(findings) item
      order by (item.value->>'decision'='ECONOMICALLY_CONFIRMED') desc,
        (item.value->>'score')::integer desc,item.key limit 1;
  end if;
  update public.anticheat_farm_evidence set
    beneficiary_id=coalesce((selected->>'beneficiary')::uuid,current_case.beneficiary_id),
    secondary_ids=case when selected is null then current_case.secondary_ids
      else array(select jsonb_array_elements_text(selected->'secondaries')::uuid) end,
    risk_score=greatest(current_case.risk_score,coalesce((selected->>'score')::integer,0)),
    confidence=coalesce(selected->>'confidence',current_case.confidence),
    decision=coalesce(selected->>'decision',current_case.decision),
    evidence=current_case.evidence||jsonb_strip_nulls(jsonb_build_object(
      'primaryScenario',selected_key,'scenarioFindings',findings))
    where cluster_id=p_cluster;
end;
$$;
revoke all on function public.anticheat_additional_farm_scenarios(uuid[]),
  public.attach_anticheat_farm_scenarios(uuid,uuid[],integer)
  from public,anon,authenticated,service_role;

do $worker$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.evaluate_anticheat_farm_evidence()'::regprocedure);
  updated:=replace(definition,'decision=excluded.decision,evidence=excluded.evidence;
    processed:=processed+1;',
    'decision=excluded.decision,evidence=excluded.evidence;
    perform public.attach_anticheat_farm_scenarios(cohort.id,members,cohort.critical_count);
    processed:=processed+1;');
  if updated=definition then raise exception 'UNEXPECTED_FARM_WORKER'; end if;
  execute updated;
  definition:=pg_get_functiondef('public.anticheat_evidenced_referral_hold(public.referrals)'::regprocedure);
  updated:=replace(definition,'f.decision=''ECONOMICALLY_CONFIRMED''',
    'f.decision=''ECONOMICALLY_CONFIRMED'' and coalesce(f.evidence->>''primaryScenario'',''A'') in(''A'',''C'')');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_HOLD_POLICY'; end if;
  execute updated;
end
$worker$;
commit;
