begin;
set local lock_timeout='5s';
-- Serialize with the existing award worker before changing its configuration.
select pg_advisory_xact_lock(hashtextextended('referral-event-settlement',0));
alter table public.referral_event_tiers drop constraint referral_event_tiers_threshold_check;
alter table public.referral_event_tiers add constraint referral_event_tiers_threshold_check
 check(threshold in (3,5,10,15,20));
insert into public.referral_event_tiers(event_id,threshold,karas,lr_cards,recruiter_badge)
select id,15,8000,0,false from public.referral_events where slug='recruiter-2026-11'
on conflict(event_id,threshold) do update set karas=excluded.karas;
update public.referral_event_tiers t
set karas=case t.threshold when 5 then 1600 when 10 then 4000 end
from public.referral_events e
where e.id=t.event_id and e.slug='recruiter-2026-11' and t.threshold in (5,10);

-- Preserve existing receipts and pay only any missing difference, once.
do $$ declare reward record; difference integer; begin
 for reward in
  select r.id,r.user_id,r.karas as paid,t.karas as target
  from public.referral_event_rewards r
  join public.referral_event_tiers t on t.event_id=r.event_id and t.threshold=r.threshold
  join public.referral_events e on e.id=r.event_id
  where e.slug='recruiter-2026-11' and r.karas<t.karas
  for update of r
 loop
  difference:=reward.target-reward.paid;
  perform public.credit_karas(reward.user_id,difference);
  perform public.advance_player_progress(reward.user_id,'karas_earned',difference);
  update public.referral_event_rewards set karas=reward.target where id=reward.id;
 end loop;
end $$;
commit;
