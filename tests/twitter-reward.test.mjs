import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { NextResponse } from "next/server.js";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("Twitter visits award five bonus packs once per verified Yokkai account", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const first = "a1900000-0000-4000-8000-000000000001";
  const second = "a1900000-0000-4000-8000-000000000002";
  await db.query(
    `insert into auth.users(id,raw_user_meta_data,email_confirmed_at) values
    ($1,'{"pseudo":"TwitterFirst"}',now()),($2,'{"pseudo":"TwitterSecond"}',null)`,
    [first, second]
  );
  const login = async id => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  const claim = async () =>
    (await db.query("select public.claim_twitter_visit_reward() value")).rows[0]
      .value;
  await login(first);
  assert.equal(await claim(), "claimed");
  assert.equal(await claim(), "already-claimed");
  await assert.rejects(
    db.exec("delete from public.twitter_reward_claims"),
    /permission denied/
  );
  await login(second);
  await assert.rejects(claim(), /ACCOUNT_UNAVAILABLE/);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.twitter_reward_claims"
      )
    ).rows[0].n,
    0
  );
  await db.exec("reset role");
  assert.deepEqual(
    (
      await db.query(
        "select bonus_regular_packs n from public.user_profiles where user_id in($1,$2) order by user_id",
        [first, second]
      )
    ).rows.map(r => r.n),
    [5, 0]
  );
  await db.exec("set role service_role");
  await db.query(
    "select public.claim_discord_reward($1,'723456789012345678')",
    [first]
  );
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select bonus_regular_packs n from public.user_profiles where user_id=$1",
        [first]
      )
    ).rows[0].n,
    10,
    "Discord and Twitter are independent gifts"
  );
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [
    second
  ]);
  await db.exec("alter table auth.users add column banned_until timestamptz");
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [second]
  );
  await login(second);
  await assert.rejects(claim(), /ACCOUNT_BANNED/);
  await db.exec("reset role");
  await db.query("update auth.users set banned_until=null where id=$1", [
    second
  ]);
  await login(second);
  assert.equal(await claim(), "claimed");
  await db.exec("reset role; set role anon");
  await assert.rejects(claim(), /permission denied/);
});

test("Twitter requires a verified same-origin POST and redirects only after a successful claim", async () => {
  let player = { id: "current-player" },
    result = "claimed",
    storageError = false;
  const calls = [];
  const imports = {
    "next/headers": { cookies: async () => ({}) },
    "next/server": { NextResponse },
    "next-intl/server": {
      getTranslations: async () => () => "Gift unavailable"
    },
    "@/lib/auth/session": { getVerifiedUser: async () => player },
    "@/utils/supabase/server": {
      createClient: () => ({
        rpc: async (...args) => {
          calls.push(args);
          return { data: result, error: storageError ? {} : null };
        }
      })
    }
  };
  const context = {
    exports: {},
    URL,
    Response,
    process: {
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://example.test"
      }
    },
    require(name) {
      assert.ok(name in imports, name);
      return imports[name];
    }
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../app/twitter/route.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    context
  );
  const { POST, GET } = context.exports;
  assert.equal(
    GET,
    undefined,
    "a prefetch or ordinary GET must never grant packs"
  );
  const request = origin =>
    new Request(
      "https://example.test/twitter?next=https://evil.test&count=999",
      { method: "POST", headers: { origin } }
    );
  assert.equal((await POST(request("https://evil.test"))).status, 403);
  assert.equal(calls.length, 0);
  player = null;
  assert.equal(
    (await POST(request("https://example.test"))).headers.get("location"),
    "https://example.test/login"
  );
  assert.equal(calls.length, 0);
  player = { id: "current-player" };
  for (const value of ["claimed", "already-claimed"]) {
    result = value;
    const response = await POST(request("https://example.test"));
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      "https://x.com/YokkaiCollec"
    );
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.ok(
    calls.every(
      args => args.length === 1 && args[0] === "claim_twitter_visit_reward"
    ),
    "no client-controlled amount, target account or redirect enters the RPC"
  );
  storageError = true;
  assert.equal((await POST(request("https://example.test"))).status, 503);
});
