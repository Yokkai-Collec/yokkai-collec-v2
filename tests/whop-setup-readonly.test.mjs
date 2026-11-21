import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { checkWhopSetup } from "../scripts/check-whop-setup.mjs";

const env = {
  WHOP_MODE: "sandbox",
  WHOP_ACCOUNT_ID: "biz_testAccount",
  WHOP_PRO_PLAN_ID: "plan_testOffer",
  WHOP_API_KEY: randomUUID()
};

const variant = {
  id: env.WHOP_PRO_PLAN_ID,
  account: { id: env.WHOP_ACCOUNT_ID },
  product: { id: "prod_testProduct" },
  visibility: "visible",
  release_method: "buy_now",
  billing_type: "renewal",
  billing_period: 30,
  currency: "eur",
  renewal_price: 4.99,
  initial_price: 0,
  trial_period_days: 3,
  tax_type: "exclusive"
};

test("Whop provisioning reads only the expected variant on the selected host", async () => {
  for (const [mode, expected] of [
    ["sandbox", "https://sandbox-api.whop.com"],
    ["production", "https://api.whop.com"]
  ]) {
    let calls = 0;
    const result = await checkWhopSetup(
      { ...env, WHOP_MODE: mode },
      async (url, options) => {
        calls++;
        assert.equal(
          url,
          `${expected}/api/v1/variants/${env.WHOP_PRO_PLAN_ID}`
        );
        assert.equal(options.method, "GET");
        assert.equal(options.redirect, "error");
        assert.equal(
          options.headers.Authorization,
          `Bearer ${env.WHOP_API_KEY}`
        );
        assert.equal(options.headers["Api-Version-Date"], "2026-11-20");
        return Response.json(variant);
      }
    );
    assert.equal(calls, 1);
    assert.deepEqual(result, {
      verified: true,
      environment: mode,
      renewalAmountInCents: 499,
      currency: "eur",
      billingPeriodDays: 30,
      trialDays: 3,
      taxType: "exclusive"
    });
  }
});

test("Whop provisioning rejects missing settings, account drift and changed terms", async () => {
  await assert.rejects(
    checkWhopSetup({ ...env, WHOP_PRO_PLAN_ID: "" }, () => {
      assert.fail("Invalid settings must fail before a network request");
    }),
    { message: "WHOP_SETUP_CONFIGURATION_INVALID" }
  );
  await assert.rejects(
    checkWhopSetup(env, async () =>
      Response.json({ ...variant, account: { id: "biz_other" } })
    ),
    { message: "WHOP_SETUP_ACCOUNT_OR_PLAN_MISMATCH" }
  );
  for (const changed of [
    { renewal_price: 6.99 },
    { initial_price: 4.99 },
    { billing_period: 365 },
    { trial_period_days: 0 },
    { tax_type: "inclusive" },
    { visibility: "archived" }
  ]) {
    await assert.rejects(
      checkWhopSetup(env, async () =>
        Response.json({ ...variant, ...changed })
      ),
      { message: "WHOP_SETUP_PLAN_TERMS_MISMATCH" }
    );
  }
  await assert.rejects(
    checkWhopSetup(env, async () =>
      Response.json({ error: env.WHOP_API_KEY }, { status: 403 })
    ),
    { message: "WHOP_SETUP_PROVIDER_UNAVAILABLE" }
  );
});
