begin;
set local lock_timeout='3s';
alter table public.achievements add column family_key text,add column section text not null default 'collection',
 add column secret boolean not null default false,add column pro_required boolean not null default false;
insert into public.achievements(id,titre,description,condition_type,condition_value,condition_categorie,karas_reward,family_key,section,secret,pro_required) values
('collection-en-marche','Collector','Own {target, number} different cards.','unique_cards_collected',25,null,30,'collector','collection',false,false),
('collector-50','Collector','Own {target, number} different cards.','catalog_unique_cards_collected',50,null,50,'collector','collection',false,false),
('collector-250','Collector','Own {target, number} different cards.','catalog_unique_cards_collected',250,null,100,'collector','collection',false,false),
('collector-1000','Collector','Own {target, number} different cards.','catalog_unique_cards_collected',1000,null,250,'collector','collection',false,false),
('collector-5000','Collector','Own {target, number} different cards.','catalog_unique_cards_collected',5000,null,750,'collector','collection',false,false),
('collector-10000','Collector','Own {target, number} different cards.','catalog_unique_cards_collected',10000,null,1000,'collector','collection',false,false),
('collector-25000','Collector','Own {target, number} different cards.','catalog_unique_cards_collected',25000,null,2500,'collector','collection',false,false),
('collector-50000','Collector','Own {target, number} different cards.','catalog_unique_cards_collected',50000,null,5000,'collector','collection',false,false),
('specialiste','Completionist','Complete {target, number}% of a category.','cards_collected_category_percent',50,null,750,'completionist','collection',false,false),
('explorer-3','Explorer','Collect cards from {target, number} categories.','catalog_categories_owned',3,null,25,'explorer','collection',false,false),
('explorer-6','Explorer','Collect cards from {target, number} categories.','catalog_categories_owned',6,null,50,'explorer','collection',false,false),
('explorer-999','Explorer','Collect cards from {target, number} categories.','catalog_categories_owned',999,null,150,'explorer','collection',false,false),
('first-sr-1','First SR','Obtain your first SR or better.','catalog_first_sr',1,null,10,'first-sr','collection',false,false),
('first-ssr-1','First SSR','Obtain your first SSR or better.','catalog_first_ssr',1,null,50,'first-ssr','collection',false,false),
('legende-naissante','Legend Pulled','Obtain {target, number} LR cards.','first_lr_card',1,null,75,'legend-pulled','collection',false,false),
('legend-pulled-5','Legend Pulled','Obtain {target, number} LR cards.','catalog_first_lr_card',5,null,250,'legend-pulled','collection',false,false),
('legend-pulled-25','Legend Pulled','Obtain {target, number} LR cards.','catalog_first_lr_card',25,null,1000,'legend-pulled','collection',false,false),
('legend-pulled-100','Legend Pulled','Obtain {target, number} LR cards.','catalog_first_lr_card',100,null,2500,'legend-pulled','collection',false,false),
('eclat-inattendu','Shiny Hunter','Draw {target, number} Shiny LR cards from packs.','catalog_shiny_drawn',1,null,2500,'shiny-hunter','collection',false,false),
('shiny-hunter-2','Shiny Hunter','Draw {target, number} Shiny LR cards from packs.','catalog_shiny_drawn',2,null,5000,'shiny-hunter','collection',false,false),
('transcendance','Evolution','Evolve SSR duplicates into Infinity {target, number} times.','ssr_evolved_to_lr',1,null,1000,'evolution','collection',false,false),
('evolution-2','Evolution','Evolve SSR duplicates into Infinity {target, number} times.','catalog_ssr_infinity',2,null,2000,'evolution','collection',false,false),
('evolution-3','Evolution','Evolve SSR duplicates into Infinity {target, number} times.','catalog_ssr_infinity',3,null,3000,'evolution','collection',false,false),
('rarity-master-5','Rarity Master','Own at least one card of every rarity, C through LR.','catalog_rarities_owned',5,null,100,'rarity-master','collection',false,false),
('fan-3','Fan','Own {target, number} copies of the same card.','catalog_max_copies',3,null,250,'fan','collection',false,false),
('fan-10','Fan','Own {target, number} copies of the same card.','catalog_max_copies',10,null,2500,'fan','collection',false,false),
('premier-rituel','Pack Opener','Open {target, number} Regular Packs.','regular_packs_opened',1,null,10,'pack-opener','packs',false,false),
('habitude-installe','Pack Opener','Open {target, number} Regular Packs.','regular_packs_opened',10,null,25,'pack-opener','packs',false,false),
('chasseur-yokkai','Pack Opener','Open {target, number} Regular Packs.','regular_packs_opened',50,null,75,'pack-opener','packs',false,false),
('pack-opener-100','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',100,null,50,'pack-opener','packs',false,false),
('pack-opener-200','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',200,null,50,'pack-opener','packs',false,false),
('pack-opener-300','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',300,null,50,'pack-opener','packs',false,false),
('pack-opener-400','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',400,null,50,'pack-opener','packs',false,false),
('pack-opener-500','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',500,null,50,'pack-opener','packs',false,false),
('pack-opener-600','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',600,null,50,'pack-opener','packs',false,false),
('pack-opener-700','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',700,null,50,'pack-opener','packs',false,false),
('pack-opener-800','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',800,null,50,'pack-opener','packs',false,false),
('pack-opener-900','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',900,null,50,'pack-opener','packs',false,false),
('pack-opener-1000','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',1000,null,500,'pack-opener','packs',false,false),
('pack-opener-5000','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',5000,null,1500,'pack-opener','packs',false,false),
('pack-opener-10000','Pack Opener','Open {target, number} Regular Packs.','catalog_regular_packs_opened',10000,null,2500,'pack-opener','packs',false,false),
('decision-decisive','Decisive','Complete {target, number} Decision Packs.','decision_packs_completed',1,null,20,'decisive','packs',false,false),
('decisive-7','Decisive','Complete {target, number} Decision Packs.','catalog_decision_packs_completed',7,null,50,'decisive','packs',false,false),
('decisive-30','Decisive','Complete {target, number} Decision Packs.','catalog_decision_packs_completed',30,null,200,'decisive','packs',false,false),
('decisive-100','Decisive','Complete {target, number} Decision Packs.','catalog_decision_packs_completed',100,null,500,'decisive','packs',false,false),
('decisive-365','Decisive','Complete {target, number} Decision Packs.','catalog_decision_packs_completed',365,null,2500,'decisive','packs',false,false),
('full-stack-1','Full Stack','Open a full batch of at least five Regular Packs {target, number} times.','catalog_full_stack',1,null,15,'full-stack','packs',false,false),
('full-stack-25','Full Stack','Open a full batch of at least five Regular Packs {target, number} times.','catalog_full_stack',25,null,150,'full-stack','packs',false,false),
('recycler-10','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',10,null,10,'recycler','economy',false,false),
('recycler-100','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',100,null,20,'recycler','economy',false,false),
('recycler-200','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',200,null,20,'recycler','economy',false,false),
('recycler-300','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',300,null,20,'recycler','economy',false,false),
('recycler-400','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',400,null,20,'recycler','economy',false,false),
('recycler-500','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',500,null,20,'recycler','economy',false,false),
('recycler-600','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',600,null,20,'recycler','economy',false,false),
('recycler-700','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',700,null,20,'recycler','economy',false,false),
('recycler-800','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',800,null,20,'recycler','economy',false,false),
('recycler-900','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',900,null,20,'recycler','economy',false,false),
('recycler-1000','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',1000,null,200,'recycler','economy',false,false),
('recycler-5000','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',5000,null,500,'recycler','economy',false,false),
('recycler-10000','Recycler','Destroy {target, number} cards.','catalog_cards_destroyed',10000,null,1000,'recycler','economy',false,false),
('karas-earner-1000','Karas Earner','Earn {target, number} Karas from rewards and completed sales.','catalog_karas_earned',1000,null,50,'karas-earner','economy',false,false),
('karas-earner-10000','Karas Earner','Earn {target, number} Karas from rewards and completed sales.','catalog_karas_earned',10000,null,500,'karas-earner','economy',false,false),
('karas-earner-100000','Karas Earner','Earn {target, number} Karas from rewards and completed sales.','catalog_karas_earned',100000,null,2500,'karas-earner','economy',false,false),
('wishful-1','Wishful','Add a card to your wishlist.','catalog_wishlist_added',1,null,5,'wishful','collection',false,false),
('wish-granted-1','Wish Granted','Obtain {target, number} different cards that were on your wishlist.','catalog_wish_granted',1,null,25,'wish-granted','collection',false,false),
('wish-granted-5','Wish Granted','Obtain {target, number} different cards that were on your wishlist.','catalog_wish_granted',5,null,75,'wish-granted','collection',false,false),
('wish-granted-10','Wish Granted','Obtain {target, number} different cards that were on your wishlist.','catalog_wish_granted',10,null,150,'wish-granted','collection',false,false),
('wish-granted-15','Wish Granted','Obtain {target, number} different cards that were on your wishlist.','catalog_wish_granted',15,null,200,'wish-granted','collection',false,false),
('wish-granted-20','Wish Granted','Obtain {target, number} different cards that were on your wishlist.','catalog_wish_granted',20,null,250,'wish-granted','collection',false,false),
('wish-granted-25','Wish Granted','Obtain {target, number} different cards that were on your wishlist.','catalog_wish_granted',25,null,300,'wish-granted','collection',false,false),
('wish-granted-30','Wish Granted','Obtain {target, number} different cards that were on your wishlist.','catalog_wish_granted',30,null,350,'wish-granted','collection',false,false),
('wish-granted-35','Wish Granted','Obtain {target, number} different cards that were on your wishlist.','catalog_wish_granted',35,null,400,'wish-granted','collection',false,false),
('wish-granted-40','Wish Granted','Obtain {target, number} different cards that were on your wishlist.','catalog_wish_granted',40,null,450,'wish-granted','collection',false,false),
('wish-granted-45','Wish Granted','Obtain {target, number} different cards that were on your wishlist.','catalog_wish_granted',45,null,500,'wish-granted','collection',false,false),
('wish-granted-50','Wish Granted','Obtain {target, number} different cards that were on your wishlist.','catalog_wish_granted',50,null,1000,'wish-granted','collection',false,false),
('first-sale-1','First Sale','Sell your first card at auction.','catalog_auctions_sold',1,null,50,'first-sale','market',false,false),
('merchant-10','Merchant','Sell {target, number} cards at auction.','catalog_auctions_sold',10,null,75,'merchant','market',false,false),
('merchant-50','Merchant','Sell {target, number} cards at auction.','catalog_auctions_sold',50,null,300,'merchant','market',false,false),
('merchant-200','Merchant','Sell {target, number} cards at auction.','catalog_auctions_sold',200,null,1500,'merchant','market',false,false),
('adjuge','Auction Winner','Win {target, number} auctions.','auctions_won',1,null,40,'auction-winner','market',false,false),
('auction-winner-10','Auction Winner','Win {target, number} auctions.','catalog_auctions_won',10,null,150,'auction-winner','market',false,false),
('auction-winner-50','Auction Winner','Win {target, number} auctions.','catalog_auctions_won',50,null,750,'auction-winner','market',false,false),
('sniper-1','Sniper','Win {target, number} auctions with a bid in the final minute.','catalog_sniper',1,null,50,'sniper','market',false,false),
('sniper-10','Sniper','Win {target, number} auctions with a bid in the final minute.','catalog_sniper',10,null,200,'sniper','market',false,false),
('friendly-1','Friendly','Have {target, number} friends.','catalog_friends_owned',1,null,10,'friendly','social',false,false),
('friendly-10','Friendly','Have {target, number} friends.','catalog_friends_owned',10,null,50,'friendly','social',false,false),
('friendly-25','Friendly','Have {target, number} friends.','catalog_friends_owned',25,null,150,'friendly','social',false,false),
('marche-conclu','Trader','Complete {target, number} trades.','trades_completed',1,null,30,'trader','social',false,false),
('trader-10','Trader','Complete {target, number} trades.','catalog_eligible_trades',10,null,150,'trader','social',false,false),
('trader-50','Trader','Complete {target, number} trades.','catalog_eligible_trades',50,null,750,'trader','social',false,false),
('negotiator-1','Negotiator','Have {target, number} counteroffers accepted with established friends.','catalog_counteroffers',1,null,25,'negotiator','social',false,false),
('negotiator-10','Negotiator','Have {target, number} counteroffers accepted with established friends.','catalog_counteroffers',10,null,100,'negotiator','social',false,false),
('generous-1','Generous','Give an SSR or better in a trade with an established friend.','catalog_generous',1,null,50,'generous','social',false,false),
('showcase-5','Showcase','Display five cards in your showcase.','catalog_showcase_size',5,null,50,'showcase','profile',false,false),
('identity-1','Identity','Set an avatar and write a bio.','catalog_identity',1,null,50,'identity','profile',false,false),
('daily-grinder-10','Daily Grinder','Complete {target, number} daily missions.','catalog_daily_missions',10,null,25,'daily-grinder','missions',false,false),
('daily-grinder-100','Daily Grinder','Complete {target, number} daily missions.','catalog_daily_missions',100,null,300,'daily-grinder','missions',false,false),
('daily-grinder-500','Daily Grinder','Complete {target, number} daily missions.','catalog_daily_missions',500,null,1500,'daily-grinder','missions',false,false),
('all-clear-7','All Clear','Fill your daily gauge {target, number} times.','catalog_daily_full',7,null,75,'all-clear','missions',false,false),
('all-clear-30','All Clear','Fill your daily gauge {target, number} times.','catalog_daily_full',30,null,300,'all-clear','missions',false,false),
('all-clear-100','All Clear','Fill your daily gauge {target, number} times.','catalog_daily_full',100,null,1000,'all-clear','missions',false,false),
('weekly-champion-1','Weekly Champion','Fill your weekly gauge {target, number} times.','catalog_weekly_full',1,null,50,'weekly-champion','missions',false,false),
('weekly-champion-10','Weekly Champion','Fill your weekly gauge {target, number} times.','catalog_weekly_full',10,null,500,'weekly-champion','missions',false,false),
('weekly-champion-52','Weekly Champion','Fill your weekly gauge {target, number} times.','catalog_weekly_full',52,null,2500,'weekly-champion','missions',false,false),
('perfect-week-1','Perfect Week','Fill both gauges during {target, number} different weeks.','catalog_perfect_weeks',1,null,50,'perfect-week','missions',false,false),
('perfect-week-10','Perfect Week','Fill both gauges during {target, number} different weeks.','catalog_perfect_weeks',10,null,300,'perfect-week','missions',false,false),
('perfect-week-52','Perfect Week','Fill both gauges during {target, number} different weeks.','catalog_perfect_weeks',52,null,1500,'perfect-week','missions',false,false),
('veteran-30','Veteran','Reach an account age of {target, number} days.','catalog_account_days',30,null,100,'veteran','profile',false,false),
('veteran-180','Veteran','Reach an account age of {target, number} days.','catalog_account_days',180,null,500,'veteran','profile',false,false),
('veteran-365','Veteran','Reach an account age of {target, number} days.','catalog_account_days',365,null,1000,'veteran','profile',false,false),
('recruiter-1','Recruiter','Refer {target, number} verified players with a three-day activity streak.','catalog_active_referrals',1,null,100,'recruiter','referral',false,false),
('recruiter-5','Recruiter','Refer {target, number} verified players with a three-day activity streak.','catalog_active_referrals',5,null,400,'recruiter','referral',false,false),
('recruiter-10','Recruiter','Refer {target, number} verified players with a three-day activity streak.','catalog_active_referrals',10,null,800,'recruiter','referral',false,false),
('recruiter-25','Recruiter','Refer {target, number} verified players with a three-day activity streak.','catalog_active_referrals',25,null,2000,'recruiter','referral',false,false),
('mentor-1','Mentor','Refer {target, number} verified players who open 50 packs.','catalog_mentored_referrals',1,null,150,'mentor','referral',false,false),
('mentor-5','Mentor','Refer {target, number} verified players who open 50 packs.','catalog_mentored_referrals',5,null,600,'mentor','referral',false,false),
('ambassador-1','Ambassador','Refer {target, number} players who become Pro.','catalog_pro_referrals',1,null,500,'ambassador','referral',false,false),
('ambassador-3','Ambassador','Refer {target, number} players who become Pro.','catalog_pro_referrals',3,null,1500,'ambassador','referral',false,false),
('welcome-aboard-1','Welcome Aboard','Join using a referral code.','catalog_referred',1,null,50,'welcome-aboard','referral',false,false),
('deja-vu-1','Deja Vu','Draw the same card twice in one Regular Pack.','catalog_deja_vu',1,null,1000,'deja-vu','secret',true,false),
('all-common-1','All Common','Draw five C cards in one Regular Pack.','catalog_all_common',1,null,10,'all-common','secret',true,false),
('rainbow-1','Rainbow','Draw C, R, SR, SSR and LR in one Regular Pack.','catalog_rainbow',1,null,5000,'rainbow','secret',true,false),
('same-family-1','Same Family','Draw five cards from the same category in one Regular Pack.','catalog_same_family',1,null,30,'same-family','secret',true,false),
('lucky-start-1','Lucky Start','Draw an LR in your first Regular Pack of the day.','catalog_lucky_start',1,null,1500,'lucky-start','secret',true,false),
('dry-spell-1','Dry Spell','Open ten consecutive Regular Packs without SR or better.','catalog_dry_spell',1,null,50,'dry-spell','secret',true,false),
('right-on-time-1','Right on Time','Open a Regular Pack in the first minute after the daily reset.','catalog_right_on_time',1,null,20,'right-on-time','secret',true,false),
('patience-1','Patience','Leave your timed Regular Pack reserve full for 24 hours.','catalog_patience',1,null,10,'patience','secret',true,false),
('comeback-1','Comeback','Return after 30 days away.','catalog_comeback',1,null,50,'comeback','secret',true,false),
('last-second-1','Last Second','Place a bid with fewer than five seconds remaining.','catalog_last_second',1,null,30,'last-second','secret',true,false),
('so-close-1','So Close','Lose an auction after bidding in its final five seconds.','catalog_so_close',1,null,25,'so-close','secret',true,false),
('mirror-1','Mirror','Trade a card for another copy of itself with an established friend.','catalog_mirror',1,null,20,'mirror','secret',true,false),
('regret-1','Regret','Destroy an SSR. A little consolation.','catalog_regret',1,null,50,'regret','secret',true,false),
('same-again-1','Same Again','Keep a Decision Pack card you already owned five times.','catalog_same_again',1,null,500,'same-again','secret',true,false),
('speed-opener-250','Speed Opener','Open {target, number} Regular Packs while Pro.','catalog_pro_packs',250,null,100,'speed-opener','pro',false,true),
('speed-opener-1000','Speed Opener','Open {target, number} Regular Packs while Pro.','catalog_pro_packs',1000,null,250,'speed-opener','pro',false,true),
('speed-opener-5000','Speed Opener','Open {target, number} Regular Packs while Pro.','catalog_pro_packs',5000,null,1000,'speed-opener','pro',false,true),
('double-decision-1','Double Decision','Complete two standard Decision Packs on {target, number} different days while Pro.','catalog_double_decision',1,null,25,'double-decision','pro',false,true),
('double-decision-7','Double Decision','Complete two standard Decision Packs on {target, number} different days while Pro.','catalog_double_decision',7,null,100,'double-decision','pro',false,true),
('double-decision-30','Double Decision','Complete two standard Decision Packs on {target, number} different days while Pro.','catalog_double_decision',30,null,300,'double-decision','pro',false,true),
('double-decision-100','Double Decision','Complete two standard Decision Packs on {target, number} different days while Pro.','catalog_double_decision',100,null,1000,'double-decision','pro',false,true),
('auction-house-1','Auction House','Have six active auctions on {target, number} different days while Pro.','catalog_auction_house',1,null,100,'auction-house','pro',false,true),
('auction-house-10','Auction House','Have six active auctions on {target, number} different days while Pro.','catalog_auction_house',10,null,400,'auction-house','pro',false,true),
('grand-gallery-10','Grand Gallery','Display ten cards in your showcase while Pro.','catalog_showcase_size',10,null,150,'grand-gallery','pro',false,true),
('curator-10','Curator','Display ten SSR or better cards in your showcase while Pro.','catalog_rare_showcase',10,null,300,'curator','pro',false,true),
('artist-1','Artist','Personalize the image of {target, number} different cards while Pro.','catalog_custom_images',1,null,50,'artist','pro',false,true),
('artist-10','Artist','Personalize the image of {target, number} different cards while Pro.','catalog_custom_images',10,null,200,'artist','pro',false,true),
('artist-50','Artist','Personalize the image of {target, number} different cards while Pro.','catalog_custom_images',50,null,600,'artist','pro',false,true),
('animated-1','Animated','Use an animated banner or avatar while Pro.','catalog_animated_profile',1,null,50,'animated','pro',false,true)
on conflict(id) do update set titre=excluded.titre,description=excluded.description,condition_type=excluded.condition_type,condition_value=excluded.condition_value,karas_reward=excluded.karas_reward,family_key=excluded.family_key,section=excluded.section,secret=excluded.secret,pro_required=excluded.pro_required;
-- The original Specialist replaces one category's 50% tier for each player,
-- rather than granting the same milestone twice. Retain its original id and claim.
create table public.user_legacy_specialist_categories(
 user_id uuid primary key references auth.users(id) on delete cascade,category text not null
);
alter table public.user_legacy_specialist_categories enable row level security;
revoke all on public.user_legacy_specialist_categories from public,anon,authenticated,service_role;
create trigger account_deletion_write_guard before insert or update or delete on public.user_legacy_specialist_categories for each statement execute function public.guard_deleted_account();
create trigger account_deletion_reference_guard before insert or update on public.user_legacy_specialist_categories for each row execute function public.guard_deleted_account();
-- One inventory aggregate serves all tiers; pack mutations retain their bounded
-- existing evaluator. Retroactive completion never credits a wallet by itself.
create function public.achievement_snapshot(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; inventory jsonb; profile public.user_profiles%rowtype; stat public.user_achievement_stats%rowtype; categories jsonb; stamp timestamptz:=clock_timestamp();
begin
 select * into profile from public.user_profiles where user_id=p_user;
 select * into stat from public.user_achievement_stats where user_id=p_user;
 select coalesce(jsonb_object_agg(metric,value),'{}'::jsonb) into result from public.user_progress_counters where user_id=p_user;
 with owned as materialized(select * from public.user_cards where user_id=p_user), copies as(select card_id,count(*) n from owned group by card_id)
 select jsonb_build_object('unique_cards_collected',(select count(*) from copies),'rarities_owned',count(distinct rarity),
 'max_copies',(select coalesce(max(n),0) from copies),'lr_owned',count(*) filter(where rarity='LR'),
 'sr_owned',count(*) filter(where rarity in('SR','SSR','LR')),'ssr_owned',count(*) filter(where rarity in('SSR','LR')),
 'sr_exact_owned',count(*) filter(where rarity='SR'),'ssr_exact_owned',count(*) filter(where rarity='SSR'),'infinity_owned',count(*) filter(where rarity='SSR' and is_evolved),'custom_images',count(distinct card_id) filter(where custom_image_url is not null),
 'rare_showcase',count(*) filter(where id=any(profile.featured_card_ids) and rarity in('SSR','LR')))
 into inventory from owned;
 with totals as(select categorie,count(*) total from public.cards where categorie is not null group by categorie),
 owned as(select c.categorie,count(distinct u.card_id) n from public.user_cards u join public.cards c on c.id=u.card_id where u.user_id=p_user group by c.categorie)
 select coalesce(jsonb_object_agg('category:'||t.categorie,floor(100.0*greatest(coalesce(o.n,0),coalesce((result->>('peak_category:'||t.categorie))::bigint,0))/t.total)),'{}'::jsonb)||jsonb_build_object(
 'categories_owned',count(*) filter(where coalesce(o.n,0)>0),'categories_total',count(*),'cards_collected_category_percent',coalesce(max(floor(100.0*greatest(coalesce(o.n,0),coalesce((result->>('peak_category:'||t.categorie))::bigint,0))/t.total)),0))
 into categories from totals t left join owned o using(categorie);
 result:=result||inventory||categories||jsonb_build_object(
 'regular_packs_opened',coalesce(stat.regular_packs_opened,0),'decision_packs_completed',coalesce(stat.decision_packs_completed,0),
 'auctions_won',coalesce(stat.auctions_won,0),'trades_completed',coalesce(stat.trades_completed,0),
 'first_lr_card',greatest(coalesce((result->>'lr_acquired')::bigint,0),(inventory->>'lr_owned')::bigint),
 'sr_acquired',greatest(coalesce((result->>'sr_acquired')::bigint,0),(inventory->>'sr_owned')::bigint),
 'ssr_acquired',greatest(coalesce((result->>'ssr_acquired')::bigint,0),(inventory->>'ssr_owned')::bigint),
 'ssr_evolved_to_lr',greatest(coalesce(stat.ssr_evolved_to_lr,0),(inventory->>'infinity_owned')::bigint),
 'unique_cards_collected',greatest((inventory->>'unique_cards_collected')::bigint,coalesce((result->>'peak_unique')::bigint,0)),
 'max_copies',greatest((inventory->>'max_copies')::bigint,coalesce((result->>'max_copies')::bigint,0)),
 'rarities_owned',greatest((inventory->>'rarities_owned')::bigint,coalesce((result->>'peak_rarities')::bigint,0)),
 'categories_owned',greatest((categories->>'categories_owned')::bigint,coalesce((result->>'peak_categories')::bigint,0)),
 'first_sr',greatest(coalesce((result->>'first_sr')::bigint,0),(inventory->>'sr_exact_owned')::bigint),
 'first_ssr',greatest(coalesce((result->>'first_ssr')::bigint,0),(inventory->>'ssr_exact_owned')::bigint),
 'ssr_infinity',greatest(coalesce((result->>'ssr_infinity')::bigint,0),(inventory->>'infinity_owned')::bigint),
 'rare_showcase',greatest((inventory->>'rare_showcase')::bigint,coalesce((result->>'pro_rare_showcase')::bigint,0)),
 'custom_images',greatest(coalesce((result->>'custom_images')::bigint,0),(inventory->>'custom_images')::bigint),
 'friends_owned',(select count(*) from public.friendships where status='accepted' and p_user in(user_id,friend_id)),
 'showcase_size',greatest(coalesce((result->>'showcase_size')::bigint,0),coalesce(cardinality(profile.featured_card_ids),0)),'identity',case when nullif(btrim(profile.bio),'') is not null and profile.avatar_url is not null then 1 else coalesce((result->>'identity')::integer,0) end,
 'account_days',greatest(0,coalesce(stamp::date-(select (to_jsonb(u)->>'created_at')::timestamptz::date from auth.users u where u.id=p_user),0)),
 'referred',case when exists(select 1 from public.referrals where referred_id=p_user) then 1 else 0 end,
 'mentored_referrals',(select count(*) from public.referrals r join public.user_achievement_stats s on s.user_id=r.referred_id where r.referrer_id=p_user and r.verified_at is not null and s.regular_packs_opened>=50),
 'pro_referrals',greatest(coalesce((result->>'pro_referrals')::bigint,0),(select count(*) from public.referrals r where r.referrer_id=p_user and r.verified_at is not null and public.billing_has_game_pro(r.referred_id))),
 'active_referrals',(select count(*) from public.referrals r where r.referrer_id=p_user and r.verified_at is not null and exists(
  select 1 from public.user_progress_marks a join public.user_progress_marks b on b.user_id=a.user_id and b.metric='activity_days' and b.mark=((a.recorded_at at time zone 'Europe/Paris')::date+1)::text
  join public.user_progress_marks c on c.user_id=a.user_id and c.metric='activity_days' and c.mark=((a.recorded_at at time zone 'Europe/Paris')::date+2)::text
  where a.user_id=r.referred_id and a.metric='activity_days')),
 'animated_profile',case when exists(select 1 from public.profile_media_assets where user_id=p_user and purpose in('avatar','banner') and animated and public_url in(profile.avatar_url,profile.banner_url)) then 1 else coalesce((result->>'pro_animated')::integer,0) end,
 'perfect_weeks',(select count(*) from public.user_gauge_completions w where w.user_id=p_user and w.period='weekly' and exists(select 1 from public.user_gauge_completions d where d.user_id=p_user and d.period='daily' and d.period_start>=w.period_start and d.period_start<public.mission_period_end(w.period_start,'weekly'))),
 'patience',case when profile.next_regular_pack_at<=stamp-interval '24 hours'-make_interval(secs=>profile.regular_pack_interval_seconds*(case when public.billing_has_game_pro(p_user) then 9 else 4 end)) then 1 else coalesce((result->>'patience')::integer,0) end);
 return result;
end;
$$;
create function public.catalogue_achievement_value(p_snapshot jsonb,p_condition text,p_category text default null)
returns bigint language sql immutable set search_path='' as $$
 select coalesce((p_snapshot->>case when replace(p_condition,'catalog_','')='cards_collected_category_percent' and p_category is not null then 'category:'||p_category else replace(p_condition,'catalog_','') end)::bigint,0)
$$;
-- Upgraded legacy rewards are prepared as player-claimed bonuses. No mass wallet
-- update occurs when this migration is applied; original claims remain intact.
create table public.achievement_upgrade_credits(
 user_id uuid not null references auth.users(id) on delete cascade,achievement_id text not null references public.achievements(id),
 reward integer not null check(reward>0),claimed_at timestamptz,primary key(user_id,achievement_id)
);
alter table public.achievement_upgrade_credits enable row level security;
revoke all on public.achievement_upgrade_credits from public,anon,authenticated,service_role;
insert into public.achievement_upgrade_credits(user_id,achievement_id,reward)
 select u.user_id,u.achievement_id,a.karas_reward from public.user_achievements u join public.achievements a on a.id=u.achievement_id
 where u.claimed_at is not null and u.achievement_id in('eclat-inattendu','specialiste','transcendance');
create or replace function public.get_achievement_catalogue()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player uuid:=auth.uid(); snapshot jsonb; result jsonb; pro boolean; stamp timestamptz:=clock_timestamp();
begin
 perform public.assert_player_not_banned();
 if player is null then raise exception 'AUTH_REQUIRED'; end if;
 perform 1 from public.user_profiles where user_id=player for update;
 if not found then raise exception 'PROFILE_MISSING'; end if;
 perform public.mark_player_progress(player,'activity_days',(stamp at time zone 'Europe/Paris')::date::text,stamp);
 insert into public.achievements(id,titre,description,condition_type,condition_value,condition_categorie,karas_reward,family_key,section)
 select 'completionist-'||md5(c.categorie)||'-'||tier.target,'Completionist','Complete a category.','catalog_cards_collected_category_percent',tier.target,c.categorie,tier.reward,'completionist','collection'
 from(select distinct categorie from public.cards where categorie is not null)c cross join(values(25,250),(50,750),(75,2000),(100,5000))tier(target,reward)
 on conflict(id) do nothing;
 snapshot:=public.achievement_snapshot(player); pro:=public.billing_has_game_pro(player);
 insert into public.user_legacy_specialist_categories(user_id,category)
 select player,substr(e.key,10) from jsonb_each(snapshot) e where e.key like 'category:%' and (e.value::text)::numeric>=50
 order by(e.value::text)::numeric desc,e.key limit 1 on conflict(user_id) do nothing;
 with completed as(
 insert into public.user_achievements(user_id,achievement_id,completed_at)
 select player,a.id,stamp from public.achievements a where(not a.pro_required or pro or coalesce((snapshot->>case a.family_key
  when 'speed-opener' then 'pro_packs' when 'double-decision' then 'double_decision' when 'auction-house' then 'auction_house'
  when 'grand-gallery' then 'pro_showcase' when 'curator' then 'pro_rare_showcase' when 'artist' then 'custom_images' when 'animated' then 'pro_animated' else '' end)::bigint,0)>=a.condition_value)
 and not(a.family_key='completionist' and a.condition_value=50 and a.condition_categorie is not null and exists(
  select 1 from public.user_legacy_specialist_categories l where l.user_id=player and l.category=a.condition_categorie))
 and public.catalogue_achievement_value(snapshot,a.condition_type,a.condition_categorie)>=case when a.family_key='explorer' and a.condition_value=999 then greatest(1,(snapshot->>'categories_total')::integer) else a.condition_value end
 and not exists(select 1 from public.user_achievements u where u.user_id=player and u.achievement_id=a.id and u.completed_at is not null)
 on conflict(user_id,achievement_id) do update set completed_at=excluded.completed_at where public.user_achievements.completed_at is null returning achievement_id
 ) insert into public.notifications(user_id,type,reference_id,achievement_id) select player,'achievement_completed',null,achievement_id from completed on conflict do nothing;
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',a.id,'family',case when a.secret and u.completed_at is null then 'secret' else a.family_key end,'section',a.section,'secret',a.secret,'proRequired',a.pro_required,
 'locked',a.pro_required and not pro and u.completed_at is null,
 'title',case when a.secret and u.completed_at is null then '???' else a.titre end,'description',case when a.secret and u.completed_at is null then '' else a.description end,
 'conditionType',case when a.secret and u.completed_at is null then 'secret' else a.condition_type end,
 'conditionValue',case when a.secret and u.completed_at is null then 1 when a.family_key='explorer' and a.condition_value=999 then greatest(1,(snapshot->>'categories_total')::integer) else a.condition_value end,
 'conditionCategory',case when a.secret and u.completed_at is null then null else coalesce(a.condition_categorie,case when a.id='specialiste' then legacy.category end) end,'karasReward',a.karas_reward,
 'progressCurrent',case when a.secret and u.completed_at is null then 0 when u.completed_at is not null then greatest(a.condition_value,public.catalogue_achievement_value(snapshot,a.condition_type,a.condition_categorie)) else public.catalogue_achievement_value(snapshot,a.condition_type,a.condition_categorie) end,
 'progressTarget',case when a.family_key='explorer' and a.condition_value=999 then greatest(1,(snapshot->>'categories_total')::integer) else a.condition_value end,
 'progressLabel',coalesce(a.condition_categorie,case when a.id='specialiste' then legacy.category end),'completedAt',u.completed_at,'claimedAt',u.claimed_at,'upgradeReward',case when b.claimed_at is null then coalesce(b.reward,0) else 0 end
 ) order by a.section,a.family_key,a.condition_categorie nulls first,a.condition_value),'[]'::jsonb) into result
 from public.achievements a left join public.user_achievements u on u.user_id=player and u.achievement_id=a.id
 left join public.achievement_upgrade_credits b on b.user_id=player and b.achievement_id=a.id
 left join public.user_legacy_specialist_categories legacy on legacy.user_id=player
 where (a.family_key<>'completionist' or a.condition_categorie is not null or u.completed_at is not null)
 and not(a.family_key='completionist' and a.condition_value=50 and a.condition_categorie is not null and coalesce(a.condition_categorie=legacy.category,false));
 return result;
