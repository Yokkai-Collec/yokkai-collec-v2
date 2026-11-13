begin;
set local lock_timeout='5s';

-- Event receipts extend referrals; the existing five-pack reward is untouched.
create table public.referral_events (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique,
 starts_at timestamptz not null,
 ends_at timestamptz not null check(ends_at>starts_at),
 settled_at timestamptz,
 exclude using gist (tstzrange(starts_at,ends_at,'[)') with &&)
);
create table public.referral_event_tiers (
 event_id uuid not null references public.referral_events(id) on delete restrict,
 threshold integer not null check(threshold in(3,5,10,20)),
 karas integer not null check(karas>0),
 recruiter_badge boolean not null default false check(not recruiter_badge or threshold=20),
 primary key(event_id,threshold)
);
create table public.referral_event_rewards (
 id uuid not null unique default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 event_id uuid not null,
 threshold integer not null,
 karas integer not null check(karas>0),
 recruiter_badge boolean not null,
 awarded_at timestamptz not null default clock_timestamp(),
 primary key(user_id,event_id,threshold),
 foreign key(event_id,threshold) references public.referral_event_tiers(event_id,threshold)
);
alter table public.referral_events enable row level security;
alter table public.referral_event_tiers enable row level security;
alter table public.referral_event_rewards enable row level security;
revoke all on public.referral_events,public.referral_event_tiers,public.referral_event_rewards from public,anon,authenticated,service_role;

insert into public.referral_events(slug,starts_at,ends_at)
 values('recruiter-2026-11','2026-11-14 19:00:00+00','2026-11-28 19:00:00+00');
insert into public.referral_event_tiers(event_id,threshold,karas,recruiter_badge)
 select e.id,t.threshold,t.karas,t.badge from public.referral_events e
 cross join(values(3,400,false),(5,750,false),(10,1600,false),(20,4000,true))t(threshold,karas,badge)
 where e.slug='recruiter-2026-11';

-- Timestamped activity, not the worker's execution time, decides qualification.
-- Reuse email verification AND anti-abuse approval before adding one-day activity.
create function public.referral_event_candidates(p_event uuid)
returns table(referrer_id uuid,referred_id uuid,pseudo text,valid_at timestamptz)
language sql stable security definer set search_path='' as $$
 select r.referrer_id,r.referred_id,p.pseudo,
 case when r.rewarded_at is not null and r.verified_at is not null and activity.opened_at is not null then
 greatest(r.rewarded_at,r.verified_at,activity.opened_at) end
 from public.referral_events e
 join public.referrals r on r.created_at>=e.starts_at and r.created_at<e.ends_at
 join auth.users u on u.id=r.referred_id and (to_jsonb(u)->>'created_at')::timestamptz>=e.starts_at and (to_jsonb(u)->>'created_at')::timestamptz<e.ends_at
 join public.user_profiles p on p.user_id=u.id
 join auth.users parent on parent.id=r.referrer_id
 left join lateral (
  select min(opened_at) opened_at from (
   select o.opened_at from public.regular_pack_openings o
    where o.opened_by=u.id and o.opened_at>=(to_jsonb(u)->>'created_at')::timestamptz+interval '24 hours'
   union all
   select d.claimed_at from public.decision_packs d where d.user_id=u.id
    and d.status='claimed' and d.claimed_at>=(to_jsonb(u)->>'created_at')::timestamptz+interval '24 hours'
  ) openings
 ) activity on true
 where e.id=p_event and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now()
 and coalesce((to_jsonb(parent)->>'banned_until')::timestamptz,'-infinity')<=now()
 and (to_jsonb(u)->>'deleted_at') is null and (to_jsonb(parent)->>'deleted_at') is null
 and not exists(select 1 from public.account_deletion_log l where l.user_id in(u.id,parent.id))
 and not exists(select 1 from public.anticheat_referral_enforcements a where a.referral_id=r.id)
 and (activity.opened_at is null or activity.opened_at<=now())
$$;
revoke all on function public.referral_event_candidates(uuid) from public,anon,authenticated,service_role;

create function public.referral_event_qualified(p_event uuid)
returns table(referrer_id uuid,referred_id uuid,pseudo text,valid_at timestamptz)
language sql stable security definer set search_path='' as $$
 select c.* from public.referral_event_candidates(p_event)c
 join public.referral_events e on e.id=p_event
 join auth.users u on u.id=c.referred_id
 where c.valid_at is not null and c.valid_at<=now()
 and c.valid_at <= e.ends_at+case when (to_jsonb(u)->>'created_at')::timestamptz>=e.ends_at-interval '24 hours'
 then interval '24 hours' else interval '0 hours' end
$$;
revoke all on function public.referral_event_qualified(uuid) from public,anon,authenticated,service_role;

