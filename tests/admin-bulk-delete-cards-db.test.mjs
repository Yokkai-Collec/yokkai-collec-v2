import assert from "node:assert/strict";
import test from "node:test";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const bidder = "10000000-0000-4000-8000-000000000002";
const admin = "10000000-0000-4000-8000-000000000003";
const cardA = "20000000-0000-4000-8000-00000000000a";
const cardB = "20000000-0000-4000-8000-00000000000b";
const cardC = "20000000-0000-4000-8000-00000000000c";
const missing = "20000000-0000-4000-8000-0000000000ff";
const copyA = "30000000-0000-4000-8000-00000000000a";
const copyB = "30000000-0000-4000-8000-00000000000b";
const copyC = "30000000-0000-4000-8000-00000000000c";

test("admin_delete_cards supprime en bloc avec les règles de admin_delete_card, tout ou rien", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());

  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values
      ($1,'{"pseudo":"Owner"}'),($2,'{"pseudo":"Bidder"}'),($3,'{"pseudo":"Admin"}')`,
    [owner, bidder, admin]
  );
  await db.query("insert into public.admin_users(user_id) values ($1)", [
    admin
  ]);
  await db.query(
    "update public.user_profiles set karas_balance=50 where user_id=$1",
    [bidder]
  );
  for (const [id, name] of [
    [cardA, "A"],
    [cardB, "B"],
    [cardC, "C"]
  ])
    await db.query(
      `insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
       values ($1,$2,$3,'ANIME/MANGA','LICENCE','SR','https://example.test/card.jpg','manual')`,
      [id, `bulk-${name}`, name]
    );
  await db.query("delete from public.card_franchises");
  await db.query(
    `insert into public.card_franchises(card_id,franchise,position) values
     ($1,'LICENCE',0),($1,'AUTRE',1),($2,'LICENCE',0),($3,'LICENCE',0)`,
    [cardA, cardB, cardC]
  );
  await db.query(
    `insert into public.user_cards(id,user_id,card_id,rarity) values
     ($1,$4,$5,'SR'),($2,$4,$6,'SR'),($3,$4,$7,'SR')`,
    [copyA, copyB, copyC, owner, cardA, cardB, cardC]
  );
  await db.query(
    `insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,status,current_price,buyer_id)
     values ($1,$2,10,60,now()+interval '1 hour','active',30,$3)`,
    [copyA, owner, bidder]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted')",
    [owner, bidder]
  );
  await db.query(
    `insert into public.trade_offers(from_user,to_user,offered_card_ids)
     values ($1,$2,$3::uuid[])`,
    [owner, bidder, [copyB]]
  );
  await db.query(
    `insert into public.card_shares(id,card_id,owner_id,card_name,franchise,rarity,shiny,show_pseudo,catalogue_image_url)
     values ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',$1,$2,'A','LICENCE','SR',false,false,'https://example.test/card.jpg')`,
    [cardA, owner]
  );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values ($1,$2),($1,$3)",
    [bidder, cardB, cardC]
  );

  const as = async (role, userId, sql, args = []) => {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      userId
    ]);
    try {
      return (await db.query(sql, args)).rows;
    } finally {
      await db.exec("reset role");
    }
  };
  const count = async (sql, args = []) =>
    Number((await db.query(sql, args)).rows[0].total);
  const cardsLeft = () => count("select count(*) total from public.cards");

  // Non-admins and anon are refused; the internal helper has no grant at all.
  for (const fn of ["admin_delete_cards", "admin_preview_delete_cards"]) {
    await assert.rejects(
      as("authenticated", owner, `select public.${fn}($1::uuid[])`, [[cardA]]),
      /ADMIN_REQUIRED/
    );
    await assert.rejects(
      as("anon", owner, `select public.${fn}($1::uuid[])`, [[cardA]]),
      /permission denied/
    );
  }
  await assert.rejects(
    as("authenticated", admin, "select public.admin_delete_card_core($1)", [
      cardA
    ]),
    /permission denied/
  );

  const preview = (
    await as(
      "authenticated",
      admin,
      "select public.admin_preview_delete_cards($1::uuid[]) value",
      [[cardA, cardB, cardA]]
    )
  )[0].value;
  assert.deepEqual(preview, {
    cards: 2,
    ownedCopies: 2,
    activeAuctions: 1,
    pendingTrades: 1,
    cardShares: 1,
    wishlists: 1,
    multiFranchiseCards: [
      { id: cardA, name: "A", franchises: ["LICENCE", "AUTRE"] }
    ]
  });

  // Cap: 501 ids are refused before anything is touched.
  const tooMany = Array.from(
    { length: 501 },
    (_, index) => `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`
  );
  await assert.rejects(
    as("authenticated", admin, "select public.admin_delete_cards($1::uuid[])", [
      tooMany
    ]),
    /BULK_LIMIT_EXCEEDED/
  );

  // One refused card = nothing deleted, no refund, no audit row.
  await assert.rejects(
    as("authenticated", admin, "select public.admin_delete_cards($1::uuid[])", [
      [cardA, cardB, missing]
    ]),
    error => {
      assert.match(error.message, /CARD_NOT_FOUND/);
      assert.equal(error.detail, missing);
      return true;
    }
  );
  assert.equal(await cardsLeft(), 3);
  assert.equal(
    await count(
      "select count(*) total from public.auctions where status='active'"
    ),
    1
  );
  assert.equal(
    await count(
      "select karas_balance total from public.user_profiles where user_id=$1",
      [bidder]
    ),
    50
  );
  assert.equal(
    await count("select count(*) total from public.admin_audit_logs"),
    0
  );

  const result = (
    await as(
      "authenticated",
      admin,
      "select public.admin_delete_cards($1::uuid[]) value",
      [[cardB, cardA]]
    )
  )[0].value;
  assert.deepEqual(result, {
    cardsDeleted: 2,
    ownedCopiesRemoved: 2,
    decisionChoicesRemoved: 0,
    auctionsCancelled: 1,
    pendingTradesDeclined: 1
  });

  // Same effects as the single-card RPC, and the unselected card C is intact
  // even though it shares the licence.
  assert.deepEqual(
    (await db.query("select id from public.cards")).rows.map(row => row.id),
    [cardC]
  );
  assert.deepEqual(
    (await db.query("select id from public.user_cards")).rows.map(
      row => row.id
    ),
    [copyC]
  );
  assert.equal(await count("select count(*) total from public.auctions"), 0);
  assert.equal(
    await count(
      "select karas_balance total from public.user_profiles where user_id=$1",
      [bidder]
    ),
    80
  );
  assert.equal(
    (await db.query("select status from public.trade_offers")).rows[0].status,
    "declined"
  );
  assert.equal(await count("select count(*) total from public.card_shares"), 0);
  assert.deepEqual(
    (await db.query("select card_id from public.wishlists")).rows,
    [{ card_id: cardC }]
  );

  // Exactly one audit row for the whole operation, without player data.
  const audit = (
    await db.query(
      "select admin_user_id,action,card_id,metadata from public.admin_audit_logs"
    )
  ).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].admin_user_id, admin);
  assert.equal(audit[0].action, "card.bulk_delete");
  assert.equal(audit[0].card_id, null);
  assert.equal(audit[0].metadata.card_count, 2);
  assert.deepEqual(
    audit[0].metadata.cards.map(card => card.id),
    [cardA, cardB]
  );
  for (const userId of [owner, bidder])
    assert.doesNotMatch(JSON.stringify(audit[0].metadata), new RegExp(userId));
});
