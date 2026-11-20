begin;
set local lock_timeout='3s';

-- Installation never activates the event or moves an existing player's cards.
create table public.black_market_config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 official_user_id uuid references public.user_profiles(user_id) on delete restrict
);
insert into public.black_market_config(singleton,official_user_id)
 values(true,(select user_id from public.user_profiles where pseudo='Yokkai-Collec Official'));
create table public.black_market_bans (
 user_id uuid primary key,
 banned_at timestamptz not null
);
create index black_market_bans_due on public.black_market_bans(banned_at,user_id);
alter table public.black_market_bans enable row level security;
revoke all on public.black_market_bans from public,anon,authenticated,service_role;
-- Use only the latest ban/unban receipt for a currently permanent ban.
-- Unknown dates conservatively start a fresh waiting period at installation.
insert into public.black_market_bans(user_id,banned_at)
 select u.id,case when receipt.action='player.ban' then receipt.created_at else clock_timestamp() end
 from auth.users u left join lateral (
   select a.action,a.created_at from public.admin_audit_logs a
   where a.action in('player.ban','player.unban') and a.metadata->>'target_user_id'=u.id::text
   order by a.created_at desc,a.id desc limit 1
 ) receipt on true where (to_jsonb(u)->>'banned_until')::timestamptz='infinity'::timestamptz;
create function public.track_black_market_ban() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (to_jsonb(new)->>'banned_until')::timestamptz='infinity'::timestamptz then
   if tg_op='INSERT' or to_jsonb(old)->>'banned_until' is distinct from to_jsonb(new)->>'banned_until' then
     insert into public.black_market_bans(user_id,banned_at) values(new.id,clock_timestamp())
       on conflict(user_id) do update set banned_at=excluded.banned_at;
   end if;
 else delete from public.black_market_bans where user_id=new.id;
 end if;
 return new;
end $$;
create trigger black_market_ban_clock after insert or update on auth.users
 for each row execute function public.track_black_market_ban();
create table public.black_market_stock (
 card_instance_id uuid primary key,
 source_user_id uuid not null,
 official_user_id uuid not null,
 recovered_at timestamptz not null default clock_timestamp(),
 recovered_by uuid,
 auction_id uuid references public.auctions(id) on delete restrict
);
alter table public.black_market_config enable row level security;
alter table public.black_market_stock enable row level security;
revoke all on public.black_market_config,public.black_market_stock from public,anon,authenticated,service_role;
alter table public.auctions add column is_black_market boolean not null default false;
alter table public.auctions add constraint auctions_black_market_shape check
 (not is_black_market or (not is_mystery and (status<>'active' or (seller_id is not null and card_instance_id is not null))));
create index auctions_black_market_ends on public.auctions(ends_at,id) where is_black_market;

do $$ declare definition text; begin
 select pg_get_constraintdef(oid) into strict definition from pg_constraint
   where conrelid='public.admin_audit_logs'::regclass and conname='admin_audit_logs_action_check';
 alter table public.admin_audit_logs drop constraint admin_audit_logs_action_check;
 execute 'alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check (action in (''black_market.configure'',''black_market.recover'',''black_market.open'') or ('||substring(definition from 8 for char_length(definition)-8)||'))';
end $$;

