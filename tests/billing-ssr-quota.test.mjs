import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { intlServer } from "./helpers/i18n.mjs";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const user = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const env = {
  NODE_ENV: "development",
  STRIPE_BILLING_ENABLED: "true",
  STRIPE_BILLING_MODE: "test",
  STRIPE_CHECKOUT_ENABLED: "false",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "local_test_placeholder",
  STRIPE_SECRET_KEY: "sk_test_example",
  STRIPE_PRO_PRICE_ID: "price_example",
  STRIPE_ACCOUNT_ID: "acct_example",
  STRIPE_PRO_WEBHOOK_SECRET: "whsec_example"
};

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    grant usage on schema public,auth to service_role;
    insert into auth.users values('${user}'),('${other}');
  `);
  await db.exec(
    readFileSync(
      resolve(
        root,
        "supabase/migrations/20261018000000_billing_request_limits.sql"
      ),
      "utf8"
    )
  );
  await db.exec("set role service_role");
  const calls = {
    quota: 0,
    provider: 0,
    accounts: 0,
    subscriptions: 0,
    claims: 0
  };
  const state = { user, quotaFailure: null, providerFailure: false };
  const stripe = {
    accounts: {
      retrieve: async () => {
        calls.accounts++;
        if (state.providerFailure)
          throw new Error("private provider diagnostic");
        return { id: "acct_example" };
      }
    },
    subscriptions: {
      list: async () => {
        calls.subscriptions++;
        return { data: [], has_more: false };
      }
    }
  };
  class FakeStripe {
    constructor() {
      calls.provider++;
      return stripe;
    }
  }
  const store = {
    claim: async id => {
      calls.claims++;
      return {
        id: "row-" + id,
        user_id: id,
        stripe_customer_id: "cus_example",
        risk_hold: false
      };
    },
    save: async () => {},
    release: async () => {}
  };
  const mock = {
    "next-intl/server": intlServer,
    stripe: FakeStripe,
    "./store": { billingStore: () => store },
    "@supabase/supabase-js": {
      createClient: () => ({
        rpc: async (name, args) => {
          calls.quota++;
          assert.equal(name, "billing_consume_request");
          if (state.quotaFailure) return state.quotaFailure;
          const result = await db.query(
            "select public.billing_consume_request($1,$2,$3) as retry",
            [args.p_user, args.p_scope, args.p_action]
          );
          return { data: result.rows[0].retry, error: null };
        }
      })
    },
    "@/lib/auth/session": {
      getCurrentUser: async () => (state.user ? { id: state.user } : null),
      getCurrentPseudo: async () => "Test player",
      getCurrentKarasBalance: async () => 0
    },
    "@/lib/referrals/server": { getReferralStatus: async () => null },
    "@/lib/discord-invite": { getDiscordInviteUrl: () => null },
    "next/navigation": {
      redirect: () => {
        throw new Error("REDIRECT");
      }
    },
    "next/link": () => null,
    "next/image": () => null
  };
  // Reuse the real pages, settings adapter, quota adapter, HTTP handler and
  // billing orchestrator. Only external services and unrelated presentation
  // are replaced: this test never sends a request to Supabase or Stripe.
  function worker() {
    const cache = new Map();
    const load = file => {
      const path = resolve(root, file);
      if (cache.has(path)) return cache.get(path);
      const compiled = { exports: {} };
      cache.set(path, compiled.exports);
      vm.runInNewContext(
        ts.transpileModule(readFileSync(path, "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true
          }
        }).outputText,
        {
          module: compiled,
          exports: compiled.exports,
          URL,
          Request,
          Response,
          Buffer,
          console,
          process: { env },
          require(id) {
            if (id === "server-only" || id.endsWith(".css")) return {};
            if (id in mock) return mock[id];
            if (id.startsWith("@/components/"))
              return new Proxy({}, { get: () => () => null });
            if (id === "./sanction-history")
              return { SanctionHistory: () => null };
            if (id.startsWith("./"))
              return load(resolve(dirname(path), id + ".ts"));
            if (id.startsWith("@/")) return load(id.slice(2) + ".ts");
            return require(id);
          }
        }
      );
      return compiled.exports;
    };
    const settingsPage = load("app/settings/page.tsx").default;
    return {
      settings: () => settingsPage({ searchParams: Promise.resolve({}) }),
      premium: load("app/premium/page.tsx").default,
      api: load("app/api/billing/status/route.ts").GET
    };
  }
  return { db, calls, state, worker };
}

function billingFrom(element) {
  if (!element || typeof element !== "object") return undefined;
  if (element.props && "billing" in element.props) return element.props.billing;
  for (const child of [element.props?.children].flat(Infinity)) {
    const billing = billingFrom(child);
    if (billing !== undefined) return billing;
  }
}

test("60 alternating Settings/Premium SSR renders share the durable 30/min quota with the API and recover", async t => {
  const { db, calls, state, worker } = await fixture(t);
  const pages = worker();
  const started = performance.now();
  for (let index = 0; index < 60; index++) {
    const billing = billingFrom(
      await (index % 2 ? pages.premium() : pages.settings())
    );
    assert.equal(billing.enabled, true);
    assert.equal(billing.checkoutEnabled, false);
    assert.equal(billing.unavailable, index >= 30);
    assert.equal(billing.status === null, index >= 30);
    assert.equal(calls.provider, Math.min(index + 1, 30));
    assert.equal(calls.accounts, Math.min(index + 1, 30));
    assert.equal(calls.subscriptions, Math.min(index + 1, 30));
  }
  assert.equal(calls.quota, 60);
  const request = () =>
    new Request("http://localhost:3000/api/billing/status?userId=" + other);
  const blocked = await pages.api(request());
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "BILLING_RATE_LIMITED");
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  assert.equal(calls.accounts, 30);
  assert.equal(calls.claims, 30);
  state.user = other;
  assert.equal((await pages.api(request())).status, 200);
  state.user = user;
  await db.query(
    "update public.billing_request_limits set window_started_at=now()-interval '2 minutes' where user_id=$1",
    [user]
  );
  assert.equal((await pages.api(request())).status, 200);
  assert.equal(billingFrom(await pages.settings()).unavailable, false);
  assert.equal(calls.accounts, 33);
  t.diagnostic(
    `60 SSR reads: 30 admitted, 30 blocked; 60 mocked Stripe operations before recovery. Local harness elapsed ${Math.round(performance.now() - started)} ms (not production network latency).`
  );
});

test("separate concurrent SSR workers and API requests cannot exceed the same quota", async t => {
  const { calls, worker } = await fixture(t);
  const first = worker(),
    second = worker();
  const responses = await Promise.all(
    Array.from({ length: 75 }, (_, index) =>
      index % 3 === 0
        ? first.api(new Request("http://localhost:3000/api/billing/status"))
        : index % 3 === 1
          ? first.settings().then(billingFrom)
          : second.premium().then(billingFrom)
    )
  );
  const admitted = responses.filter(result =>
    result instanceof Response ? result.status === 200 : !result.unavailable
  );
  assert.equal(admitted.length, 30);
  assert.equal(calls.quota, 75);
  assert.equal(calls.provider, 30);
  assert.equal(calls.accounts, 30);
  assert.equal(calls.subscriptions, 30);
  assert.equal(calls.claims, 30);
});

test("SSR fails closed before Stripe on broken quota storage and never invents Basic status or leaks diagnostics", async t => {
  const { calls, state, worker } = await fixture(t);
  const pages = worker();
  for (const failure of [
    { data: null, error: { message: "private quota diagnostic" } },
    { data: "0", error: null },
    { data: 601, error: null }
  ]) {
    state.quotaFailure = failure;
    for (const render of [pages.settings, pages.premium]) {
      const billing = billingFrom(await render());
      assert.equal(billing.unavailable, true);
      assert.equal(billing.status, null);
      assert.doesNotMatch(
        JSON.stringify(billing),
        /private|diagnostic|secret|placeholder/
      );
    }
  }
  assert.equal(calls.provider, 0);
  assert.equal(calls.accounts, 0);
  assert.equal(calls.claims, 0);
  state.quotaFailure = null;
  state.providerFailure = true;
  assert.equal(billingFrom(await pages.premium()).unavailable, true);
  assert.equal(calls.accounts, 1);
  assert.equal(calls.quota, 7);
  state.user = null;
  const anonymous = billingFrom(await pages.premium());
  assert.equal(anonymous, null);
  await assert.rejects(pages.settings(), /REDIRECT/);
  assert.equal(
    (await pages.api(new Request("http://localhost:3000/api/billing/status")))
      .status,
    401
  );
  assert.equal(calls.quota, 7);
});