end;
$$;
-- A bonus can only be claimed by its authenticated beneficiary, once. It uses
-- the same profile-first lock order as mission claims and game mutations.
create function public.claim_achievement_upgrade(p_achievement_id text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player uuid:=auth.uid(); bonus public.achievement_upgrade_credits%rowtype; balance integer; stamp timestamptz:=clock_timestamp();
begin
 perform public.assert_player_not_banned();
 if player is null then raise exception 'AUTH_REQUIRED'; end if;
 perform 1 from public.user_profiles where user_id=player for update;
 select * into bonus from public.achievement_upgrade_credits where user_id=player and achievement_id=p_achievement_id for update;
 if not found then raise exception 'ACHIEVEMENT_LOCKED'; end if;
 if bonus.claimed_at is not null then raise exception 'ACHIEVEMENT_ALREADY_CLAIMED'; end if;
 update public.achievement_upgrade_credits set claimed_at=stamp where user_id=player and achievement_id=p_achievement_id;
 balance:=public.credit_karas(player,bonus.reward);
 perform public.advance_player_progress(player,'karas_earned',bonus.reward,stamp);
 return jsonb_build_object('balance',balance,'reward',bonus.reward,'claimedAt',stamp);
end;
$$;
-- Recover only facts preserved by authoritative history. No pre-launch missions.
insert into public.user_progress_counters select p.original_owner_id,'lr_acquired',count(*) from public.regular_pack_opening_cards p join public.cards c on c.id=p.card_id
 where c.rarete_base='LR' and exists(select 1 from auth.users u where u.id=p.original_owner_id) group by p.original_owner_id
 on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
insert into public.user_progress_counters select u.user_id,'shiny_drawn',count(*) from public.user_cards u where u.rarity='LR' and u.is_shiny and not u.is_evolved
 and exists(select 1 from public.regular_pack_opening_cards p where p.card_instance_id=u.id and p.original_owner_id=u.user_id)
 group by u.user_id on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
insert into public.user_progress_counters select d.user_id,'shiny_drawn',count(*) from public.decision_packs d join public.decision_pack_choices c on c.id=d.kept_choice_id
 where d.status='claimed' and c.rarity='LR' and c.is_shiny group by d.user_id
 on conflict(user_id,metric) do update set value=public.user_progress_counters.value+excluded.value;
revoke all on function public.achievement_snapshot(uuid),public.catalogue_achievement_value(jsonb,text,text),public.claim_achievement_upgrade(text) from public,anon,authenticated,service_role;
grant execute on function public.claim_achievement_upgrade(text) to authenticated;
revoke all on function public.get_achievement_catalogue() from public,anon,authenticated,service_role;
grant execute on function public.get_achievement_catalogue() to authenticated;
create trigger account_deletion_write_guard before insert or update or delete on public.achievement_upgrade_credits for each statement execute function public.guard_deleted_account();

create or replace function public.claim_achievement(p_achievement_id text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); earned public.user_achievements%rowtype; reward integer; balance integer; claimed timestamptz:=clock_timestamp();
begin
 perform public.assert_player_not_banned();
 if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
 perform 1 from public.user_profiles where user_id=player_id for update;
 if not found then raise exception 'PROFILE_MISSING' using errcode='P0001'; end if;
 select * into earned from public.user_achievements where user_id=player_id and achievement_id=p_achievement_id for update;
 if not found or earned.completed_at is null then raise exception 'ACHIEVEMENT_LOCKED' using errcode='P0001'; end if;
 if earned.claimed_at is not null then raise exception 'ACHIEVEMENT_ALREADY_CLAIMED' using errcode='P0001'; end if;
 select karas_reward into reward from public.achievements where id=p_achievement_id;
 balance:=public.credit_karas(player_id,reward);
 update public.user_achievements set claimed_at=claimed where user_id=player_id and achievement_id=p_achievement_id;
 perform public.advance_player_progress(player_id,'karas_earned',reward,claimed);
 return jsonb_build_object('balance',balance,'claimedAt',claimed,'reward',reward);
end;
$$;
revoke all on function public.claim_achievement(text) from public,anon,service_role;
grant execute on function public.claim_achievement(text) to authenticated;

-- Retained regular contents prove these secrets even after a transfer/removal.
with packs as(
 select p.original_owner_id user_id,p.pack_opening_id,count(*) n,count(distinct p.card_id) distinct_cards,
 count(distinct c.categorie) categories,count(distinct c.rarete_base) rarities,bool_and(c.rarete_base='C') all_common
 from public.regular_pack_opening_cards p join public.cards c on c.id=p.card_id
 where exists(select 1 from auth.users u where u.id=p.original_owner_id) group by p.original_owner_id,p.pack_opening_id
), facts as(select user_id,v.metric from packs cross join lateral(values
 ('deja_vu',n=5 and distinct_cards<5),('same_family',n=5 and categories=1),('rainbow',n=5 and rarities=5),('all_common',n=5 and all_common))v(metric,earned) where v.earned)
insert into public.user_progress_counters select distinct user_id,metric,1 from facts
on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
insert into public.user_progress_marks(user_id,metric,mark,recorded_at)
 select opened_by,'activity_days',(opened_at at time zone 'Europe/Paris')::date::text,min(opened_at)
 from public.regular_pack_openings p where exists(select 1 from auth.users u where u.id=p.opened_by)
 group by opened_by,(opened_at at time zone 'Europe/Paris')::date on conflict do nothing;
with draws as(
 select p.original_owner_id user_id,c.rarete_base rarity from public.regular_pack_opening_cards p join public.cards c on c.id=p.card_id
 where exists(select 1 from auth.users u where u.id=p.original_owner_id)
 union all select d.user_id,c.rarity from public.decision_packs d join public.decision_pack_choices c on c.id=d.kept_choice_id where d.status='claimed'
), values_by_player as(select user_id,count(*) filter(where rarity in('SR','SSR','LR')) sr,count(*) filter(where rarity in('SSR','LR')) ssr,count(*) filter(where rarity='LR') lr,count(*) filter(where rarity='SR') exact_sr,count(*) filter(where rarity='SSR') exact_ssr from draws group by user_id)
insert into public.user_progress_counters select user_id,v.metric,v.amount from values_by_player cross join lateral(values('sr_acquired',sr),('ssr_acquired',ssr),('lr_acquired',lr),('first_sr',exact_sr),('first_ssr',exact_ssr))v(metric,amount)
on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
-- Regular removals do not prove destruction, but Decision discard flags do.
insert into public.user_progress_counters select d.user_id,'cards_destroyed',count(*) from public.decision_packs d join public.decision_pack_choices c on c.pack_id=d.id where c.is_discarded group by d.user_id
on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
insert into public.user_progress_counters select distinct d.user_id,'regret',1 from public.decision_packs d join public.decision_pack_choices c on c.pack_id=d.id where c.is_discarded and c.rarity='SSR'
on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
create trigger account_deletion_reference_guard before insert or update on public.achievement_upgrade_credits for each row execute function public.guard_deleted_account();

-- Additional deterministic retrospective facts from retained pack/bid histories.
with packs as(
 select o.opened_by user_id,o.id,o.opened_at,bool_or(c.rarete_base in('SR','SSR','LR')) has_sr,bool_or(c.rarete_base='LR') has_lr,
 row_number() over(partition by o.opened_by,public.mission_period_start(o.opened_at,'daily') order by o.opened_at,o.id) day_position
 from public.regular_pack_openings o join public.regular_pack_opening_cards p on p.pack_opening_id=o.id join public.cards c on c.id=p.card_id
 where exists(select 1 from auth.users u where u.id=o.opened_by) group by o.opened_by,o.id,o.opened_at
), runs as(select *,sum(has_sr::integer) over(partition by user_id order by opened_at,id) run from packs),
 facts as(
 select user_id,'dry_spell' metric from runs where not has_sr group by user_id,run having count(*)>=10
 union select user_id,'lucky_start' from packs where day_position=1 and has_lr
 union select user_id,'right_on_time' from packs where opened_at-public.mission_period_start(opened_at,'daily')<interval '1 minute'
)
insert into public.user_progress_counters select distinct user_id,metric,1 from facts on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
insert into public.user_progress_counters select bidder_id,'last_second',1 from public.bids b join public.auctions a on a.id=b.auction_id
 where b.created_at>=a.ends_at-interval '5 seconds' and b.created_at<a.ends_at group by bidder_id
 on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
insert into public.user_progress_counters select a.buyer_id,'sniper',count(*) from public.auctions a where a.status='sold' and a.buyer_id is not null and exists(
 select 1 from public.bids b where b.auction_id=a.id and b.bidder_id=a.buyer_id and b.created_at>=a.ends_at-interval '1 minute' and b.created_at<a.ends_at)
 group by a.buyer_id on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
-- A balance is a lower bound on income, not a reconstruction of spent Karas.
insert into public.user_progress_counters select user_id,'karas_earned',karas_balance from public.user_profiles
 on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);


