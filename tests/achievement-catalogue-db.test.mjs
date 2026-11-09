import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const user = "10000000-0000-4000-8000-000000000088";
test("retroactive catalogue preserves claims, hides secret conditions and unlocks existing progress", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values($1,'{"pseudo":"RetroTest"}')`,
    [user]
  );
  await db.query(
    "update public.user_achievement_stats set regular_packs_opened=100 where user_id=$1",
    [user]
  );
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [user]);
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select public.get_achievements() result")).rows[0].result
      .length,
    11,
    "legacy reader preserves its 11-achievement contract"
  );
  const first = (
    await db.query("select public.get_achievement_catalogue() result")
  ).rows[0].result;
  assert.ok(first.length > 100);
  assert.ok(
    first.find(a => a.family === "pack-opener" && a.conditionValue === 100)
      .completedAt
  );
  const secret = first.find(a => a.id === "regret-1");
  assert.equal(secret.family, "secret");
  assert.equal(secret.conditionType, "secret");
  assert.equal(secret.description, "");
  const claimed = (
    await db.query(
      `select public.claim_catalogue_achievement('premier-rituel') result`
    )
  ).rows[0].result;
  assert.equal(claimed.reward, 10);
  await assert.rejects(
    db.query(`select public.claim_catalogue_achievement('premier-rituel')`),
    /ACHIEVEMENT_ALREADY_CLAIMED/
  );
  const second = (
    await db.query("select public.get_achievement_catalogue() result")
  ).rows[0].result;
  assert.ok(second.find(a => a.id === "premier-rituel").claimedAt);
  assert.equal(
    (await db.query("select public.get_missions() result")).rows[0].result
      .periods[0].missions.length,
    14
  );
  await db.exec("reset role");
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) n from public.user_mission_progress where user_id=$1",
          [user]
        )
      ).rows[0].n
    ),
    0
  );
});
import { readFileSync, readdirSync } from "node:fs";
import { pgliteMigrationSource } from "../scripts/replay-migrations.mjs";
test("legacy upgrades preserve original claims and prepare exactly one player-claimed full bonus", async t => {
  const latest = "20261109190200_achievement_catalogue.sql";
  const migrations = readdirSync(
    new URL("../supabase/migrations/", import.meta.url)
  )
    .filter(n => n.endsWith(".sql") && n !== latest)
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values($1,'{"pseudo":"LegacyBonus"}')`,
    [user]
  );
  await db.query(
    `insert into public.user_achievements values($1,'eclat-inattendu','2026-10-01T00:00:00Z','2026-10-01T01:00:00Z')`,
    [user]
  );
  const before = (
    await db.query(
      "select karas_balance from public.user_profiles where user_id=$1",
      [user]
    )
  ).rows[0].karas_balance;
  await db.exec(
    pgliteMigrationSource(
      readFileSync(
        new URL("../supabase/migrations/" + latest, import.meta.url),
        "utf8"
      )
    )
  );
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [user]
      )
    ).rows[0].karas_balance,
    before,
    "migration does not credit wallets"
  );
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [user]);
  await db.exec("set role authenticated");
  const catalogue = (
    await db.query("select public.get_achievement_catalogue() result")
  ).rows[0].result;
  assert.equal(
    catalogue.find(a => a.id === "eclat-inattendu").upgradeReward,
    2500
  );
  const claimed = (
    await db.query(
      `select public.claim_achievement_upgrade('eclat-inattendu') result`
    )
  ).rows[0].result;
  assert.equal(claimed.reward, 2500);
  await assert.rejects(
    db.query(`select public.claim_achievement_upgrade('eclat-inattendu')`),
    /ACHIEVEMENT_ALREADY_CLAIMED/
  );
  await db.exec("reset role");
  assert.equal(
    new Date(
      (
        await db.query(
          `select claimed_at from public.user_achievements where user_id=$1 and achievement_id='eclat-inattendu'`,
          [user]
        )
      ).rows[0].claimed_at
    ).toISOString(),
    "2026-10-01T01:00:00.000Z"
  );
});
test("ownership milestones survive recycling before the first catalogue visit", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values($1,'{"pseudo":"PeakCollector"}')`,
    [user]
  );
  await db.exec(`insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
 select md5('peak-'||g)::uuid,'peak-'||g,'Card '||g,'ANIME/MANGA','Fixture',(array['C','R','SR','SSR','LR'])[1+(g-1)%5]::public.card_rarity,'https://example.test/card.png','test' from generate_series(1,50) g`);
  const ids = (
    await db.query(
      `insert into public.user_cards(user_id,card_id,rarity) select $1,id,rarete_base from public.cards where source_id like 'peak-%' returning id`,
      [user]
    )
  ).rows.map(r => r.id);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  await db.query("select public.discard_collection_cards($1::uuid[])", [ids]);
  const items = (
    await db.query("select public.get_achievement_catalogue() result")
  ).rows[0].result;
  assert.ok(
    items.find(a => a.family === "collector" && a.conditionValue === 50)
      .completedAt
  );
  assert.ok(items.find(a => a.family === "rarity-master").completedAt);
  assert.equal(
    items.filter(a => a.family === "completionist" && a.conditionValue === 50)
      .length,
    1,
    "legacy Specialist replaces one category tier, not a second reward"
  );
});
