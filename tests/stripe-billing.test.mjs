import { intlServer } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import Stripe from "stripe";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const env = {
  NODE_ENV: "development",
  STRIPE_BILLING_ENABLED: "true",
  STRIPE_BILLING_MODE: "test",
  STRIPE_CHECKOUT_ENABLED: "true",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "server_test_key",
  STRIPE_SECRET_KEY: "sk_test_example",
  STRIPE_PRO_PRICE_ID: "price_example",
  STRIPE_ACCOUNT_ID: "acct_example",
  STRIPE_PRO_WEBHOOK_SECRET: "whsec_example"
};
function loader(options = {}) {
  const cache = new Map();
  function load(file) {
    const path = resolve(root, file);
    if (cache.has(path)) return cache.get(path);
    const compiled = { exports: {} };
    cache.set(path, compiled.exports);
    vm.runInNewContext(
      ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true
        }
      }).outputText,
      {
        exports: compiled.exports,
        module: compiled,
        Error,
        Date: options.Date ?? Date,
        URL,
        Request,
        Response,
        Buffer,
        console,
        process: { env: options.env ?? env },
        require(id) {
          if (id === "next-intl/server") return intlServer;
          if (id === "server-only") return {};
          if (options.mocks?.[id]) return options.mocks[id];
          if (id.startsWith("./")) return load(resolve(path, "..", id + ".ts"));
          if (id.startsWith("@/")) return load(id.slice(2) + ".ts");
          return require(id);
        }
      }
    );
    return compiled.exports;
  }
  return load;
}
const load = loader();
const { billingConfig, BillingError } = load("lib/billing/config.ts");
const { subscriptionState, validateProPrice, stripeDestination } = load(
  "lib/billing/subscription.ts"
);
const { billingService } = load("lib/billing/server.ts");
const userId = "00000000-0000-0000-0000-000000000001";
test("restricted billing keys remain mode-bound and public or organization keys are rejected", () => {
  const live = {
    ...env,
    NODE_ENV: "production",
    STRIPE_BILLING_MODE: "live",
    NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://database.invalid"
  };
  for (const prefix of ["sk", "rk"]) {
    assert.equal(
      billingConfig({ ...env, STRIPE_SECRET_KEY: `${prefix}_test_example` })
        .live,
      false
    );
    assert.equal(
      billingConfig({ ...live, STRIPE_SECRET_KEY: `${prefix}_live_example` })
        .live,
      true
    );
    assert.throws(
      () =>
        billingConfig({ ...env, STRIPE_SECRET_KEY: `${prefix}_live_example` }),
      /BILLING_CONFIGURATION/
    );
    assert.throws(
      () =>
        billingConfig({ ...live, STRIPE_SECRET_KEY: `${prefix}_test_example` }),
      /BILLING_CONFIGURATION/
    );
  }
  for (const secret of [
    "pk_live_example",
    "pk_test_example",
    "sk_org_example",
    "rk_org_example",
    "rk_live_",
    "rk_live_example\n"
  ]) {
    assert.throws(
      () => billingConfig({ ...live, STRIPE_SECRET_KEY: secret }),
      /BILLING_CONFIGURATION/
    );
  }
});
function subscription(changes = {}) {
  return {
    id: "sub_example",
    customer: "cus_example",
    livemode: false,
    status: "active",
    pause_collection: null,
    cancel_at_period_end: false,
    latest_invoice: {
      status: "paid",
      livemode: false,
      amount_paid: 499,
      currency: "eur",
      parent: { subscription_details: { subscription: "sub_example" } },
      lines: {
        has_more: false,
        data: [
          {
            pricing: { price_details: { price: "price_example" } },
            period: { start: 1, end: 2000000000 },
            amount: 499
          }
        ]
      }
    },
    items: {
      data: [
        {
          price: { id: "price_example" },
          quantity: 1,
          current_period_end: Math.floor(Date.now() / 1000) + 86400
        }
      ]
    },
    ...changes
  };
}
function fixture(config = billingConfig(env)) {
  const calls = [],
    events = new Set();
  const row = {
    id: "row",
    user_id: userId,
    scope: config.scope,
    stripe_customer_id: null,
    checkout_id: null,
    checkout_nonce: "nonce1",
    lease_token: "token",
    risk_hold: false,
    customer_started_at: null,
    checkout_started_at: null
  };
  const state = {
    subs: [],
    price: {
      active: true,
      livemode: config.live,
      type: "recurring",
      currency: "eur",
      unit_amount: 499,
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "licensed"
      }
    },
    checkout: {
      id: "cs_test_example",
      status: "open",
      customer: "cus_example",
      client_reference_id: userId,
      livemode: config.live,
      url: "https://checkout.stripe.com/c/pay/example"
    },
    claimed: false,
    saves: []
  };
  const stripe = {
    accounts: { retrieve: async () => ({ id: config.account }) },
    prices: { retrieve: async () => state.price },
    customers: {
      create: async (params, options) => {
        calls.push(["customer", params, options]);
        return { id: "cus_example", livemode: config.live };
      }
    },
    subscriptions: {
      list: async () => ({ has_more: false, data: state.subs })
    },
    checkout: {
      sessions: {
        retrieve: async () => state.checkout,
        create: async (params, options) => {
          calls.push(["checkout", params, options]);
          return state.checkout;
        }
      }
    },
    billingPortal: {
      sessions: {
        create: async params => {
          calls.push(["portal", params]);
          return { url: "https://billing.stripe.com/p/session" };
        }
      }
    },
    webhooks: new Stripe("sk_test_example").webhooks,
    charges: {
      retrieve: async () => ({ customer: "cus_example", livemode: config.live })
    }
  };
  const store = {
    claim: async id => {
      assert.equal(id, userId);
      if (state.claimed) throw new BillingError("BILLING_BUSY");
      state.claimed = true;
      return structuredClone(row);
    },
    release: async () => {
      state.claimed = false;
    },
    save: async (_account, change) => {
      state.saves.push(change);
      if (change.customer) row.stripe_customer_id = change.customer;
      if (change.checkout) row.checkout_id = change.checkout;
      if (change.prepareCustomer)
        row.customer_started_at ??= new Date().toISOString();
      if (change.prepareCheckout)
        row.checkout_started_at ??= new Date().toISOString();
      if (change.rotate) {
        row.checkout_nonce = "nonce2";
        row.checkout_id = null;
        row.checkout_started_at = null;
      }
      if (change.hold) row.risk_hold = true;
      if (change.event) events.add(change.event);
      return row.checkout_nonce;
    },
    owner: async customer =>
      customer === row.stripe_customer_id ? userId : undefined,
    processed: async event => events.has(event),
    reconciliationPage: async () => [{ user_id: userId }]
  };
  const service = billingService(config, stripe, store);
  const webhook = event => {
    const body = JSON.stringify({
      id: "evt_example",
      livemode: config.live,
      type: "invoice.paid",
      data: { object: { customer: "cus_example" } },
      ...event
    });
    return service.webhook(
      body,
      stripe.webhooks.generateTestHeaderString({
        payload: body,
        secret: config.webhookSecret
      })
    );
  };
  return { service, stripe, store, row, state, calls, webhook, events };
}

