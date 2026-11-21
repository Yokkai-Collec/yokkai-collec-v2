import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  verifyWhopLiveAccess,
  openWhopCheckout,
  reconcileWhopLive,
  liveWhopConfig,
  cancelLinkedWhopAccount
} from "../lib/billing/whop-live.mjs";

const config = { account: "biz_live", key: "example" };
const now = Date.parse("2026-11-27T00:00:00Z");
const time = days => new Date(now + days * 86400000).toISOString();
const row = {
  whop_account_id: config.account,
  membership_id: "mem_imported",
  member_id: "mber_player",
  product_id: "prod_pro",
  variant_id: "plan_imported",
  stripe_paid_until: time(-0.1)
};
const membership = {
  id: row.membership_id,
  account: { id: config.account },
  member_id: row.member_id,
  product_id: row.product_id,
  variant_id: row.variant_id,
  status: "active",
  updated_at: time(0),
  current_period_start: time(-0.1),
  current_period_end: time(29.9)
};
const paid = {
  account: { id: config.account },
  membership_id: row.membership_id,
  product_id: row.product_id,
  status: "paid",
  substatus: "succeeded",
  paid_at: time(-0.09),
  subtotal: { amount: "4.99", currency: "eur" },
  refunded_amount: { amount: "0.00" },
  dispute_created_at: null,
  dispute_alerted_at: null,
  refunded_at: null
};

function provider(current, payments) {
  const paths = [];
  const fetch = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://api.whop.com");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    paths.push(url.pathname);
    if (url.pathname.endsWith("/payments")) {
      assert.equal(url.searchParams.get("membership_id"), row.membership_id);
      return Response.json({
        data: payments,
        page_info: { has_next_page: false }
      });
    }
    return Response.json(current);
  };
  return { fetch, paths };
}

test("Whop import only bridges the paid Stripe window and requires undisputed payment after it", async () => {
  const first = provider({ ...membership, status: "trialing" }, []);
  const paidUntil = time(1);
  assert.equal(
    (
      await verifyWhopLiveAccess(
        { ...row, stripe_paid_until: paidUntil },
        config,
        first.fetch,
        now
      )
    ).accessUntil,
    paidUntil
  );
  assert.deepEqual(first.paths, ["/api/v1/memberships/mem_imported"]);
  for (const payments of [
    [],
    [{ ...paid, refunded_amount: { amount: "4.99" } }],
    [{ ...paid, dispute_created_at: time(-0.05) }]
  ]) {
    assert.equal(
      (
        await verifyWhopLiveAccess(
          row,
          config,
          provider(membership, payments).fetch,
          now
        )
      ).accessUntil,
      null
    );
  }
  assert.equal(
    (
      await verifyWhopLiveAccess(
        row,
        config,
        provider(membership, [paid]).fetch,
        now
      )
    ).accessUntil,
    time(29.9)
  );
  assert.equal(
    (
      await verifyWhopLiveAccess(
        row,
        config,
        provider({ ...membership, status: "canceled" }, []).fetch,
        now
      )
    ).accessUntil,
    null
  );
  await assert.rejects(
    verifyWhopLiveAccess(
      row,
      config,
      provider({ ...membership, member_id: "mber_other" }, []).fetch,
      now
    ),
    /MEMBERSHIP_MISMATCH/
  );
  await assert.rejects(
    verifyWhopLiveAccess(
      row,
      config,
      provider(membership, [{ ...paid, membership_id: "mem_other" }]).fetch,
      now
    ),
    /PAYMENT_MISMATCH/
  );
  assert.throws(
    () => liveWhopConfig({ NODE_ENV: "development" }),
    /WRONG_ENVIRONMENT/
  );
  assert.deepEqual(await reconcileWhopLive({}), {
    checked: 0,
    failed: 0,
    skipped: true
  });
});

test("the account deletion adapter only confirms a matching terminal Whop membership", async () => {
  const calls = [];
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row }) })
      })
    }),
    rpc: async (method, params) => {
      calls.push({ method, params });
      return {};
    }
  };
  const env = {
    NODE_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com",
    WHOP_LIVE_ACCOUNT_ID: config.account,
    WHOP_LIVE_API_KEY: "example"
  };
  const request = async (_url, options) =>
    Response.json(
      options.method === "POST"
        ? { ...membership, status: "canceled" }
        : membership
    );
  await cancelLinkedWhopAccount("player", db, env, request);
  assert.deepEqual(calls, [
    {
      method: "billing_confirm_whop_live_deletion",
      params: { p_user: "player", p_membership: row.membership_id }
    }
  ]);
  await assert.rejects(
    cancelLinkedWhopAccount("player", db, env, async () =>
      Response.json(membership)
    ),
    /CANCELLATION_UNVERIFIED/
  );
  assert.equal(calls.length, 1);
});

