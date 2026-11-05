import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("frost preferences retain Pro and owner-only protection", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const user = "86300000-0000-4000-8000-000000000004";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [user, JSON.stringify({ pseudo: "FrostTest" })]
  );
  const save = () =>
    db.query(
      "insert into public.profile_customizations(user_id,style) values($1,$2)",
      [user, JSON.stringify({ showcaseScene: "frost" })]
    );
  await assert.rejects(save(), /PRO_REQUIRED/);
  await db.query(
    "select public.billing_set_manual_pro_access($1,true,'Disposable frost test')",
    [user]
  );
  await save();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  const profile = (await db.query("select public.get_profile(null) value"))
    .rows[0].value;
  assert.equal(profile.profileStyle.style.showcaseScene, "frost");
  await assert.rejects(
    db.query("update public.profile_customizations set style='{}'"),
    /permission denied/
  );
});