test("portal cancellation timestamps at the paid period end are displayed without revoking paid access", () => {
  const s = subscription();
  const end = s.items.data[0].current_period_end;
  const get = changes =>
    subscriptionState(
      { data: [{ ...s, ...changes }], has_more: false },
      "price_example",
      false
    );
  assert.equal(get({ cancel_at: end }).cancelAtPeriodEnd, true);
  assert.equal(get({ cancel_at: end }).active, true);
  assert.equal(get({ cancel_at: end }).endsAt, end);
  assert.equal(
    get({ cancel_at_period_end: true, cancel_at: null }).cancelAtPeriodEnd,
    true
  );
  for (const cancel_at of [
    null,
    undefined,
    0,
    -1,
    NaN,
    end + 86400,
    end - 86400
  ]) {
    assert.equal(get({ cancel_at }).cancelAtPeriodEnd, false);
  }
  assert.equal(
    get({ cancel_at: null, canceled_at: Math.floor(Date.now() / 1000) })
      .cancelAtPeriodEnd,
    false
  );
  assert.equal(get({ cancel_at: end, status: "canceled" }).active, false);
});

test("refresh persists portal cancellation and clears it when Stripe removes the scheduled date", async () => {
  const { service, row, state } = fixture();
  row.stripe_customer_id = "cus_example";
  const s = subscription();
  s.cancel_at = s.items.data[0].current_period_end;
  state.subs = [s];
  const canceled = await service.status(userId);
  assert.equal(canceled.cancelAtPeriodEnd, true);
  assert.equal(canceled.active, true);
  assert.equal(state.saves.at(-1).state.cancelAtPeriodEnd, true);
  s.cancel_at = null;
  const resumed = await service.status(userId);
  assert.equal(resumed.cancelAtPeriodEnd, false);
  assert.equal(resumed.active, true);
  assert.equal(state.saves.at(-1).state.cancelAtPeriodEnd, false);
});

