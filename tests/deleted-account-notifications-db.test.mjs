import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("a wishlist held by an account being deleted no longer blocks auctions", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const [seller, deleted, fan] = [1, 2, 3].map(
    id => `de1e7000-0000-4000-8000-00000000000${id}`
  );
  for (const [id, pseudo] of [
    [seller, "Seller"],
    [deleted, "Leaving"],
    [fan, "Fan"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  const catalog = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('test','wished','Test','Test','Test','LR','https://example.invalid/card.png') returning id"
    )
  ).rows[0].id;
  const card = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'LR') returning id",
      [seller, catalog]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.wishlists(user_id,card_id) values($1,$3),($2,$3)",
    [deleted, fan, catalog]
  );
  // Deletion fence committed, cleanup not finished yet.
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [deleted]
  );

  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    seller
  ]);
  await db.exec("set role authenticated");
  const auction = (
    await db.query("select public.create_auction($1,20000,60) id", [card])
  ).rows[0].id;
  await db.exec("reset role");

  const notified = (
    await db.query(
      "select user_id from public.notifications where reference_id=$1 order by user_id",
      [auction]
    )
  ).rows.map(row => row.user_id);
  assert.deepEqual(notified, [fan]);
});
