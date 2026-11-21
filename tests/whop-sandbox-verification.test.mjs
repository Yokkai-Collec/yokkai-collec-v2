import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const env = {
  NODE_ENV: "development",
  WHOP_MODE: "sandbox",
  WHOP_API_KEY: "test-fixture",
  WHOP_ACCOUNT_ID: "biz_sandbox",
  WHOP_PRO_PLAN_ID: "plan_sandbox",
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3117",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "local-fixture"
};
const checkoutRef = "4ff7839a-1ec7-4711-a767-75651108e101";
const userId = "49d21cc3-ae3d-4b65-9961-70ce89424111";

function fixture(verify) {
  const scope = "sandbox:biz_sandbox:plan_sandbox";
  const account = {
    checkout_ref: checkoutRef,
    checkout_id: "ch_sandbox",
    created_at: new Date().toISOString(),
    membership_id: null,
    membership_status: null,
    period_end: null,
    verified_at: null
  };
  let saves = 0;
  const database = async (input, options) => {
    const { pathname, searchParams } = new URL(input);
    switch (pathname.split("/").at(-1)) {
      case "billing_entitlement_config":
        return Response.json({ whop_sandbox_scope: scope });
      case "account_deletion_log":
        return Response.json([]);
      case "whop_sandbox_accounts":
        if (options.method === "PATCH")
          return Response.json({ checkout_ref: checkoutRef });
        assert.equal(searchParams.get("user_id"), "eq." + userId);
        return Response.json([account]);
      case "whop_sandbox_save_membership": {
        const payload = JSON.parse(options.body);
        assert.equal(payload.p_ref, checkoutRef);
        assert.equal(payload.p_membership, "mem_sandbox");
        Object.assign(account, {
          membership_id: payload.p_membership,
          membership_status: payload.p_status,
          period_end: payload.p_period_end,
          verified_at: payload.p_verified_at
        });
        saves++;
        return Response.json(null);
      }
      default:
        throw Error("Unexpected local request");
    }
  };
  const { outputText } = ts.transpileModule(
    readFileSync(
      new URL("../lib/billing/whop-sandbox.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  );
  class BillingError extends Error {}
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    process: { env },
    URL,
    URLSearchParams,
    Response,
    AbortSignal,
    require(name) {
      if (name === "server-only") return {};
      if (name === "./config") return { BillingError };
      assert.equal(name, "@supabase/supabase-js");
      return {
        createClient: (url, key, options) =>
          createClient(url, key, { ...options, global: { fetch: database } })
      };
    }
  });
  const config = exports.whopSandboxConfig();
  const provider = async (url, options) => {
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, "https://sandbox-api.whop.com");
    assert.equal(endpoint.searchParams.get("variant_id"), "plan_sandbox");
    assert.equal(options.redirect, "error");
    const membership = {
      id: "mem_sandbox",
      user_id: "user_test",
      account: { id: "biz_sandbox" },
      variant_id: "plan_sandbox",
      metadata: { yokkai_checkout_ref: checkoutRef },
      status: "trialing",
      updated_at: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 60000).toISOString()
    };
    return Response.json({
      data: [verify(membership)],
      page_info: { has_next_page: false }
    });
  };
  return {
    service: exports.whopSandboxService(config, provider),
    config: exports.whopSandboxConfig,
    saves: () => saves
  };
}

test("a verified matching Whop trial grants Pro, but a membership from another checkout cannot", async () => {
  const unmatched = fixture(membership => ({ ...membership, metadata: {} }));
  assert.equal((await unmatched.service.status(userId)).active, false);
  assert.equal(unmatched.saves(), 0);

  const matching = fixture(membership => membership);
  const status = await matching.service.status(userId);
  assert.equal(status.status, "trialing");
  assert.equal(status.active, true);
  assert.equal(matching.saves(), 1);
  assert.equal(matching.config({ ...env, NODE_ENV: "production" }), null);
  assert.equal(
    matching.config({
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.com"
    }),
    null
  );
});
