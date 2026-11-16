import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("auction cards carry the #1 of the actual copy in the market and detail", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const seller = "13900000-0000-4000-8000-000000000001";
  const viewer = "13900000-0000-4000-8000-000000000002";

  async function asPlayer(id) {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  }

  for (const [id, pseudo] of [
    [seller, "MarketFirstSeller"],
    [viewer, "MarketFirstViewer"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );

  async function catalogue(name, rarity) {
    const { rows } = await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'Anime/Manga','Badge test',$2,'https://example.test/badge.png','test') returning id",
      [name, rarity]
    );
    return rows[0].id;
  }

  async function copy(cardId, rarity, shiny = false) {
    const { rows } = await db.query(
      "insert into public.user_cards(user_id,card_id,rarity,is_shiny) values ($1,$2,$3,$4) returning id",
      [seller, cardId, rarity, shiny]
    );
    return rows[0].id;
  }

  const lr = await catalogue("Market LR", "LR");
  const first = await copy(lr, "LR");
  const duplicate = await copy(lr, "LR");
  const shinyFirst = await copy(lr, "LR", true);
  const ssr = await copy(await catalogue("Market SSR", "SSR"), "SSR");
  const evolvedCard = await catalogue("Market Infinity", "LR");
  const classicInput = await copy(evolvedCard, "LR");
  const shinyInput = await copy(evolvedCard, "LR", true);
  const spareInput = await copy(evolvedCard, "LR");
  await db.query(
    "update public.first_lr_copies set source='legacy' where card_instance_id=any($1::uuid[])",
    [[first, classicInput]]
  );
  await asPlayer(seller);
  const {
    rows: [evolution]
  } = await db.query("select public.evolve_lr_card($1::uuid[]) value", [
    [classicInput, shinyInput, spareInput]
  ]);
  await db.exec("reset role");

  const expected = new Map();
  for (const [instance, source] of [
    [first, "legacy"],
    [duplicate, null],
    [shinyFirst, "mint"],
    [ssr, null],
    [evolution.value.instanceId, "mint"]
  ]) {
    const { rows } = await db.query(
      "insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at) values ($1,$2,10,10,60,clock_timestamp()+interval '60 minutes') returning id",
      [instance, seller]
    );
    expected.set(rows[0].id, source);
  }

  await asPlayer(viewer);
  const read = async (sql, args) => (await db.query(sql, args)).rows[0].value;
  function check(listings) {
    assert.equal(listings.length, expected.size);
    for (const { id, card } of listings) {
      assert.ok(expected.has(id));
      assert.equal(card.firstLrCopy, expected.get(id));
      assert.ok(!("instanceId" in card));
    }
  }

  check((await read("select public.browse_auctions_page() value")).items);
  check((await read("select public.list_auctions_page() value")).items);
  check(await read("select public.list_auctions() value"));
  const details = await Promise.all(
    [...expected.keys()].map(id =>
      read("select public.get_auction($1) value", [id])
    )
  );
  check(details);
  assert.equal(details.at(-1).card.isEvolved, true);
  assert.equal(details.at(-1).card.shiny, true);
  await assert.rejects(
    db.query("select public.auction_first_lr_copy_source($1)", [first]),
    /permission denied/
  );
});
