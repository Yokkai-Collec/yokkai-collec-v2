begin;

alter table public.whop_live_accounts
  alter column stripe_subscription_id drop not null,
  alter column stripe_customer_id drop not null,
  alter column stripe_paid_until drop not null,
  add constraint whop_live_import_fields check (
    num_nonnulls(stripe_subscription_id, stripe_customer_id, stripe_paid_until) in (0,3)
  ),
  add column cancel_at_period_end boolean not null default false;

-- Preserve the opaque reference after erasure so a late payment flow
-- can still be found and terminated on Whop.
create table public.whop_live_checkouts (
  checkout_ref uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  checkout_id text unique check (checkout_id ~ '^ch_[A-Za-z0-9]+$'),
  created_at timestamptz not null default clock_timestamp(),
  membership_id text unique check (membership_id ~ '^mem_[A-Za-z0-9]+$')
);
alter table public.whop_live_checkouts enable row level security;
revoke all on public.whop_live_checkouts from public,anon,authenticated,service_role;
grant select on public.whop_live_checkouts to service_role;

create function public.billing_begin_whop_checkout(p_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  checkout public.whop_live_checkouts;
begin
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user::text,0));
  if exists(select 1 from public.account_deletion_log where user_id=p_user)
    or public.billing_has_game_pro(p_user)
    or exists(select 1 from public.whop_live_accounts where user_id=p_user)
    or exists(select 1 from public.billing_accounts a join public.billing_entitlement_config c
      on c.scope=a.scope and c.enabled where a.user_id=p_user and (a.active or a.risk_hold))
  then raise exception 'BILLING_USE_PORTAL'; end if;
  insert into public.whop_live_checkouts(user_id) values(p_user) on conflict(user_id) do nothing;
  update public.whop_live_checkouts
    set checkout_ref=gen_random_uuid(), created_at=clock_timestamp()
    where user_id=p_user and checkout_id is null and created_at<clock_timestamp()-interval '23 hours';
  select * into strict checkout from public.whop_live_checkouts where user_id=p_user;
  return to_jsonb(checkout);
end;
$$;
revoke all on function public.billing_begin_whop_checkout(uuid) from public,anon,authenticated;
grant execute on function public.billing_begin_whop_checkout(uuid) to service_role;

create function public.billing_save_whop_checkout(p_user uuid,p_ref uuid,p_checkout text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user::text,0));
  if exists(select 1 from public.account_deletion_log where user_id=p_user) then
    raise exception 'BILLING_REVIEW_REQUIRED';
  end if;
  update public.whop_live_checkouts set checkout_id=p_checkout
    where user_id=p_user and checkout_ref=p_ref and p_checkout is not null
      and (checkout_id is null or checkout_id=p_checkout);
  if not found then raise exception 'BILLING_REVIEW_REQUIRED'; end if;
end;
$$;
revoke all on function public.billing_save_whop_checkout(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.billing_save_whop_checkout(uuid,uuid,text) to service_role;

create function public.billing_attach_whop_checkout(
  p_ref uuid,p_account text,p_membership text,p_member text,p_product text,p_variant text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  player uuid;
begin
  select user_id into player from public.whop_live_checkouts where checkout_ref=p_ref and checkout_id is not null;
  if player is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||player::text,0));
  if exists(select 1 from public.account_deletion_log where user_id=player) then return false; end if;
  perform 1 from public.whop_live_checkouts
    where checkout_ref=p_ref and user_id=player and checkout_id is not null
      and (membership_id is null or membership_id=p_membership) for update;
  if not found then raise exception 'BILLING_REVIEW_REQUIRED'; end if;
  if exists(select 1 from public.billing_accounts a join public.billing_entitlement_config c
    on c.scope=a.scope and c.enabled where a.user_id=player and (a.active or a.risk_hold))
  then raise exception 'BILLING_REVIEW_REQUIRED'; end if;
  insert into public.whop_live_accounts(user_id,whop_account_id,membership_id,member_id,product_id,variant_id)
    values(player,p_account,p_membership,p_member,p_product,p_variant)
    on conflict(user_id) do nothing;
  if not exists(select 1 from public.whop_live_accounts where user_id=player
      and stripe_subscription_id is null
      and (whop_account_id,membership_id,member_id,product_id,variant_id)=
          (p_account,p_membership,p_member,p_product,p_variant)) then
    raise exception 'BILLING_REVIEW_REQUIRED';
  end if;
  update public.whop_live_checkouts set membership_id=p_membership where checkout_ref=p_ref;
  return true;
end;
$$;
revoke all on function public.billing_attach_whop_checkout(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.billing_attach_whop_checkout(uuid,text,text,text,text,text) to service_role;

-- Retain the old signature while the previous application container drains.
create function public.billing_save_whop_checkout_state(
  p_membership text,p_status text,p_access_until timestamptz,p_provider_updated_at timestamptz,
  p_verified_at timestamptz,p_cancel_at_period_end boolean
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.billing_save_whop_live_state(p_membership,p_status,p_access_until,p_provider_updated_at,p_verified_at);
  update public.whop_live_accounts set cancel_at_period_end=p_cancel_at_period_end
    where membership_id=p_membership and provider_updated_at=p_provider_updated_at
      and verified_at<=p_verified_at and verified_at>=p_verified_at-interval '30 seconds'
      and deletion_confirmed_at is null;
end;
$$;
revoke all on function public.billing_save_whop_checkout_state(text,text,timestamptz,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.billing_save_whop_checkout_state(text,text,timestamptz,timestamptz,timestamptz,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