create function public.admin_configure_black_market(p_official_user_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_player_not_banned();
 if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 perform 1 from public.black_market_config where singleton for update;
 if p_official_user_id is null or p_enabled is null or not exists(
   select 1 from public.user_profiles p join auth.users u on u.id=p.user_id
   where p.user_id=p_official_user_id and p.pseudo='Yokkai-Collec Official'
     and coalesce(u.banned_until,'-infinity')<=clock_timestamp()
 ) then raise exception 'BLACK_MARKET_INVALID_OFFICIAL'; end if;
 if exists(select 1 from public.black_market_stock s join public.user_cards c on c.id=s.card_instance_id
   where c.user_id=s.official_user_id and s.official_user_id<>p_official_user_id)
 then raise exception 'BLACK_MARKET_STOCK_REMAINS'; end if;
 update public.black_market_config set official_user_id=p_official_user_id,enabled=p_enabled where singleton;
 insert into public.admin_audit_logs(admin_user_id,action,metadata) values(auth.uid(),'black_market.configure',
   jsonb_build_object('officialUserId',p_official_user_id,'enabled',p_enabled));
end $$;

-- Shared private worker; every entry point enforces the full 14-day delay.
-- Temporary suspensions, legitimate buyers and investigation holds stay put.
create function public.recover_black_market_cards(p_user_id uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare official uuid; copies uuid[]; recovered integer;
begin
 select official_user_id into official from public.black_market_config where singleton and enabled for update;
 if official is null then raise exception 'BLACK_MARKET_INVALID_OFFICIAL'; end if;
 -- Same account-deletion fence and profile-before-card ordering as economic mutations.
 perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||u::text,0))
   from (select distinct unnest(array[p_user_id,official]) u order by u) accounts;
 perform 1 from auth.users where id in(p_user_id,official) order by id for update;
 if p_user_id=official or not exists(select 1 from auth.users where id=p_user_id and banned_until='infinity'::timestamptz)
 then raise exception 'BLACK_MARKET_PERMANENT_BAN_REQUIRED'; end if;
 if not exists(select 1 from public.black_market_bans where user_id=p_user_id and banned_at<=clock_timestamp()-interval '14 days')
 then raise exception 'BLACK_MARKET_WAITING_PERIOD'; end if;
 if not exists(select 1 from auth.users where id=official and coalesce(banned_until,'-infinity')<=clock_timestamp())
 then raise exception 'BLACK_MARKET_INVALID_OFFICIAL'; end if;
 perform 1 from public.user_profiles where user_id in(p_user_id,official) order by user_id for update;
 select coalesce(array_agg(id),'{}') into copies from (
   select c.id from public.user_cards c where c.user_id=p_user_id and c.rarity in('LR','SSR')
     and not exists(select 1 from public.black_market_stock s where s.card_instance_id=c.id)
     and not exists(select 1 from public.auctions a where a.card_instance_id=c.id and a.status='active')
     and not exists(select 1 from public.anticheat_trade_card_holds h where h.card_id=c.id)
     and not exists(select 1 from public.trade_offers t where t.status='pending'
       and (c.id=any(t.offered_card_ids) or c.id=any(t.requested_card_ids)))
   order by c.id for update of c
 ) eligible;
 insert into public.black_market_stock(card_instance_id,source_user_id,official_user_id,recovered_by)
   select unnest(copies),p_user_id,official,p_actor;
 update public.user_cards set is_locked=false where id=any(copies) and is_locked;
 update public.user_cards set user_id=official,folder_id=null,is_locked=false,is_first_owner=false,date_obtention=clock_timestamp()
   where id=any(copies) and user_id=p_user_id;
 get diagnostics recovered=row_count;
 if recovered>0 then
   insert into public.admin_audit_logs(admin_user_id,action,metadata) values(p_actor,'black_market.recover',
     jsonb_build_object('sourceUserId',p_user_id,'officialUserId',official,'cardIds',copies,'automatic',p_actor is null));
 end if;
 return jsonb_build_object('recovered',recovered,'remaining',(
   select count(*) from public.user_cards where user_id=p_user_id and rarity in('LR','SSR')));
end $$;

create function public.recover_due_black_market_cards() returns void
language plpgsql security definer set search_path='' as $$
declare account record;
begin
 if not exists(select 1 from public.black_market_config where singleton and enabled and official_user_id is not null) then return; end if;
 for account in select b.user_id from public.black_market_bans b join auth.users u on u.id=b.user_id
   where b.banned_at<=clock_timestamp()-interval '14 days' and u.banned_until='infinity'::timestamptz
     and b.user_id<>(select official_user_id from public.black_market_config where singleton)
     and exists(select 1 from public.user_cards c where c.user_id=b.user_id and c.rarity in('LR','SSR')
       and not exists(select 1 from public.black_market_stock s where s.card_instance_id=c.id))
   order by b.banned_at,b.user_id
 loop
   begin
     perform public.recover_black_market_cards(account.user_id,null);
   exception when deadlock_detected or lock_not_available then
     raise warning 'BLACK_MARKET_RECOVERY_DEFERRED %',account.user_id;
   when raise_exception then
     if sqlerrm not in('BLACK_MARKET_PERMANENT_BAN_REQUIRED','BLACK_MARKET_INVALID_OFFICIAL','BLACK_MARKET_WAITING_PERIOD') then raise; end if;
   end;
 end loop;
