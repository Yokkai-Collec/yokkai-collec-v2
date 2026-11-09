begin;
set local lock_timeout='3s';
create table public.user_seen_cards(
 user_id uuid not null references auth.users(id) on delete cascade,card_id uuid not null references public.cards(id) on delete cascade,
 primary key(user_id,card_id)
);
create table public.user_progress_marks(
 user_id uuid not null references auth.users(id) on delete cascade,metric text not null,mark text not null,recorded_at timestamptz not null default clock_timestamp(),
 primary key(user_id,metric,mark)
);
insert into public.user_seen_cards select distinct user_id,card_id from public.user_cards on conflict do nothing;
insert into public.user_seen_cards select distinct original_owner_id,card_id from public.regular_pack_opening_cards p
 where exists(select 1 from public.user_profiles u where u.user_id=p.original_owner_id) and exists(select 1 from public.cards c where c.id=p.card_id) on conflict do nothing;
alter table public.user_seen_cards enable row level security;
alter table public.user_progress_marks enable row level security;
revoke all on public.user_seen_cards,public.user_progress_marks from public,anon,authenticated,service_role;

-- Indexed ownership counts preserve milestones reached between two visits to
-- the achievements page, without rescanning the collection during a pack draw.
alter table public.user_seen_cards add column owned_copies bigint not null default 0 check(owned_copies>=0);
update public.user_seen_cards s set owned_copies=c.n from(select user_id,card_id,count(*) n from public.user_cards group by user_id,card_id)c where s.user_id=c.user_id and s.card_id=c.card_id;
insert into public.user_progress_counters select user_id,'owned_unique',count(*) from public.user_seen_cards where owned_copies>0 group by user_id;
insert into public.user_progress_counters select user_id,'peak_unique',count(*) from public.user_seen_cards where owned_copies>0 group by user_id;
insert into public.user_progress_counters select user_id,'max_copies',max(owned_copies) from public.user_seen_cards group by user_id;
insert into public.user_progress_counters select s.user_id,'owned_category:'||c.categorie,count(*) from public.user_seen_cards s join public.cards c on c.id=s.card_id where s.owned_copies>0 and c.categorie is not null group by s.user_id,c.categorie;
insert into public.user_progress_counters select s.user_id,'owned_rarity:'||c.rarete_base::text,sum(s.owned_copies) from public.user_seen_cards s join public.cards c on c.id=s.card_id where s.owned_copies>0 group by s.user_id,c.rarete_base;
insert into public.user_progress_counters select user_id,replace(metric,'owned_category:','peak_category:'),value from public.user_progress_counters where metric like 'owned_category:%';
insert into public.user_progress_counters select user_id,'peak_categories',count(*) from public.user_progress_counters where metric like 'owned_category:%' and value>0 group by user_id;
insert into public.user_progress_counters select user_id,'peak_rarities',count(*) from public.user_progress_counters where metric like 'owned_rarity:%' and value>0 group by user_id;
create function public.apply_owned_card_deltas(p_user uuid,p_deltas jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare deltas jsonb; largest bigint;
begin
 if not exists(select 1 from public.user_profiles where user_id=p_user) then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('player-progress:'||p_user::text,0));
 with changes as materialized(
  select s.card_id,s.owned_copies previous,greatest(0,s.owned_copies+d.value::bigint) copies,c.categorie category,c.rarete_base::text rarity
  from jsonb_each_text(p_deltas)d join public.user_seen_cards s on s.user_id=p_user and s.card_id=d.key::uuid join public.cards c on c.id=s.card_id
 ), updated as(
  update public.user_seen_cards s set owned_copies=c.copies from changes c where s.user_id=p_user and s.card_id=c.card_id
  returning c.previous,c.copies,c.category,c.rarity
 ), metrics as(
  select 'owned_unique' metric,sum((copies>0)::integer-(previous>0)::integer) amount from updated
  union all select 'owned_category:'||category,sum((copies>0)::integer-(previous>0)::integer) from updated where category is not null group by category
  union all select 'owned_rarity:'||rarity,sum(copies-previous) from updated group by rarity
 ) select(select coalesce(jsonb_object_agg(metric,coalesce(amount,0)),'{}'::jsonb) from metrics),(select coalesce(max(copies),0) from updated) into deltas,largest;
 insert into public.user_progress_counters select p_user,key,greatest(0,value::bigint) from jsonb_each_text(deltas)
 on conflict(user_id,metric) do update set value=greatest(0,public.user_progress_counters.value+(deltas->>excluded.metric)::bigint);
 insert into public.user_progress_counters
  select p_user,'peak_unique',value from public.user_progress_counters where user_id=p_user and metric='owned_unique'
  union all select p_user,'max_copies',largest
  union all select p_user,replace(metric,'owned_category:','peak_category:'),value from public.user_progress_counters where user_id=p_user and metric like 'owned_category:%' and deltas?metric
  union all select p_user,'peak_rarities',count(*) from public.user_progress_counters where user_id=p_user and metric like 'owned_rarity:%' and value>0
  union all select p_user,'peak_categories',count(*) from public.user_progress_counters where user_id=p_user and metric like 'owned_category:%' and value>0
 on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
