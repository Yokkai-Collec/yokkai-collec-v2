import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("recent profile cards distinguish recorded pack drops and accepted trades without exposing private provenance", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists created_at timestamptz default now()"
  );
  const owner = "87000000-0000-4000-8000-000000000001",
    other = "87000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [owner, "SourceOwner"],
    [other, "SourceViewer"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [owner, other]
  );
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values('recent-source','Source Card','ANIME/MANGA','Source Series','SR','https://example.test/card.webp','test') returning id"
    )
  ).rows[0].id;
  const copies = [];
  for (let n = 0; n < 5; n++)
    copies.push(
      (
        await db.query(
          "insert into public.user_cards(user_id,card_id,date_obtention,rarity) values($1,$2,'2026-11-06T10:00:00Z'::timestamptz + $3 * interval '1 minute','SR') returning id",
          [owner, card, n]
        )
      ).rows[0].id
    );
  await db.query(
    "insert into public.regular_pack_opening_cards(card_instance_id,pack_opening_id,card_id,original_owner_id,recorded_at) values($1,gen_random_uuid(),$2,$3,'2026-11-06T10:00:00Z'),($4,gen_random_uuid(),$2,$5,'2026-11-05T10:00:00Z')",
    [copies[0], card, owner, copies[1], other]
  );
  await db.query(
    "insert into public.trade_offers(from_user,to_user,offered_card_ids,status,updated_at) values($1,$2,$3,'accepted','2026-11-06T10:01:00Z'),($1,$2,$4,'pending','2026-11-06T10:02:00Z')",
    [other, owner, [copies[1]], [copies[2]]]
  );
  const pack = (
    await db.query(
      "insert into public.decision_packs(user_id) values($1) returning id",
      [owner]
    )
  ).rows[0].id;
  const choice = (
    await db.query(
      "insert into public.decision_pack_choices(pack_id,card_id,rarity,position) values($1,$2,'SR',1) returning id",
      [pack, card]
    )
  ).rows[0].id;
  await db.query(
    "update public.decision_packs set status='claimed',kept_choice_id=$2,claimed_at='2026-11-06T10:03:00Z' where id=$1",
    [pack, choice]
  );
  const read = async (viewer, stable = false) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      viewer
    ]);
    try {
      return (
        await db.query(
          "select public." +
            (stable
              ? "get_profile_details_with_binders"
              : "get_profile_details") +
            "($1) value",
          [owner]
        )
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  for (const stable of [false, true]) {
    const activity = (await read(owner, stable)).activity;
    const sources = new Map(activity.map(x => [x.id, x.acquisitionSource]));
    assert.equal(sources.get(copies[0]), "pack");
    assert.equal(sources.get(copies[1]), "trade");
    assert.equal(sources.get(copies[2]), "unknown");
    assert.equal(sources.get(copies[3]), "pack");
    assert.equal(sources.get(copies[4]), "unknown");
    for (const item of activity) {
      assert.equal("original_owner_id" in item, false);
      assert.equal("from_user" in item, false);
    }
  }
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [owner]
  );
  await db.query(
    "delete from public.friendships where user_id=$1 or friend_id=$1",
    [owner]
  );
  assert.deepEqual((await read(other)).activity, []);
});