end $$;
-- One daily pass; the threshold is never rounded up early.
select cron.schedule('black-market-recovery','0 0 * * *','select public.recover_due_black_market_cards();');

create function public.admin_open_black_market_auction(p_card_instance_id uuid,p_starting_price integer,p_duration_minutes integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare official uuid; auction uuid; snapshot jsonb;
begin
 perform public.assert_player_not_banned();
 if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 select official_user_id into official from public.black_market_config where singleton and enabled for update;
 if official is null then raise exception 'BLACK_MARKET_DISABLED'; end if;
 if p_starting_price is null or p_starting_price<10 or p_duration_minutes is null
   or p_duration_minutes not in(15,30,60,240,720,1440) then raise exception 'BLACK_MARKET_INVALID_AUCTION'; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||official::text,0));
 perform 1 from public.user_profiles where user_id=official for update;
 perform 1 from public.user_cards c join public.black_market_stock s on s.card_instance_id=c.id
   where c.id=p_card_instance_id and c.user_id=official and s.official_user_id=official
     and c.rarity in('LR','SSR') and not c.is_locked for update of c;
 if not found then raise exception 'BLACK_MARKET_CARD_UNAVAILABLE'; end if;
 if exists(select 1 from auth.users where id=official and banned_until>clock_timestamp())
   or exists(select 1 from public.anticheat_trade_card_holds where card_id=p_card_instance_id)
 then raise exception 'BLACK_MARKET_CARD_UNAVAILABLE'; end if;
 select jsonb_build_object('id',d.id,'name',d.nom,'category',d.categorie,'anime',d.franchise,'liveFranchise',true,
   'rarity',c.rarity,'image',d.image_url,'catalogueImage',d.image_url,'shiny',c.is_shiny,'isEvolved',c.is_evolved,
   'firstLrCopy',case when c.rarity='LR' then public.auction_first_lr_copy_source(c.id) end)
 into snapshot from public.user_cards c join public.cards d on d.id=c.card_id where c.id=p_card_instance_id;
 update public.user_cards set custom_image_url=null where id=p_card_instance_id;
 insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at,is_black_market,card_snapshot)
 values(p_card_instance_id,official,p_starting_price,p_starting_price,p_duration_minutes,
   clock_timestamp()+make_interval(mins=>p_duration_minutes),true,snapshot) returning id into auction;
 update public.black_market_stock set auction_id=auction where card_instance_id=p_card_instance_id;
 insert into public.admin_audit_logs(admin_user_id,action,metadata) values(auth.uid(),'black_market.open',
   jsonb_build_object('auctionId',auction,'cardInstanceId',p_card_instance_id));
 return auction;
end $$;

-- Custody cannot be bypassed through ordinary sell/discard/trade RPCs, even by
-- the official account. Only the existing locked auction settlement transfers it.
create function public.guard_black_market_card() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.black_market_stock s where s.card_instance_id=old.id and s.official_user_id=old.user_id) then
   if tg_op='DELETE' then raise exception 'BLACK_MARKET_CARD_RESERVED'; end if;
   if new.user_id<>old.user_id and not exists(select 1 from public.auctions a
     where a.card_instance_id=old.id and a.is_black_market and a.status='sold' and a.buyer_id=new.user_id)
   then raise exception 'BLACK_MARKET_CARD_RESERVED'; end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger black_market_card_custody before update or delete on public.user_cards
 for each row execute function public.guard_black_market_card();

