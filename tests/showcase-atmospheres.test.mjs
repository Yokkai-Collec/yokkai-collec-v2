import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const scenes = ["lightning", "flames", "mist", "aurora", "embers"];
function load(file) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    { exports, URL, require: id => load(id.slice(2) + ".ts") }
  );
  return exports;
}

test("atmospheres survive normalization and retain bounded Pro-only storage", async t => {
  const style = load("lib/ui/profile-style.ts");
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const user = "86300000-0000-4000-8000-000000000003";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [user, JSON.stringify({ pseudo: "Atmospheres" })]
  );
  const save = scene =>
    db.query(
      "insert into public.profile_customizations(user_id,style) values($1,$2)",
      [user, JSON.stringify({ showcaseScene: scene })]
    );
  await assert.rejects(save("flames"), /PRO_REQUIRED/);
  await db.query(
    "select public.billing_set_manual_pro_access($1,true,'Disposable atmosphere test')",
    [user]
  );
  for (const scene of scenes) {
    assert.equal(
      style.normalizeProfileStyle({
        ...style.DEFAULT_PROFILE_STYLE,
        showcaseScene: scene
      }).showcaseScene,
      scene
    );
    await save(scene);
    const result = await db.query(
      "select style from public.profile_customizations where user_id=$1",
      [user]
    );
    assert.equal(result.rows[0].style.showcaseScene, scene);
    await db.query(
      "delete from public.profile_customizations where user_id=$1",
      [user]
    );
  }
  await assert.rejects(save("custom-css"), /PROFILE_STYLE_INVALID/);
  assert.equal(
    style.normalizeProfileStyle({
      ...style.DEFAULT_PROFILE_STYLE,
      showcaseScene: "custom-css"
    }).showcaseScene,
    undefined
  );
});
