import { createClient } from "@supabase/supabase-js";

const rest = "https://api.whop.com/api/v1/";
const version = "2026-11-20";
const membershipId = /^mem_[A-Za-z0-9]+$/;
const states = new Set([
  "trialing",
  "active",
  "past_due",
  "completed",
  "canceled",
  "expired",
  "unresolved"
]);
const validTime = value =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const canAccess = status => status === "active" || status === "trialing";
const terminal = status => status === "canceled" || status === "expired";

export function liveWhopConfig(env) {
  if (
    env.NODE_ENV !== "production" ||
    env.NEXT_PUBLIC_SITE_URL !== "https://yokkai-collec.com"
  )
    throw Error("WHOP_LIVE_WRONG_ENVIRONMENT");
  if (
    !/^biz_[A-Za-z0-9]+$/.test(env.WHOP_LIVE_ACCOUNT_ID ?? "") ||
    !env.WHOP_LIVE_API_KEY ||
    /\s/.test(env.WHOP_LIVE_API_KEY)
  )
    throw Error("WHOP_LIVE_CONFIGURATION");
  return { account: env.WHOP_LIVE_ACCOUNT_ID, key: env.WHOP_LIVE_API_KEY };
}

async function requestWhop(config, path, request, timeout, body) {
  const response = await request(rest + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + config.key,
      "Api-Version-Date": version,
      Accept: "application/json",
      ...(body && { "Content-Type": "application/json" })
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw Error("WHOP_LIVE_PROVIDER_UNAVAILABLE");
  return response.json();
}

function membershipMatches(row, config, membership) {
  return (
    membership?.id === row.membership_id &&
    membership.account?.id === config.account &&
    membership.member_id === row.member_id &&
    membership.product_id === row.product_id &&
    membership.variant_id === row.variant_id &&
    states.has(membership.status)
  );
}

function membershipPath(row, config) {
  if (
    row.whop_account_id !== config.account ||
    !membershipId.test(row.membership_id)
  )
    throw Error("WHOP_LIVE_ACCOUNT_MISMATCH");
  return "memberships/" + row.membership_id;
}

async function readMembership(row, config, request, timeout) {
  const membership = await requestWhop(
    config,
    membershipPath(row, config),
    request,
    timeout
  );
  if (!membershipMatches(row, config, membership))
    throw Error("WHOP_LIVE_MEMBERSHIP_MISMATCH");
  return membership;
}

export async function verifyWhopLiveAccess(
  row,
  config,
  request = fetch,
  now = Date.now()
) {
  const membership = await readMembership(row, config, request, 5000);
  if (!validTime(membership.updated_at)) throw Error("WHOP_LIVE_BAD_PERIOD");
  let accessUntil = null;
  if (canAccess(membership.status)) {
    const end = membership.current_period_end;
    if (!validTime(end) || !validTime(row.stripe_paid_until))
      throw Error("WHOP_LIVE_BAD_PERIOD");
    if (Date.parse(end) > now) {
      const priorPaidUntil = Date.parse(row.stripe_paid_until);
      if (priorPaidUntil > now) {
        // Stripe already paid for this time. A future Whop renewal cannot
        // extend this bridge without a verified successful payment.
        accessUntil = new Date(
          Math.min(priorPaidUntil, Date.parse(end))
        ).toISOString();
      } else if (membership.status === "active") {
        const start = membership.current_period_start;
        if (
          !validTime(start) ||
          Date.parse(start) > now ||
          Date.parse(start) >= Date.parse(end)
        )
          throw Error("WHOP_LIVE_BAD_PERIOD");
        const params = new URLSearchParams({
          account_id: config.account,
          membership_id: row.membership_id,
          first: "30",
          created_after: new Date(Date.parse(start) - 86400000).toISOString()
        });
        const payments = await requestWhop(
          config,
          "payments?" + params,
          request,
          5000
        );
        if (
          !Array.isArray(payments?.data) ||
          payments.page_info?.has_next_page !== false ||
          payments.data.some(
            payment =>
              payment.membership_id !== row.membership_id ||
              payment.account?.id !== config.account ||
              payment.product_id !== row.product_id
          )
        )
          throw Error("WHOP_LIVE_PAYMENT_MISMATCH");
        const current = payments.data.filter(
          payment =>
            validTime(payment.paid_at) &&
            Date.parse(payment.paid_at) >= Date.parse(start) - 300000 &&
            Date.parse(payment.paid_at) <= now
        );
        const blocked = current.some(
          payment =>
            payment.dispute_created_at ||
            payment.dispute_alerted_at ||
            payment.refunded_at ||
            Number(payment.refunded_amount?.amount ?? 0) !== 0
        );
        const paid = current.some(
          payment =>
            payment.status === "paid" &&
            payment.substatus === "succeeded" &&
            payment.subtotal?.currency === "eur" &&
            Number(payment.subtotal.amount) === 4.99
        );
        if (paid && !blocked) accessUntil = end;
      }
    }
  }
  return {
    status: membership.status,
    accessUntil,
    updatedAt: membership.updated_at
  };
}

export function whopLiveDb(env) {
  const database = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    database.protocol !== "https:" ||
    database.username ||
    database.password ||
    database.pathname !== "/" ||
    database.search ||
    database.hash ||
    ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
    !key
  ) {
    throw Error("WHOP_LIVE_CONFIGURATION");
  }
  return createClient(database.origin, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export async function reconcileWhopLive(
  env,
  { db, request = fetch, now = Date.now } = {}
) {
  if (env.WHOP_LIVE_SYNC_ENABLED !== "true")
    return { checked: 0, failed: 0, skipped: true };
  const config = liveWhopConfig(env);
  const store = db ?? whopLiveDb(env);
  const deadline = now() + 210000;
  let cursor = "00000000-0000-0000-0000-000000000000",
    checked = 0,
    failed = 0;
  while (now() < deadline) {
    const { data, error } = await store
      .from("whop_live_accounts")
      .select(
        "user_id,stripe_paid_until,whop_account_id,membership_id,member_id,product_id,variant_id"
      )
      .is("deletion_confirmed_at", null)
      .gt("user_id", cursor)
      .order("user_id")
      .limit(40);
    if (error || !Array.isArray(data))
      throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
    for (let start = 0; start < data.length; start += 4) {
      if (now() >= deadline) throw Error("WHOP_LIVE_DEADLINE");
      const batch = await Promise.allSettled(
        data.slice(start, start + 4).map(async row => {
          const stamp = now();
          const state = await verifyWhopLiveAccess(row, config, request, stamp);
          const write = await store.rpc("billing_save_whop_live_state", {
            p_membership: row.membership_id,
            p_status: state.status,
            p_access_until: state.accessUntil,
            p_provider_updated_at: state.updatedAt,
            p_verified_at: new Date(stamp).toISOString()
          });
          if (write.error) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
        })
      );
      checked += batch.length;
      failed += batch.filter(entry => entry.status === "rejected").length;
    }
    if (data.length < 40) return { checked, failed, skipped: false };
    cursor = data.at(-1).user_id;
  }
  throw Error("WHOP_LIVE_DEADLINE");
}

export async function cancelLinkedWhopAccount(
  userId,
  db,
  env = process.env,
  request = fetch
) {
  // Deployments may install this adapter before applying the additive migration.
  const { data: row, error } = await db
    .from("whop_live_accounts")
    .select(
      "whop_account_id,membership_id,member_id,product_id,variant_id,deletion_confirmed_at"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error?.code === "PGRST205" || error?.code === "42P01") return;
  if (error) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
  if (!row || row.deletion_confirmed_at) return;
  const config = liveWhopConfig(env);
  const path = membershipPath(row, config);
  const membership = await readMembership(row, config, request, 5000);
  if (!terminal(membership.status)) {
    const canceled = await requestWhop(
      config,
      path + "/cancel",
      request,
      5000,
      { cancel_at_period_end: false }
    );
    if (!membershipMatches(row, config, canceled) || !terminal(canceled.status))
      throw Error("WHOP_LIVE_CANCELLATION_UNVERIFIED");
  }
  const saved = await db.rpc("billing_confirm_whop_live_deletion", {
    p_user: userId,
    p_membership: row.membership_id
  });
  if (saved.error) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
}
