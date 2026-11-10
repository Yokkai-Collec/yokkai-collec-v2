begin;
set local lock_timeout='3s';

-- The launch instant is immutable: never count pre-launch actions as missions.
create function public.mission_period_start(p_stamp timestamptz,p_period text)
returns timestamptz language sql immutable set search_path='' as $$
 select (case when p_period='daily' then date_trunc('day',p_stamp at time zone 'Europe/Paris'-interval '20 hours')+interval '20 hours'
 else date_trunc('week',p_stamp at time zone 'Europe/Paris'-interval '20 hours')+interval '20 hours' end) at time zone 'Europe/Paris'
$$;
create function public.mission_period_end(p_start timestamptz,p_period text)
returns timestamptz language sql immutable set search_path='' as $$
 select ((p_start at time zone 'Europe/Paris')+case when p_period='daily' then interval '1 day' else interval '1 week' end) at time zone 'Europe/Paris'
$$;
create table public.mission_definitions(
 id text primary key,period text not null check(period in ('daily','weekly')),
 metric text not null,target integer not null check(target>0),points integer not null check(points>0),category text not null,
 unique(period,metric,target)
);
insert into public.mission_definitions values
 ('daily-packs-5','daily','regular_packs_opened',5,15,'packs'),
 ('daily-packs-15','daily','regular_packs_opened',15,20,'packs'),
 ('daily-packs-30','daily','regular_packs_opened',30,30,'packs'),
 ('daily-decision','daily','decision_days',1,15,'packs'),
 ('daily-sr','daily','sr_acquired',3,15,'collection'),
 ('daily-ssr','daily','ssr_acquired',1,30,'collection'),
 ('daily-recycle','daily','cards_destroyed',10,15,'collection'),
 ('daily-wishlist','daily','wishlist_added',1,15,'collection'),
 ('daily-new','daily','new_cards',10,20,'collection'),
 ('daily-bid','daily','bids_placed',1,20,'market'),
 ('daily-list','daily','auctions_listed',1,20,'market'),
 ('daily-friend','daily','friend_requests',1,15,'social'),
 ('daily-visit','daily','friend_visits',1,15,'social'),
 ('daily-trade','daily','trades_proposed',1,20,'social'),
 ('weekly-packs-100','weekly','regular_packs_opened',100,10,'packs'),
 ('weekly-packs-250','weekly','regular_packs_opened',250,15,'packs'),
 ('weekly-decision','weekly','decision_days',7,25,'packs'),
 ('weekly-recycle','weekly','cards_destroyed',100,10,'collection'),
 ('weekly-new','weekly','new_cards',50,10,'collection'),
 ('weekly-ssr','weekly','ssr_acquired',3,15,'collection'),
 ('weekly-lr','weekly','lr_acquired',1,25,'collection'),
 ('weekly-daily-3','weekly','daily_full',3,10,'missions'),
 ('weekly-daily-6','weekly','daily_full',6,25,'missions'),
 ('weekly-sales','weekly','auctions_sold',2,15,'market'),
 ('weekly-win','weekly','auctions_won',1,15,'market'),
 ('weekly-trade','weekly','trades_completed',1,15,'social');
create table public.gauge_milestones(
 period text not null check(period in ('daily','weekly')),points integer not null check(points between 1 and 100),
 reward integer not null check(reward>0),primary key(period,points)
);
insert into public.gauge_milestones values
 ('daily',20,15),('daily',50,25),('daily',80,30),('daily',100,40),
 ('weekly',20,50),('weekly',40,75),('weekly',60,100),('weekly',80,125),('weekly',100,250);
