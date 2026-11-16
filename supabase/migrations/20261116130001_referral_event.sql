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
 karas integer not null check(karas>=0),
 lr_cards integer not null default 0 check(lr_cards in(0,5)),
 check((karas>0 and lr_cards=0) or (karas=0 and lr_cards=5 and threshold=20)),
 recruiter_badge boolean not null default false check(not recruiter_badge or threshold=20),
 primary key(event_id,threshold)
);
create table public.referral_event_rewards (
 id uuid not null unique default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 event_id uuid not null,
 threshold integer not null,
 karas integer not null check(karas>=0),
 lr_cards integer not null default 0 check(lr_cards in(0,5)),
 check((karas>0 and lr_cards=0) or (karas=0 and lr_cards=5 and threshold=20)),
 recruiter_badge boolean not null,
 decision_pack_id uuid unique references public.decision_packs(id) on delete set null,
 cards jsonb not null default '[]',
 awarded_at timestamptz not null default clock_timestamp(),
 primary key(user_id,event_id,threshold),
 foreign key(event_id,threshold) references public.referral_event_tiers(event_id,threshold)
);
alter table public.referral_events enable row level security;
alter table public.referral_event_tiers enable row level security;
alter table public.referral_event_rewards enable row level security;
revoke all on public.referral_events,public.referral_event_tiers,public.referral_event_rewards from public,anon,authenticated,service_role;

insert into public.referral_events(slug,starts_at,ends_at)
 values('recruiter-2026-11','2026-11-16 19:00:00+00','2026-11-30 19:00:00+00');
insert into public.referral_event_tiers(event_id,threshold,karas,lr_cards,recruiter_badge)
 select e.id,t.threshold,t.karas,t.lr_cards,t.badge from public.referral_events e
 cross join(values(3,750,0,false),(5,750,0,false),(10,1600,0,false),(20,0,5,true))t(threshold,karas,lr_cards,badge)
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
    and not exists(select 1 from public.referral_event_rewards automatic where automatic.decision_pack_id=d.id)
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

insert into public.player_title_catalog(id) values('recruiter');

-- The worker is owner-only. Reading progress cannot award a reward.
create function public.settle_referral_events()
returns void language plpgsql security definer set search_path='' as $$
declare event_row record; reward record; pack uuid; picked public.cards%rowtype; copy uuid; drawn jsonb; shiny boolean;
begin
 if not (select enabled from public.event_runtime_config where singleton) then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('referral-event-settlement',0));
 for event_row in select * from public.referral_events where starts_at<=now() and settled_at is null order by starts_at loop
  for reward in
   insert into public.referral_event_rewards(user_id,event_id,threshold,karas,lr_cards,recruiter_badge)
   select q.referrer_id,event_row.id,t.threshold,t.karas,t.lr_cards,t.recruiter_badge
   from public.referral_event_qualified(event_row.id)q
   join public.referral_event_tiers t on t.event_id=event_row.id
   group by q.referrer_id,t.threshold,t.karas,t.lr_cards,t.recruiter_badge
   having count(*)>=t.threshold
   on conflict(user_id,event_id,threshold) do nothing returning *
  loop
   if reward.karas>0 then
    perform public.credit_karas(reward.user_id,reward.karas);
    perform public.advance_player_progress(reward.user_id,'karas_earned',reward.karas);
   end if;
   if reward.lr_cards>0 then
    -- A fully claimed bonus Decision Pack: all five cards are kept. The existing
    -- bonus marker excludes it from the daily quota and pending-choice flow.
    insert into public.decision_packs(user_id,status,claimed_at,is_compensation)
     values(reward.user_id,'claimed',clock_timestamp(),true) returning id into pack;
    drawn:='[]'::jsonb;
    for position in 1..reward.lr_cards loop
     select * into picked from public.cards where rarete_base='LR' order by random() limit 1;
     if not found then raise exception 'CATALOGUE_INCOMPLETE'; end if;
     shiny:=random()<0.01; -- Same LR Shiny chance as the existing Decision Pack.
     insert into public.decision_pack_choices(pack_id,card_id,rarity,is_shiny,position)
      values(pack,picked.id,'LR',shiny,position);
     insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
      values(reward.user_id,picked.id,clock_timestamp(),'LR',shiny,false,true) returning id into copy;
     drawn:=drawn||jsonb_build_array(jsonb_build_object('id',picked.id,'name',picked.nom,
      'category',picked.categorie,'anime',picked.franchise,'rarity','LR','image',picked.image_url,
      'instanceId',copy,'shiny',shiny,'isEvolved',false));
    end loop;
    update public.referral_event_rewards set decision_pack_id=pack,cards=drawn where id=reward.id;
   end if;
   if reward.recruiter_badge then
    insert into public.player_title_unlocks(user_id,title_id) values(reward.user_id,'recruiter') on conflict do nothing;
   end if;
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
 if not (select enabled from public.event_runtime_config where singleton) then return null; end if;
 select * into event_row from public.referral_events order by
 case when now()>=starts_at and now()<ends_at+interval '24 hours' then 0 when starts_at>now() then 1 else 2 end,
 case when starts_at>now() then starts_at end asc,starts_at desc limit 1;
 if not found then return null; end if;
 select count(*) into valid_count from public.referral_event_qualified(event_row.id) where referrer_id=player;
 return jsonb_build_object('id',event_row.id,'startsAt',event_row.starts_at,'endsAt',event_row.ends_at,
 'serverNow',now(),'validCount',valid_count,
 'tiers',(select coalesce(jsonb_agg(jsonb_build_object('threshold',t.threshold,'karas',t.karas,
  'lrCards',t.lr_cards,'badge',t.recruiter_badge,'awarded',r.id is not null) order by t.threshold),'[]')
  from public.referral_event_tiers t left join public.referral_event_rewards r
   on r.event_id=t.event_id and r.threshold=t.threshold and r.user_id=player where t.event_id=event_row.id),
 'rewardCards',coalesce((select r.cards from public.referral_event_rewards r where r.user_id=player and r.event_id=event_row.id and r.lr_cards>0),'[]'::jsonb),
 'pending',(select coalesce(jsonb_agg(c.pseudo order by c.pseudo),'[]')
  from public.referral_event_candidates(event_row.id)c
  join auth.users u on u.id=c.referred_id
  where c.referrer_id=player and now()<event_row.ends_at+case when (to_jsonb(u)->>'created_at')::timestamptz>=event_row.ends_at-interval '24 hours'
   then interval '24 hours' else interval '0 hours' end
  and not exists(select 1 from public.referral_event_qualified(event_row.id)q where q.referred_id=c.referred_id)));
