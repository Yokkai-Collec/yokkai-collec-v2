-- Apply to the local Black Friday preview database only.
begin;

create table if not exists public.blackout_preview_wallets (
  user_id uuid primary key references public.user_profiles(user_id) on delete cascade,
  purchase_day date not null,
  bought_today integer not null check (bought_today between 0 and 3),
  reserve integer not null check (reserve >= 0)
);

alter table public.blackout_preview_wallets enable row level security;
revoke all on public.blackout_preview_wallets from public, anon, authenticated, service_role;

create or replace function public.blackout_preview_wallet(
  p_user uuid, p_action text, p_quantity integer default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pack_price constant integer := 750;
  daily_limit constant integer := 3;
  today date := (clock_timestamp() at time zone 'Europe/Paris')::date;
  balance integer;
  purchased integer;
begin
  if p_action = 'buy' then
    if p_quantity is null or p_quantity not between 1 and daily_limit then
      raise exception 'BLACKOUT_INVALID_QUANTITY';
    end if;

    -- Serialize purchases and openings for this account before checking the cap.
    select karas_balance into strict balance
    from public.user_profiles where user_id = p_user for update;
    today := (clock_timestamp() at time zone 'Europe/Paris')::date;
    select bought_today into purchased
    from public.blackout_preview_wallets
    where user_id = p_user and purchase_day = today;
    if coalesce(purchased, 0) + p_quantity > daily_limit then
      raise exception 'BLACKOUT_DAILY_LIMIT';
    end if;

    perform public.debit_karas(p_user, p_quantity * pack_price);
    insert into public.blackout_preview_wallets as wallet (user_id, purchase_day, bought_today, reserve)
    values (p_user, today, p_quantity, p_quantity)
    on conflict (user_id) do update set
      purchase_day = excluded.purchase_day,
      bought_today = coalesce(purchased, 0) + p_quantity,
      reserve = wallet.reserve + p_quantity;
  elsif p_action = 'open' then
    perform 1 from public.user_profiles where user_id = p_user for update;
    update public.blackout_preview_wallets set reserve = reserve - 1
    where user_id = p_user and reserve > 0;
  elsif p_action is distinct from 'read' then
    raise exception 'BLACKOUT_INVALID_ACTION';
  end if;

  return (
    select jsonb_build_object(
      'balance', profile.karas_balance,
      'boughtToday', case when wallet.purchase_day = today then wallet.bought_today else 0 end,
      'reserve', coalesce(wallet.reserve, 0),
      'price', pack_price,
      'dailyLimit', daily_limit
    )
    from public.user_profiles profile
    left join public.blackout_preview_wallets wallet using (user_id)
    where profile.user_id = p_user
  );
end;
$$;

revoke all on function public.blackout_preview_wallet(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.blackout_preview_wallet(uuid, text, integer) to service_role;
notify pgrst, 'reload schema';

commit;
