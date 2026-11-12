begin;
set local lock_timeout='5s';

alter table public.anticheat_runtime_flags drop constraint anticheat_runtime_flags_flag_check;
alter table public.anticheat_runtime_flags add constraint anticheat_runtime_flags_flag_check
  check(flag in ('discord_alerts_v2','graph_detection_v2','risk_score_v2_shadow','quarantine_shadow',
    'quarantine_enforcement','advanced_recovery','automatic_sanctions','automatic_decisions_paused',
    'quarantine_auto_release','ip_cluster_detection','cluster_investigation','referral_evidence_hold'));
insert into public.anticheat_runtime_flags(flag) values('referral_evidence_hold');

-- Reuse the existing pending-reward table. Only a recent, economically
-- corroborated beneficiary can qualify a new referral for this short hold.
create function public.anticheat_evidenced_referral_hold(p_referral public.referrals)
returns table(network_identity text,hold_until timestamptz)
language sql stable security definer set search_path='' as $$
  select c.network_identity,p_referral.verified_at+interval '24 hours'
  from public.anticheat_farm_evidence f
  join public.anticheat_network_clusters c on c.id=f.cluster_id
  join public.anticheat_network_observations child
    on child.network_identity=c.network_identity and child.user_id=p_referral.referred_id
  join public.anticheat_network_observations parent
    on parent.network_identity=c.network_identity and parent.user_id=p_referral.referrer_id
  join auth.users u on u.id=p_referral.referred_id
  where public.anticheat_runtime_flag_enabled('referral_evidence_hold')
    and not public.anticheat_runtime_flag_enabled('automatic_decisions_paused')
    and f.beneficiary_id=p_referral.referrer_id and f.decision='ECONOMICALLY_CONFIRMED'
    and f.evaluated_cluster_at=c.evaluated_at and f.evaluated_at>=now()-interval '24 hours'
    and p_referral.verified_at+interval '24 hours'>now()
    and (to_jsonb(u)->>'created_at')::timestamptz>=now()-interval '72 hours'
    and least(child.last_seen_at,parent.last_seen_at)>=now()-interval '24 hours'
  order by f.evaluated_at desc,c.id limit 1
$$;
revoke all on function public.anticheat_evidenced_referral_hold(public.referrals)
  from public,anon,authenticated,service_role;
create index anticheat_farm_evidence_confirmed_beneficiary_idx
  on public.anticheat_farm_evidence(beneficiary_id,evaluated_at desc)
  where decision='ECONOMICALLY_CONFIRMED';

do $rewards$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.complete_referral_after_verification(uuid,timestamptz)'::regprocedure);
  updated:=replace(definition,'if held_network is not null then',
    'if held_network is null and public.anticheat_runtime_flag_enabled(''referral_evidence_hold'') then
       select x.network_identity,x.hold_until into held_network,held_until
       from public.anticheat_evidenced_referral_hold(referral) x;
     end if;
     if held_network is not null then');
  if updated=definition then raise exception 'UNEXPECTED_REFERRAL_REWARD_FUNCTION'; end if;
  execute updated;

  -- Both confirmation and the scheduled release lock the referral first.
  definition:=pg_get_functiondef('public.release_quiet_referral_reward_holds()'::regprocedure);
  updated:=replace(definition,'from public.anticheat_referral_reward_holds h',
    'from public.anticheat_referral_reward_holds h join public.referrals locked_referral on locked_referral.id=h.referral_id');
  updated:=replace(updated,'limit 100 for update skip locked','limit 100 for update of locked_referral skip locked');
  if updated=definition or strpos(updated,'for update of locked_referral skip locked')=0 then
    raise exception 'UNEXPECTED_REFERRAL_RELEASE_FUNCTION';
  end if;
  execute updated;
end
$rewards$;
commit;