create function public.guard_black_market_listing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.black_market_stock s join public.user_cards c on c.id=s.card_instance_id
   where s.card_instance_id=new.card_instance_id and c.user_id=s.official_user_id)
   and not new.is_black_market then raise exception 'BLACK_MARKET_CARD_RESERVED'; end if;
 if new.is_black_market and not exists(select 1 from public.black_market_stock s
   join public.black_market_config cfg on cfg.singleton and cfg.enabled and cfg.official_user_id=s.official_user_id
   join public.user_cards c on c.id=s.card_instance_id and c.user_id=s.official_user_id
   where s.card_instance_id=new.card_instance_id and new.seller_id=s.official_user_id)
 then raise exception 'BLACK_MARKET_CARD_UNAVAILABLE'; end if;
 return new;
end $$;
create trigger black_market_listing_custody before insert on public.auctions
 for each row execute function public.guard_black_market_listing();

-- Keep the mature bid/escrow/refund/settlement path, exposing only an event flag.
do $$ declare definition text; updated text; target regprocedure; begin
 target:='public.get_auction(uuid)'::regprocedure;
 definition:=pg_get_functiondef(target);
 updated:=replace(definition,'''id'',a.id,','''id'',a.id,''isBlackMarket'',a.is_black_market,');
 updated:=replace(updated,'case when a.is_mystery then a.card_snapshot',
   'case when a.is_mystery or a.is_black_market then a.card_snapshot');
 if updated=definition then raise exception 'BLACK_MARKET_DETAIL_PATCH_MISSING'; end if;
 execute updated;
 foreach target in array array[
   'public.browse_auctions_page(integer,text,text,text,text,text)'::regprocedure,
   'public.list_auctions_page(jsonb,integer)'::regprocedure,'public.list_auctions()'::regprocedure
 ] loop
   definition:=pg_get_functiondef(target);
   updated:=replace(definition,'where not is_mystery','where not is_mystery and not is_black_market');
   if updated=definition then raise exception 'BLACK_MARKET_MARKET_PATCH_MISSING: %',target; end if;
   execute updated;
 end loop;
end $$;

create function public.get_black_market_event() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.assert_player_not_banned();
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if not (select enabled from public.black_market_config where singleton) then return null; end if;
 -- Bounded feed; sold/expired editions remain available through their detail URL.
 return jsonb_build_object('auctions',coalesce((select jsonb_agg(
   public.get_auction(a.id)||jsonb_build_object(
     'popularity',(select coalesce(favoris_count,0) from public.cards where id=a.card_id),
     'ownedCount',(select count(*) from public.user_cards where user_id=auth.uid() and card_id=a.card_id)
   ) order by a.ends_at,a.id)
   from (select sale.id,sale.ends_at,copy.card_id from public.auctions sale
     join public.user_cards copy on copy.id=sale.card_instance_id
     where sale.is_black_market and sale.status='active'
     order by sale.ends_at,sale.id limit 60) a),'[]'::jsonb));
end $$;

create function public.admin_get_black_market_stock() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.assert_player_not_banned();
 if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 return (select jsonb_build_object('enabled',cfg.enabled,'officialUserId',cfg.official_user_id,
   'items',coalesce((select jsonb_agg(jsonb_build_object('instanceId',q.id,'name',q.nom,'rarity',q.rarity))
   from (select c.id,d.nom,c.rarity from public.black_market_stock s
     join public.user_cards c on c.id=s.card_instance_id and c.user_id=s.official_user_id
     join public.cards d on d.id=c.card_id where not exists(
       select 1 from public.auctions a where a.card_instance_id=c.id and a.status='active')
     order by s.recovered_at,c.id limit 200) q),'[]'::jsonb)) from public.black_market_config cfg where singleton);
end $$;

revoke all on function public.admin_configure_black_market(uuid,boolean),public.recover_black_market_cards(uuid,uuid),
 public.admin_open_black_market_auction(uuid,integer,integer),public.get_black_market_event(),public.admin_get_black_market_stock(),
 public.guard_black_market_card(),public.guard_black_market_listing(),public.track_black_market_ban(),public.recover_due_black_market_cards() from public,anon,authenticated,service_role;
grant execute on function public.admin_configure_black_market(uuid,boolean),
 public.admin_open_black_market_auction(uuid,integer,integer),public.get_black_market_event(),public.admin_get_black_market_stock() to authenticated;
notify pgrst,'reload schema';
commit;