-- The worker is owner-only. Reading progress cannot award a reward.
create function public.settle_referral_events()
returns void language plpgsql security definer set search_path='' as $$
declare event_row record; reward record;
begin
 perform pg_advisory_xact_lock(hashtextextended('referral-event-settlement',0));
 for event_row in select * from public.referral_events where starts_at<=now() and settled_at is null order by starts_at loop
  for reward in
   insert into public.referral_event_rewards(user_id,event_id,threshold,karas,recruiter_badge)
   select q.referrer_id,event_row.id,t.threshold,t.karas,t.recruiter_badge
   from public.referral_event_qualified(event_row.id)q
   join public.referral_event_tiers t on t.event_id=event_row.id
   group by q.referrer_id,t.threshold,t.karas,t.recruiter_badge
   having count(*)>=t.threshold
   on conflict(user_id,event_id,threshold) do nothing returning *
  loop
   perform public.credit_karas(reward.user_id,reward.karas);
   perform public.advance_player_progress(reward.user_id,'karas_earned',reward.karas);
   insert into public.notifications(user_id,type,reference_id)
    values(reward.user_id,'referral_event_tier',reward.id);
  end loop;
  if now()>event_row.ends_at+interval '24 hours' then
   update public.referral_events set settled_at=clock_timestamp() where id=event_row.id;
  end if;
 end loop;
end;$$;
revoke all on function public.settle_referral_events() from public,anon,authenticated,service_role;

create function public.get_referral_event()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid(); event_row public.referral_events%rowtype; valid_count integer;
begin
 if player is null then raise exception 'AUTH_REQUIRED'; end if;
 perform public.assert_player_not_banned();
 select * into event_row from public.referral_events order by
 case when now()>=starts_at and now()<ends_at+interval '24 hours' then 0 when starts_at>now() then 1 else 2 end,
 case when starts_at>now() then starts_at end asc,starts_at desc limit 1;
 if not found then return null; end if;
 select count(*) into valid_count from public.referral_event_qualified(event_row.id) where referrer_id=player;
 return jsonb_build_object('id',event_row.id,'startsAt',event_row.starts_at,'endsAt',event_row.ends_at,
 'serverNow',now(),'validCount',valid_count,
 'tiers',(select coalesce(jsonb_agg(jsonb_build_object('threshold',t.threshold,'karas',t.karas,
  'badge',t.recruiter_badge,'awarded',r.id is not null) order by t.threshold),'[]')
  from public.referral_event_tiers t left join public.referral_event_rewards r
   on r.event_id=t.event_id and r.threshold=t.threshold and r.user_id=player where t.event_id=event_row.id),
 'pending',(select coalesce(jsonb_agg(c.pseudo order by c.pseudo),'[]')
  from public.referral_event_candidates(event_row.id)c
  join auth.users u on u.id=c.referred_id
  where c.referrer_id=player and now()<event_row.ends_at+case when (to_jsonb(u)->>'created_at')::timestamptz>=event_row.ends_at-interval '24 hours'
   then interval '24 hours' else interval '0 hours' end
  and not exists(select 1 from public.referral_event_qualified(event_row.id)q where q.referred_id=c.referred_id)));
end;$$;
revoke all on function public.get_referral_event() from public,anon,authenticated,service_role;
grant execute on function public.get_referral_event() to authenticated;

-- Earned badges come from immutable receipts, never editable Pro cosmetics.
create function public.get_referral_event_badges(p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('eventId',r.event_id) order by r.awarded_at),'[]')
 from public.referral_event_rewards r join public.user_profiles p on p.user_id=r.user_id
 join auth.users u on u.id=p.user_id
 where r.user_id=p_user and r.recruiter_badge and auth.uid() is not null
 and (p.is_public or p.user_id=auth.uid()) and not public.users_blocked(auth.uid(),p_user)
 and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now() and (to_jsonb(u)->>'deleted_at') is null
$$;
revoke all on function public.get_referral_event_badges(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_referral_event_badges(uuid) to authenticated;

do $$
declare definition text; updated text; signature regprocedure;
begin
 select pg_get_constraintdef(oid) into strict definition from pg_constraint
 where conrelid='public.notifications'::regclass and conname='notifications_type_check';
 alter table public.notifications drop constraint notifications_type_check;
 execute 'alter table public.notifications add constraint notifications_type_check check(type=''referral_event_tier'' or ('||substring(definition from 8 for char_length(definition)-8)||'))';
 foreach signature in array array['public.list_notifications(integer)'::regprocedure,'public.get_push_notification(uuid,timestamptz)'::regprocedure] loop
  definition:=pg_get_functiondef(signature);
  -- Preserve all existing notification privacy filters and privileges.
  updated:=replace(definition,'''createdAt'',n.created_at',
   '''createdAt'',n.created_at,''referralReward'',(select r.karas from public.referral_event_rewards r where r.id=n.reference_id and r.user_id=n.user_id)');
  if updated=definition then raise exception 'REFERRAL_NOTIFICATION_PATCH_MISMATCH: %',signature; end if;
  execute updated;
 end loop;
end;$$;

select cron.schedule('settle-referral-events','* * * * *','select public.settle_referral_events()');
commit;
