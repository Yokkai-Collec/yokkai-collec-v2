import "server-only";
import { createClient } from "@supabase/supabase-js";
import { BillingError } from "./config";

const apiOrigin = "https://sandbox-api.whop.com";
const checkoutOrigin = "https://sandbox.whop.com";
const previewPath = "/design-system/whop-preview";
const apiVersion = "2026-11-20";
const membershipStatuses = [
  "trialing",
  "active",
  "past_due",
  "completed",
  "canceled",
  "expired",
  "unresolved"
] as const;
type MembershipStatus = (typeof membershipStatuses)[number];
type Account = {
  checkout_ref: string;
  checkout_id: string | null;
  created_at: string;
  membership_id: string | null;
  membership_status: MembershipStatus | null;
  period_end: string | null;
  verified_at: string | null;
};
type Membership = {
  id: string;
  account?: { id: string };
  variant_id: string;
  user_id: string | null;
  metadata?: { yokkai_checkout_ref?: string };
  status: MembershipStatus;
  current_period_end: string | null;
  updated_at: string;
};

const unavailable = () => new BillingError("BILLING_UNAVAILABLE");
const notReady = () => new BillingError("BILLING_REVIEW_REQUIRED");

function localOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    )
      return url.origin;
  } catch {
    return null;
  }
  return null;
}

export function whopSandboxConfig(env = process.env) {
  if (env.NODE_ENV !== "development" || env.WHOP_MODE !== "sandbox")
    return null;
  const origin = localOrigin(env.NEXT_PUBLIC_SITE_URL);
  const database = localOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const {
    WHOP_API_KEY: key,
    WHOP_ACCOUNT_ID: account,
    WHOP_PRO_PLAN_ID: plan
  } = env;
  const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    !origin ||
    !database ||
    !serviceKey ||
    !key ||
    /\s/.test(key) ||
    !account ||
    !/^biz_[A-Za-z0-9]+$/.test(account) ||
    !plan ||
    !/^plan_[A-Za-z0-9]+$/.test(plan)
  )
    return null;
  return {
    origin,
    database,
    serviceKey,
    key,
    account,
    plan,
    scope: `sandbox:${account}:${plan}`
  };
}

type Config = NonNullable<ReturnType<typeof whopSandboxConfig>>;
const checkoutUrl = (id: string) => `${checkoutOrigin}/checkout/${id}/`;

