begin;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists updated_at timestamptz;
create table if not exists auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid);
do $$
declare
 admin uuid:='30000000-0000-4000-8000-000000000001';
 banned uuid:='30000000-0000-4000-8000-000000000003';
 temporary uuid:='30000000-0000-4000-8000-000000000004';
 player uuid:='30000000-0000-4000-8000-000000000005';
 buyer uuid:='30000000-0000-4000-8000-000000000006';
 lr uuid; ssr uuid; sr uuid; copy uuid; ssr_copy uuid; sale uuid; unsold uuid; before_count bigint; stamp timestamptz;
 day date:='2099-01-10'; opens timestamptz; closes timestamptz;
 bid_definition text; detail_definition text; feed_definition text;
 reminder_definition text; activity_definition text; event_notice_count integer;
 protected_copy uuid; hold_case uuid; pending_trade uuid;
 stale_trade uuid; unrelated_trade uuid; stale_sale uuid;
 recovery_command text; slot record; runs_at_slot boolean;
 winner_avatar text:='https://api.yokkai-collec.com/storage/v1/object/public/avatars/'||player||'/avatar.png';
begin
 assert not (select enabled from public.black_market_config), 'Must install disabled';
 insert into auth.users(id,raw_user_meta_data) values
 (admin,'{"pseudo":"BlackMarketAdmin"}'),
 (banned,'{"pseudo":"BlackMarketBanned"}'),(temporary,'{"pseudo":"BlackMarketTemporary"}'),
 (player,'{"pseudo":"BlackMarketPlayer"}'),(buyer,'{"pseudo":"BlackMarketBuyer"}');
 insert into public.admin_users(user_id) values(admin);
 perform set_config('request.jwt.claim.sub',admin::text,true);
 assert public.admin_get_black_market_stock()->>'idleStatus'='upcoming', 'Idle status is not upcoming by default';
 assert public.get_black_market_event()->>'idleStatus'='upcoming', 'Default status missing from the feed';
 perform public.admin_set_black_market_idle_status('closed');
 assert public.admin_get_black_market_stock()->>'idleStatus'='closed', 'Closed status was not saved';
 assert public.get_black_market_event()->>'idleStatus'='closed', 'Closed status missing from the feed';
 assert public.get_black_market_event()->'auctions'='[]'::jsonb, 'Idle feed exposed auctions';
 assert not (select enabled from public.black_market_config), 'Idle setting enabled recovery';
 begin perform public.admin_set_black_market_idle_status(null); raise exception 'Invalid status accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_INVALID_IDLE_STATUS',sqlerrm; end;
 perform set_config('request.jwt.claim.sub',player::text,true);
 begin perform public.admin_set_black_market_idle_status('upcoming'); raise exception 'Non-admin set idle status';
 exception when raise_exception then assert sqlerrm='ADMIN_REQUIRED',sqlerrm; end;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.admin_set_black_market_idle_status('upcoming');
 assert public.get_black_market_event()->>'idleStatus'='upcoming', 'Status could not be switched back';
 perform public.admin_configure_black_market(true);
 insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values
 ('bm-lr','Recovered LR','Anime','Test','LR','https://example.test/card.png','test') returning id into lr;
 insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values
 ('bm-ssr','Recovered SSR','Anime','Test','SSR','https://example.test/card.png','test') returning id into ssr;
 insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values
 ('bm-sr','Protected SR','Anime','Test','SR','https://example.test/card.png','test') returning id into sr;
 insert into public.user_cards(user_id,card_id,rarity,is_locked,is_shiny) values(banned,lr,'LR',true,true) returning id into copy;
 insert into public.user_cards(user_id,card_id,rarity) values(banned,lr,'LR') returning id into protected_copy;
 insert into public.friendships(user_id,friend_id,status) values(banned,player,'accepted'),(player,buyer,'accepted');
 perform set_config('request.jwt.claim.sub',banned::text,true);
 insert into public.trade_offers(from_user,to_user,offered_card_ids)
   values(banned,player,array[protected_copy]) returning id into pending_trade;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.anticheat_quarantines(subject_type,subject_id,status,sender_user_id,recipient_user_id,evidence_confidence,economic_severity,expires_at)
   values('trade',gen_random_uuid(),'AWAITING_REVIEW',banned,player,'CORROBORATED','MEDIUM',now()+interval '1 hour') returning id into hold_case;
 insert into public.anticheat_trade_card_holds(card_id,quarantine_id) values(protected_copy,hold_case);
 insert into public.user_cards(user_id,card_id,rarity) values(banned,ssr,'SSR') returning id into ssr_copy;
 insert into public.user_cards(user_id,card_id,rarity) values(banned,sr,'SR'),(temporary,lr,'LR'),(player,lr,'LR');
 perform public.admin_set_user_ban(banned,true);
 update auth.users set banned_until=clock_timestamp()+interval '30 days' where id=temporary;
 stamp:=(select banned_at from public.black_market_bans where user_id=banned);
 assert public.admin_get_black_market_recovery_queue()->>'total'='1', 'Temporary suspension appeared in the recovery queue';
 assert (public.admin_get_black_market_recovery_queue(2147483647)->'items') @>
   jsonb_build_array(jsonb_build_object('userId',banned,'eligibleAt',stamp+interval '14 days',
     'eligible',false,'pendingLR',2,'pendingSSR',1,'blockedCount',1)), 'Wrong pending recovery counts or eligibility date';
 -- Reproduce an old offer and auction left open after the account ban.
 perform set_config('request.jwt.claim.sub',player::text,true);
 insert into public.trade_offers(from_user,to_user,requested_card_ids)
   values(player,banned,array[ssr_copy]) returning id into stale_trade;
 insert into public.trade_offers(from_user,to_user,offered_karas)
   values(player,buyer,1) returning id into unrelated_trade;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 update public.user_profiles set karas_balance=1000 where user_id=buyer;
 perform public.debit_karas(buyer,120);
 insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at)
   values(copy,banned,buyer,100,120,30,clock_timestamp()+interval '30 minutes') returning id into stale_sale;
 insert into public.bids(auction_id,bidder_id,amount) values(stale_sale,buyer,120);
 update auth.users set updated_at=clock_timestamp() where id=banned;
 assert (select banned_at=stamp from public.black_market_bans where user_id=banned), 'Unrelated Auth write resets ban clock';
 perform public.recover_due_black_market_cards();
 assert (select user_id=banned from public.user_cards where id=copy), 'Recovered before 14 days';
 update public.black_market_bans set banned_at=clock_timestamp()-interval '14 days'+interval '1 minute' where user_id=banned;
 perform public.recover_due_black_market_cards();
 assert (select user_id=banned from public.user_cards where id=copy), 'Rounded up waiting period';
 assert (select status='active' from public.auctions where id=stale_sale), 'Auction cancelled before 14 days';
 assert (select status='pending' from public.trade_offers where id=stale_trade), 'Trade cancelled before 14 days';
 update public.black_market_bans set banned_at=clock_timestamp()-interval '14 days' where user_id=banned;
 perform public.admin_configure_black_market(false);
 perform public.recover_due_black_market_cards();
 assert (select user_id=banned from public.user_cards where id=copy), 'Disabled event moved assets';
 assert (select karas_balance=880 from public.user_profiles where user_id=buyer), 'Disabled event refunded escrow';
 perform public.admin_configure_black_market(true);
 select count(*) into before_count from public.user_cards;
 perform public.recover_due_black_market_cards();
 assert (select count(*)=2 from public.black_market_stock where source_user_id=banned and card_id is not null), 'SSR and LR not recovered into private stock';
 assert (select status='cancelled' from public.trade_offers where id=stale_trade), 'Pending trade did not release the recovered SSR';
 assert (select status='pending' from public.trade_offers where id=unrelated_trade), 'Unrelated pending trade was cancelled';
 assert (select status='expired' and buyer_id is null and current_price=starting_price and card_snapshot is not null
   from public.auctions where id=stale_sale), 'Stale auction was not closed with its history';
 assert exists(select 1 from public.bids where auction_id=stale_sale and bidder_id=buyer and amount=120), 'Historical bid was deleted';
 assert (select karas_balance=1000 from public.user_profiles where user_id=buyer), 'Bidder did not get the held Karas back';
 assert exists(select 1 from public.admin_audit_logs where action='black_market.recover' and metadata @>
   jsonb_build_object('cancelledAuctionIds',jsonb_build_array(stale_sale),
     'cancelledTradeIds',jsonb_build_array(stale_trade),'refundedKaras',120)), 'Recovery cancellations missing from audit';
 assert (select recovered_lr=1 and recovered_ssr=1 and checked_accounts=1 and deferred_accounts=1
   from public.black_market_recovery_runs order by id desc limit 1), 'Daily recovery counts are incorrect';
 assert (public.admin_get_black_market_recovery_queue()->'items') @>
   jsonb_build_array(jsonb_build_object('userId',banned,'eligible',true,'pendingLR',1,'pendingSSR',0,'blockedCount',1)),
   'The queue still includes recovered cards or misses a blocked card';
 assert (public.admin_get_black_market_recovery_queue(1,banned)->'items') @>
   jsonb_build_array(jsonb_build_object('id',protected_copy,'rarity','LR','reasons',jsonb_build_array('trade','investigation'))),
   'The pending trade or investigation hold is missing from the queue';
 delete from public.trade_offers where id=pending_trade;
 assert not exists(select 1 from public.user_cards where id=copy), 'Recovered copy still in a player inventory';
 assert (select is_shiny from public.black_market_stock where card_instance_id=copy), 'Variant lost in recovery';
 assert public.get_first_lr_copy_badges(array[copy]) =
   jsonb_build_array(jsonb_build_object('instanceId',copy,'source','mint')),
   'The first LR copy badge lookup stopped resolving the recovered instance';
 assert (select user_id=banned from public.user_cards where id=protected_copy), 'Investigation hold bypassed';
 assert (select count(*)=1 from public.user_cards where user_id=banned and rarity='SR'), 'Lower rarity confiscated';
 assert (select count(*)=1 from public.user_cards where user_id=temporary), 'Temporary suspension confiscated';
 assert (select count(*)=1 from public.user_cards where user_id=player), 'Unbanned account confiscated';
 assert (select count(*) from public.user_cards)+(select count(*) from public.black_market_stock where card_id is not null)=before_count, 'Recovery minted or destroyed copies';
 perform public.recover_due_black_market_cards();
 assert (select count(*)=2 from public.black_market_stock), 'Duplicate recovery';
 assert (select karas_balance=1000 from public.user_profiles where user_id=buyer), 'Bidder was refunded twice';
 delete from public.auctions where id=stale_sale;
 assert not has_table_privilege('authenticated','public.black_market_stock','select,insert,update,delete'), 'Private stock is exposed';
 begin insert into public.user_cards(id,user_id,card_id,rarity) values(copy,buyer,lr,'LR');
   raise exception 'An instance in stock could be duplicated in a player inventory';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_CARD_RESERVED',sqlerrm; end;
 select card_instance_id into ssr_copy from public.black_market_stock where rarity='SSR';
 begin perform public.admin_schedule_black_market_edition(current_date-1,array[copy]); raise exception 'Past date accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_INVALID_DAY',sqlerrm; end;
 insert into public.wishlists(user_id,card_id) values(buyer,lr);
 perform public.admin_schedule_black_market_edition(day-1,array[copy]);
 perform public.admin_schedule_black_market_edition(day,array[copy,ssr_copy]);
 assert (select starting_price=500 and current_price=500 from public.auctions
   where black_market_stock_id=ssr_copy and black_market_day=day),'Wrong default SSR opening price';
 perform public.admin_schedule_black_market_edition(day,array[ssr_copy,copy],array[700,1000]);
 begin perform public.admin_schedule_black_market_edition(day+1,array[ssr_copy,copy],array[700]); raise exception 'Mismatched price list accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_INVALID_STARTING_PRICE',sqlerrm; end;
 begin perform public.admin_schedule_black_market_edition(day+1,array[ssr_copy,copy],array[9,1000]); raise exception 'Starting price below minimum accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_INVALID_STARTING_PRICE',sqlerrm; end;
 begin perform public.admin_schedule_black_market_edition(day+1,array[ssr_copy,copy],array[null,1000]); raise exception 'Missing starting price accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_INVALID_STARTING_PRICE',sqlerrm; end;
 assert (select opening_day=day from public.black_market_editions),'Invalid prices changed edition';
 perform public.admin_schedule_black_market_edition(day,array[copy,ssr_copy]);
 assert public.admin_get_black_market_stock()->'items' @> jsonb_build_array(
   jsonb_build_object('instanceId',ssr_copy,'startingPrice',700,'firstLrCopy',null),
   jsonb_build_object('instanceId',copy,'startingPrice',1000,'firstLrCopy','mint')
 ),'Admin stock did not include the saved prices and first LR badge per copy';
 assert exists (select 1 from public.admin_audit_logs where action='black_market.open'
   and metadata->'startingPrices'->>ssr_copy::text='700'),'Saved starting price missing in the audit log';
 assert (select count(*)=1 from public.black_market_editions),'Rescheduling left a duplicate edition';
 assert jsonb_array_length(public.admin_get_black_market_stock()->'selectedIds')=2,'Admin could not reopen selection';
 assert jsonb_array_length(public.admin_get_black_market_stock()->'recoveryRuns')>0,'Admin recovery journal missing';
 assert (public.admin_get_black_market_stock()->'items') @>
   jsonb_build_array(jsonb_build_object(
     'instanceId',copy,'image','https://example.test/card.png','category','ANIME',
     'anime','Test','rarity','LR','shiny',true,'isEvolved',false
   )),'Admin stock does not include the original card art and variant';
 begin perform public.admin_schedule_black_market_edition(day+1,array[copy,protected_copy]); raise exception 'Invalid stock accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_CARD_UNAVAILABLE',sqlerrm; end;
 select starts_at,ends_at into strict opens,closes from public.black_market_editions where opening_day=day;
 assert opens='2099-01-10 11:00:00+00' and closes='2099-01-10 23:00:00+00', 'Not noon to midnight in Paris';
 assert not exists(select 1 from public.notifications where user_id=buyer and type='wishlist_card_on_auction'),'Wishlist revealed reserved lot';
 select id into strict sale from public.auctions where black_market_stock_id=copy and black_market_day=day;
 select id into strict unsold from public.auctions where black_market_stock_id=ssr_copy and black_market_day=day;
 assert (select seller_id is null and card_instance_id is null from public.auctions where id=sale), 'A scheduled card has a player owner';
 assert (select starting_price=1000 and current_price=1000 and duration_minutes=720 from public.auctions where id=sale),'Wrong LR opening price';
 assert (select starting_price=700 and current_price=700 and duration_minutes=720 from public.auctions where id=unsold),'Wrong custom SSR opening price';
 perform set_config('request.jwt.claim.sub',buyer::text,true);
 assert public.get_black_market_event()->'auctions'='[]'::jsonb,'Upcoming lots exposed';
 assert jsonb_array_length(public.get_black_market_event()->'upcomingCards')=2,'Missing upcoming cards';
 assert (public.get_black_market_event()->'upcomingCards') @> jsonb_build_array(jsonb_build_object('id',lr,'rarity','LR')),'Missing selected LR preview';
 assert (public.get_black_market_event()->'upcomingCards') @> '[{"rarity":"SSR"}]'::jsonb,'Missing selected SSR preview';
 assert (public.get_black_market_event()->'upcomingCards') @> jsonb_build_array(
   jsonb_build_object('id',lr,'firstLrCopy','mint','shiny',true,'isEvolved',false)
 ),'The announced card lost its first LR copy badge';
 assert not exists (
   select 1 from jsonb_array_elements(public.get_black_market_event()->'upcomingCards') as preview(card)
   cross join lateral jsonb_object_keys(preview.card) as field(key)
   where field.key not in ('id','name','category','anime','image','rarity')
     and (field.key in ('firstLrCopy','shiny','isEvolved') and preview.card->>'rarity'='LR'
       and preview.card->>'firstLrCopy' in ('legacy','mint')) is not true
 ),'Upcoming cards exposed auction or ownership fields';
 assert (public.get_black_market_event()->>'startsAt')::timestamptz=opens,'Opening countdown missing';
 begin perform public.set_black_market_reminder(sr,true); raise exception 'Unscheduled reminder accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_CARD_UNAVAILABLE',sqlerrm; end;
 perform public.set_black_market_reminder(lr,true);
 perform public.set_black_market_reminder(lr,false);
 assert public.get_black_market_activity()->'reminderCardIds'='[]'::jsonb,'Unsubscribe failed';
 perform public.set_black_market_reminder(lr,true);
 perform public.set_black_market_reminder(lr,true);
 assert public.get_black_market_activity()->'reminderCardIds'=jsonb_build_array(lr),'Reminder was not deduplicated';
 perform set_config('request.jwt.claim.sub',player::text,true);
 assert public.get_black_market_activity()->'reminderCardIds'='[]'::jsonb,'Another player can see the reminder';
 perform set_config('request.jwt.claim.sub',buyer::text,true);
 perform public.send_black_market_reminders();
 assert not exists(select 1 from public.notifications where type='black_market_card_open'),'Early reminder sent';
 begin perform public.get_auction(sale); raise exception 'Early detail was visible';
 exception when raise_exception then assert sqlerrm='AUCTION_NOT_FOUND',sqlerrm; end;
 begin perform public.place_bid(sale,1000); raise exception 'Early offer accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_NOT_OPEN',sqlerrm; end;
 begin perform public.admin_schedule_black_market_edition(day+1,array[copy]); raise exception 'Non-admin scheduled';
 exception when raise_exception then assert sqlerrm='ADMIN_REQUIRED',sqlerrm; end;
 begin perform public.admin_get_black_market_stock(); raise exception 'Non-admin read stock';
 exception when raise_exception then assert sqlerrm='ADMIN_REQUIRED',sqlerrm; end;
 begin perform public.admin_get_black_market_recovery_queue(1,banned); raise exception 'Non-admin read recovery queue';
 exception when raise_exception then assert sqlerrm='ADMIN_REQUIRED',sqlerrm; end;
 detail_definition:=pg_get_functiondef('public.get_auction(uuid)'::regprocedure);
 feed_definition:=pg_get_functiondef('public.get_black_market_event()'::regprocedure);
 reminder_definition:=pg_get_functiondef('public.send_black_market_reminders()'::regprocedure);
 activity_definition:=pg_get_functiondef('public.get_black_market_activity()'::regprocedure);
 bid_definition:=pg_get_functiondef('public.place_bid(uuid,integer)'::regprocedure);
 execute replace(detail_definition,'statement_timestamp()',quote_literal(opens)||'::timestamptz');
 execute replace(feed_definition,'statement_timestamp()',quote_literal(opens)||'::timestamptz');
 execute replace(bid_definition,'clock_timestamp()',quote_literal(closes-interval '3 minutes 1 second')||'::timestamptz');
 execute replace(reminder_definition,'statement_timestamp()',quote_literal(opens)||'::timestamptz');
 perform public.send_black_market_reminders();
 perform public.send_black_market_reminders();
 select count(*) into event_notice_count from public.notifications
   where user_id=buyer and type='black_market_card_open' and reference_id=sale;
 assert event_notice_count=1,'Opening reminder is missing, duplicated or linked to the wrong lot';
 assert public.list_notifications(30) @> jsonb_build_array(
   jsonb_build_object('type','black_market_card_open','referenceId',sale,'cardName','RECOVERED LR')
 ),'Opening notification did not resolve the card and auction';
 assert public.get_black_market_activity()->'reminderCardIds'='[]'::jsonb,'Delivered reminder was not consumed';
 assert public.get_black_market_event()->'auctions'->0->>'isBlackMarket'='true','Missing event identity';
 assert jsonb_array_length(public.get_black_market_event()->'auctions')=2,'Wrong event lots';
 assert (public.get_black_market_event()->'auctions') @>
   jsonb_build_array(jsonb_build_object('id',sale,'card',jsonb_build_object('firstLrCopy','mint','shiny',true))),
   'The live Black Market lost the first LR copy badge';
 assert public.get_auction(sale)->'card'->>'firstLrCopy'='mint','Auction detail lost the first LR copy badge';
 assert public.get_black_market_event()->'upcomingCards'='[]'::jsonb,'Preview still present after opening';
 assert public.get_black_market_event()->'auctions'->0 ? 'popularity','Popularity sorting data missing';
 assert public.get_black_market_event()->'auctions'->0->>'ownedCount'='0','Ownership badge data missing';
 assert public.list_auctions()='[]'::jsonb,'Event in legacy market';
 assert public.browse_auctions_page()->'items'='[]'::jsonb,'Event in general market';
 assert public.list_auctions_page()->'items'='[]'::jsonb,'Event in paged market';
 begin perform public.admin_configure_black_market(true); raise exception 'Non-admin configured';
 exception when raise_exception then assert sqlerrm='ADMIN_REQUIRED',sqlerrm; end;
 begin perform public.admin_schedule_black_market_edition(day+1,array[ssr_copy],array[700]); raise exception 'Non-admin scheduled custom prices';
 exception when raise_exception then assert sqlerrm='ADMIN_REQUIRED',sqlerrm; end;
 update public.user_profiles set karas_balance=5000 where user_id in(player,buyer,admin);
 assert public.get_auction(sale)->>'bidIncrement'='1000','LR step missing';
 assert public.get_auction(unsold)->>'startingPrice'='700','Custom opening price missing';
 assert public.get_auction(unsold)->>'bidIncrement'='500','SSR step missing';
 assert public.get_auction(sale)->>'lateBidIncrement'='2000','Initial late LR step missing';
 begin perform public.place_bid(sale,999); raise exception 'Underpriced first bid accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_BID_TOO_LOW',sqlerrm; end;
 perform public.place_bid(sale,1000);
 begin perform public.place_bid(sale,1999); raise exception 'LR raise below 1000 accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_BID_TOO_LOW',sqlerrm; end;
 perform public.place_bid(sale,2000);
 assert (select ends_at=closes from public.auctions where id=sale),'Bid before final three minutes extended the lot';
 execute replace(bid_definition,'clock_timestamp()',quote_literal(closes-interval '3 minutes')||'::timestamptz');
 begin perform public.place_bid(unsold,699); raise exception 'Bid below custom opening price accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_BID_TOO_LOW',sqlerrm; end;
 perform public.place_bid(unsold,700);
 assert (select ends_at=closes+interval '1 minute' from public.auctions where id=unsold),'Late first bid at the opening price did not extend the lot';
 assert public.get_auction(unsold)->>'lateBidIncrement'='1000','Opening bid consumed the first SSR late raise';
 begin perform public.place_bid(unsold,1199); raise exception 'SSR raise below 500 accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_BID_TOO_LOW',sqlerrm; end;
 perform public.place_bid(unsold,1200);
 assert (select ends_at=closes+interval '1 minute' from public.auctions where id=unsold),'Once more than three minutes remain, the regular bid does not extend the lot';
 execute replace(bid_definition,'clock_timestamp()',quote_literal(closes-interval '2 minutes')||'::timestamptz');
 begin perform public.place_bid(unsold,2199); raise exception 'Late SSR raise below 1000 accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_BID_TOO_LOW',sqlerrm; end;
 perform public.place_bid(unsold,2200);
 assert (select ends_at=closes+interval '2 minutes' from public.auctions where id=unsold),'Late SSR raise did not extend the lot';
 perform public.place_bid(unsold,2700);
 assert public.get_auction(unsold)->>'lateBidIncrement'='1500','Regular bid changed the next late SSR increment';
 assert (select ends_at=closes+interval '2 minutes' from public.auctions where id=unsold),'Regular SSR raise extended the lot';
 update public.auctions set buyer_id=null,current_price=starting_price,ends_at=closes where id=unsold;
 perform public.credit_karas(buyer,2700);
 perform set_config('request.jwt.claim.sub',player::text,true);
 begin perform public.place_bid(sale,3999); raise exception 'Late LR raise below 2000 accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_BID_TOO_LOW',sqlerrm; end;
 perform public.place_bid(sale,4000);
 assert (select ends_at=closes+interval '1 minute' from public.auctions where id=sale),'Late LR raise did not extend the lot';
 assert (select ends_at=closes from public.auctions where id=unsold),'Late LR raise extended another lot';
 assert (select karas_balance=5000 from public.user_profiles where user_id=buyer),'Outbid refund failed';
 execute replace(bid_definition,'clock_timestamp()',quote_literal(closes)||'::timestamptz');
 execute replace(feed_definition,'statement_timestamp()',quote_literal(closes)||'::timestamptz');
 execute replace(activity_definition,'statement_timestamp()',quote_literal(closes)||'::timestamptz');
 assert (public.get_black_market_event()->>'endsAt')::timestamptz=closes+interval '1 minute','Live edition did not show the latest deadline';
 assert jsonb_array_length(public.get_black_market_event()->'auctions')=1,'After midnight only the extended lot is open';
 assert public.get_black_market_activity()->'lastEdition'->>'openingDay' is distinct from day::text,'Extended edition moved to results early';
 begin perform public.place_bid(unsold,500); raise exception 'Bid on unextended lot at midnight accepted';
 exception when raise_exception then assert sqlerrm='AUCTION_CLOSED',sqlerrm; end;
 begin perform public.place_bid(sale,6999); raise exception 'Second late LR raise below 3000 accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_BID_TOO_LOW',sqlerrm; end;
 begin perform public.place_bid(sale,7000); raise exception 'Unaffordable late raise accepted';
 exception when raise_exception then assert sqlerrm='INSUFFICIENT_KARAS',sqlerrm; end;
 assert public.get_auction(sale)->>'lateBidIncrement'='3000','Rejected offers advanced the late LR increment';
 update public.user_profiles set karas_balance=8000 where user_id=player;
 perform public.place_bid(sale,7000);
 assert (select ends_at=closes+interval '2 minutes' from public.auctions where id=sale),'Valid bid after midnight did not extend the lot';
 assert public.get_auction(sale)->>'lateBidIncrement'='4000','Third late LR increment did not advance to 4000';
 begin perform public.place_bid(sale,10999); raise exception 'Third late LR raise below 4000 accepted';
 exception when raise_exception then assert sqlerrm='BLACK_MARKET_BID_TOO_LOW',sqlerrm; end;
 perform public.place_bid(sale,11000);
 assert public.get_auction(sale)->>'lateBidIncrement'='5000','Fourth late LR increment did not advance to 5000';
 closes:=closes+interval '3 minutes';
 execute replace(bid_definition,'clock_timestamp()',quote_literal(closes)||'::timestamptz');
 execute replace(feed_definition,'statement_timestamp()',quote_literal(closes)||'::timestamptz');
 begin perform public.place_bid(sale,16000); raise exception 'Bid at extended deadline accepted';
 exception when raise_exception then assert sqlerrm='AUCTION_CLOSED',sqlerrm; end;
 assert public.get_black_market_event()->'auctions'='[]'::jsonb,'Closed lots still available';
 assert public.get_black_market_event()->'upcomingCards'='[]'::jsonb,'Expired selection was still visible';
 execute replace(pg_get_functiondef('public.settle_expired_auctions()'::regprocedure),'clock_timestamp()',quote_literal(closes)||'::timestamptz');
 perform public.settle_expired_auctions();
 assert (select status='sold' from public.auctions where id=sale),'Lot not sold';
 assert (select user_id=player from public.user_cards where id=copy),'Original instance not awarded';
 assert (select is_shiny from public.user_cards where id=copy),'Winner lost shiny variant';
 assert public.get_first_lr_copy_badges(array[copy]) =
   jsonb_build_array(jsonb_build_object('instanceId',copy,'source','mint')),
   'The winner collection could not resolve the awarded first LR copy badge';
 assert (select count(*) from public.user_cards)+(select count(*) from public.black_market_stock where card_id is not null)=before_count,'Settlement minted copies';
 assert (select card_id is null from public.black_market_stock where card_instance_id=copy),'Sold instance is still available in admin stock';
 assert (select karas_balance=5000 from public.user_profiles where user_id=admin),'System sale credited a player';
 assert (select karas_balance=1000 from public.user_profiles where user_id=player),'Buyer escrow incorrect';
 assert (select status='expired' from public.auctions where id=unsold),'Unsold lot did not expire';
 perform public.billing_set_manual_pro_access(player,true,'Black Market avatar test',null,admin);
 update public.user_profiles set avatar_url=winner_avatar where user_id=player;
 insert into public.profile_customizations(user_id,style) values(player,'{"avatarFrame":"crystal"}');
 execute replace(activity_definition,'statement_timestamp()',quote_literal(closes)||'::timestamptz');
 assert (public.get_black_market_activity()->'lastEdition'->>'endsAt')::timestamptz=closes,
   'Archive lost the actual end of the edition';
 assert jsonb_array_length(public.get_black_market_activity()->'lastEdition'->'lots')=1,
   'Unsold card appeared in the archive after a bid';
 assert (public.get_black_market_activity()->'lastEdition'->'lots') @>
   jsonb_build_array(jsonb_build_object('id',sale,'amount',11000,'sold',true,'bidStatus','won',
     'card',jsonb_build_object('firstLrCopy','mint'),
     'winnerName',(select pseudo from public.user_profiles where user_id=player))),
   'Winner did not see their name, final price, winning status and first LR copy badge';
 perform set_config('request.jwt.claim.sub',buyer::text,true);
 assert (public.get_black_market_activity()->'lastEdition'->'lots') @>
   jsonb_build_array(jsonb_build_object('id',sale,'amount',11000,'sold',true,'bidStatus',null,
     'winnerName',(select pseudo from public.user_profiles where user_id=player),
     'winnerAvatarUrl',winner_avatar,'winnerAvatarFrame','crystal')),
   'An outbid player should see only the public sale result';
 perform public.billing_set_manual_pro_access(player,false);
 assert (public.get_black_market_activity()->'lastEdition'->'lots') @>
   jsonb_build_array(jsonb_build_object('id',sale,'winnerAvatarUrl',winner_avatar,
     'winnerAvatarFrame',null)), 'A deactivated Pro account still exposes its avatar frame';
 perform set_config('request.jwt.claim.sub',admin::text,true);
 assert (public.get_black_market_activity()->'lastEdition'->'lots') @>
   jsonb_build_array(jsonb_build_object('id',sale,'amount',11000,'sold',true,'bidStatus',null)),
   'Public results leaked another player’s bid status';
 perform set_config('request.jwt.claim.sub',player::text,true);
 assert (select card_id=ssr from public.black_market_stock where card_instance_id=ssr_copy),'Unsold copy lost';
 perform public.settle_expired_auctions();
 assert (select karas_balance=1000 from public.user_profiles where user_id=player),'Settlement repeated';
 delete from public.user_cards where id=copy;
 assert (select status='sold' and card_instance_id is null from public.auctions where id=sale),'Winner cannot dispose of a settled card';
 assert public.get_auction(sale)->>'isBlackMarket'='true','Settled event history lost';
 perform set_config('request.jwt.claim.sub',admin::text,true);
 delete from public.anticheat_trade_card_holds where card_id=protected_copy;
 perform public.recover_due_black_market_cards();
 assert (select card_id=lr from public.black_market_stock where card_instance_id=protected_copy), 'Released hold was not retried';
 assert public.admin_get_black_market_recovery_queue()->>'total'='0', 'Recovered account remains in the queue';
 perform public.admin_set_user_ban(banned,false);
 assert not exists(select 1 from public.black_market_bans where user_id=banned),'Unban did not clear clock';
 perform public.admin_set_user_ban(banned,true);
 assert (select banned_at>stamp from public.black_market_bans where user_id=banned),'Reban did not reset clock';
 assert not has_function_privilege('authenticated','public.recover_due_black_market_cards()','execute'),'Player can run worker';
 assert not has_function_privilege('service_role','public.recover_black_market_cards(uuid,uuid)','execute'),'Recovery helper exposed';
 assert not has_table_privilege('authenticated','public.black_market_bans','select'),'Private ban data exposed';
 select command into strict recovery_command from cron.job
 where jobname='black-market-recovery' and schedule='0 18,19 * * *' and active;
 for slot in select * from (values
   ('2026-03-28 18:00:00+00'::timestamptz,false), ('2026-03-28 19:00:00+00'::timestamptz,true),
   ('2026-03-29 18:00:00+00'::timestamptz,true), ('2026-03-29 19:00:00+00'::timestamptz,false),
   ('2026-10-24 18:00:00+00'::timestamptz,true), ('2026-10-24 19:00:00+00'::timestamptz,false),
   ('2026-10-25 18:00:00+00'::timestamptz,false), ('2026-10-25 19:00:00+00'::timestamptz,true)
 ) slots(utc_time, should_run) loop
   execute replace(replace(recovery_command,'public.recover_due_black_market_cards()','true'),
     'statement_timestamp()',quote_literal(slot.utc_time)||'::timestamptz') into runs_at_slot;
   assert coalesce(runs_at_slot,false)=slot.should_run,'Recovery did not run only at 20:00 Paris time';
 end loop;
end $$;
rollback;