test("billing is closed by default and strictly separates local test and live production configuration", () => {
  assert.throws(() => billingConfig({}), /BILLING_DISABLED/);
  assert.equal(billingConfig(env).live, false);
  for (const change of [
    { NODE_ENV: "production" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://production.invalid" },
    { STRIPE_SECRET_KEY: "sk_live_example" },
    { STRIPE_BILLING_MODE: "unknown" },
    { SUPABASE_SECRET_KEY: "" },
    { STRIPE_ACCOUNT_ID: "" }
  ])
    assert.throws(
      () => billingConfig({ ...env, ...change }),
      /BILLING_CONFIGURATION/
    );
  const live = {
    ...env,
    NODE_ENV: "production",
    STRIPE_BILLING_MODE: "live",
    STRIPE_SECRET_KEY: "sk_live_example",
    NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://database.invalid"
  };
  assert.equal(billingConfig(live).live, true);
  for (const change of [
    { NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com.evil.invalid" },
    { NEXT_PUBLIC_SITE_URL: "http://yokkai-collec.com" },
    { NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com/?query=x" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" },
    { STRIPE_SECRET_KEY: "sk_test_example" }
  ])
    assert.throws(() => billingConfig({ ...live, ...change }));
});
test("entitlements require an active, unpaused, unexpired, paid, single-item subscription of the correct price and mode", () => {
  const s = subscription();
  const get = sub =>
    subscriptionState({ data: [sub], has_more: false }, "price_example", false);
  assert.equal(get(s).active, true);
  assert.equal(get({ ...s, cancel_at_period_end: true }).active, true);
  for (const status of [
    "trialing",
    "incomplete",
    "incomplete_expired",
    "past_due",
    "canceled",
    "unpaid",
    "paused"
  ])
    assert.equal(get({ ...s, status }).active, false);
  for (const change of [
    { pause_collection: {} },
    { latest_invoice: null },
    { latest_invoice: "in_unexpanded" },
    { latest_invoice: { status: "open", amount_paid: 499, livemode: false } },
    { latest_invoice: { status: "paid", amount_paid: 0, livemode: false } },
    { latest_invoice: { status: "paid", amount_paid: 499, livemode: true } },
    {
      items: {
        data: [
          {
            price: { id: "other" },
            quantity: 1,
            current_period_end: 2000000000
          }
        ]
      }
    },
    {
      items: {
        data: [
          {
            price: { id: "price_example" },
            quantity: 2,
            current_period_end: 2000000000
          }
        ]
      }
    },
    {
      items: {
        data: [
          { price: { id: "price_example" }, quantity: 1, current_period_end: 1 }
        ]
      }
    }
  ])
    assert.equal(get({ ...s, ...change }).active, false);
  assert.throws(() => get({ ...s, livemode: true }), /BILLING_REVIEW_REQUIRED/);
  assert.throws(() =>
    subscriptionState({ data: [s], has_more: true }, "price_example", false)
  );
  assert.throws(() =>
    subscriptionState({ data: [s, s], has_more: false }, "price_example", false)
  );
  for (const latest_invoice of [
    {
      ...s.latest_invoice,
      parent: { subscription_details: { subscription: "sub_other" } }
    },
    {
      ...s.latest_invoice,
      lines: { has_more: true, data: s.latest_invoice.lines.data }
    },
    { ...s.latest_invoice, currency: "usd" },
    {
      ...s.latest_invoice,
      lines: {
        has_more: false,
        data: [
          { ...s.latest_invoice.lines.data[0], period: { start: 1, end: 2 } }
        ]
      }
    }
  ])
    assert.equal(get({ ...s, latest_invoice }).active, false);
});
test("price validation rejects wrong amount, currency, cadence, type and mode", () => {
  const { state } = fixture();
  assert.doesNotThrow(() => validateProPrice(state.price, false));
  for (const change of [
    { livemode: true },
    { active: false },
    { unit_amount: 1 },
    { currency: "usd" },
    { type: "one_time" },
    {
      recurring: { interval: "year", interval_count: 1, usage_type: "licensed" }
    }
  ])
    assert.throws(() => validateProPrice({ ...state.price, ...change }, false));
  for (const url of [
    null,
    "https://evil.invalid/checkout",
    "https://checkout.stripe.com.evil.invalid",
    "https://user@checkout.stripe.com/pay"
  ])
    assert.throws(() => stripeDestination(url, "https://checkout.stripe.com"));
});
test("checkout persists the server-owned customer first, fixes amount and identity, reuses an open session and blocks duplicates", async () => {
  const f = fixture();
  await f.service.checkout(userId);
  await f.service.checkout(userId);
  assert.equal(f.calls.filter(c => c[0] === "customer").length, 1);
  assert.equal(f.calls.filter(c => c[0] === "checkout").length, 1);
  assert.equal(f.state.saves[0].prepareCustomer, true);
  assert.equal(f.row.stripe_customer_id, "cus_example");
  const [, params, options] = f.calls.find(c => c[0] === "checkout");
  assert.equal(params.client_reference_id, userId);
  assert.equal(params.customer, "cus_example");
  assert.equal(params.line_items[0].price, "price_example");
  assert.equal(params.line_items[0].quantity, 1);
  assert.equal(params.mode, "subscription");
  assert.equal(
    params.success_url,
    "http://localhost:3000/settings?checkout=returned#subscription"
  );
  assert.equal(
    params.cancel_url,
    "http://localhost:3000/settings?checkout=canceled#subscription"
  );
  assert.match(options.idempotencyKey, /row:nonce1$/);
  f.state.subs = [subscription()];
  await assert.rejects(f.service.checkout(userId), /BILLING_USE_PORTAL/);
  const closed = fixture({ ...billingConfig(env), checkoutEnabled: false });
  await assert.rejects(
    closed.service.checkout(userId),
    /BILLING_CHECKOUT_CLOSED/
  );
  assert.equal(closed.state.saves.length, 0);
});
test("expired checkouts rotate the persisted nonce; completed checkouts and uncertain operations older than idempotency retention fail closed", async () => {
  const f = fixture();
  f.row.stripe_customer_id = "cus_example";
  f.row.checkout_id = "cs_test_old";
  f.state.checkout.status = "expired";
  await f.service.checkout(userId);
  assert.match(
    f.calls.find(c => c[0] === "checkout")[2].idempotencyKey,
    /nonce2$/
  );
  f.state.checkout.status = "complete";
  await assert.rejects(f.service.checkout(userId), /BILLING_USE_PORTAL/);
  f.state.subs = [subscription({ status: "canceled" })];
  f.state.checkout.subscription = "sub_example";
  await assert.doesNotReject(f.service.checkout(userId));
  const late = fixture();
  late.row.customer_started_at = "2020-01-01T00:00:00Z";
  await assert.rejects(
    late.service.checkout(userId),
    /BILLING_REVIEW_REQUIRED/
  );
  assert.equal(late.calls.length, 0);
  const uncertain = fixture();
  uncertain.row.stripe_customer_id = "cus_example";
  uncertain.row.checkout_started_at = "2020-01-01T00:00:00Z";
  await assert.rejects(
    uncertain.service.checkout(userId),
    /BILLING_REVIEW_REQUIRED/
  );
});
test("concurrent requests serialize, account/mode mismatches cannot create checkout, and leases release after errors", async () => {
  const f = fixture();
  let proceed;
  const gate = new Promise(resolve => {
    proceed = resolve;
  });
  const create = f.stripe.customers.create;
  f.stripe.customers.create = async (...args) => {
    await gate;
    return create(...args);
  };
  const first = f.service.checkout(userId);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.service.checkout(userId), /BILLING_BUSY/);
  proceed();
  await first;
  assert.equal(f.calls.filter(c => c[0] === "checkout").length, 1);
  f.stripe.accounts.retrieve = async () => ({ id: "acct_other" });
  await assert.rejects(f.service.checkout(userId), /BILLING_ACCOUNT_MISMATCH/);
  const wrong = fixture();
  wrong.stripe.customers.create = async () => ({
    id: "cus_wrong",
    livemode: true
  });
  await assert.rejects(wrong.service.checkout(userId), /BILLING_MODE_MISMATCH/);
  assert.equal(wrong.state.claimed, false);
});
test("signed webhooks deduplicate, reread Stripe for late events and ignore untrusted customer metadata", async () => {
  const f = fixture();
  f.row.stripe_customer_id = "cus_example";
  f.state.subs = [subscription()];
  await f.webhook();
  assert.equal(f.state.saves.at(-1).state.active, true);
  const saves = f.state.saves.length;
  await f.webhook();
  assert.equal(f.state.saves.length, saves);
  f.state.subs = [subscription({ status: "canceled" })];
  await f.webhook({ id: "evt_late", type: "customer.subscription.created" });
  assert.equal(f.state.saves.at(-1).state.active, false);
  await f.webhook({
    id: "evt_unknown",
    data: {
      object: { customer: "cus_unknown", metadata: { yokkai_user_id: userId } }
    }
  });
  assert.equal(f.events.has("evt_unknown"), false);
  await assert.rejects(
    f.service.webhook("{}", "invalid"),
    /BILLING_SIGNATURE_INVALID/
  );
  await assert.rejects(
    f.webhook({ id: "evt_live", livemode: true }),
    /BILLING_MODE_MISMATCH/
  );
  await assert.rejects(
    f.webhook({ id: "evt_connect", account: "acct_connected" }),
    /BILLING_MODE_MISMATCH/
  );
  f.store.save = async () => {
    throw new Error("DB unavailable");
  };
  await assert.rejects(f.webhook({ id: "evt_retry" }), /DB unavailable/);
  assert.equal(f.events.has("evt_retry"), false);
});
test("refunds and disputes put a sticky hold on access; portal and reconciliation use only server-owned identities", async () => {
  const f = fixture();
  f.row.stripe_customer_id = "cus_example";
  f.state.subs = [subscription()];
  await f.webhook({
    type: "charge.dispute.created",
    data: { object: { charge: "ch_example" } }
  });
  assert.equal(f.row.risk_hold, true);
  await f.webhook({ id: "evt_after", type: "invoice.paid" });
  assert.equal(f.state.saves.at(-1).state.active, false);
  await f.service.portal(userId);
  assert.equal(f.calls.find(c => c[0] === "portal")[1].customer, "cus_example");
  assert.equal(
    f.calls.find(c => c[0] === "portal")[1].return_url,
    "http://localhost:3000/settings#subscription"
  );
  assert.equal((await f.service.status(userId)).active, false);
  const result = await f.service.reconcile(
    "00000000-0000-0000-0000-000000000000"
  );
  assert.equal(result.checked, 1);
  assert.equal(result.failed, 0);
  f.stripe.subscriptions.list = async () => {
    throw new Error("Provider unavailable");
  };
  assert.equal((await f.service.reconcile("")).failed, 1);
});
test("HTTP derives the account from Auth, rejects cross-site posts and forged price/user payloads, bounds bodies and masks secrets", async () => {
  const local = loader({
    mocks: {
      "@/lib/auth/session": { getCurrentUser: async () => ({ id: userId }) }
    }
  });
  const http = local("lib/billing/http.ts");
  const request = (body = "{}", origin = env.NEXT_PUBLIC_SITE_URL) =>
    new Request(origin + "/api/billing/checkout", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body
    });
  assert.equal((await http.billingUser(request(), true)).id, userId);
  await assert.rejects(
    http.billingUser(request("{}", "https://evil.invalid"), true),
    /BILLING_REQUEST_DENIED/
  );
  for (const body of [
    '{"price":"cheap"}',
    '{"userId":"other"}',
    "[]",
    "null",
    "bad"
  ])
    await assert.rejects(
      http.emptyBillingInput(request(body)),
      /BILLING_INVALID_REQUEST/
    );
  await assert.rejects(
    http.billingBody(request("x".repeat(2000)), 1024),
    /BILLING_INVALID_REQUEST/
  );
  const noUser = loader({
    mocks: { "@/lib/auth/session": { getCurrentUser: async () => null } }
  })("lib/billing/http.ts");
  await assert.rejects(noUser.billingUser(request()), /BILLING_AUTH_REQUIRED/);
  const reply = http.billingFailure(new Error("sk_live_do_not_leak"));
  assert.equal(reply.status, 503);
  assert.doesNotMatch(await reply.text(), /sk_live/);
  assert.match(reply.headers.get("cache-control"), /no-store/);
  assert.throws(
    () => http.requireBillingReconciliation(request()),
    /BILLING_AUTH_REQUIRED/
  );
  const cron = loader({
    env: { ...env, STRIPE_RECONCILIATION_SECRET: "a".repeat(32) },
    mocks: { "@/lib/auth/session": {} }
  })("lib/billing/http.ts");
  assert.doesNotThrow(() =>
    cron.requireBillingReconciliation(
      new Request("http://localhost:3000/api/billing/reconcile", {
        headers: { authorization: "Bearer " + "a".repeat(32) }
      })
    )
  );
});

