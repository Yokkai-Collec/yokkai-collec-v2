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
const blackFridayStartsAt = Date.parse("2026-11-26T20:00:00+01:00");
const blackFridayEndsAt = Date.parse("2026-11-30T21:00:00+01:00");
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
  return {
    account: env.WHOP_LIVE_ACCOUNT_ID,
    key: env.WHOP_LIVE_API_KEY,
    regularPlan: env.WHOP_LIVE_PLAN_ID
  };
}

async function requestWhop(
  config,
  path,
  request,
  timeout,
  body,
  idempotencyKey = undefined
) {
  const response = await request(rest + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + config.key,
      "Api-Version-Date": version,
      Accept: "application/json",
      ...(body && { "Content-Type": "application/json" }),
      ...(idempotencyKey && { "Idempotency-Key": idempotencyKey })
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

function verifiedRenewal(payment, membership, row, regularPlan) {
  if (payment.status !== "paid" || payment.substatus !== "succeeded")
    return false;
  const amount = Number(payment.subtotal?.amount);
  const sameVariant =
    payment.variant_id === row.variant_id ||
    payment.line_items?.some(
      item =>
        item.product_id === row.product_id && item.variant_id === row.variant_id
    );
  if (payment.subtotal?.currency === "eur") {
    if (amount === 4.99) return true;

    // A first charge can arrive after the promo expires when the buyer started a trial.
    const created = Date.parse(membership.created_at);
    const paid = Date.parse(payment.paid_at);
    const periodStart = Date.parse(membership.current_period_start);
    const firstChargeDeadline = created + 4 * 86400000;
    return (
      amount === 2.99 &&
      row.stripe_paid_until === null &&
      row.variant_id === regularPlan &&
      sameVariant &&
      payment.member_id === row.member_id &&
      /^promo_[A-Za-z0-9]+$/.test(payment.promo_code_id ?? "") &&
      created >= blackFridayStartsAt &&
      created < blackFridayEndsAt &&
      periodStart >= created - 300000 &&
      periodStart < firstChargeDeadline &&
      paid >= created - 300000 &&
      paid < firstChargeDeadline
    );
  }
  // Whop reports the variant price in EUR even when it collects in the buyer's currency.
  return (
    row.stripe_paid_until === null &&
    sameVariant &&
    payment.member_id === row.member_id &&
    membership.renewal_price?.currency === "eur" &&
    Number(membership.renewal_price.amount) === 4.99 &&
    /^[a-z]{3}$/.test(payment.subtotal?.currency) &&
    Number.isFinite(amount) &&
    amount > 0
  );
}

export async function verifyWhopLiveAccess(
  row,
  config,
  request = fetch,
  now = Date.now(),
  provided = undefined
) {
  const membership =
    provided ?? (await readMembership(row, config, request, 5000));
  if (!validTime(membership.updated_at)) throw Error("WHOP_LIVE_BAD_PERIOD");
  let accessUntil = null;
  if (canAccess(membership.status)) {
    const end = membership.current_period_end;
    if (
      !validTime(end) ||
      (row.stripe_paid_until !== null && !validTime(row.stripe_paid_until))
    )
      throw Error("WHOP_LIVE_BAD_PERIOD");
    if (Date.parse(end) > now) {
      const priorPaidUntil = Date.parse(row.stripe_paid_until);
      if (priorPaidUntil > now) {
        // Stripe already paid for this time. A future Whop renewal cannot
        // extend this bridge without a verified successful payment.
        accessUntil = new Date(
          Math.min(priorPaidUntil, Date.parse(end))
        ).toISOString();
      } else if (
        membership.status === "trialing" &&
        row.stripe_paid_until === null
      ) {
        const created = Date.parse(membership.created_at);
        const start = Date.parse(membership.current_period_start);
        if (
          Number.isFinite(created) &&
          created <= now &&
          start <= now &&
          Date.parse(end) <= created + 3 * 86400000 + 300000 &&
          membership.initial_price?.currency === "eur" &&
          Number(membership.initial_price.amount) === 0
        )
          accessUntil = end;
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
        const paid = current.some(payment =>
          verifiedRenewal(payment, membership, row, config.regularPlan)
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
          await refreshWhopAccess(store, row, config, request, stamp);
        })
      );
      checked += batch.length;
      failed += batch.filter(entry => entry.status === "rejected").length;
    }
    if (data.length < 40) {
      // A discovery failure must never prevent refreshing established subscriptions.
      try {
        await reconcileWhopCheckouts(
          env,
          store,
          config,
          request,
          deadline,
          now
        );
      } catch {
        failed++;
      }
      return { checked, failed, skipped: false };
    }
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
  if (!row) {
    await cancelPendingCheckout(userId, db, env, request);
    return;
  }
  if (row.deletion_confirmed_at) return;
  const config = liveWhopConfig(env);
  const membership = await readMembership(row, config, request, 5000);
  await cancelMembership(row, config, membership, request);
  const saved = await db.rpc("billing_confirm_whop_live_deletion", {
    p_user: userId,
    p_membership: row.membership_id
  });
  if (saved.error) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
}

const checkoutId = /^ch_[A-Za-z0-9]+$/;
const refId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const checkoutFields = "checkout_ref,checkout_id,created_at,membership_id";
const checkoutReturn =
  "https://yokkai-collec.com/settings?checkout=returned#subscription";

export function whopCheckoutEnabled(env = process.env) {
  return (
    env.NODE_ENV === "production" && env.WHOP_LIVE_CHECKOUT_ENABLED === "true"
  );
}

function checkoutPlan(env) {
  if (!/^plan_[A-Za-z0-9]+$/.test(env.WHOP_LIVE_PLAN_ID ?? ""))
    throw Error("WHOP_LIVE_CONFIGURATION");
  return env.WHOP_LIVE_PLAN_ID;
}

async function checkoutFor(db, userId) {
  const { data, error } = await db
    .from("whop_live_checkouts")
    .select(checkoutFields)
    .eq("user_id", userId)
    .maybeSingle();
  if (error?.code === "PGRST205" || error?.code === "42P01") return null;
  if (error) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
  return data;
}

function checkoutLocation(id) {
  if (!checkoutId.test(id)) throw Error("WHOP_LIVE_CHECKOUT_MISMATCH");
  return "https://whop.com/checkout/" + id;
}

export async function openWhopCheckout(
  userId,
  env = process.env,
  request = fetch,
  store = undefined
) {
  if (!whopCheckoutEnabled(env) || env.WHOP_LIVE_SYNC_ENABLED !== "true")
    throw Error("WHOP_LIVE_CHECKOUT_DISABLED");
  const config = liveWhopConfig(env);
  const plan = checkoutPlan(env);
  const db = store ?? whopLiveDb(env);
  const { data: attempt, error } = await db.rpc("billing_begin_whop_checkout", {
    p_user: userId
  });
  if (error?.message === "BILLING_USE_PORTAL" || attempt?.membership_id)
    throw Error("BILLING_USE_PORTAL");
  if (error || !refId.test(attempt?.checkout_ref))
    throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
  if (attempt.checkout_id) return checkoutLocation(attempt.checkout_id);
  // Retrying a failed database write reuses the same provider configuration.
  if (
    !validTime(attempt.created_at) ||
    Date.now() - Date.parse(attempt.created_at) > 23 * 3600000
  )
    throw Error("WHOP_LIVE_CHECKOUT_REVIEW_REQUIRED");
  const result = await requestWhop(
    config,
    "checkout_configurations",
    request,
    5000,
    {
      account_id: config.account,
      variant_id: plan,
      mode: "payment",
      redirect_url: checkoutReturn,
      metadata: { yokkai_checkout_ref: attempt.checkout_ref }
    },
    "yokkai-live:" + attempt.checkout_ref
  );
  const url = checkoutLocation(result?.id);
  const offer = result.variant;
  if (
    result.account_id !== config.account ||
    result.mode !== "payment" ||
    result.metadata?.yokkai_checkout_ref !== attempt.checkout_ref ||
    result.purchase_url?.replace(/\/$/, "") !== url ||
    offer?.id !== plan ||
    offer.currency !== "eur" ||
    offer.billing_type !== "renewal" ||
    offer.billing_period !== 30 ||
    offer.initial_price !== 0 ||
    offer.renewal_price !== 4.99 ||
    (offer.trial_period_days !== null && offer.trial_period_days !== 0)
  )
    throw Error("WHOP_LIVE_CHECKOUT_MISMATCH");
  const saved = await db.rpc("billing_save_whop_checkout", {
    p_user: userId,
    p_ref: attempt.checkout_ref,
    p_checkout: result.id
  });
  if (saved.error) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
  return url;
}

function newCheckoutMembership(membership, config, plan) {
  return (
    membership?.account?.id === config.account &&
    membership.variant_id === plan &&
    membershipId.test(membership.id) &&
    /^mber_[A-Za-z0-9]+$/.test(membership.member_id) &&
    /^prod_[A-Za-z0-9]+$/.test(membership.product_id) &&
    refId.test(membership.metadata?.yokkai_checkout_ref)
  );
}

async function listCheckoutMemberships(config, plan, request, from, visit) {
  const params = new URLSearchParams({
    account_id: config.account,
    variant_id: plan,
    first: "100",
    created_after: new Date(Date.parse(from) - 60000).toISOString()
  });
  for (let page = 0; page < 12; page++) {
    const result = await requestWhop(
      config,
      "memberships?" + params,
      request,
      5000
    );
    if (!Array.isArray(result?.data))
      throw Error("WHOP_LIVE_MEMBERSHIP_MISMATCH");
    for (const membership of result.data) {
      if (newCheckoutMembership(membership, config, plan))
        await visit(membership);
    }
    if (result.page_info?.has_next_page === false) return;
    const cursor = result.page_info?.end_cursor;
    if (!cursor || cursor === params.get("after")) break;
    params.set("after", cursor);
  }
  throw Error("WHOP_LIVE_INCOMPLETE_MEMBERSHIPS");
}

function membershipRow(membership) {
  return {
    whop_account_id: membership.account.id,
    membership_id: membership.id,
    member_id: membership.member_id,
    product_id: membership.product_id,
    variant_id: membership.variant_id,
    stripe_paid_until: null
  };
}

async function bindCheckoutMembership(
  db,
  config,
  plan,
  checkout,
  candidate,
  request
) {
  const row = membershipRow(candidate);
  const membership = await readMembership(row, config, request, 5000);
  if (
    !newCheckoutMembership(membership, config, plan) ||
    membership.metadata.yokkai_checkout_ref !== checkout.checkout_ref ||
    !validTime(membership.created_at) ||
    Date.parse(membership.created_at) < Date.parse(checkout.created_at) - 60000
  )
    throw Error("WHOP_LIVE_MEMBERSHIP_MISMATCH");
  const linked = await db.rpc("billing_attach_whop_checkout", {
    p_ref: checkout.checkout_ref,
    p_account: config.account,
    p_membership: membership.id,
    p_member: membership.member_id,
    p_product: membership.product_id,
    p_variant: membership.variant_id
  });
  if (linked.error) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
  if (linked.data === false) {
    // The player's deletion fence won. Cancel the verified new membership.
    await cancelMembership(row, config, membership, request);
    return null;
  }
  if (linked.data !== true) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
  return row;
}

async function reconcileWhopCheckouts(env, db, config, request, deadline, now) {
  if (!env.WHOP_LIVE_PLAN_ID) return;
  const plan = checkoutPlan(env);
  const pending = await db
    .from("whop_live_checkouts")
    .select("created_at")
    .not("checkout_id", "is", null)
    .is("membership_id", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (pending.error) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
  if (!pending.data) return;
  await listCheckoutMemberships(
    config,
    plan,
    request,
    pending.data.created_at,
    async membership => {
      if (now() >= deadline) throw Error("WHOP_LIVE_DEADLINE");
      const attempt = await db
        .from("whop_live_checkouts")
        .select(checkoutFields)
        .eq("checkout_ref", membership.metadata.yokkai_checkout_ref)
        .not("checkout_id", "is", null)
        .is("membership_id", null)
        .maybeSingle();
      if (attempt.error) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
      if (attempt.data) {
        const linked = await bindCheckoutMembership(
          db,
          config,
          plan,
          attempt.data,
          membership,
          request
        );
        if (linked) await refreshWhopAccess(db, linked, config, request, now());
      }
    }
  );
}

const liveStatusFields =
  "stripe_paid_until,whop_account_id,membership_id,member_id,product_id,variant_id,status,access_until,verified_at,cancel_at_period_end";

async function liveAccount(db, userId) {
  const result = await db
    .from("whop_live_accounts")
    .select(liveStatusFields)
    .eq("user_id", userId)
    .is("deletion_confirmed_at", null)
    .maybeSingle();
  if (result.error?.code === "42703") return null; // Transitional pre-migration schema.
  if (result.error) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
  return result.data;
}

export async function hasWhopCheckout(userId, env = process.env) {
  if (env.NODE_ENV !== "production" || env.WHOP_LIVE_SYNC_ENABLED !== "true")
    return false;
  const db = whopLiveDb(env);
  const [linked, attempt] = await Promise.all([
    liveAccount(db, userId),
    checkoutFor(db, userId)
  ]);
  return !!(linked || attempt);
}

export async function whopSubscriptionStatus(
  userId,
  env = process.env,
  request = fetch
) {
  if (env.NODE_ENV !== "production" || env.WHOP_LIVE_SYNC_ENABLED !== "true")
    return null;
  const db = whopLiveDb(env);
  let row = await liveAccount(db, userId);
  if (!row) {
    const attempt = await checkoutFor(db, userId);
    if (!attempt?.checkout_id || attempt.membership_id) return null;
    const config = liveWhopConfig(env),
      plan = checkoutPlan(env);
    let candidate;
    await listCheckoutMemberships(
      config,
      plan,
      request,
      attempt.created_at,
      membership => {
        if (membership.metadata.yokkai_checkout_ref === attempt.checkout_ref) {
          if (candidate) throw Error("WHOP_LIVE_MEMBERSHIP_MISMATCH");
          candidate = membership;
        }
      }
    );
    if (!candidate) return null;
    const linked = await bindCheckoutMembership(
      db,
      config,
      plan,
      attempt,
      candidate,
      request
    );
    if (!linked) return null;
    await refreshWhopAccess(db, linked, config, request, Date.now());
    row = await liveAccount(db, userId);
    if (!row) return null;
  }
  const end = Date.parse(row.access_until);
  const verified = Date.parse(row.verified_at);
  const now = Date.now();
  return {
    provider: "whop",
    hasCustomer: true,
    active:
      canAccess(row.status) &&
      end > now &&
      verified <= now &&
      verified > now - 900000,
    status: terminal(row.status) ? "canceled" : (row.status ?? "incomplete"),
    endsAt: Number.isFinite(end) ? Math.floor(end / 1000) : null,
    cancelAtPeriodEnd: row.cancel_at_period_end === true
  };
}

export async function whopManageUrl(
  userId,
  env = process.env,
  request = fetch
) {
  if (env.NODE_ENV !== "production" || env.WHOP_LIVE_SYNC_ENABLED !== "true")
    return null;
  const row = await liveAccount(whopLiveDb(env), userId);
  if (!row) return null;
  const membership = await readMembership(
    row,
    liveWhopConfig(env),
    request,
    5000
  );
  const url = new URL(membership.manage_url);
  if (
    url.origin !== "https://whop.com" ||
    url.username ||
    url.password ||
    url.pathname.replace(/\/$/, "") !== "/billing/manage/" + row.member_id
  )
    throw Error("WHOP_LIVE_MEMBERSHIP_MISMATCH");
  return url.href;
}

async function refreshWhopAccess(db, row, config, request, stamp) {
  const membership = await readMembership(row, config, request, 5000);
  const state = await verifyWhopLiveAccess(
    row,
    config,
    request,
    stamp,
    membership
  );
  const write = await db.rpc("billing_save_whop_checkout_state", {
    p_membership: row.membership_id,
    p_status: state.status,
    p_access_until: state.accessUntil,
    p_provider_updated_at: state.updatedAt,
    p_verified_at: new Date(stamp).toISOString(),
    p_cancel_at_period_end: membership.cancel_at_period_end === true
  });
  if (write.error) throw Error("WHOP_LIVE_STORE_UNAVAILABLE");
}

async function cancelMembership(row, config, membership, request) {
  if (terminal(membership.status)) return;
  const canceled = await requestWhop(
    config,
    membershipPath(row, config) + "/cancel",
    request,
    5000,
    { cancel_at_period_end: false },
    "yokkai-deletion:" + row.membership_id
  );
  if (!membershipMatches(row, config, canceled) || !terminal(canceled.status))
    throw Error("WHOP_LIVE_CANCELLATION_UNVERIFIED");
}

async function cancelPendingCheckout(userId, db, env, request) {
  if (!env.WHOP_LIVE_PLAN_ID) return;
  const pending = await checkoutFor(db, userId);
  if (!pending?.checkout_id) return;
  const config = liveWhopConfig(env),
    plan = checkoutPlan(env);
  await listCheckoutMemberships(
    config,
    plan,
    request,
    pending.created_at,
    async candidate => {
      if (candidate.metadata.yokkai_checkout_ref !== pending.checkout_ref)
        return;
      const row = membershipRow(candidate);
      const membership = await readMembership(row, config, request, 5000);
      if (
        !newCheckoutMembership(membership, config, plan) ||
        membership.metadata.yokkai_checkout_ref !== pending.checkout_ref
      )
        throw Error("WHOP_LIVE_MEMBERSHIP_MISMATCH");
      await cancelMembership(row, config, membership, request);
    }
  );
}
