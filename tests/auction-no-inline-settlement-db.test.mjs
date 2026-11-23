import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("creating an auction leaves unrelated expired sales to the cron and releases elapsed quota slots", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const seller = "99600000-0000-4000-8000-000000000001";
  const other = "99600000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [seller, "ListingSeller"],
    [other, "ElapsedSeller"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source) values('no-inline-settle','Fixture','ANIME/MANGA','SR','https://example.test/card.png','test') returning id"
    )
  ).rows[0].id;
  const copies = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) select $1,$2,'SR' from generate_series(1,6) returning id",
      [seller, card]
    )
  ).rows.map(r => r.id);
  const otherCopy = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'SR') returning id",
      [other, card]
    )
  ).rows[0].id;
  const expired = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at) values($1,$2,10,10,60,clock_timestamp()-interval '1 second') returning id",
      [otherCopy, other]
    )
  ).rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    seller
  ]);
  await db.exec("set role authenticated");
  for (const copy of copies.slice(0, 5))
    await db.query("select public.create_auction($1,10,60)", [copy]);
  await assert.rejects(
    db.query("select public.create_auction($1,10,60)", [copies[5]]),
    /AUCTION_LIMIT_REACHED/
  );
  await db.exec("reset role");
  assert.equal(
    (
      await db.query("select status from public.auctions where id=$1", [
        expired
      ])
    ).rows[0].status,
    "active"
  );
  await db.query(
    "update public.auctions set ends_at=clock_timestamp()-interval '1 second' where seller_id=$1",
    [seller]
  );
  await db.exec("set role authenticated");
  await db.query("select public.create_auction($1,10,60)", [copies[5]]);
  await db.exec("reset role");
  await db.query("select public.settle_expired_auctions()");
  assert.equal(
    (
      await db.query("select status from public.auctions where id=$1", [
        expired
      ])
    ).rows[0].status,
    "expired"
  );
});

test("removing inline settlement refuses a disabled cron before replacing the legacy function", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const migration = name =>
    readFileSync(
      new URL("../supabase/migrations/" + name, import.meta.url),
      "utf8"
    );
  await db.exec(migration("20261027175000_admin_pro_auction_limit.sql"));
  await db.exec(
    "update cron.job set active=false where command ilike '%settle_expired_auctions%'"
  );
  await assert.rejects(
    db.exec(
      migration("20261028120000_auction_creation_without_inline_settlement.sql")
    ),
    /SETTLEMENT_CRON_REQUIRED/
  );
  await db.exec("rollback");
  const source = (
    await db.query(
      "select prosrc from pg_proc where oid='public.create_auction(uuid,integer,integer)'::regprocedure"
    )
  ).rows[0].prosrc;
  assert.match(source, /perform public\.settle_expired_auctions\(\)/);
});
