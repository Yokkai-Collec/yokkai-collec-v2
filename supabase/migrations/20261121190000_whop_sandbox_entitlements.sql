begin;

alter table public.billing_entitlement_config
  add column whop_sandbox_scope text check (
    whop_sandbox_scope ~ '^sandbox:biz_[A-Za-z0-9]+:plan_[A-Za-z0-9]+$'
  );

create table public.whop_sandbox_accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  checkout_ref uuid not null default gen_random_uuid() unique,
  checkout_id text check (checkout_id ~ '^ch_[A-Za-z0-9]+$'),
  created_at timestamptz not null default clock_timestamp(),
  next_sync_at timestamptz,
  membership_id text unique check (membership_id ~ '^mem_[A-Za-z0-9]+$'),
  membership_status text check (membership_status in
    ('trialing','active','past_due','completed','canceled','expired','unresolved')),
  period_end timestamptz,
  provider_updated_at timestamptz,
  verified_at timestamptz,
  primary key (user_id, scope)
);
alter table public.whop_sandbox_accounts enable row level security;
revoke all on public.whop_sandbox_accounts from public,anon,authenticated;
grant select,insert,update on public.whop_sandbox_accounts to service_role;

create or replace function public.billing_has_game_pro(p_user uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select not exists (
    select 1 from public.account_deletion_log where user_id=p_user
  ) and (
    exists (
      select 1 from public.pro_access_grants g
      where g.user_id=p_user
        and (g.expires_at is null or g.expires_at>clock_timestamp())
    )
    or exists (
      select 1
      from public.billing_entitlement_config c
      join public.billing_accounts a on a.scope=c.scope and a.user_id=p_user
      where c.singleton and c.enabled and a.active and a.status='active'
        and not a.risk_hold and a.period_end>clock_timestamp()
        and a.verified_at>clock_timestamp()-interval '15 minutes'
        and a.verified_at<=clock_timestamp()
    )
    or exists (
      select 1
      from public.billing_entitlement_config c
      join public.whop_sandbox_accounts a on a.scope=c.whop_sandbox_scope and a.user_id=p_user
      where c.singleton and a.membership_status in ('trialing','active')
        and a.period_end>clock_timestamp()
        and a.verified_at>clock_timestamp()-interval '15 minutes'
        and a.verified_at<=clock_timestamp()
    )
  );
$$;

create function public.whop_sandbox_save_membership(
  p_ref uuid, p_membership text, p_status text, p_period_end timestamptz,
  p_updated_at timestamptz, p_verified_at timestamptz
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  account public.whop_sandbox_accounts;
  stamp timestamptz := clock_timestamp();
begin
  if p_updated_at is null or p_verified_at is null or p_verified_at>stamp+interval '30 seconds'
    or p_verified_at<stamp-interval '1 minute' then
    raise exception 'WHOP_SANDBOX_INVALID_SNAPSHOT';
  end if;
  update public.whop_sandbox_accounts a
    set membership_id=p_membership, membership_status=p_status, period_end=p_period_end,
        provider_updated_at=p_updated_at, verified_at=least(stamp,p_verified_at)
    where a.checkout_ref=p_ref
      and a.checkout_id is not null
      and (a.membership_id is null or a.membership_id=p_membership)
      and coalesce(a.provider_updated_at,'-infinity')<=p_updated_at
      and coalesce(a.verified_at,'-infinity')<=p_verified_at
      and exists (select 1 from public.billing_entitlement_config c
        where c.singleton and c.whop_sandbox_scope=a.scope)
      and not exists (select 1 from public.account_deletion_log d where d.user_id=a.user_id)
    returning a.* into account;
  if found then
    perform public.billing_sync_pack_timing(account.user_id,account.period_end);
  end if;
end;
$$;
revoke all on function public.whop_sandbox_save_membership(uuid,text,text,timestamptz,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.whop_sandbox_save_membership(uuid,text,text,timestamptz,timestamptz,timestamptz)
  to service_role;

notify pgrst, 'reload schema';
commit;
