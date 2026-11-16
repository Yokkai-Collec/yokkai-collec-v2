begin;
update public.event_runtime_config set enabled=true where singleton;
alter table auth.users add column if not exists created_at timestamptz default now();
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;

do $$
declare bonus_pack uuid; parent uuid:=gen_random_uuid(); child uuid; code text; event_id uuid; n integer; initial_balance integer; result jsonb; stamp timestamptz:=now();
begin
 -- A disposable edition with relative dates keeps the test runnable in future.
 delete from public.referral_event_tiers;
 delete from public.referral_events;
 insert into public.referral_events(slug,starts_at,ends_at) values('test',stamp-interval '4 days',stamp+interval '1 day') returning id into event_id;
 insert into public.referral_event_tiers(event_id,threshold,karas,lr_cards,recruiter_badge) values(event_id,3,750,0,false),(event_id,5,1600,0,false),(event_id,10,4000,0,false),(event_id,20,0,5,true);
 insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source) values
 ('event-lr-1','Event LR 1','ANIME/MANGA','LR','https://example.test/lr1.png','test'),
 ('event-lr-2','Event LR 2','ANIME/MANGA','LR','https://example.test/lr2.png','test');
 insert into auth.users(id,raw_user_meta_data,email_confirmed_at,created_at)
 values(parent,jsonb_build_object('pseudo','EventParent'),stamp,stamp-interval '10 days');
 perform set_config('request.jwt.claim.sub',parent::text,true);
 code:=public.create_referral_code();
 insert into public.decision_packs(user_id) values(parent); -- Existing pending daily pack stays intact.
 select karas_balance into initial_balance from public.user_profiles where user_id=parent;
 for n in 1..24 loop
  child:=gen_random_uuid();
  insert into auth.users(id,raw_user_meta_data,created_at)
   values(child,jsonb_build_object('pseudo','EventChild'||n,'referral_code',code),stamp-interval '3 days');
  update auth.users set email_confirmed_at=stamp-interval '2 days' where id=child;
  update public.referrals set created_at=stamp-interval '3 days',verified_at=stamp-interval '2 days',rewarded_at=stamp-interval '2 days' where referred_id=child;
  if n=21 then
   update public.referrals set created_at=stamp-interval '6 days' where referred_id=child;
  elsif n=22 then
   update auth.users set banned_until='infinity' where id=child;
  elsif n=23 then
   update auth.users set deleted_at=stamp where id=child;
  end if;
  if n<>24 then
   insert into public.regular_pack_openings(opened_by,source,opened_at)
   values(child,'timed',stamp-interval '1 day');
  end if;
 end loop;
 if (select bonus_regular_packs from public.user_profiles where user_id=parent)<>120 then
  raise exception 'Existing reward must still grant five packs for each of 24 verified referrals'; end if;
 if exists(select 1 from public.referrals r join public.user_profiles p on p.user_id=r.referred_id where r.referrer_id=parent and p.bonus_regular_packs<>5) then
  raise exception 'Existing referred-player reward changed'; end if;
 result:=public.get_referral_event();
 if (result->>'validCount')::int<>20 then raise exception 'Invalid, banned, anonymized or outside-event referrals counted: %',result; end if;
 if result->'pending'<>jsonb_build_array('EventChild24') then raise exception 'Pending DTO must contain only pseudos: %',result; end if;
 if exists(select 1 from public.referral_event_rewards) then raise exception 'Reading progress awarded money'; end if;
 -- An automatically awarded pack must not masquerade as player activity.
 insert into public.decision_packs(user_id,status,claimed_at,is_compensation) values(child,'claimed',stamp,true) returning id into bonus_pack;
 insert into public.referral_event_rewards(user_id,event_id,threshold,karas,lr_cards,recruiter_badge,decision_pack_id)
 values(child,event_id,20,0,5,true,bonus_pack);
 if (public.get_referral_event()->>'validCount')::int<>20 then raise exception 'Automatic reward counted as active play'; end if;
 update public.event_runtime_config set enabled=false where singleton;
 perform public.settle_referral_events();
 if exists(select 1 from public.referral_event_rewards where user_id=parent) then raise exception 'Disabled event awarded rewards'; end if;
 if public.get_referral_event() is not null then raise exception 'Disabled event exposed'; end if;
 update public.event_runtime_config set enabled=true where singleton;
 perform public.settle_referral_events();
 perform public.settle_referral_events();
 if (select count(*) from public.referral_event_rewards where user_id=parent)<>4 then raise exception 'Duplicate or missing tier'; end if;
 if (select karas_balance from public.user_profiles where user_id=parent)<>initial_balance+6350 then raise exception 'Tier balances must be cumulative and idempotent'; end if;
 if (select count(*) from public.notifications where user_id=parent and type='referral_event_tier')<>4 then raise exception 'Notification duplicated'; end if;
 if (select count(*) from public.user_cards where user_id=parent and rarity='LR' and not is_evolved and is_first_owner)<>5 then raise exception 'Special pack must award all five LR once'; end if;
 if (select count(*) from public.decision_packs where user_id=parent and is_compensation and status='claimed')<>1 then raise exception 'Special Decision Pack missing or duplicated'; end if;
 if (select count(*) from public.decision_packs where user_id=parent and not is_compensation and status='pending')<>1 then raise exception 'Special pack consumed or replaced the daily pack'; end if;
 if (select count(*) from public.decision_pack_choices c join public.referral_event_rewards r on r.decision_pack_id=c.pack_id where r.user_id=parent and c.rarity='LR' and not c.is_discarded)<>5 then raise exception 'Special pack discarded a reward'; end if;
 if jsonb_array_length(public.get_referral_event()->'rewardCards')<>5 then raise exception 'Owned reward reveal missing'; end if;
 if not exists(select 1 from jsonb_array_elements(public.list_notifications(30))notice where (notice->>'referralPackCards')::int=5) then raise exception 'Pack notification missing'; end if;
 if (select count(*) from public.player_title_unlocks where user_id=parent and title_id='recruiter')<>1 then raise exception 'Recruiter title missing or duplicated'; end if;
 perform public.equip_player_title('recruiter');
 if public.get_profile(null)->>'titleId'<>'recruiter' then raise exception 'Recruiter title cannot be equipped'; end if;
 -- Other notification types can precede rewards, including with identical timestamps.
 update public.notifications set created_at=stamp+interval '1 minute' where user_id=parent and type<>'referral_event_tier';
 if (select count(*) from jsonb_array_elements(public.list_notifications(30)) notice
     join public.referral_event_rewards reward on reward.id=(notice->>'referenceId')::uuid
     where notice->>'type'='referral_event_tier' and reward.user_id=parent
       and (notice->>'referralReward')::int=reward.karas
       and (notice->>'referralPackCards')::int=reward.lr_cards)<>4 then
  raise exception 'Notification reward projection missing'; end if;
 if has_function_privilege('authenticated','public.settle_referral_events()','execute')
 or has_function_privilege('service_role','public.settle_referral_events()','execute') then raise exception 'Worker exposed to clients'; end if;
 if has_table_privilege('authenticated','public.referral_event_rewards','insert') then raise exception 'Client can forge tiers'; end if;

 -- A final-day signup may qualify during grace; an earlier signup may not.
 update public.referral_events set starts_at=stamp-interval '6 days',ends_at=stamp-interval '12 hours' where id=event_id;
 update public.referrals set created_at=stamp-interval '30 hours',rewarded_at=stamp-interval '1 hour',verified_at=stamp-interval '1 hour' where referrer_id=parent;
 update auth.users set created_at=stamp-interval '30 hours' where id in(select referred_id from public.referrals where referrer_id=parent);
 update public.regular_pack_openings set opened_at=stamp-interval '1 hour' where opened_by in(select referred_id from public.referrals where referrer_id=parent);
 if (select count(*) from public.referral_event_qualified(event_id))<>21 then raise exception 'Final-day grace not honored'; end if;
 update auth.users set created_at=stamp-interval '3 days' where id in(select referred_id from public.referrals where referrer_id=parent);
 if exists(select 1 from public.referral_event_qualified(event_id)) then raise exception 'Grace incorrectly extends early signups'; end if;
 update public.referral_events set ends_at=stamp-interval '25 hours' where id=event_id;
 if exists(select 1 from public.referral_event_qualified(event_id)) then raise exception 'Late qualification counted'; end if;
end;$$;
rollback;