end;
$$;
revoke all on function public.apply_owned_card_deltas(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.mark_player_progress(p_user uuid,p_metric text,p_mark text,p_stamp timestamptz default clock_timestamp())
returns boolean language plpgsql security definer set search_path='' as $$
begin
 insert into public.user_progress_marks values(p_user,p_metric,p_mark,p_stamp) on conflict do nothing;
 if not found then return false; end if;
 perform public.advance_player_progress(p_user,p_metric,1,p_stamp);
 return true;
end;
$$;
-- Acquisition is batched once per statement; never scan the complete collection per card.
create function public.capture_collection_progress()
returns trigger language plpgsql security definer set search_path='' as $$
declare player record; discovered integer; wished integer; wished_card uuid; stock_deltas jsonb;
begin
 for player in select user_id,count(*) filter(where not is_evolved)::integer total,
  count(*) filter(where not is_evolved and rarity in ('SR','SSR','LR'))::integer sr,
  count(*) filter(where not is_evolved and rarity in ('SSR','LR'))::integer ssr,
  count(*) filter(where not is_evolved and rarity='LR')::integer lr,
  count(*) filter(where not is_evolved and rarity='SR')::integer exact_sr,
  count(*) filter(where not is_evolved and rarity='SSR')::integer exact_ssr,
  count(*) filter(where is_evolved and rarity='SSR')::integer infinity
  from progress_cards group by user_id order by user_id
 loop
  with discovered_cards as (
   insert into public.user_seen_cards select distinct user_id,card_id from progress_cards where user_id=player.user_id and not is_evolved
   on conflict do nothing returning card_id
  ) select count(*) into discovered from discovered_cards;
  for wished_card in select distinct pc.card_id from progress_cards pc join public.wishlists w on w.user_id=pc.user_id and w.card_id=pc.card_id where pc.user_id=player.user_id loop
   perform public.mark_player_progress(player.user_id,'wish_granted',wished_card::text);
  end loop;
  select jsonb_object_agg(card_id,n) into stock_deltas from(select card_id,count(*) n from progress_cards where user_id=player.user_id group by card_id) cards;
  perform public.apply_owned_card_deltas(player.user_id,coalesce(stock_deltas,'{}'::jsonb));
  perform public.advance_player_progress(player.user_id,'new_cards',discovered);
  perform public.advance_player_progress(player.user_id,'sr_acquired',player.sr);
  perform public.advance_player_progress(player.user_id,'ssr_acquired',player.ssr);
  perform public.advance_player_progress(player.user_id,'lr_acquired',player.lr);
  perform public.advance_player_progress(player.user_id,'first_sr',player.exact_sr);
  perform public.advance_player_progress(player.user_id,'first_ssr',player.exact_ssr);
  perform public.advance_player_progress(player.user_id,'ssr_infinity',player.infinity);
 end loop;
 return null;
end;
$$;
create trigger user_cards_progress_insert after insert on public.user_cards referencing new table as progress_cards
 for each statement execute function public.capture_collection_progress();
alter table public.regular_pack_openings add column progress_transaction bigint;
alter table public.regular_pack_openings alter column progress_transaction set default txid_current();
create index regular_pack_openings_progress_transaction on public.regular_pack_openings(opened_by,progress_transaction) where progress_transaction is not null;
create function public.capture_regular_pack_progress()
returns trigger language plpgsql security definer set search_path='' as $$
declare pack record; stamp timestamptz; first_today boolean; dry bigint; batch_count integer;
begin
 for pack in select pc.original_owner_id player,pc.pack_opening_id opening,min(pc.recorded_at) stamp,
  count(distinct pc.card_id) distinct_cards,count(distinct c.categorie) categories,
  bool_and(c.rarete_base='C') all_common,count(distinct c.rarete_base) rarities,
  bool_or(c.rarete_base in ('SR','SSR','LR')) has_sr,bool_or(c.rarete_base='LR') has_lr,
  count(*) filter(where uc.rarity='LR' and uc.is_shiny and not uc.is_evolved) shinies
  from progress_pack_cards pc join public.cards c on c.id=pc.card_id left join public.user_cards uc on uc.id=pc.card_instance_id
  group by pc.original_owner_id,pc.pack_opening_id order by pc.original_owner_id
 loop
  stamp:=pack.stamp;
  select count(*) into batch_count from public.regular_pack_openings where opened_by=pack.player and progress_transaction=txid_current();
  if batch_count=1 and exists(select 1 from public.user_profiles where user_id=pack.player and
   next_regular_pack_at+make_interval(secs=>regular_pack_interval_seconds*(case when public.billing_has_game_pro(pack.player) then 9 else 4 end))<=stamp) then
   insert into public.user_progress_marks values(pack.player,'full_batch_candidate',txid_current()::text,stamp) on conflict do nothing;
  end if;
  if batch_count>=5 and exists(select 1 from public.user_progress_marks where user_id=pack.player and metric='full_batch_candidate' and mark=txid_current()::text) then
   perform public.mark_player_progress(pack.player,'full_stack',txid_current()::text,stamp);
  end if;
  perform public.advance_player_progress(pack.player,'regular_packs_opened',1,stamp);
  perform public.advance_player_progress(pack.player,'shiny_drawn',pack.shinies,stamp);
  if public.billing_has_game_pro(pack.player) then perform public.advance_player_progress(pack.player,'pro_packs',1,stamp); end if;
  first_today:=public.mark_player_progress(pack.player,'pack_days',public.mission_period_start(stamp,'daily')::text,stamp);
  if first_today and pack.has_lr then perform public.mark_player_progress(pack.player,'lucky_start','once',stamp); end if;
  if pack.distinct_cards<5 then perform public.mark_player_progress(pack.player,'deja_vu','once',stamp); end if;
  if pack.all_common then perform public.mark_player_progress(pack.player,'all_common','once',stamp); end if;
  if pack.rarities=5 then perform public.mark_player_progress(pack.player,'rainbow','once',stamp); end if;
  if pack.categories=1 then perform public.mark_player_progress(pack.player,'same_family','once',stamp); end if;
  if stamp-public.mission_period_start(stamp,'daily')<interval '1 minute' then perform public.mark_player_progress(pack.player,'right_on_time','once',stamp); end if;
  insert into public.user_progress_counters values(pack.player,'dry_run',case when pack.has_sr then 0 else 1 end)
   on conflict(user_id,metric) do update set value=case when pack.has_sr then 0 else public.user_progress_counters.value+1 end returning value into dry;
  if dry>=10 then perform public.mark_player_progress(pack.player,'dry_spell','once',stamp); end if;
 end loop;
 return null;
end;
$$;
create trigger regular_pack_cards_progress after insert on public.regular_pack_opening_cards referencing new table as progress_pack_cards
 for each statement execute function public.capture_regular_pack_progress();
create function public.capture_card_destruction_progress()
returns trigger language plpgsql security definer set search_path='' as $$
declare player record;
begin
 if coalesce(current_setting('game.progress_action',true),'')<>'destruction' then return null; end if;
 for player in select user_id,count(*)::integer total,bool_or(rarity='SSR') ssr,sum(public.card_destruction_value(rarity)) earned
  from destroyed_progress_cards group by user_id order by user_id
 loop
  perform public.advance_player_progress(player.user_id,'cards_destroyed',player.total);
  perform public.advance_player_progress(player.user_id,'karas_earned',player.earned);
  if player.ssr then perform public.mark_player_progress(player.user_id,'regret','once'); end if;
 end loop;
 return null;
end;
$$;
create trigger user_cards_progress_destroy after delete on public.user_cards referencing old table as destroyed_progress_cards
 for each statement execute function public.capture_card_destruction_progress();
-- Add an operation marker inside the existing validated functions, retaining their
-- bodies, privileges, input checks, ban guards and lock order.
do $$ declare signature text; definition text; begin
 foreach signature in array array['public.discard_collection_card(uuid)','public.discard_collection_cards(uuid[])','public.discard_regular_pack_card(uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  execute replace(definition,'perform public.assert_player_not_banned();',E'perform public.assert_player_not_banned();\n perform set_config(''game.progress_action'',''destruction'',true);');
 end loop;
 foreach signature in array array['public.evolve_ssr_card(uuid[])','public.evolve_lr_card(uuid[])'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  execute replace(definition,'perform public.assert_player_not_banned();',E'perform public.assert_player_not_banned();\n perform set_config(''game.progress_action'',''evolution'',true);');
 end loop;
end $$;
create function public.capture_game_progress()
returns trigger language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); day_start timestamptz; n integer; eligible boolean; player uuid; owner uuid;
begin
 if tg_table_name='wishlists' then
  perform public.advance_player_progress(new.user_id,'wishlist_added',1,stamp);
 elsif tg_table_name='bids' then
  perform public.advance_player_progress(new.bidder_id,'bids_placed',1,stamp);
  if exists(select 1 from public.auctions where id=new.auction_id and ends_at-stamp between interval '0 seconds' and interval '5 seconds') then
   perform public.mark_player_progress(new.bidder_id,'last_second','once',stamp);
  end if;
 elsif tg_table_name='friendships' then
  if tg_op='INSERT' then perform public.advance_player_progress(new.user_id,'friend_requests',1,stamp); end if;
  if new.status='accepted' then
   for player in select u from unnest(array[new.user_id,new.friend_id]) u order by u loop
    perform pg_advisory_xact_lock(hashtextextended('player-progress:'||player::text,0));
    insert into public.user_progress_counters select player,'friends_owned',count(*) from public.friendships where status='accepted' and player in(user_id,friend_id)
    on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
   end loop;
  end if;
 elsif tg_table_name='trade_offers' then
  if tg_op='INSERT' then perform public.advance_player_progress(new.from_user,'trades_proposed',1,stamp);
  elsif old.status<>'accepted' and new.status='accepted' then
   foreach player in array array[new.from_user,new.to_user] loop
    perform public.advance_player_progress(player,'trades_completed',1,stamp);
   end loop;
   perform public.advance_player_progress(new.from_user,'karas_earned',greatest(0,new.requested_karas-new.offered_karas),stamp);
   perform public.advance_player_progress(new.to_user,'karas_earned',greatest(0,new.offered_karas-new.requested_karas),stamp);
   eligible:=exists(select 1 from public.friendships where status='accepted' and updated_at<=stamp-interval '3 days'
    and ((user_id=new.from_user and friend_id=new.to_user) or(user_id=new.to_user and friend_id=new.from_user)));
   if eligible then
    perform public.mark_player_progress(new.from_user,'eligible_trades',new.to_user::text||':'||public.mission_period_start(stamp,'daily')::text,stamp);
    perform public.mark_player_progress(new.to_user,'eligible_trades',new.from_user::text||':'||public.mission_period_start(stamp,'daily')::text,stamp);
    if new.parent_offer_id is not null then perform public.mark_player_progress(new.from_user,'counteroffers',new.to_user::text||':'||public.mission_period_start(stamp,'daily')::text,stamp); end if;
    if exists(select 1 from public.user_cards where id=any(new.offered_card_ids) and rarity in ('SSR','LR')) then
     perform public.mark_player_progress(new.from_user,'generous','once',stamp);
    end if;
    if exists(select 1 from public.user_cards where id=any(new.requested_card_ids) and rarity in ('SSR','LR')) then
     perform public.mark_player_progress(new.to_user,'generous','once',stamp);
    end if;
    if exists(select 1 from public.user_cards a join public.user_cards b on a.card_id=b.card_id where a.id=any(new.offered_card_ids) and b.id=any(new.requested_card_ids)) then
     perform public.mark_player_progress(new.from_user,'mirror','once',stamp); perform public.mark_player_progress(new.to_user,'mirror','once',stamp);
    end if;
   end if;
  end if;
 elsif tg_table_name='auctions' then
  -- place_bid extends ends_at before inserting the bid row. Only OLD.ends_at
  -- represents the real deadline the bidder saw.
  if tg_op='UPDATE' and new.status='active' and new.current_price>old.current_price and new.buyer_id is not null and old.ends_at>stamp then
   if old.ends_at-stamp<=interval '1 minute' then
    insert into public.user_progress_marks values(new.buyer_id,'sniper_candidate',new.id::text,stamp) on conflict do nothing;
   end if;
   if old.ends_at-stamp<interval '5 seconds' then
    perform public.mark_player_progress(new.buyer_id,'last_second','once',stamp);
    if old.buyer_id is not null and old.buyer_id<>new.buyer_id then
     insert into public.user_progress_marks values(old.buyer_id,'late_outbid_candidate',new.id::text,stamp) on conflict do nothing;
    end if;
   end if;
  end if;
  if tg_op='INSERT' then
   perform public.advance_player_progress(new.seller_id,'auctions_listed',1,stamp);
   if public.billing_has_game_pro(new.seller_id) and (select count(*) from public.auctions where seller_id=new.seller_id and status='active' and ends_at>stamp)>=6 then
    perform public.mark_player_progress(new.seller_id,'auction_house',public.mission_period_start(stamp,'daily')::text,stamp);
   end if;
  elsif old.status='active' and new.status='sold' and new.buyer_id is not null then
   perform public.advance_player_progress(new.seller_id,'auctions_sold',1,stamp);
   perform public.advance_player_progress(new.seller_id,'karas_earned',new.current_price,stamp);
   perform public.advance_player_progress(new.buyer_id,'auctions_won',1,stamp);
   if exists(select 1 from public.user_progress_marks where user_id=new.buyer_id and metric='sniper_candidate' and mark=new.id::text)
    or exists(select 1 from public.bids where auction_id=new.id and bidder_id=new.buyer_id and created_at>=new.ends_at-interval '1 minute' and created_at<new.ends_at) then
    perform public.mark_player_progress(new.buyer_id,'sniper',new.id::text,stamp);
   end if;
   for owner in select user_id from public.user_progress_marks where metric='late_outbid_candidate' and mark=new.id::text and user_id<>new.buyer_id
    union select distinct bidder_id from public.bids where auction_id=new.id and bidder_id<>new.buyer_id
    and created_at>=new.ends_at-interval '5 seconds' and created_at<new.ends_at
   loop perform public.mark_player_progress(owner,'so_close','once',stamp); end loop;
  end if;
 elsif tg_table_name='decision_packs' then
  if old.status='pending' and new.status='claimed' then
   day_start:=public.mission_period_start(stamp,'daily');
   perform public.mark_player_progress(new.user_id,'decision_days',day_start::text,stamp);
   if public.billing_has_game_pro(new.user_id) and (select count(*) from public.decision_packs where user_id=new.user_id and status='claimed' and created_at>=day_start and created_at<public.mission_period_end(day_start,'daily') and not is_compensation)>=2 then
    perform public.mark_player_progress(new.user_id,'double_decision',day_start::text,stamp);
   end if;
   if exists(select 1 from public.decision_pack_choices c where c.id=new.kept_choice_id and (select count(*) from public.user_cards u where u.user_id=new.user_id and u.card_id=c.card_id)>=6) then
    perform public.mark_player_progress(new.user_id,'same_again','once',stamp);
   end if;
   select count(*) into n from public.decision_pack_choices where pack_id=new.id and rarity='LR' and is_shiny and id=new.kept_choice_id;
   perform public.advance_player_progress(new.user_id,'shiny_drawn',n,stamp);
  end if;
 elsif tg_table_name='decision_pack_choices' then
  if not old.is_discarded and new.is_discarded then
   select user_id into owner from public.decision_packs where id=new.pack_id;
   perform public.advance_player_progress(owner,'cards_destroyed',1,stamp);
   perform public.advance_player_progress(owner,'karas_earned',public.card_destruction_value(new.rarity),stamp);
   if new.rarity='SSR' then perform public.mark_player_progress(owner,'regret','once',stamp); end if;
  end if;
 elsif tg_table_name='user_profiles' then
  if (new.bio,new.avatar_url,new.featured_card_ids,new.banner_url) is distinct from (old.bio,old.avatar_url,old.featured_card_ids,old.banner_url) then
  if nullif(btrim(new.bio),'') is not null and new.avatar_url is not null then perform public.mark_player_progress(new.user_id,'identity','once',stamp); end if;
  insert into public.user_progress_counters values(new.user_id,'showcase_size',coalesce(cardinality(new.featured_card_ids),0)) on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
  if public.billing_has_game_pro(new.user_id) then
   insert into public.user_progress_counters values(new.user_id,'pro_showcase',coalesce(cardinality(new.featured_card_ids),0)) on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
   insert into public.user_progress_counters select new.user_id,'pro_rare_showcase',count(*) from public.user_cards where user_id=new.user_id and id=any(new.featured_card_ids) and rarity in('SSR','LR') on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
   if exists(select 1 from public.profile_media_assets where user_id=new.user_id and purpose in('avatar','banner') and animated and public_url in(new.avatar_url,new.banner_url)) then perform public.mark_player_progress(new.user_id,'pro_animated','once',stamp); end if;
  end if;
  end if;
  if new.last_seen_at is distinct from old.last_seen_at and new.last_seen_at is not null then
   perform public.mark_player_progress(new.user_id,'activity_days',(new.last_seen_at at time zone 'Europe/Paris')::date::text,stamp);
  end if;
  if old.last_seen_at is not null and new.last_seen_at>old.last_seen_at+interval '30 days' then perform public.mark_player_progress(new.user_id,'comeback','once',stamp); end if;
 end if;
 return new;
end;
$$;
create trigger wishlist_progress after insert on public.wishlists for each row execute function public.capture_game_progress();
create trigger bids_progress after insert on public.bids for each row execute function public.capture_game_progress();
create trigger friendship_progress after insert or update of status on public.friendships for each row execute function public.capture_game_progress();
create trigger trade_progress after insert or update of status on public.trade_offers for each row execute function public.capture_game_progress();
create trigger auction_progress after insert or update of status,buyer_id,current_price,ends_at on public.auctions for each row execute function public.capture_game_progress();
create trigger decision_progress after update of status on public.decision_packs for each row execute function public.capture_game_progress();
create trigger decision_destroy_progress after update of is_discarded on public.decision_pack_choices for each row execute function public.capture_game_progress();
create trigger comeback_progress after update of last_seen_at,avatar_url,bio,featured_card_ids,banner_url on public.user_profiles for each row execute function public.capture_game_progress();
create function public.record_friend_visit(p_identifier text)
returns void language plpgsql volatile security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); target uuid;
begin
 perform public.assert_player_not_banned();
 if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
 select user_id into target from public.user_profiles where user_id::text=p_identifier or lower(pseudo)=lower(p_identifier) limit 1;
 if target is null or not exists(select 1 from public.friendships where status='accepted' and
  ((user_id=viewer and friend_id=target) or(user_id=target and friend_id=viewer))) then return; end if;
 perform public.mark_player_progress(viewer,'friend_visits',public.mission_period_start(clock_timestamp(),'daily')::text);
end;
$$;
-- Existing data can prove discoveries, wishlist ownership, accepted trades and
-- completed sales. Do not invent missing destruction/earnings/draw snapshots.
insert into public.user_progress_counters
 select user_id,'new_cards',count(*) from public.user_seen_cards group by user_id
 union all select user_id,'wishlist_added',count(*) from public.wishlists group by user_id
 union all select seller_id,'auctions_sold',count(*) from public.auctions where status='sold' and buyer_id is not null group by seller_id
 union all select seller_id,'karas_earned',sum(current_price) from public.auctions where status='sold' and buyer_id is not null group by seller_id
 on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
-- Backfill only lifetime counters; never create a historical mission period.
do $$ declare name text; begin
 foreach name in array array['user_seen_cards','user_progress_marks','user_progress_counters','user_mission_progress','user_gauge_completions','user_milestone_claims'] loop
  execute format('create trigger account_deletion_write_guard before insert or update or delete on public.%I for each statement execute function public.guard_deleted_account()',name);
  execute format('create trigger account_deletion_reference_guard before insert or update on public.%I for each row execute function public.guard_deleted_account()',name);
 end loop;
end $$;
revoke all on function public.mark_player_progress(uuid,text,text,timestamptz),public.capture_collection_progress(),public.capture_regular_pack_progress(),
 public.capture_card_destruction_progress(),public.capture_game_progress(),public.record_friend_visit(text) from public,anon,authenticated,service_role;
grant execute on function public.record_friend_visit(text) to authenticated;

-- Ownership transfers discover cards too, without replaying every card in the collection.
create function public.capture_transferred_card_progress()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.user_id=old.user_id then return new; end if;
 insert into public.user_seen_cards(user_id,card_id) values(new.user_id,new.card_id) on conflict do nothing;
 if found then perform public.advance_player_progress(new.user_id,'new_cards',1); end if;
 perform public.apply_owned_card_deltas(old.user_id,jsonb_build_object(old.card_id::text,-1));
 perform public.apply_owned_card_deltas(new.user_id,jsonb_build_object(new.card_id::text,1));
 if new.rarity in('SR','SSR','LR') then perform public.advance_player_progress(new.user_id,'sr_acquired',1); end if;
 if new.rarity in('SSR','LR') then perform public.advance_player_progress(new.user_id,'ssr_acquired',1); end if;
 if new.rarity='LR' then perform public.advance_player_progress(new.user_id,'lr_acquired',1); end if;
 if exists(select 1 from public.wishlists where user_id=new.user_id and card_id=new.card_id) then perform public.mark_player_progress(new.user_id,'wish_granted',new.card_id::text); end if;
 return new;
end;
$$;
revoke all on function public.capture_transferred_card_progress() from public,anon,authenticated,service_role;
create trigger transferred_card_progress after update of user_id on public.user_cards for each row execute function public.capture_transferred_card_progress();


create function public.capture_personalization_progress()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.custom_image_url is not null and new.custom_image_url is distinct from old.custom_image_url and public.billing_has_game_pro(new.user_id) then
  perform public.mark_player_progress(new.user_id,'custom_images',new.card_id::text);
 end if;
 return new;
end;
$$;
revoke all on function public.capture_personalization_progress() from public,anon,authenticated,service_role;
create trigger personalized_card_progress after update of custom_image_url on public.user_cards for each row execute function public.capture_personalization_progress();


create function public.capture_removed_card_stock()
returns trigger language plpgsql security definer set search_path='' as $$
declare card record;
begin
 for card in select user_id,jsonb_object_agg(card_id,-n) deltas from(select user_id,card_id,count(*) n from removed_stock_cards group by user_id,card_id) cards group by user_id order by user_id loop
  perform public.apply_owned_card_deltas(card.user_id,card.deltas);
 end loop;
 return null;
end;
$$;
revoke all on function public.capture_removed_card_stock() from public,anon,authenticated,service_role;
create trigger user_cards_removed_stock after delete on public.user_cards referencing old table as removed_stock_cards for each statement execute function public.capture_removed_card_stock();


create function public.capture_pro_referral_progress()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent uuid;
begin
 if not public.billing_has_game_pro(new.user_id) then return new; end if;
 for parent in select referrer_id from public.referrals where referred_id=new.user_id and verified_at is not null loop
  perform public.mark_player_progress(parent,'pro_referrals',new.user_id::text);
 end loop;
 return new;
end;
$$;
revoke all on function public.capture_pro_referral_progress() from public,anon,authenticated,service_role;
create trigger billing_pro_referral_progress after insert or update on public.billing_accounts for each row execute function public.capture_pro_referral_progress();
create trigger manual_pro_referral_progress after insert or update on public.pro_access_grants for each row execute function public.capture_pro_referral_progress();

notify pgrst,'reload schema';
commit;
