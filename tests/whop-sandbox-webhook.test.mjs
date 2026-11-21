import assert from "node:assert/strict";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const scope = "sandbox:biz_test:plan_test";
const version = "2026-11-20";
const secret = "ws_" + randomBytes(32).toString("hex");
const file = path => readFileSync(new URL(path, import.meta.url), "utf8");

function verifier() {
  const { outputText } = ts.transpileModule(
    file("../lib/billing/whop-webhook.ts"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  );
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    Buffer,
    TextDecoder,
    require(name) {
      if (name === "node:crypto") return { createHmac, timingSafeEqual };
      if (name === "./config") return { BillingError: class extends Error {} };
      if (name === "./whop-sandbox") return { whopApiVersion: version };
      return {};
    }
  });
  return exports.verifiedWhopEvent;
}

test("Whop verifies the original bytes, account, version and timestamp before accepting membership events", () => {
  const verify = verifier();
  const when = 1795280000000;
  const event = {
    id: "msg_Fixture",
    type: "membership.activated",
    api_version: "v1",
    api_version_date: version,
    account_id: "biz_test",
    data: { id: "mem_Test" }
  };
  function delivery(extra = {}, now = when) {
    const body = Buffer.from(JSON.stringify({ ...event, ...extra }, null, 2));
    const timestamp = String(Math.floor(now / 1000));
    const signature = createHmac("sha256", secret)
      .update(event.id + "." + timestamp + ".")
      .update(body)
      .digest("base64");
    return [
      body,
      new Headers({
        "webhook-id": event.id,
        "webhook-timestamp": timestamp,
        "webhook-signature": "v1," + signature
      })
    ];
  }
  assert.equal(
    verify(...delivery(), secret, "biz_test", when).membershipId,
    "mem_Test"
  );
  assert.equal(
    verify(...delivery({ type: "product.updated" }), secret, "biz_test", when),
    null
  );
  const [body, headers] = delivery();
  assert.throws(
    () =>
      verify(
        Buffer.concat([body, Buffer.from(" ")]),
        headers,
        secret,
        "biz_test",
        when
      ),
    /BILLING_SIGNATURE_INVALID/
  );
  assert.throws(
    () => verify(...delivery({}, when + 301000), secret, "biz_test", when),
    /BILLING_SIGNATURE_INVALID/
  );
  assert.throws(
    () => verify(...delivery({}, when - 301000), secret, "biz_test", when),
    /BILLING_SIGNATURE_INVALID/
  );
  assert.throws(
    () =>
      verify(
        ...delivery({ account_id: "biz_other" }),
        secret,
        "biz_test",
        when
      ),
    /BILLING_ACCOUNT_MISMATCH/
  );
  assert.throws(
    () =>
      verify(
        ...delivery({ api_version_date: "2026-01-01" }),
        secret,
        "biz_test",
        when
      ),
    /BILLING_ACCOUNT_MISMATCH/
  );
});

test("queued Whop deliveries are service-only, deduplicated and recover after a worker lease expires", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.billing_entitlement_config(singleton boolean,whop_sandbox_scope text);
    insert into public.billing_entitlement_config values(true,'${scope}');
    grant select on public.billing_entitlement_config to service_role;
  `);
  await db.exec(
    file("../supabase/migrations/20261121200000_whop_sandbox_webhook_jobs.sql")
  );
  const claim = async (jobScope = scope) =>
    (
      await db.query(
        "select * from public.whop_sandbox_claim_webhook($1,null)",
        [jobScope]
      )
    ).rows;
  await db.exec("set role authenticated");
  await assert.rejects(claim(), /permission denied/);
  await db.exec("set role service_role");
  for (let attempt = 0; attempt < 2; attempt++)
    await db.query(
      "insert into public.whop_sandbox_webhook_jobs(scope,event_id,membership_id) values($1,'msg_Fixture','mem_Test') on conflict do nothing",
      [scope]
    );
  assert.equal((await claim("sandbox:biz_other:plan_other")).length, 0);
  const [first] = await claim();
  assert.equal(first.membership_id, "mem_Test");
  assert.equal((await claim()).length, 0);
  await db.exec(
    "update public.whop_sandbox_webhook_jobs set available_at=clock_timestamp()"
  );
  const [retry] = await claim();
  assert.notEqual(retry.lease_token, first.lease_token);
  const lateUpdate = await db.query(
    "update public.whop_sandbox_webhook_jobs set processed_at=now() where lease_token=$1",
    [first.lease_token]
  );
  assert.equal(lateUpdate.affectedRows, 0);
  await db.query(
    "update public.whop_sandbox_webhook_jobs set processed_at=now() where lease_token=$1",
    [retry.lease_token]
  );
  await db.exec(
    "update public.whop_sandbox_webhook_jobs set available_at=clock_timestamp()"
  );
  assert.equal((await claim()).length, 0);
});
