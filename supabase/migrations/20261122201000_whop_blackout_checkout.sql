begin;

alter table public.whop_live_checkouts
  add column variant_id text check (variant_id ~ '^plan_[A-Za-z0-9]+$');

create function public.billing_begin_blackout_whop_checkout(p_user uuid, p_variant text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  attempt jsonb;
  existing_ref uuid;
begin
  if p_variant is null or p_variant !~ '^plan_[A-Za-z0-9]+$' then
    raise exception 'WHOP_LIVE_CONFIGURATION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:' || p_user::text, 0));
  select checkout_ref into existing_ref from public.whop_live_checkouts where user_id = p_user;
  attempt := public.billing_begin_whop_checkout(p_user);
  if existing_ref is distinct from (attempt ->> 'checkout_ref')::uuid then
    update public.whop_live_checkouts set variant_id = p_variant where user_id = p_user;
    attempt := attempt || jsonb_build_object('variant_id', p_variant);
  end if;
  return attempt;
end;
$$;

revoke all on function public.billing_begin_blackout_whop_checkout(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.billing_begin_blackout_whop_checkout(uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
