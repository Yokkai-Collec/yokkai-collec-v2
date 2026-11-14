import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

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
