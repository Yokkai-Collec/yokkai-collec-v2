import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("launch titles are granted to profiles created before the migration", async t => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const titleMigration = "20261115102000_player_titles.sql";
  const migrations = readdirSync(directory)
    .filter(name => name.endsWith(".sql") && name < titleMigration)
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  const player = "7d000000-0000-4000-8000-000000000003";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
    [player, JSON.stringify({ pseudo: "ExistingTitlePlayer" })]
  );
  await db.exec(readFileSync(new URL(titleMigration, directory), "utf8"));
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  const profile = (await db.query("select public.get_profile(null) as value"))
    .rows[0].value;
  assert.equal(profile.titleId, "collector");
  assert.deepEqual(profile.unlockedTitleIds, [
    "collector",
    "explorer",
    "reseller"
  ]);
  assert.deepEqual(profile.unseenTitleIds, ["explorer", "reseller"]);
});

test("players can equip only their own unlocked titles", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const owner = "7d000000-0000-4000-8000-000000000001";
  const other = "7d000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [owner, "TitleOwner"],
    [other, "TitleOther"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  const login = async id => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const profile = async identifier =>
    (await db.query("select public.get_profile($1) as value", [identifier]))
      .rows[0].value;
  await login(owner);
  assert.equal((await profile(null)).titleId, "collector");
  assert.deepEqual((await profile(null)).unseenTitleIds, [
    "explorer",
    "reseller"
  ]);
  assert.deepEqual((await profile(null)).unlockedTitleIds, [
    "collector",
    "explorer",
    "reseller"
  ]);
  await db.query(
    "select public.mark_player_titles_seen(array['explorer','reseller'])"
  );
  assert.deepEqual((await profile(null)).unseenTitleIds, []);
  await db.query(
    "select public.update_profile_appearance_titled('',null,'{}',null,null,null,'reseller')"
  );
  assert.equal((await profile(null)).titleId, "reseller");
  await db.query(
    "select public.update_profile_appearance_titled('Saved jointly',null,'{}',null,null,null,'explorer')"
  );
  assert.equal((await profile(null)).titleId, "explorer");
  assert.equal((await profile(null)).bio, "Saved jointly");
  await assert.rejects(
    db.query(
      "select public.update_profile_appearance_titled('Must roll back',null,'{}',null,null,null,'invented')"
    ),
    /TITLE_NOT_UNLOCKED/
  );
  assert.equal((await profile(null)).bio, "Saved jointly");
  assert.equal((await profile(null)).titleId, "explorer");
  await assert.rejects(
    db.query("select public.equip_player_title('reseller')"),
    /permission denied/
  );
  await db.query(
    "select public.update_profile_appearance_titled('',null,'{}',null,null,null,'collector')"
  );
  await login(other);
  assert.deepEqual((await profile(null)).unseenTitleIds, [
    "explorer",
    "reseller"
  ]);
  await db.query(
    "select public.mark_player_titles_seen(array['explorer','reseller'])"
  );
  await login(owner);
  await assert.rejects(
    db.query(
      "select public.update_profile_appearance_titled('',null,'{}',null,null,null,'invented text')"
    ),
    /TITLE_NOT_UNLOCKED/
  );
  await assert.rejects(
    db.query(
      "select public.update_profile_appearance_titled('',null,'{}',null,null,null,null)"
    ),
    /TITLE_NOT_UNLOCKED/
  );
  for (const table of [
    "player_title_catalog",
    "player_title_unlocks",
    "player_equipped_titles"
  ]) {
    await assert.rejects(
      db.query(`insert into public.${table} default values`),
      /permission denied/
    );
    await assert.rejects(
      db.query(`delete from public.${table}`),
      /permission denied/
    );
  }
  await db.exec("reset role");
  await db.query(
    "insert into public.player_title_catalog(id) values('test_reward')"
  );
  await db.query(
    "insert into public.player_title_unlocks(user_id,title_id) values($1,'test_reward')",
    [other]
  );
  await login(owner);
  await assert.rejects(
    db.query(
      "select public.update_profile_appearance_titled('',null,'{}',null,null,null,'test_reward')"
    ),
    /TITLE_NOT_UNLOCKED/
  );
  await db.query("select public.mark_player_titles_seen(array['test_reward'])");
  await login(other);
  assert.deepEqual((await profile(null)).unseenTitleIds, ["test_reward"]);
  await db.exec("reset role");
  await db.query(
    "insert into public.player_title_catalog(id) values('test_reward_next')"
  );
  await db.query(
    "insert into public.player_title_unlocks(user_id,title_id) values($1,'test_reward_next')",
    [other]
  );
  await login(other);
  await db.query("select public.mark_player_titles_seen(array['test_reward'])");
  assert.deepEqual((await profile(null)).unseenTitleIds, ["test_reward_next"]);
  await db.query(
    "select public.mark_player_titles_seen(array['test_reward_next'])"
  );
  assert.deepEqual((await profile(null)).unseenTitleIds, []);
  await db.query(
    "select public.update_profile_appearance_titled('',null,'{}',null,null,null,'test_reward')"
  );
  assert.equal((await profile(null)).titleId, "test_reward");
  assert.deepEqual((await profile(null)).unlockedTitleIds, [
    "collector",
    "explorer",
    "reseller",
    "test_reward",
    "test_reward_next"
  ]);
  await login(owner);
  const viewed = await profile("TitleOther");
  assert.equal(viewed.titleId, "test_reward");
  assert.equal(viewed.unlockedTitleIds, undefined);
  assert.equal(viewed.unseenTitleIds, undefined);
  const socialIdentity = (
    await db.query("select public.search_users('TitleOther') as value")
  ).rows[0].value[0];
  assert.equal(socialIdentity.profileStyle.titleId, "test_reward");
  assert.equal(socialIdentity.profileStyle.active, false);
  await db.exec("reset role");
  await db.query("delete from public.player_title_unlocks where user_id=$1", [
    other
  ]);
  await login(other);
  assert.equal((await profile(null)).titleId, "collector");
  await db.query(
    "select public.update_profile_appearance_titled('',null,'{}',null,null,null,'collector')"
  );
  await db.exec("reset role");
  await db.query(
    "insert into public.player_title_unlocks(user_id,title_id) values($1,'test_reward')",
    [other]
  );
  await login(other);
  await db.query(
    "select public.update_profile_appearance_titled('',null,'{}',null,null,null,'test_reward')"
  );
  await db.query(
    "select public.update_profile_appearance_titled('',null,'{}',null,null,null,'collector')"
  );
  assert.equal((await profile(null)).titleId, "collector");
  await db.exec("reset role");
  await db.query("delete from public.user_profiles where user_id=$1", [other]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from public.player_title_unlocks where user_id=$1",
        [other]
      )
    ).rows[0].n,
    0
  );
  await db.exec("reset role; set role anon");
  await assert.rejects(
    db.query(
      "select public.update_profile_appearance_titled('',null,'{}',null,null,null,'collector')"
    ),
    /permission denied/
  );
});
