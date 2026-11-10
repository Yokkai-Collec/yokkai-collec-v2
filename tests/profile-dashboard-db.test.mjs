import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("profile dashboard uses real stats, distinct completion, mutual friends and protects private data", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const [owner, viewer, common, stranger] = [1, 2, 3, 4].map(
    n => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  );
  for (const [index, id] of [owner, viewer, common, stranger].entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo: `Dashboard${index}` })]
    );
  }
  await db.exec(
    "alter table auth.users add column created_at timestamptz default '2025-11-21T10:00:00Z'"
  );
  await db.query(
    "update public.user_achievement_stats set regular_packs_opened=17 where user_id=$1",
    [owner]
  );
  await db.query(
    "insert into public.decision_packs(user_id,status) values ($1,'claimed')",
    [owner]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted'),($3,$2,'accepted')",
    [owner, common, viewer]
  );
  await db.exec(`insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values
    ('dashboard-lr','Test LR','ANIME/MANGA','Test Dashboard','LR','https://example.test/lr.png','test'),
    ('dashboard-ssr','Test SSR','ANIME/MANGA','Test Dashboard','SSR','https://example.test/ssr.png','test');`);
  const cards = (
    await db.query(
      "select id,rarete_base from public.cards where source_id like 'dashboard-%' order by source_id"
    )
  ).rows;
  for (const card of cards)
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,$3),($1,$2,$3)",
      [owner, card.id, card.rarete_base]
    );
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values ($1,'Test Dashboard')",
    [owner]
  );
  const interests = {
    anime: ["Noragami"],
    games: ["Silent Hill"],
    kpop: ["BTS"],
    other: []
  };
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);
  const saved = (
    await db.query("select public.update_profile_interests($1::jsonb) value", [
      JSON.stringify(interests)
    ])
  ).rows[0].value;
  assert.deepEqual(saved, interests);
  await assert.rejects(
    db.query("select public.update_profile_interests($1::jsonb)", [
      JSON.stringify({ ...interests, other: Array(13).fill("Too many") })
    ]),
    /INTERESTS_INVALID/
  );
  await assert.rejects(
    db.query("select public.update_profile_interests($1::jsonb)", [
      JSON.stringify({ ...interests, anime: ["x".repeat(101)] })
    ]),
    /INTERESTS_INVALID/
  );
  await assert.rejects(
    db.query("select public.update_profile_interests('{}'::jsonb)"),
    /INTERESTS_INVALID/
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer
  ]);
  const get = async () =>
    (await db.query("select public.get_profile_details($1) value", [owner]))
      .rows[0].value;
  const details = await get();
  assert.equal(details.boostersOpened, 18);
  assert.equal(details.lrCount, 2);
  assert.equal(details.ssrCount, 2);
  assert.equal(
    new Date(details.joinedAt).getTime(),
    new Date("2025-11-21T10:00:00Z").getTime()
  );
  assert.deepEqual(details.interests, interests);
  assert.deepEqual(
    details.mutualFriends.map(friend => friend.id),
    [common]
  );
  assert.deepEqual(details.favoriteAlbums, [
    {
      license: "Test Dashboard",
      image: "https://example.test/lr.png",
      total: 2,
      owned: 2,
      percent: 100
    }
  ]);
  assert.equal(details.activity.length, 4);
  assert.ok(
    details.activity.every(event => event.kind === "obtained" && event.card.id)
  );
  await db.exec("reset role");
  const soldCopy = (
    await db.query(
      "select id from public.user_cards where user_id=$1 limit 1",
      [owner]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at,status) values ($1,$2,$3,10,240,60,now()-interval '1 minute','sold')",
    [soldCopy, owner, viewer]
  );
  await db.query(
    "update public.user_cards set user_id=$1, date_obtention=now() where id=$2",
    [viewer, soldCopy]
  );
  await db.exec("set role authenticated");
  const sellerActivity = (await get()).activity;
  assert.equal(sellerActivity.filter(event => event.kind === "sold").length, 1);
  assert.equal(sellerActivity.find(event => event.kind === "sold").price, 240);
  const buyerDetails = (
    await db.query("select public.get_profile_details(null) value")
  ).rows[0].value;
  assert.equal(
    buyerDetails.activity.filter(event => event.kind === "bought").length,
    1
  );
  assert.equal(
    buyerDetails.activity.filter(event => event.kind === "obtained").length,
    0
  );
  await db.query("select public.update_profile_interests($1::jsonb)", [
    JSON.stringify({ ...interests, anime: ["Viewer only"] })
  ]);
  assert.deepEqual(
    (await get()).interests,
    interests,
    "a viewer cannot update someone else's interests"
  );
  await db.exec("reset role");
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [owner]
  );
  await db.exec("set role authenticated");
  const privateData = await get();
  for (const key of ["boostersOpened", "lrCount", "ssrCount"])
    assert.equal(privateData[key], null);
  for (const key of ["mutualFriends", "favoriteAlbums", "activity"])
    assert.deepEqual(privateData[key], []);
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select public.get_profile_details($1)", [owner]),
    /permission denied/
  );
  await assert.rejects(
    db.query("select public.update_profile_interests($1::jsonb)", [
      JSON.stringify(interests)
    ]),
    /permission denied/
  );
  await db.exec(
    "reset role; create table auth.identities(user_id uuid, provider text, created_at timestamptz, updated_at timestamptz); set role service_role"
  );
  const request = "71000000-0000-4000-8001-000000000001";
  await db.query("select public.reserve_data_export($1,$2)", [owner, request]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [
      owner,
      request
    ])
  ).rows[0].value;
  assert.deepEqual(
    exported.profile.interests,
    interests,
    "personal favorites must be included in the owner's export"
  );
  assert.ok(!JSON.stringify(exported).includes("Viewer only"));
});
