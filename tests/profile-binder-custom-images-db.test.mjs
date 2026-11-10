import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("profile binders show the newest personalised art for an owned card", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());

  const owner = "f3700000-0000-4000-8000-000000000001";
  const card = "f3700000-0000-4000-8000-000000000002";
  const franchise = "Custom art fixture";
  const category = "ANIME/MANGA";
  const sourceKey =
    "source:" +
    createHash("sha256").update(`${category}\u001f${franchise}`).digest("hex");

  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"CustomArtOwner"}\')',
    [owner]
  );
  await db.query(
    "insert into public.cards(id,source,source_id,nom,franchise,categorie,rarete_base,image_url) values($1,'manual','custom-art-fixture','Fixture card',$2,$3,'LR','https://example.test/catalogue.webp')",
    [card, franchise, category]
  );
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity,date_obtention,custom_image_url) values($1,$2,'LR','2026-11-01T12:00:00Z','https://i.imgur.com/older.webp'),($1,$2,'LR','2026-11-02T12:00:00Z','https://i.imgur.com/newest.gif')",
    [owner, card]
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);

  const page = (
    await db.query(
      "select public.get_binder_cards_page(null,$1,'','','',false,0,24,'rarity') value",
      [sourceKey]
    )
  ).rows[0].value;

  assert.equal(page.binderOwned, 1);
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.items[0], {
    id: card,
    name: "FIXTURE CARD",
    category,
    anime: franchise,
    rarity: "LR",
    image: "https://i.imgur.com/newest.gif",
    catalogueImage: "https://example.test/catalogue.webp",
    customImageUrl: "https://i.imgur.com/newest.gif",
    owned: true
  });
});
