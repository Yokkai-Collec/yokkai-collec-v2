import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";

const source = readFileSync(
  new URL(
    "../supabase/migrations/20261015000003_remove_audited_unlicensed_anime.sql",
    import.meta.url
  ),
  "utf8"
);
const owner = "91000000-0000-4000-8000-000000000001";
const friend = "91000000-0000-4000-8000-000000000002";
const ids = Array.from(
  { length: 6 },
  (_, i) => `92000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
);
const badCopy = "93000000-0000-4000-8000-000000000001";
const goodCopy = "93000000-0000-4000-8000-000000000002";

// The production UUID fingerprint cannot match synthetic fixture UUIDs. Only
// the two expected audit constants are injected; all selection, guards and
// deletion SQL remain identical. Original production guards are tested below.
function fixtureMigration(expectedIds) {
  const fingerprint = createHash("md5")
    .update([...expectedIds].sort().join(","))
    .digest("hex");
  return source
    .replace(
      "expected_count constant integer := 15406;",
      `expected_count constant integer := ${expectedIds.length};`
    )
    .replace(
      "expected_fingerprint constant text := '1b864d9b640237d59ee73772b348115d';",
      `expected_fingerprint constant text := '${fingerprint}';`
    );
}
async function seed(db) {
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"AuditOwner"}\'),($2,\'{"pseudo":"AuditFriend"}\')',
    [owner, friend]
  );
  for (const [index, id] of ids.entries()) {
    await db.query(
      `insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
      values($1,$2,$3,$4,$5,'C','https://example.test/audit.png',$6)`,
      [
        id,
        `audited-${index}`,
        `Audit ${index}`,
        index === 4 ? "VIDEO GAMES" : "ANIME/MANGA",
        index === 2 ? "Preserved licence" : index === 1 ? " " : "",
        index === 5 ? "manual" : "anilist"
      ]
    );
  }
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position) values ($1,'Secondary licence',1)",
    [ids[3]]
  );
  await db.query(
    "insert into public.user_cards(id,user_id,card_id,rarity) values ($1,$3,$4,'C'),($2,$3,$5,'C')",
    [badCopy, goodCopy, owner, ids[0], ids[2]]
  );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values ($1,$2),($1,$3)",
    [owner, ids[0], ids[2]]
  );
}
const count = async (db, table) =>
  Number(
    (await db.query(`select count(*) as total from public.${table}`)).rows[0]
      .total
  );

test("suppression auditée : garde exacte de production, aucun changement pour un autre jeu de cartes", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  assert.match(source, /expected_count constant integer := 15406;/);
  assert.match(
    source,
    /expected_fingerprint constant text := '1b864d9b640237d59ee73772b348115d';/
  );
  await seed(db);
  await assert.rejects(db.exec(source), /AUDITED_CARD_SET_CHANGED/);
  await db.exec("rollback");
  // Matching only the count is insufficient: the UUID fingerprint must match.
  await assert.rejects(
    db.exec(
      source.replace(
        "expected_count constant integer := 15406;",
        "expected_count constant integer := 2;"
      )
    ),
    /AUDITED_CARD_SET_CHANGED/
  );
  await db.exec("rollback");
  assert.equal(await count(db, "cards"), 6);
  assert.equal(await count(db, "user_cards"), 2);
  assert.equal(await count(db, "wishlists"), 2);
});

test("suppression auditée : copies, wishlist et dépendances nettoyées, autres cartes et images conservées", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  await seed(db);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted')",
    [owner, friend]
  );
  await db.query(
    "insert into public.trade_offers(from_user,to_user,offered_card_ids) values ($1,$2,$3::uuid[])",
    [owner, friend, [badCopy]]
  );
  await db.query(
    "update public.user_cards set is_locked=true where id=any($1::uuid[])",
    [[badCopy, goodCopy]]
  );
  await db.query(
    "update public.user_profiles set banner_card_id=$2,featured_card_ids=$3::uuid[] where user_id=$1",
    [owner, ids[0], [badCopy, goodCopy]]
  );
  await db.exec(
    "insert into storage.objects(bucket_id,name) values ('card-images','audit-image-kept')"
  );
  const pack = (
    await db.query(
      "insert into public.decision_packs(user_id,status) values ($1,'pending') returning id",
      [owner]
    )
  ).rows[0].id;
  const choice = (
    await db.query(
      "insert into public.decision_pack_choices(pack_id,card_id,rarity,position) values ($1,$2,'SR',1) returning id",
      [pack, ids[0]]
    )
  ).rows[0].id;
  await db.query(
    "update public.decision_packs set status='claimed',kept_choice_id=$2 where id=$1",
    [pack, choice]
  );
  await db.query(
    "insert into public.card_shares(id,card_id,owner_id,card_name,franchise,rarity,shiny,show_pseudo,catalogue_image_url) values ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',$1,$2,'Audit','','C',false,false,'https://example.test/audit.png')",
    [ids[0], owner]
  );
  const history = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,status,current_price) values ($1,$2,10,60,now()-interval '1 hour','expired',10) returning id",
      [badCopy, owner]
    )
  ).rows[0].id;
  const balances = (
    await db.query(
      "select user_id,karas_balance from public.user_profiles order by user_id"
    )
  ).rows;
  await db.exec(fixtureMigration(ids.slice(0, 2)));
  assert.deepEqual(
    (await db.query("select id from public.cards order by id")).rows.map(
      row => row.id
    ),
    ids.slice(2)
  );
  assert.deepEqual(
    (await db.query("select id,is_locked from public.user_cards")).rows,
    [{ id: goodCopy, is_locked: true }]
  );
  assert.deepEqual(
    (await db.query("select card_id from public.wishlists")).rows,
    [{ card_id: ids[2] }]
  );
  assert.equal(
    (await db.query("select status from public.trade_offers")).rows[0].status,
    "declined"
  );
  assert.deepEqual(
    (
      await db.query(
        "select banner_card_id,featured_card_ids from public.user_profiles where user_id=$1",
        [owner]
      )
    ).rows[0],
    { banner_card_id: null, featured_card_ids: [goodCopy] }
  );
  assert.equal(
    (
      await db.query(
        "select kept_choice_id from public.decision_packs where id=$1",
        [pack]
      )
    ).rows[0].kept_choice_id,
    null
  );
  assert.equal(await count(db, "decision_pack_choices"), 0);
  assert.equal(await count(db, "card_shares"), 0);
  assert.deepEqual(
    (
      await db.query(
        "select card_instance_id,status,current_price from public.auctions where id=$1",
        [history]
      )
    ).rows[0],
    { card_instance_id: null, status: "expired", current_price: 10 }
  );
  assert.equal(
    (
      await db.query(
        "select count(*) as total from storage.objects where name='audit-image-kept'"
      )
    ).rows[0].total,
    1
  );
  assert.deepEqual(
    (
      await db.query(
        "select user_id,karas_balance from public.user_profiles order by user_id"
      )
    ).rows,
    balances
  );
  await db.exec(source); // no eligible cards remain: idempotent no-op.
  assert.equal(await count(db, "cards"), 4);
});

test("suppression auditée : une nouvelle enchère active annule toute l'opération sans mouvement de solde", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  await seed(db);
  await db.query(
    "insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,status,current_price,buyer_id) values ($1,$2,10,60,now()+interval '1 hour','active',30,$3)",
    [badCopy, owner, friend]
  );
  const balances = (
    await db.query(
      "select user_id,karas_balance from public.user_profiles order by user_id"
    )
  ).rows;
  await assert.rejects(
    db.exec(fixtureMigration(ids.slice(0, 2))),
    /AUDITED_CARDS_HAVE_ACTIVE_AUCTIONS/
  );
  await db.exec("rollback");
  assert.equal(await count(db, "cards"), 6);
  assert.equal(await count(db, "user_cards"), 2);
  assert.equal(await count(db, "wishlists"), 2);
  assert.equal(await count(db, "auctions"), 1);
  assert.deepEqual(
    (
      await db.query(
        "select user_id,karas_balance from public.user_profiles order by user_id"
      )
    ).rows,
    balances
  );
});
