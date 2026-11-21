import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const user = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const scope = "sandbox:biz_example:plan_example";

test("only current verified Whop sandbox memberships grant game Pro", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${user}'),('${other}');
    create table public.billing_entitlement_config (
      singleton boolean primary key, scope text, enabled boolean
    );
    insert into billing_entitlement_config values (true, null, false);
    create table public.billing_accounts (
      user_id uuid, scope text, active boolean, status text, risk_hold boolean,
      period_end timestamptz, verified_at timestamptz
    );
    create table public.account_deletion_log (user_id uuid primary key);
    create table public.pro_access_grants (user_id uuid primary key, expires_at timestamptz);
    create table public.pack_sync_calls (user_id uuid);
    create function public.billing_sync_pack_timing(p_user uuid, p_cutoff timestamptz)
    returns void language sql as $$insert into public.pack_sync_calls values (p_user)$$;
    grant select on public.account_deletion_log, public.billing_entitlement_config to service_role;
    grant insert on public.pack_sync_calls to service_role;
    revoke all on public.billing_entitlement_config from public,anon,authenticated;
    create function public.billing_has_game_pro(p_user uuid) returns boolean language sql as $$select false$$;
    revoke all on function public.billing_has_game_pro(uuid) from public,anon,authenticated;
    grant execute on function public.billing_has_game_pro(uuid) to service_role;
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261121190000_whop_sandbox_entitlements.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  const entitled = async uid =>
    (await db.query("select public.billing_has_game_pro($1) as pro", [uid]))
      .rows[0].pro;
  const {
    rows: [{ checkout_ref: ref }]
  } = await db.query(
    "insert into public.whop_sandbox_accounts(user_id,scope,checkout_id) values ($1,$2,'ch_example') returning checkout_ref",
    [user, scope]
  );
  async function save(
    status,
    updated,
    id = "mem_example",
    end = new Date(Date.now() + 60000)
  ) {
    await db.query(
      "select public.whop_sandbox_save_membership($1,$2,$3,$4,$5,clock_timestamp())",
      [ref, id, status, end.toISOString(), updated.toISOString()]
    );
  }
  const initial = new Date(Date.now() - 30000);
  const later = new Date(Date.now() - 10000);
  await save("trialing", initial);
  assert.equal(await entitled(user), false);
  await db.query(
    "update public.billing_entitlement_config set whop_sandbox_scope=$1",
    [scope]
  );
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("select * from public.whop_sandbox_accounts"),
    /permission denied/
  );
  await assert.rejects(save("trialing", initial), /permission denied/);
  await db.exec("set role service_role");
  await save("trialing", initial);
  assert.equal(await entitled(user), true);
  assert.equal(await entitled(other), false);
  await save("canceled", later, "mem_unrelated");
  assert.equal(await entitled(user), true);
  await save("canceled", later);
  await save("trialing", initial);
  assert.equal(await entitled(user), false);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from public.whop_sandbox_accounts"
      )
    ).rows[0].n,
    1
  );
  await db.exec("reset role");
  assert.equal(
    (await db.query("select count(*)::int as n from public.pack_sync_calls"))
      .rows[0].n,
    2
  );
  await save("active", later, "mem_example", new Date(Date.now() - 20000));
  assert.equal(await entitled(user), false);
  await save("active", later);
  await db.query(
    "update public.whop_sandbox_accounts set verified_at=clock_timestamp()-interval '16 minutes'"
  );
  assert.equal(await entitled(user), false);
  await db.query("insert into public.account_deletion_log values ($1)", [user]);
  await save("active", later);
  assert.equal(await entitled(user), false);
});