end;$$;
revoke all on function public.get_referral_event() from public,anon,authenticated,service_role;
grant execute on function public.get_referral_event() to authenticated;

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
   '''createdAt'',n.created_at,''referralPackCards'',(select r.lr_cards from public.referral_event_rewards r where r.id=n.reference_id and r.user_id=n.user_id),''referralReward'',(select r.karas from public.referral_event_rewards r where r.id=n.reference_id and r.user_id=n.user_id)');
  if updated=definition then raise exception 'REFERRAL_NOTIFICATION_PATCH_MISMATCH: %',signature; end if;
  execute updated;
 end loop;
end;$$;

-- Extend the existing snapshot export in place, preserving its identity and ACL.
do $export$
declare source text; marker text := 'return result;';
begin
 source := pg_get_functiondef('public.build_data_export(uuid,uuid)'::regprocedure);
 if (length(source)-length(replace(source,marker,'')))/length(marker)<>1 then
  raise exception 'REFERRAL_EVENT_EXPORT_PATCH_MISMATCH';
 end if;
 execute replace(source,marker,$body$
  select result || jsonb_build_object('referral_event_rewards',coalesce((
   select jsonb_agg(jsonb_build_object('event_id',r.event_id,'event',e.slug,
    'starts_at',e.starts_at,'ends_at',e.ends_at,'threshold',r.threshold,
    'karas',r.karas,'lr_cards',r.lr_cards,'recruiter_title',r.recruiter_badge,
    'awarded_at',r.awarded_at,'decision_pack_id',r.decision_pack_id,'cards',r.cards)
    order by r.awarded_at,r.id)
   from public.referral_event_rewards r join public.referral_events e on e.id=r.event_id
   where r.user_id=p_user_id),'[]'::jsonb)) into result;
  if (select coalesce(sum(case when jsonb_typeof(value)='array' then jsonb_array_length(value)
   when jsonb_typeof(value)='object' then 1 else 0 end),0) from jsonb_each(result))>100000
   or octet_length(result::text)>26214400 then raise exception 'EXPORT_TOO_LARGE'; end if;
  return result;
 $body$);
end;
$export$;

select cron.schedule('settle-referral-events','* * * * *','select public.settle_referral_events()');
commit;
