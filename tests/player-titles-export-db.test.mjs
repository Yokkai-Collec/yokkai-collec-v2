import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("adding title exports preserves every pre-existing export section", async t => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migration = "20261115105001_player_titles_data_export.sql";
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(name => name.endsWith(".sql") && name < migration)
      .sort()
  });
  t.after(() => db.close());
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  const owner = "7e000000-0000-4000-8000-000000000004";
  const request = "7e000000-0000-4000-8000-000000000005";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
    [owner, JSON.stringify({ pseudo: "TitleExportBaseline" })]
  );
  await db.exec("set role service_role");
  await db.query("select public.reserve_data_export($1,$2)", [owner, request]);
  const build = async () =>
    (
      await db.query("select public.build_data_export($1,$2) as value", [
        owner,
        request
      ])
    ).rows[0].value;
  const before = await build();
  await db.exec("reset role");
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  await db.exec("set role service_role");
  const after = await build();
  assert.deepEqual(after.player_title, { title_id: "collector" });
  assert.deepEqual(
    after.player_titles.map(row => row.title_id),
    ["explorer", "reseller"]
  );
  delete after.player_title;
  delete after.player_titles;
  delete after.exported_at;
  delete before.exported_at;
  assert.deepEqual(after, before);
});

test("title export keeps the existing bounded, owner-only delegation chain", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const definition = async name =>
    (
      await db.query("select pg_get_functiondef($1::regprocedure) as value", [
        `public.${name}(uuid,uuid)`
      ])
    ).rows[0].value;
  const visited = new Set(["build_data_export"]);
  let body = await definition("build_data_export");
  assert.match(body, /'twitter_reward'/);
  while (!body.includes("'bio',t.bio")) {
    const delegate = body.match(
      /public\.(build_data_export_without_[a-z_]+)\(\s*p_user_id\s*,\s*p_request_id\s*\)/i
    )?.[1];
    assert.ok(delegate, "Export must retain its original profile projection");
    assert.ok(
      !visited.has(delegate) && visited.size < 8,
      "Export delegation must be acyclic and bounded"
    );
    visited.add(delegate);
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        (
          await db.query(
            "select has_function_privilege($1,$2,'EXECUTE') as allowed",
            [role, `public.${delegate}(uuid,uuid)`]
          )
        ).rows[0].allowed,
        false
      );
    body = await definition(delegate);
  }
});

test("personal data export includes only the owner's equipped and unlocked titles", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  const owner = "7e000000-0000-4000-8000-000000000001";
  const other = "7e000000-0000-4000-8000-000000000002";
  const request = "7e000000-0000-4000-8000-000000000003";
  for (const [id, pseudo] of [
    [owner, "TitleExportOwner"],
    [other, "TitleExportOther"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query(
    "insert into public.player_title_catalog(id) values('private_reward')"
  );
  await db.query(
    "insert into public.player_title_unlocks(user_id,title_id) values($1,'private_reward')",
    [other]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);
  await db.query(
    "select public.update_profile_appearance_titled('',null,'{}',null,null,null,'reseller')"
  );
  await db.query("select public.mark_player_titles_seen(array['reseller'])");
  await assert.rejects(
    db.query("select public.build_data_export($1,$2)", [owner, request]),
    /permission denied/
  );
  await db.exec("reset role; set role service_role");
  await db.query("select public.reserve_data_export($1,$2)", [owner, request]);
  const data = (
    await db.query("select public.build_data_export($1,$2) as value", [
      owner,
      request
    ])
  ).rows[0].value;
  assert.deepEqual(data.player_title, { title_id: "reseller" });
  assert.deepEqual(
    data.player_titles.map(row => row.title_id),
    ["explorer", "reseller"]
  );
  assert.equal(data.player_titles[0].seen_at, null);
  assert.ok(data.player_titles[1].seen_at);
  assert.ok(
    data.player_titles.every(
      row => row.unlocked_at && !Object.hasOwn(row, "user_id")
    )
  );
  assert.equal(data.schema_version, 1);
});
