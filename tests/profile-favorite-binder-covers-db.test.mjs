import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
test("profile favorite covers use native catalogue artwork and preserve privacy without changing ownership", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const owner = "84000000-0000-4000-8000-000000000001",
    viewer = "84000000-0000-4000-8000-000000000002";
  await db.exec(
    "alter table auth.users add column if not exists created_at timestamptz default now()"
  );
  for (const [id, pseudo] of [
    [owner, "CoverOwner"],
    [viewer, "CoverViewer"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  for (const [source, rarity, image] of [
    ["cover-blank", "LR", ""],
    ["cover-ssr", "SSR", "https://example.test/ssr.png"],
    ["cover-common", "C", "https://example.test/common.png"]
  ])
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA','Favorite Cover',$2,$3,'test')",
      [source, rarity, image]
    );
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values($1,'Favorite Cover')",
    [owner]
  );
  const as = async (user, sql, args = []) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    try {
      return (await db.query(sql, args)).rows[0].value;
    } finally {
      await db.exec(
        "reset role;select set_config('request.jwt.claim.sub','',false)"
      );
    }
  };
  const details = (user, stable) =>
    as(
      user,
      `select public.${stable ? "get_profile_details_with_binders" : "get_profile_details"}($1) value`,
      [owner]
    );
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [owner]
  );
  for (const stable of [false, true]) {
    const albums = (await details(viewer, stable)).favoriteAlbums;
    assert.equal(albums.length, 1);
    assert.equal(albums[0].image, "https://example.test/ssr.png");
    assert.equal(albums[0].owned, 0);
    assert.equal(albums[0].total, 3);
  }
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [owner]
  );
  for (const stable of [false, true]) {
    assert.deepEqual((await details(viewer, stable)).favoriteAlbums, []);
    assert.equal(
      (await details(owner, stable)).favoriteAlbums[0].image,
      "https://example.test/ssr.png"
    );
  }
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [owner, viewer]
  );
  assert.equal(
    (await details(viewer, true)).favoriteAlbums[0].image,
    "https://example.test/ssr.png"
  );
  await as(viewer, "select public.block_user($1) value", [owner]);
  for (const stable of [false, true])
    assert.deepEqual(
      (await details(viewer, stable)).favoriteAlbums,
      [],
      "Blocking preserves the profile identity but hides the collection and its covers"
    );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.user_cards where user_id=$1",
        [owner]
      )
    ).rows[0].n,
    0,
    "Covers never manufacture or transfer owned copies"
  );
});
