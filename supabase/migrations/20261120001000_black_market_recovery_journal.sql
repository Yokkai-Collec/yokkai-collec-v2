begin;

create table public.black_market_recovery_runs (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default clock_timestamp(),
  checked_accounts integer not null,
  recovered_lr integer not null,
  recovered_ssr integer not null,
  deferred_accounts integer not null
);
alter table public.black_market_recovery_runs enable row level security;
revoke all on public.black_market_recovery_runs from public, anon, authenticated, service_role;
revoke all on sequence public.black_market_recovery_runs_id_seq from public, anon, authenticated, service_role;

-- Count the exact recovered copies while their existing transaction locks are held.
do $recovery$
declare
  source text := pg_get_functiondef('public.recover_black_market_cards(uuid,uuid)'::regprocedure);
  marker text := 'return jsonb_build_object(''recovered'',recovered,';
begin
  if strpos(source, marker) = 0 then raise exception 'BLACK_MARKET_RECOVERY_COUNT_PATCH_MISSING'; end if;
  execute replace(source, marker, marker || $body$
    'lr', (select count(*) from public.user_cards where id = any(copies) and rarity = 'LR'),
    'ssr', (select count(*) from public.user_cards where id = any(copies) and rarity = 'SSR'),
  $body$);
end
$recovery$;

create or replace function public.recover_due_black_market_cards() returns void
language plpgsql security definer set search_path='' as $$
declare
  account record;
  result jsonb;
  checked integer := 0;
  lr integer := 0;
  ssr integer := 0;
  deferred integer := 0;
begin
  if not exists (select 1 from public.black_market_config
    where singleton and enabled and official_user_id is not null) then return; end if;
  for account in
    select b.user_id from public.black_market_bans b join auth.users u on u.id = b.user_id
    where b.banned_at <= clock_timestamp() - interval '14 days'
      and u.banned_until = 'infinity'::timestamptz
      and b.user_id <> (select official_user_id from public.black_market_config where singleton)
      and exists (select 1 from public.user_cards c where c.user_id = b.user_id and c.rarity in ('LR','SSR')
        and not exists (select 1 from public.black_market_stock s where s.card_instance_id = c.id))
    order by b.banned_at, b.user_id
  loop
    checked := checked + 1;
    begin
      result := public.recover_black_market_cards(account.user_id, null);
      lr := lr + (result->>'lr')::integer;
      ssr := ssr + (result->>'ssr')::integer;
      if (result->>'remaining')::integer > 0 then deferred := deferred + 1; end if;
    exception when deadlock_detected or lock_not_available then
      deferred := deferred + 1;
      raise warning 'BLACK_MARKET_RECOVERY_DEFERRED %', account.user_id;
    when raise_exception then
      if sqlerrm not in ('BLACK_MARKET_PERMANENT_BAN_REQUIRED',
        'BLACK_MARKET_INVALID_OFFICIAL','BLACK_MARKET_WAITING_PERIOD') then raise; end if;
      deferred := deferred + 1;
    end;
  end loop;
  insert into public.black_market_recovery_runs(checked_accounts, recovered_lr, recovered_ssr, deferred_accounts)
  values(checked, lr, ssr, deferred);
end $$;

do $stock$
declare
  source text := pg_get_functiondef('public.admin_get_black_market_stock()'::regprocedure);
  marker text := '''officialUserId'', cfg.official_user_id,';
begin
  if strpos(source, marker) = 0 then raise exception 'BLACK_MARKET_STOCK_JOURNAL_PATCH_MISSING'; end if;
  execute replace(source, marker, marker || $body$
    'recoveryRuns', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'checkedAt', r.checked_at, 'checkedAccounts', r.checked_accounts,
      'recoveredLR', r.recovered_lr, 'recoveredSSR', r.recovered_ssr, 'deferredAccounts', r.deferred_accounts
    ) order by r.id desc) from (
      select * from public.black_market_recovery_runs order by id desc limit 20
    ) r), '[]'::jsonb),
  $body$);
end
$stock$;

notify pgrst, 'reload schema';
commit;