test("actual route handlers enforce Auth/Origin and never select billing accounts from query strings or request bodies", async () => {
  const calls = [];
  const quotaCalls = [];
  const routeLoad = loader({
    mocks: {
      "@/lib/auth/session": { getCurrentUser: async () => ({ id: userId }) },
      "@/lib/billing/rate-limit": {
        BillingRateLimitError: class extends BillingError {},
        consumeBillingRequest: async (id, action) => {
          quotaCalls.push([action, id]);
        }
      },
      "@/lib/billing/server": {
        configuredBillingService: () => ({
          webhook: async (body, signature) => {
            calls.push(["webhook", body, signature]);
          },
          reconcile: async () => {
            throw new Error("must not reconcile without secret");
          }
        })
      },
      "@/lib/billing/checkout-service": {
        configuredBillingService: () => ({
          checkout: async id => {
            calls.push(["checkout", id]);
            return "https://checkout.stripe.com/example";
          },
          portal: async id => {
            calls.push(["portal", id]);
            return "https://billing.stripe.com/example";
          },
          status: async id => {
            calls.push(["status", id]);
            return { active: false };
          }
        })
      }
    }
  });
  const post = (body = "{}", origin = env.NEXT_PUBLIC_SITE_URL) =>
    new Request(
      env.NEXT_PUBLIC_SITE_URL + "/api/billing/checkout?userId=other",
      {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body
      }
    );
  for (const route of ["checkout", "portal"]) {
    const handler = routeLoad(`app/api/billing/${route}/route.ts`).POST;
    assert.equal((await handler(post())).status, 200);
    assert.deepEqual(calls.at(-1), [route, userId]);
    assert.deepEqual(quotaCalls.at(-1), [route, userId]);
    const count = calls.length;
    const quotaCount = quotaCalls.length;
    assert.equal((await handler(post('{"userId":"other"}'))).status, 400);
    assert.equal(
      (await handler(post("{}", "https://evil.invalid"))).status,
      403
    );
    assert.equal(calls.length, count);
    assert.equal(quotaCalls.length, quotaCount);
  }
  assert.equal(
    (
      await routeLoad("app/api/billing/status/route.ts").GET(
        new Request("http://localhost:3000/api/billing/status?userId=other")
      )
    ).status,
    200
  );
  assert.deepEqual(calls.at(-1), ["status", userId]);
  assert.deepEqual(quotaCalls.at(-1), ["status", userId]);
  const hook = routeLoad("app/api/billing/webhook/route.ts").POST;
  assert.equal(
    (
      await hook(
        new Request("http://localhost:3000/api/billing/webhook", {
          method: "POST",
          body: "{}"
        })
      )
    ).status,
    400
  );
  assert.equal(
    (
      await hook(
        new Request("http://localhost:3000/api/billing/webhook", {
          method: "POST",
          headers: { "stripe-signature": "signed" },
          body: '{ "untouched": true }'
        })
      )
    ).status,
    200
  );
  assert.deepEqual(calls.at(-1), [
    "webhook",
    '{ "untouched": true }',
    "signed"
  ]);
  assert.equal(
    (await routeLoad("app/api/billing/reconcile/route.ts").POST(post())).status,
    401
  );
});

