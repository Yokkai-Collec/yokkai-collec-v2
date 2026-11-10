import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261110040000_card_discovery_variants.sql";

test("card discovery keeps normal LR and Shiny LR owners separate", async t => {
  const migrations = readdirSync(
    new URL("../supabase/migrations/", import.meta.url)
  )
    .filter(name => name.endsWith(".sql") && name < migration)
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  const ids = [
    "15000000-0000-4000-8000-000000000001",
    "15000000-0000-4000-8000-000000000002",
    "15000000-0000-4000-8000-000000000003"
  ];
  for (const [index, id] of ids.entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo: `Variant ${index}` })]
    );
  }
  const cardId = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values('variant-lr','SPIDER-MAN','FILM','Spider-Verse','LR','https://example.test/spider.webp','test') returning id"
    )
  ).rows[0].id;
  for (const [owner, shiny] of [
    [ids[1], false],
    [ids[2], true]
  ]) {
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity,is_shiny) values($1,$2,'LR',$3)",
      [owner, cardId, shiny]
    );
  }
  await db.exec(
    readFileSync(
      new URL(`../supabase/migrations/${migration}`, import.meta.url),
      "utf8"
    )
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids[0]
  ]);
  await db.exec("set role authenticated");
  const normal = (
    await db.query("select public.get_card_discovery($1,0,30,false) value", [
      cardId
    ])
  ).rows[0].value;
  const shiny = (
    await db.query("select public.get_card_discovery($1,0,30,true) value", [
      cardId
    ])
  ).rows[0].value;
  assert.deepEqual(
    normal.owners.map(owner => owner.pseudo),
    ["Variant 1"]
  );
  assert.deepEqual(
    shiny.owners.map(owner => owner.pseudo),
    ["Variant 2"]
  );
  assert.equal(normal.card.shiny, false);
  assert.equal(shiny.card.shiny, true);
});
