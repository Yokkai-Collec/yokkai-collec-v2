import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const a = "72000000-0000-4000-8000-000000000001";
const b = "72000000-0000-4000-8000-000000000002";
const c = "72000000-0000-4000-8000-000000000003";
const d = "72000000-0000-4000-8000-000000000004";
const request = "73000000-0000-4000-8000-000000000001";
const migration = "20261021100000_referral_data_export.sql";
const directory = new URL("../supabase/migrations/", import.meta.url);

async function setup(t, migrations) {
  const { db } = await replayMigrations(migrations ? { migrations } : {});
  t.after(() => db.close());
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  for (const [id, pseudo] of [
    [a, "ReferralOwner"],
    [b, "ReferralChild"],
    [c, "OtherOwner"],
    [d, "NoReferral"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.query(
    "insert into public.referral_codes(user_id,code) values($1,'aaaaaaaaaaaa'),($2,'bbbbbbbbbbbb'),($3,'cccccccccccc')",
    [a, b, c]
  );
  await db.query(
    "insert into public.referrals(code_id,referrer_id,referred_id,verified_at,rewarded_at) select id,$1,$2,now(),now() from public.referral_codes where user_id=$1",
    [a, b]
  );
  await db.query(
    "insert into public.referrals(code_id,referrer_id,referred_id) select id,$1,$2 from public.referral_codes where user_id=$1",
    [c, a]
  );
  await db.query(
    "insert into public.referrals(code_id,referrer_id,referred_id) select id,$1,$2 from public.referral_codes where user_id=$1",
    [b, c]
  );
  const build = async id => {
    await db.exec("reset role; set role service_role");
    await db.query("select public.reserve_data_export($1,$2)", [id, request]);
    return (
      await db.query("select public.build_data_export($1,$2) value", [
        id,
        request
      ])
    ).rows[0].value;
  };
  return { db, build };
}

test("referral export preserves old sections and snapshot controls while isolating the player's events and own code", async t => {
  const prior = readdirSync(directory)
    .filter(name => name.endsWith(".sql") && name < migration)
    .sort();
  const { db, build } = await setup(t, prior);
  const before = await build(a);
  assert.equal(
    "referrals" in before,
    false,
    "Regression must reproduce the missing section before migration"
  );
  await db.exec("reset role");
  const fence = (
    await db.query("select * from public.data_export_state where user_id=$1", [
      a
    ])
  ).rows;
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  assert.deepEqual(
    (
      await db.query(
        "select * from public.data_export_state where user_id=$1",
        [a]
      )
    ).rows,
    fence
  );
  await db.exec("set role service_role");
  const after = (
    await db.query("select public.build_data_export($1,$2) value", [a, request])
  ).rows[0].value;
  for (const key of Object.keys(before).filter(key => key !== "exported_at"))
    assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(
    after.referral_codes.map(item => item.code),
    ["aaaaaaaaaaaa"]
  );
  assert.deepEqual(Object.keys(after.referral_codes[0]).sort(), [
    "code",
    "created_at"
  ]);
  assert.equal(after.referrals.length, 2);
  assert.deepEqual(after.referrals.map(item => item.role).sort(), [
    "referred",
    "referrer"
  ]);
  for (const row of after.referrals) {
    assert.deepEqual(Object.keys(row).sort(), [
      "created_at",
      "id",
      "reward_packs",
      "rewarded_at",
      "role",
      "verified_at"
    ]);
    assert.equal(row.reward_packs, 5);
  }
  assert.ok(after.referrals.find(row => row.role === "referrer").rewarded_at);
  assert.equal(
    after.referrals.find(row => row.role === "referred").rewarded_at,
    null
  );
  assert.doesNotMatch(
    JSON.stringify({ codes: after.referral_codes, events: after.referrals }),
    new RegExp(
      [
        b,
        c,
        "bbbbbbbbbbbb",
        "cccccccccccc",
        "ReferralChild",
        "OtherOwner"
      ].join("|")
    )
  );
  const empty = await build(d);
  assert.deepEqual(empty.referral_codes, []);
  assert.deepEqual(empty.referrals, []);
  await assert.rejects(
    db.query("select public.build_data_export($1,$2)", [c, request]),
    /EXPORT_RESERVATION_REQUIRED/
  );
  await assert.rejects(
    db.query("select public.build_data_export_without_referrals($1,$2)", [
      a,
      request
    ]),
    /permission denied/
  );
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    for (const fn of [
      "build_data_export",
      "build_data_export_without_referrals"
    ])
      await assert.rejects(
        db.query(`select public.${fn}($1,$2)`, [a, request]),
        /permission denied/
      );
  }
  await db.exec("reset role");
  const properties = (
    await db.query(
      "select provolatile,prosecdef,proconfig from pg_proc where oid='public.build_data_export(uuid,uuid)'::regprocedure"
    )
  ).rows[0];
  assert.equal(properties.provolatile, "s");
  assert.equal(properties.prosecdef, true);
  assert.ok(properties.proconfig.includes('search_path=""'));
  assert.ok(properties.proconfig.includes("TimeZone=UTC"));
});

test("every public, Auth and Storage relation has an explicit export projection or documented exclusion", async t => {
  const { db, build } = await setup(t);
  const inventory = JSON.parse(
    readFileSync(
      new URL("../docs/data-export-inventory.json", import.meta.url),
      "utf8"
    )
  );
  const tables = (
    await db.query(
      "select table_schema||'.'||table_name relation from information_schema.tables where table_schema in ('public','auth','storage') order by 1"
    )
  ).rows.map(row => row.relation);
  assert.deepEqual(Object.keys(inventory).sort(), tables);
  const data = await build(a);
  for (const [table, entry] of Object.entries(inventory)) {
    assert.notEqual(Boolean(entry.sections), Boolean(entry.excluded), table);
    if (entry.sections) {
      assert.ok(entry.sections.length > 0, table);
      for (const section of entry.sections)
        assert.ok(section in data, `${table} -> ${section}`);
    } else assert.ok(entry.excluded.length > 20, table);
  }
});

test("event reward exports contain only the player's own receipts", async t => {
  const { db, build } = await setup(t);
  const event = (
    await db.query("select id from public.referral_events limit 1")
  ).rows[0].id;
  await db.query(
    "insert into public.referral_event_rewards(user_id,event_id,threshold,karas,lr_cards,recruiter_badge) values($1,$3,3,750,0,false),($2,$3,5,750,0,false)",
    [a, b, event]
  );
  const data = await build(a);
  assert.equal(data.referral_event_rewards.length, 1);
  assert.equal(data.referral_event_rewards[0].threshold, 3);
  assert.equal(data.referral_event_rewards[0].karas, 750);
  assert.deepEqual(data.referral_event_rewards[0].cards, []);
  assert.equal(data.referral_event_rewards[0].event_id, event);
});

test("referral rows count toward the unchanged complete-file bounds and failed generation releases its reservation", async t => {
  const { db, build } = await setup(t);
  await db.query(
    "insert into public.folders(user_id,nom) select $1,'folder-'||n from generate_series(1,99994) n",
    [a]
  );
  await assert.rejects(build(a), /EXPORT_TOO_LARGE/);
  await db.exec("reset role");
  const base = (
    await db.query(
      "select public.build_data_export_without_referrals($1,$2) value",
      [a, request]
    )
  ).rows[0].value;
  const rows = Object.values(base).reduce(
    (sum, value) =>
      sum +
      (Array.isArray(value)
        ? value.length
        : value && typeof value === "object"
          ? 1
          : 0),
    0
  );
  assert.ok(rows <= 100000, "Existing sections alone must still fit");
  assert.ok(
    rows + 3 > 100000,
    "Only the added own code and two referral events cause the overflow"
  );
  await db.exec("set role service_role");
  await db.query("select public.finish_data_export($1,$2,false)", [a, request]);
  await db.query("select public.reserve_data_export($1,$2)", [
    a,
    "73000000-0000-4000-8000-000000000002"
  ]);
});