test("quota denial returns a safe retry delay and stops the actual billing route before Stripe", async () => {
  const local = loader();
  const { BillingRateLimitError } = local("lib/billing/rate-limit.ts");
  const { billingFailure } = local("lib/billing/http.ts");
  const response = billingFailure(new BillingRateLimitError(60));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    code: "BILLING_RATE_LIMITED",
    error: "Too many requests. Please try again shortly."
  });
  let providerCalls = 0;
  const routeLoad = loader({
    mocks: {
      "./config": local("lib/billing/config.ts"),
      "./rate-limit": { BillingRateLimitError },
      "@/lib/auth/session": { getCurrentUser: async () => ({ id: userId }) },
      "@/lib/billing/rate-limit": {
        BillingRateLimitError,
        consumeBillingRequest: async () => {
          throw new BillingRateLimitError(60);
        }
      },
      "@/lib/billing/checkout-service": {
        configuredBillingService: () => {
          providerCalls++;
          throw new Error("must not reach Stripe");
        }
      }
    }
  });
  for (const action of ["checkout", "portal", "status"]) {
    const route = routeLoad(`app/api/billing/${action}/route.ts`);
    const request = new Request(
      `http://localhost:3000/api/billing/${action}`,
      action === "status"
        ? {}
        : {
            method: "POST",
            headers: {
              origin: env.NEXT_PUBLIC_SITE_URL,
              "content-type": "application/json"
            },
            body: "{}"
          }
    );
    const result = await (action === "status"
      ? route.GET(request)
      : route.POST(request));
    assert.equal(result.status, 429);
    assert.equal(result.headers.get("Retry-After"), "60");
  }
  assert.equal(providerCalls, 0);
});