create table public.user_progress_counters(
 user_id uuid not null references auth.users(id) on delete cascade,metric text not null,value bigint not null check(value>=0),
 primary key(user_id,metric)
);
create table public.user_mission_progress(
 user_id uuid not null references auth.users(id) on delete cascade,
 period text not null check(period in ('daily','weekly')),period_start timestamptz not null,metric text not null,
 value bigint not null check(value>=0),primary key(user_id,period,period_start,metric)
);
create table public.user_gauge_completions(
 user_id uuid not null references auth.users(id) on delete cascade,
 period text not null check(period in ('daily','weekly')),period_start timestamptz not null,completed_at timestamptz not null,
 primary key(user_id,period,period_start)
);
create table public.user_milestone_claims(
 user_id uuid not null references auth.users(id) on delete cascade,
 period text not null check(period in ('daily','weekly')),period_start timestamptz not null,
 points integer not null,reward integer not null check(reward>0),claimed_at timestamptz not null,
 primary key(user_id,period,period_start,points),foreign key(period,points) references public.gauge_milestones(period,points)
);
create function public.mission_points(p_user uuid,p_period text,p_start timestamptz)
returns integer language sql stable set search_path='' as $$
 select least(100,coalesce(sum(d.points),0))::integer from public.mission_definitions d
 join public.user_mission_progress p on p.user_id=p_user and p.period=d.period and p.period_start=p_start and p.metric=d.metric
 where d.period=p_period and p.value>=d.target
$$;
create function public.advance_player_progress(p_user uuid,p_metric text,p_amount bigint,p_stamp timestamptz default clock_timestamp())
returns void language plpgsql volatile security definer set search_path='' as $$
declare kind text; start_at timestamptz; fresh boolean; completed_count integer; old_completed integer;
begin
 if p_user is null or p_amount<=0 then return; end if;
 -- Different actions can finish concurrently. Serialize a player's gauge writes
 -- so crossing 100 points cannot be missed by two independent transactions.
 perform pg_advisory_xact_lock(hashtextextended('player-progress:'||p_user::text,0));
 insert into public.user_progress_counters values(p_user,p_metric,p_amount)
 on conflict(user_id,metric) do update set value=public.user_progress_counters.value+excluded.value;
 if p_stamp<'2026-11-09 19:00:00+00'::timestamptz then return; end if;
 foreach kind in array array['daily','weekly'] loop
  if not exists(select 1 from public.mission_definitions where period=kind and metric=p_metric) then continue; end if;
  start_at:=public.mission_period_start(p_stamp,kind);
  old_completed:=0;
  if kind='daily' then
   select count(*) into old_completed from public.mission_definitions d join public.user_mission_progress p
    on p.user_id=p_user and p.period=kind and p.period_start=start_at and p.metric=d.metric
    where d.period=kind and d.metric=p_metric and p.value>=d.target;
  end if;
  -- Counts are bounded to the largest fixed objective; excess actions never grow a period indefinitely.
  insert into public.user_mission_progress values(p_user,kind,start_at,p_metric,
   least(p_amount,(select max(target) from public.mission_definitions where period=kind and metric=p_metric)))
  on conflict(user_id,period,period_start,metric) do update set value=least(public.user_mission_progress.value+excluded.value,
   (select max(target) from public.mission_definitions where period=kind and metric=p_metric));
  if kind='daily' then
   select count(*) into completed_count from public.mission_definitions d join public.user_mission_progress p
    on p.user_id=p_user and p.period=kind and p.period_start=start_at and p.metric=d.metric
    where d.period=kind and d.metric=p_metric and p.value>=d.target;
   if completed_count>old_completed then
    insert into public.user_progress_counters values(p_user,'daily_missions',completed_count-old_completed)
    on conflict(user_id,metric) do update set value=public.user_progress_counters.value+excluded.value;
   end if;
  end if;
  if public.mission_points(p_user,kind,start_at)>=100 then
   insert into public.user_gauge_completions values(p_user,kind,start_at,p_stamp) on conflict do nothing;
   fresh:=found;
   if fresh then
    if kind='daily' then perform public.advance_player_progress(p_user,'daily_full',1,p_stamp);
    else
     insert into public.user_progress_counters values(p_user,'weekly_full',1)
     on conflict(user_id,metric) do update set value=public.user_progress_counters.value+1;
    end if;
   end if;
  end if;
 end loop;

