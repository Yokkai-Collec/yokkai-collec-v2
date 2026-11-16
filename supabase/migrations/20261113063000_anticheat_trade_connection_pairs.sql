begin;
set local lock_timeout='5s';

-- Store one pair seen on the same authenticated request per player. Historical
-- network and browser observations are independent and cannot backfill a pair.
create table public.anticheat_trade_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  network_identity text check(network_identity~'^v[1-9][0-9]*:[a-f0-9]{64}$'),
  device_identity text not null check(device_identity~'^v[1-9][0-9]*:[a-f0-9]{64}$'),
  observed_at timestamptz not null
);
alter table public.anticheat_trade_connections enable row level security;
revoke all on public.anticheat_trade_connections from public,anon,authenticated,service_role;

create function public.record_anticheat_trade_connection(
  p_user_id uuid,p_network_identity text,p_device_identity text
) returns void
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
  if public.anticheat_account_exempt(p_user_id) then return; end if;
  if not exists(select 1 from auth.users where id=p_user_id) then return; end if;
  insert into public.anticheat_trade_connections(user_id,network_identity,device_identity,observed_at)
    values(p_user_id,p_network_identity,p_device_identity,stamp)
  on conflict(user_id) do update
    set network_identity=excluded.network_identity,device_identity=excluded.device_identity,
      observed_at=excluded.observed_at
    where anticheat_trade_connections.observed_at<=excluded.observed_at
      and (anticheat_trade_connections.network_identity is distinct from excluded.network_identity
        or anticheat_trade_connections.device_identity is distinct from excluded.device_identity
        or anticheat_trade_connections.observed_at<=excluded.observed_at-interval '15 minutes');
end;
$$;
revoke all on function public.record_anticheat_trade_connection(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_anticheat_trade_connection(uuid,text,text) to service_role;

create or replace function public.clear_exempt_anticheat_context()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.anticheat_network_observations where user_id=new.user_id;
  delete from public.anticheat_device_observations where user_id=new.user_id;
  delete from public.anticheat_trade_connections where user_id=new.user_id;
  return new;
end;
$$;

create or replace function public.anticheat_trade_shares_connection(p_offer public.trade_offers)
returns boolean language sql stable set search_path='' as $$
  select not public.anticheat_account_exempt(p_offer.from_user)
    and not public.anticheat_account_exempt(p_offer.to_user)
    and exists(
      select 1 from public.anticheat_trade_connections a
      join public.anticheat_trade_connections b using(network_identity,device_identity)
      where a.user_id=p_offer.from_user and b.user_id=p_offer.to_user
        and least(a.observed_at,b.observed_at)>=now()-interval '7 days'
    )
$$;

-- Apply the same evidence rule to optional non-blocking trade observations.
do $shadow$
declare definition text; updated text;
begin
  definition:=pg_get_functiondef('public.capture_trade_quarantine_shadow()'::regprocedure);
  updated:=regexp_replace(definition,'  select exists[(][\s\S]*?if not [(]shared_network and shared_device[)] then return new; end if;',
    '  if not public.anticheat_trade_shares_connection(new) then return new; end if;');
  if updated=definition then raise exception 'UNEXPECTED_TRADE_SHADOW_CONTEXT'; end if;
  updated:=replace(updated,E'  shared_network boolean;\n  shared_device boolean;\n','');
  execute updated;
end;
$shadow$;

create or replace function public.purge_anticheat_deleted_identities()
returns integer language plpgsql set search_path='' as $$
declare affected integer;
begin
  update public.anticheat_deleted_accounts set pseudo=null,email=null
    where identity_expires_at<=clock_timestamp() and (pseudo is not null or email is not null);
  get diagnostics affected=row_count;
  delete from public.anticheat_trade_connections where observed_at<now()-interval '7 days';
  return affected;
end;
$$;

notify pgrst,'reload schema';
commit;