test("production entitlements preserve Stripe access and reject stale, unauthorized or deleted Whop links", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const uid = "00000000-0000-0000-0000-000000000001";
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${uid}');
    create table public.billing_accounts(user_id uuid,scope text,active boolean,status text,risk_hold boolean,
      period_end timestamptz,verified_at timestamptz,deletion_confirmed_at timestamptz,stripe_customer_id text,
      checkout_id text,customer_started_at timestamptz,checkout_started_at timestamptz,lease_until timestamptz);
    insert into public.billing_accounts(user_id,scope,active,status,risk_hold,period_end,verified_at,stripe_customer_id)
     values('${uid}','live:acct_stripe:price_pro',true,'active',false,now()+interval '1 day',now(),'cus_stripe');
    create table public.account_deletion_log(user_id uuid);
    create table public.billing_entitlement_config(singleton boolean,enabled boolean,scope text,whop_sandbox_scope text);
    insert into public.billing_entitlement_config values(true,true,'live:acct_stripe:price_pro',null);
    create table public.pro_access_grants(user_id uuid,expires_at timestamptz);
    create table public.whop_sandbox_accounts(user_id uuid,scope text,membership_status text,period_end timestamptz,verified_at timestamptz);
    create function public.billing_has_game_pro(uuid) returns boolean language sql as $$select false$$;
    create function public.billing_sync_pack_timing(uuid,timestamptz) returns void language plpgsql as $$begin end$$;
    create function public.prepare_account_deletion(p_user_id uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
    create function public.prepare_account_deletion_without_billing(uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
    revoke all on function public.billing_has_game_pro(uuid), public.prepare_account_deletion(uuid)
      from public,anon,authenticated;
    grant execute on function public.billing_has_game_pro(uuid),public.prepare_account_deletion(uuid) to service_role;
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261121210000_whop_live_entitlements.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  const pro = async () =>
    (await db.query("select public.billing_has_game_pro($1) as pro", [uid]))
      .rows[0].pro;
  const link = () =>
    db.exec(`select public.billing_link_whop_import('cus_stripe','sub_import','biz_live',
    'mem_imported','mber_player','prod_pro','plan_imported',(select period_end from public.billing_accounts))`);
  assert.equal(await pro(), true);
  await link();
  await link();
  const save = status =>
    db.query(
      `select public.billing_save_whop_live_state('mem_imported',$1,
     case when $1='active' then now()+interval '1 day' end, now(), now())`,
      [status]
    );
  await db.exec(
    "update public.billing_accounts set active=false,deletion_confirmed_at=clock_timestamp()"
  );
  assert.equal(await pro(), false);
  await save("active");
  assert.equal(await pro(), true);
  await db.exec(
    "update public.whop_live_accounts set verified_at=now()-interval '16 minutes'"
  );
  assert.equal(await pro(), false);
  await save("active");
  await db.exec("set role authenticated");
  await assert.rejects(save("active"), /permission denied/);
  await assert.rejects(link(), /permission denied/);
  await db.exec("reset role");
  await assert.rejects(
    db.query(
      "select public.billing_confirm_whop_live_deletion($1,'mem_imported')",
      [uid]
    ),
    /REVIEW_REQUIRED/
  );
  await db.query("insert into public.account_deletion_log values($1)", [uid]);
  assert.equal(await pro(), false);
  await assert.rejects(
    db.query("select public.prepare_account_deletion($1)", [uid]),
    /CANCELLATION_REQUIRED/
  );
  await db.query(
    "select public.billing_confirm_whop_live_deletion($1,'mem_imported')",
    [uid]
  );
  assert.deepEqual(
    (
      await db.query("select public.prepare_account_deletion($1) as objects", [
        uid
      ])
    ).rows[0].objects,
    []
  );

  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261121220000_whop_live_checkout.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  await assert.rejects(
    db.query("select public.billing_begin_whop_checkout($1)", [uid]),
    /BILLING_USE_PORTAL/
  );
  const newcomer = "00000000-0000-0000-0000-000000000002";
  await db.query("insert into auth.users values($1)", [newcomer]);
  const begin = async () =>
    (
      await db.query(
        "select public.billing_begin_whop_checkout($1) as checkout",
        [newcomer]
      )
    ).rows[0].checkout;
  await db.exec("set role authenticated");
  await assert.rejects(begin(), /permission denied/);
  await db.exec("reset role");
  const { checkout_ref: ref } = await begin();
  assert.equal((await begin()).checkout_ref, ref);
  const bind = async () =>
    (
      await db.query(
        "select public.billing_attach_whop_checkout($1,'biz_live','mem_new','mber_new','prod_pro','plan_live') as ok",
        [ref]
      )
    ).rows[0].ok;
  assert.equal(await bind(), false);
  await db.query("select public.billing_save_whop_checkout($1,$2,'ch_new')", [
    newcomer,
    ref
  ]);
  assert.equal(await bind(), true);
  assert.equal(await bind(), true);
  const newPro = async () =>
    (
      await db.query("select public.billing_has_game_pro($1) as pro", [
        newcomer
      ])
    ).rows[0].pro;
  assert.equal(await newPro(), false);
  await db.exec(
    "select public.billing_save_whop_checkout_state('mem_new','trialing',now()+interval '3 days',now(),now(),true)"
  );
  assert.equal(await newPro(), true);
  assert.equal(
    (
      await db.exec(
        "select cancel_at_period_end from public.whop_live_accounts where membership_id='mem_new'"
      )
    )[0].rows[0].cancel_at_period_end,
    true
  );
  assert.equal(await pro(), false);
});

test("new Whop checkouts reuse the same server-owned reference and reject changes to the offer", async () => {
  const ref = "b82f91cf-4900-4ae9-ab38-2a13a54c103a";
  const env = {
    NODE_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com",
    WHOP_LIVE_SYNC_ENABLED: "true",
    WHOP_LIVE_CHECKOUT_ENABLED: "true",
    WHOP_LIVE_ACCOUNT_ID: config.account,
    WHOP_LIVE_API_KEY: config.key,
    WHOP_LIVE_PLAN_ID: "plan_live"
  };
  const checkout = {
    id: "ch_server",
    account_id: config.account,
    mode: "payment",
    purchase_url: "https://whop.com/checkout/ch_server/",
    metadata: { yokkai_checkout_ref: ref },
    variant: {
      id: env.WHOP_LIVE_PLAN_ID,
      currency: "eur",
      billing_type: "renewal",
      billing_period: 30,
      initial_price: 0,
      renewal_price: 4.99,
      trial_period_days: 3
    }
  };
  const attempt = {
    checkout_ref: ref,
    checkout_id: null,
    created_at: new Date().toISOString()
  };
  const calls = [];
  const db = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "billing_begin_whop_checkout") return { data: attempt };
      attempt.checkout_id = args.p_checkout;
      return {};
    }
  };
  const request = async (url, options) => {
    assert.equal(url, "https://api.whop.com/api/v1/checkout_configurations");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["Idempotency-Key"], "yokkai-live:" + ref);
    assert.deepEqual(JSON.parse(options.body), {
      account_id: config.account,
      variant_id: env.WHOP_LIVE_PLAN_ID,
      mode: "payment",
      redirect_url:
        "https://yokkai-collec.com/settings?checkout=returned#subscription",
      metadata: { yokkai_checkout_ref: ref }
    });
    return Response.json(checkout);
  };
  assert.equal(
    await openWhopCheckout("player", env, request, db),
    "https://whop.com/checkout/ch_server"
  );
  assert.deepEqual(
    calls.map(c => c[0]),
    ["billing_begin_whop_checkout", "billing_save_whop_checkout"]
  );
  await openWhopCheckout(
    "player",
    env,
    () => assert.fail("must reuse link"),
    db
  );
  attempt.checkout_id = null;
  await assert.rejects(
    openWhopCheckout(
      "player",
      env,
      async () =>
        Response.json({
          ...checkout,
          variant: { ...checkout.variant, renewal_price: 9.99 }
        }),
      db
    ),
    /CHECKOUT_MISMATCH/
  );
  assert.equal(attempt.checkout_id, null);
});

test("an eligible Whop trial grants access for its verified period and cannot be extended indefinitely", async () => {
  const trial = {
    ...membership,
    status: "trialing",
    created_at: time(-0.1),
    current_period_end: time(2.9),
    initial_price: { amount: "0", currency: "eur" }
  };
  const newUser = { ...row, stripe_paid_until: null };
  assert.equal(
    (
      await verifyWhopLiveAccess(
        newUser,
        config,
        provider(trial, []).fetch,
        now
      )
    ).accessUntil,
    time(2.9)
  );
  const extended = { ...trial, current_period_end: time(29.9) };
  assert.equal(
    (
      await verifyWhopLiveAccess(
        newUser,
        config,
        provider(extended, []).fetch,
        now
      )
    ).accessUntil,
    null
  );
  assert.equal(
    (
      await verifyWhopLiveAccess(
        newUser,
        config,
        provider(membership, []).fetch,
        now
      )
    ).accessUntil,
    null
  );
});