export function whopSandboxService(config: Config, request = fetch) {
  const db = createClient(config.database, config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const fields =
    "checkout_ref,checkout_id,created_at,membership_id,membership_status,period_end,verified_at";

  async function provider<T>(path: string, init?: RequestInit): Promise<T> {
    try {
      const response = await request(apiOrigin + "/api/v1/" + path, {
        ...init,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + config.key,
          "Api-Version-Date": apiVersion,
          ...init?.headers
        }
      });
      if (!response.ok) throw unavailable();
      return await response.json();
    } catch {
      throw unavailable();
    }
  }

  function row(userId: string) {
    return db
      .from("whop_sandbox_accounts")
      .select(fields)
      .eq("user_id", userId)
      .eq("scope", config.scope)
      .maybeSingle<Account>();
  }

  async function accountFor(userId: string) {
    const { data, error } = await row(userId);
    if (error) throw unavailable();
    return data;
  }

  async function requireEnabled(userId: string) {
    const [setting, deletion] = await Promise.all([
      db
        .from("billing_entitlement_config")
        .select("whop_sandbox_scope")
        .eq("singleton", true)
        .single(),
      db
        .from("account_deletion_log")
        .select("user_id")
        .eq("user_id", userId)
        .limit(1)
    ]);
    if (setting.error || deletion.error) throw unavailable();
    if (
      setting.data.whop_sandbox_scope !== config.scope ||
      deletion.data.length
    )
      throw new BillingError("BILLING_DISABLED", 404);
  }

  // A durable per-account interval also prevents concurrent provider calls.
  async function claim(account: Account, stamp: Date) {
    const { data, error } = await db
      .from("whop_sandbox_accounts")
      .update({ next_sync_at: new Date(stamp.getTime() + 6000).toISOString() })
      .eq("checkout_ref", account.checkout_ref)
      .or(`next_sync_at.is.null,next_sync_at.lte.${stamp.toISOString()}`)
      .select("checkout_ref")
      .maybeSingle();
    if (error) throw unavailable();
    return !!data;
  }

  function membershipMatches(membership: Membership, account: Account) {
    return (
      membership?.account?.id === config.account &&
      membership.variant_id === config.plan &&
      /^mem_[A-Za-z0-9]+$/.test(membership.id) &&
      typeof membership.user_id === "string" &&
      /^user_[A-Za-z0-9]+$/.test(membership.user_id) &&
      membership.metadata?.yokkai_checkout_ref === account.checkout_ref
    );
  }

  async function readMembership(account: Account) {
    if (account.membership_id) {
      const result = await provider<Membership>(
        `memberships/${account.membership_id}`
      );
      if (
        result.id !== account.membership_id ||
        !membershipMatches(result, account)
      )
        throw notReady();
      return result;
    }
    const params = new URLSearchParams({
      account_id: config.account,
      variant_id: config.plan,
      first: "100",
      created_after: new Date(
        Date.parse(account.created_at) - 60000
      ).toISOString()
    });
    const response = await provider<{
      data: Membership[];
      page_info: { has_next_page: boolean };
    }>(`memberships?${params}`);
    if (
      !Array.isArray(response.data) ||
      response.page_info?.has_next_page !== false
    )
      throw notReady();
    const matches = response.data.filter(membership =>
      membershipMatches(membership, account)
    );
    if (matches.length > 1) throw notReady();
    return matches[0] ?? null;
  }

  return {
    async checkout(userId: string) {
      await requireEnabled(userId);
      const insert = await db
        .from("whop_sandbox_accounts")
        .upsert(
          { user_id: userId, scope: config.scope },
          { onConflict: "user_id,scope", ignoreDuplicates: true }
        );
      if (insert.error) throw unavailable();
      const account = await accountFor(userId);
      if (!account) throw unavailable();
      if (account.membership_id)
        throw new BillingError("BILLING_USE_PORTAL", 409);
      if (account.checkout_id) return checkoutUrl(account.checkout_id);
      const stamp = new Date();
      if (stamp.getTime() - Date.parse(account.created_at) >= 23 * 3600000)
        throw notReady();
      if (!(await claim(account, stamp)))
        throw new BillingError("BILLING_BUSY", 409);
      const checkout = await provider<{
        id: string;
        account_id: string;
        purchase_url: string;
        mode: string;
        variant?: {
          id: string;
          currency: string;
          billing_type: string;
          billing_period: number;
          initial_price: number;
          renewal_price: number;
          trial_period_days: number;
        };
      }>("checkout_configurations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `yokkai-sandbox:${account.checkout_ref}`
        },
        body: JSON.stringify({
          account_id: config.account,
          variant_id: config.plan,
          mode: "payment",
          metadata: { yokkai_checkout_ref: account.checkout_ref },
          redirect_url: config.origin + previewPath
        })
      });
      const variant = checkout.variant;
      if (
        !/^ch_[A-Za-z0-9]+$/.test(checkout.id) ||
        checkout.account_id !== config.account ||
        checkout.mode !== "payment" ||
        variant?.id !== config.plan ||
        variant.currency !== "eur" ||
        variant.billing_type !== "renewal" ||
        variant.billing_period !== 30 ||
        variant.initial_price !== 0 ||
        variant.renewal_price !== 4.99 ||
        variant.trial_period_days !== 3 ||
        typeof checkout.purchase_url !== "string" ||
        checkout.purchase_url.replace(/\/$/, "") !==
          checkoutUrl(checkout.id).slice(0, -1)
      )
        throw notReady();
      const { data, error } = await db
        .from("whop_sandbox_accounts")
        .update({ checkout_id: checkout.id, next_sync_at: null })
        .eq("checkout_ref", account.checkout_ref)
        .is("checkout_id", null)
        .select("checkout_ref")
        .maybeSingle();
      if (error || !data) throw unavailable();
      return checkoutUrl(checkout.id);
    },
    async status(userId: string) {
      await requireEnabled(userId);
      let account = await accountFor(userId);
      if (!account?.checkout_id)
        return { status: "not_started", active: false };
      const stamp = new Date();
      if (await claim(account, stamp)) {
        const membership = await readMembership(account);
        if (membership) {
          if (
            !membershipStatuses.includes(membership.status) ||
            !Number.isFinite(Date.parse(membership.updated_at)) ||
            (membership.current_period_end !== null &&
              !Number.isFinite(Date.parse(membership.current_period_end)))
          )
            throw notReady();
          const { error } = await db.rpc("whop_sandbox_save_membership", {
            p_ref: account.checkout_ref,
            p_membership: membership.id,
            p_status: membership.status,
            p_period_end: membership.current_period_end,
            p_updated_at: membership.updated_at,
            p_verified_at: stamp.toISOString()
          });
          if (error) throw unavailable();
          account = await accountFor(userId);
        }
      }
      const now = Date.now();
      const active =
        !!account?.period_end &&
        !!account.verified_at &&
        (account.membership_status === "trialing" ||
          account.membership_status === "active") &&
        Date.parse(account.period_end) > now &&
        Date.parse(account.verified_at) > now - 15 * 60000;
      return { status: account?.membership_status ?? "pending", active };
    }
  };
}