end;
$$;
create function public.claim_mission_milestone(p_period text,p_start timestamptz,p_points integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player uuid:=auth.uid(); amount integer; balance integer; stamp timestamptz:=clock_timestamp();
begin
 perform public.assert_player_not_banned();
 if player is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_period not in ('daily','weekly') or p_start<>public.mission_period_start(p_start,p_period)
  or p_start<'2026-11-09 19:00:00+00'::timestamptz or p_start>stamp then raise exception 'MISSION_LOCKED'; end if;
 -- Profile first, matching the game mutations; serializes manual and automatic settlement.
 perform 1 from public.user_profiles where user_id=player for update;
 if not found then raise exception 'PROFILE_MISSING'; end if;
 select reward into amount from public.gauge_milestones where period=p_period and points=p_points;
 if not found or public.mission_points(player,p_period,p_start)<p_points then raise exception 'MISSION_LOCKED'; end if;
 if public.billing_has_game_pro(player) then amount:=ceil(amount*1.5)::integer; end if;
 insert into public.user_milestone_claims values(player,p_period,p_start,p_points,amount,stamp) on conflict do nothing;
 if not found then raise exception 'MISSION_ALREADY_CLAIMED'; end if;
 balance:=public.credit_karas(player,amount);
 perform public.advance_player_progress(player,'karas_earned',amount,stamp);
 return jsonb_build_object('balance',balance,'reward',amount,'claimedAt',stamp);
end;
$$;
create function public.get_missions()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player uuid:=auth.uid(); stamp timestamptz:=clock_timestamp(); due record; result jsonb; settled boolean:=false;
begin
 perform public.assert_player_not_banned();
 if player is null then raise exception 'AUTH_REQUIRED'; end if;
 perform 1 from public.user_profiles where user_id=player for update;
 if not found then raise exception 'PROFILE_MISSING'; end if;
 -- Settle every unpaid historical period, including after a long absence; no cron required.
 for due in
  with periods as materialized(
   select distinct p.period,p.period_start from public.user_mission_progress p where p.user_id=player and public.mission_period_end(p.period_start,p.period)<=stamp
  ), earned as materialized(
   select p.*,public.mission_points(player,p.period,p.period_start) points from periods p
  )
  select e.period,e.period_start,m.points from earned e join public.gauge_milestones m on m.period=e.period and m.points<=e.points
  where not exists(select 1 from public.user_milestone_claims c where c.user_id=player and c.period=e.period and c.period_start=e.period_start and c.points=m.points)
  order by e.period_start,e.period,m.points
 loop perform public.claim_mission_milestone(due.period,due.period_start,due.points); settled:=true; end loop;
 select jsonb_build_object('settled',settled,'serverNow',stamp,'launchAt','2026-11-09T19:00:00Z','active',stamp>='2026-11-09 19:00:00+00'::timestamptz,
  'pro',public.billing_has_game_pro(player),'periods',(
   select jsonb_agg(jsonb_build_object('period',kind,'startAt',public.mission_period_start(stamp,kind),'endsAt',public.mission_period_end(public.mission_period_start(stamp,kind),kind),
    'points',public.mission_points(player,kind,public.mission_period_start(stamp,kind)),
    'missions',(select jsonb_agg(jsonb_build_object('id',d.id,'metric',d.metric,'target',d.target,'points',d.points,'category',d.category,'current',coalesce(p.value,0)) order by coalesce(p.value,0)>=d.target,d.category,d.target,d.id)
     from public.mission_definitions d left join public.user_mission_progress p on p.user_id=player and p.period=d.period and p.period_start=public.mission_period_start(stamp,kind) and p.metric=d.metric where d.period=kind),
    'milestones',(select jsonb_agg(jsonb_build_object('points',m.points,'reward',case when public.billing_has_game_pro(player) then ceil(m.reward*1.5)::integer else m.reward end,'claimedAt',c.claimed_at)
     order by m.points) from public.gauge_milestones m left join public.user_milestone_claims c on c.user_id=player and c.period=m.period and c.period_start=public.mission_period_start(stamp,kind) and c.points=m.points where m.period=kind)
   )) from unnest(array['daily','weekly']) kind)
 ) into result;
 return result;
end;
$$;
-- No client may write counters, select someone else's history, or call internal helpers.
do $$ declare name text; begin
 foreach name in array array['mission_definitions','gauge_milestones','user_progress_counters','user_mission_progress','user_gauge_completions','user_milestone_claims'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated',name);
 end loop;
end $$;
revoke all on function public.mission_period_start(timestamptz,text),public.mission_period_end(timestamptz,text),
 public.mission_points(uuid,text,timestamptz),public.advance_player_progress(uuid,text,bigint,timestamptz),
 public.claim_mission_milestone(text,timestamptz,integer),public.get_missions() from public,anon,authenticated,service_role;
grant execute on function public.claim_mission_milestone(text,timestamptz,integer),public.get_missions() to authenticated;
commit;