-- Count qualifying historical trades once per counterpart and game day.
insert into public.user_progress_marks(user_id,metric,mark,recorded_at)
 select distinct participant.player,'eligible_trades',participant.other::text||':'||public.mission_period_start(t.updated_at,'daily')::text,
 min(t.updated_at) over(partition by participant.player,participant.other,public.mission_period_start(t.updated_at,'daily'))
 from public.trade_offers t cross join lateral(values(t.from_user,t.to_user),(t.to_user,t.from_user))participant(player,other)
 where t.status='accepted' and exists(select 1 from public.friendships f where f.status='accepted' and f.updated_at<=t.updated_at-interval '3 days'
  and((f.user_id=t.from_user and f.friend_id=t.to_user)or(f.user_id=t.to_user and f.friend_id=t.from_user))) on conflict do nothing;
insert into public.user_progress_counters select user_id,'eligible_trades',count(*) from public.user_progress_marks where metric='eligible_trades' group by user_id
 on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);


insert into public.user_progress_counters select b.bidder_id,'so_close',1 from public.bids b join public.auctions a on a.id=b.auction_id
 where a.status='sold' and a.buyer_id<>b.bidder_id and b.created_at>=a.ends_at-interval '5 seconds' and b.created_at<a.ends_at group by b.bidder_id
 on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);
insert into public.user_progress_marks(user_id,metric,mark,recorded_at)
 select w.user_id,'wish_granted',w.card_id::text,min(u.date_obtention) from public.wishlists w join public.user_cards u on u.user_id=w.user_id and u.card_id=w.card_id and u.date_obtention>=w.created_at
 group by w.user_id,w.card_id on conflict do nothing;
insert into public.user_progress_counters select user_id,'wish_granted',count(*) from public.user_progress_marks where metric='wish_granted' group by user_id
 on conflict(user_id,metric) do update set value=greatest(public.user_progress_counters.value,excluded.value);

notify pgrst,'reload schema';
commit;