test("Blackout checkout uses the authenticated Whop session and prefills only the event code", async () => {
  const site = "https://yokkai-collec.com";
  let now = Date.parse("2026-11-26T19:59:59+01:00");
  let destination = "https://whop.com/checkout/ch_linked";
  const calls = [];
  const app = loader({
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    env: {
      ...env,
      NODE_ENV: "production",
      STRIPE_BILLING_MODE: "live",
      STRIPE_SECRET_KEY: "sk_live_example",
      NEXT_PUBLIC_SITE_URL: site,
      NEXT_PUBLIC_SUPABASE_URL: "https://database.invalid",
      WHOP_LIVE_SYNC_ENABLED: "true"
    },
    mocks: {
      "@/lib/auth/session": { getCurrentUser: async () => ({ id: userId }) },
      "@/lib/billing/rate-limit": {
        BillingRateLimitError: class extends Error {},
        consumeBillingRequest: async () => {}
      },
      "@/lib/data/blackout-preview": {
        blackFridayTerms: {
          startsAt: "2026-11-26T20:00:00+01:00",
          endsAt: "2026-11-30T21:00:00+01:00",
          promoCode: "BLACKOUT"
        }
      },
      "@/lib/billing/whop-live.mjs": { whopCheckoutEnabled: () => true },
      "@/lib/billing/checkout-service": {
        configuredBillingService: () => ({
          checkout: async id => {
            calls.push(id);
            return destination;
          }
        })
      }
    }
  });
  const { POST } = app("app/api/billing/checkout/route.ts");
  function checkout(origin = site) {
    return POST(
      new Request(
        site +
          "/api/billing/checkout?offer=blackout&promoCode=OTHER&userId=other",
        {
          method: "POST",
          headers: { origin, "Content-Type": "application/json" },
          body: "{}"
        }
      )
    );
  }

  assert.equal((await checkout()).status, 404);
  now = Date.parse("2026-11-26T20:00:00+01:00");
  assert.equal((await checkout("https://other.invalid")).status, 403);
  assert.deepEqual(calls, []);
  const response = await checkout();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    url: "https://whop.com/checkout/ch_linked?promoCode=BLACKOUT"
  });
  assert.deepEqual(calls, [userId]);
  destination = "https://checkout.stripe.com/example";
  assert.equal((await checkout()).status, 503);
  now = Date.parse("2026-11-30T21:00:00+01:00");
  assert.equal((await checkout()).status, 404);
  assert.deepEqual(calls, [userId, userId]);
});
