begin;

-- Only an operator-reviewed Stripe-to-Whop mapping can create a production link.
-- Renewal collection and the Stripe migration are external to these functions.
create table public.whop_live_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_subscription_id text unique not null check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  whop_account_id text not null check (whop_account_id ~ '^biz_[A-Za-z0-9]+$'),
  membership_id text unique not null check (membership_id ~ '^mem_[A-Za-z0-9]+$'),
  member_id text not null check (member_id ~ '^mber_[A-Za-z0-9]+$'),
  product_id text not null check (product_id ~ '^prod_[A-Za-z0-9]+$'),
  variant_id text not null check (variant_id ~ '^plan_[A-Za-z0-9]+$'),
  stripe_paid_until timestamptz not null,
  status text check (status in ('trialing','active','past_due','completed','canceled','expired','unresolved')),
  access_until timestamptz,
  provider_updated_at timestamptz,
  verified_at timestamptz,
  deletion_confirmed_at timestamptz
);
alter table public.whop_live_accounts enable row level security;
revoke all on public.whop_live_accounts from public,anon,authenticated,service_role;
grant select on public.whop_live_accounts to service_role;

create function public.billing_link_whop_import(
  p_customer text, p_subscription text, p_account text, p_membership text,
  p_member text, p_product text, p_variant text, p_paid_until timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  player uuid;
  stripe public.billing_accounts;
begin
  select user_id into strict player from public.billing_accounts where stripe_customer_id=p_customer;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||player::text,0));
  select * into strict stripe from public.billing_accounts
    where stripe_customer_id=p_customer and user_id=player for update;
  if stripe.scope !~ '^live:' or not stripe.active or stripe.status<>'active'
    or stripe.risk_hold or stripe.deletion_confirmed_at is not null
    or p_paid_until is distinct from stripe.period_end or p_paid_until<=clock_timestamp()
    or stripe.verified_at is null or stripe.verified_at<=clock_timestamp()-interval '15 minutes'
    or stripe.verified_at>clock_timestamp()
    or not exists(select 1 from public.billing_entitlement_config c
      where c.singleton and c.enabled and c.scope=stripe.scope)
    or exists(select 1 from public.account_deletion_log where user_id=player) then
    raise exception 'BILLING_REVIEW_REQUIRED';
  end if;
  insert into public.whop_live_accounts (
    user_id,stripe_subscription_id,stripe_customer_id,whop_account_id,membership_id,
    member_id,product_id,variant_id,stripe_paid_until
  ) values (
    player,p_subscription,p_customer,p_account,p_membership,
    p_member,p_product,p_variant,p_paid_until
  ) on conflict (user_id) do nothing;
  if not exists (
    select 1 from public.whop_live_accounts w where w.user_id=player
      and (w.stripe_subscription_id,w.stripe_customer_id,w.whop_account_id,w.membership_id,
        w.member_id,w.product_id,w.variant_id,w.stripe_paid_until) =
        (p_subscription,p_customer,p_account,p_membership,p_member,p_product,p_variant,p_paid_until)
  ) then raise exception 'BILLING_REVIEW_REQUIRED'; end if;
end;
$$;
revoke all on function public.billing_link_whop_import(text,text,text,text,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.billing_link_whop_import(text,text,text,text,text,text,text,timestamptz) to service_role;

create or replace function public.billing_has_game_pro(p_user uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select not exists (
    select 1 from public.account_deletion_log where user_id=p_user
  ) and (
    exists (
      select 1 from public.pro_access_grants g where g.user_id=p_user
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
    or exists (
      select 1 from public.whop_live_accounts a where a.user_id=p_user
        and a.status in ('trialing','active') and a.deletion_confirmed_at is null
        and (a.stripe_paid_until<=clock_timestamp() or not exists (
          select 1 from public.billing_accounts s
          where s.user_id=p_user and s.stripe_customer_id=a.stripe_customer_id and s.risk_hold
        ))
        and a.access_until>clock_timestamp()
        and a.verified_at>clock_timestamp()-interval '15 minutes'
        and a.verified_at<=clock_timestamp()
    )
  );
$$;

create function public.billing_save_whop_live_state(
  p_membership text,p_status text,p_access_until timestamptz,p_provider_updated_at timestamptz,
  p_verified_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  player uuid;
  previous_end timestamptz;
  stamp timestamptz := clock_timestamp();
begin
  if p_status is null or p_provider_updated_at is null or p_verified_at is null
    or p_verified_at>stamp+interval '30 seconds' or p_verified_at<stamp-interval '1 minute'
    or (p_access_until is not null and p_status not in ('trialing','active')) then
    raise exception 'BILLING_REVIEW_REQUIRED';
  end if;
  select user_id,access_until into player,previous_end
    from public.whop_live_accounts where membership_id=p_membership for update;
  if not found then raise exception 'BILLING_REVIEW_REQUIRED'; end if;
  update public.whop_live_accounts a
    set status=p_status,access_until=p_access_until,provider_updated_at=p_provider_updated_at,
        verified_at=least(stamp,p_verified_at)
    where a.membership_id=p_membership and a.deletion_confirmed_at is null
      and coalesce(a.provider_updated_at,'-infinity')<=p_provider_updated_at
      and coalesce(a.verified_at,'-infinity')<=p_verified_at
      and not exists(select 1 from public.account_deletion_log where user_id=player);
  if found then
    perform public.billing_sync_pack_timing(player,
      case when p_access_until is null and previous_end is not null then least(stamp,previous_end) end);
  end if;
end;
$$;
revoke all on function public.billing_save_whop_live_state(text,text,timestamptz,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.billing_save_whop_live_state(text,text,timestamptz,timestamptz,timestamptz)
  to service_role;

create function public.billing_confirm_whop_live_deletion(p_user uuid,p_membership text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user::text,0));
  if not exists(select 1 from public.account_deletion_log where user_id=p_user) then
    raise exception 'BILLING_REVIEW_REQUIRED';
  end if;
  update public.whop_live_accounts set deletion_confirmed_at=clock_timestamp(),access_until=null
    where user_id=p_user and membership_id=p_membership;
  if not found then raise exception 'BILLING_REVIEW_REQUIRED'; end if;
end;
$$;
revoke all on function public.billing_confirm_whop_live_deletion(uuid,text) from public,anon,authenticated;
grant execute on function public.billing_confirm_whop_live_deletion(uuid,text) to service_role;

create or replace function public.prepare_account_deletion(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user_id::text,0));
  if exists(select 1 from public.billing_accounts where user_id=p_user_id
    and (stripe_customer_id is not null or checkout_id is not null
      or customer_started_at is not null or checkout_started_at is not null
      or lease_until>clock_timestamp())
    and (deletion_confirmed_at is null or lease_until>clock_timestamp()))
    or exists(select 1 from public.whop_live_accounts where user_id=p_user_id
      and deletion_confirmed_at is null) then
    raise exception 'BILLING_CANCELLATION_REQUIRED';
  end if;
  return public.prepare_account_deletion_without_billing(p_user_id);
end;
$$;

notify pgrst, 'reload schema';
commit;
