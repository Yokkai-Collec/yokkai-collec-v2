import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("showcase scenes, arrangements and text remain bounded, Pro-only and owner-projected", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const user = "86300000-0000-4000-8000-000000000002";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [user, JSON.stringify({ pseudo: "ShowcaseDesign" })]
  );
  const save = style =>
    db.query(
      "insert into public.profile_customizations(user_id,style) values($1,$2)",
      [user, JSON.stringify(style)]
    );
  await assert.rejects(save({ showcaseScene: "velvet" }), /PRO_REQUIRED/);
  await db.query(
    "select public.billing_set_manual_pro_access($1,true,'Disposable showcase design test')",
    [user]
  );
  for (const invalid of [
    { showcaseScene: "unknown" },
    { showcaseScene: null },
    { showcaseLayout: "unknown" },
    { showcaseLayout: [] },
    { showcaseIntensity: -1 },
    { showcaseIntensity: 101 },
    { showcaseIntensity: 1.5 },
    { showcaseIntensity: "50" },
    { showcaseIntensity: null },
    { showcaseTitle: "x".repeat(61) },
    { showcaseTitle: 12 },
    { showcaseTitle: "bad\ntext" },
    { showcaseDescription: "x".repeat(161) },
    { showcaseDescription: null },
    { showcaseDescription: "bad\ttext" }
  ])
    await assert.rejects(save(invalid), /PROFILE_STYLE_INVALID/);
  for (const showcaseScene of ["velvet", "stars", "marble"]) {
    for (const showcaseLayout of ["row", "fan", "spotlight"]) {
      await save({
        showcaseScene,
        showcaseLayout,
        showcaseIntensity: 0,
        showcaseTitle: "My treasures",
        showcaseDescription: "A collection of favorites"
      });
      await db.query(
        "delete from public.profile_customizations where user_id=$1",
        [user]
      );
    }
  }
  const style = {
    showcaseScene: "stars",
    showcaseLayout: "fan",
    showcaseIntensity: 100,
    showcaseTitle: "My treasures",
    showcaseDescription: "My favorites"
  };
  await save(style);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  const profile = (await db.query("select public.get_profile(null) value"))
    .rows[0].value;
  for (const [key, value] of Object.entries(style))
    assert.equal(profile.profileStyle.style[key], value);
  await assert.rejects(
    db.query("update public.profile_customizations set style='{}'"),
    /permission denied/
  );
  await db.exec("reset role");
  await db.query("delete from public.pro_access_grants where user_id=$1", [
    user
  ]);
  const inactive = (await db.query("select public.get_profile(null) value"))
    .rows[0].value;
  assert.equal(inactive.profileStyle.active, false);
  assert.deepEqual(inactive.profileStyle.style, {});
});
