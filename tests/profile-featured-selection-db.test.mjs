import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
test("unified profile selection is atomic, owner-only, private and independent from collection favorites", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const owner = "86000000-0000-4000-8000-000000000001",
    visitor = "86000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [owner, "FeaturedOwner"],
    [visitor, "FeaturedVisitor"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  const as = async (user, sql, args = []) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    try {
      return (await db.query(sql, args)).rows[0]?.v;
    } finally {
      await db.exec(
        "reset role;select set_config('request.jwt.claim.sub','',false)"
      );
    }
  };
  const keys = [];
  for (const license of ["Featured Alpha", "Featured Beta"]) {
    const card = (
      await db.query(
        "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA',$1,'LR','https://example.test/lr.png','test') returning id",
        [license]
      )
    ).rows[0].id;
    keys.push(
      (
        await db.query(
          "select binder_key from public.catalogue_binder_links where card_id=$1 limit 1",
          [card]
        )
      ).rows[0].binder_key
    );
  }
  await as(owner, "select public.set_binder_favorite($1,true) v", [keys[0]]);
  const folder = await as(
    owner,
    "select public.save_license_folder(null,$1,'Akatsuki','{}',true) v",
    [keys[0]]
  );
  const foreign = await as(
    visitor,
    "select public.save_license_folder(null,$1,'Private folder','{}',true) v",
    [keys[0]]
  );
  const read = (viewer = owner) =>
    as(viewer, "select public.get_profile_featured_items($1) v", [owner]);
  const save = (binders, folders) =>
    as(owner, "select public.set_profile_featured_selection($1,$2) v", [
      binders,
      folders
    ]);
  assert.equal(
    (await read()).items.length,
    2,
    "Existing binders and featured folders remain visible before the first explicit selection"
  );
  await save([keys[1]], [folder]);
  let result = await read();
  assert.deepEqual(result.binderKeys, [keys[1]]);
  assert.deepEqual(result.folderIds, [folder]);
  assert.deepEqual(
    new Set(result.items.map(item => item.kind)),
    new Set(["binder", "folder"])
  );
  assert.equal(
    result.items.find(item => item.kind === "binder").image,
    "https://example.test/lr.png"
  );
  assert.deepEqual(
    (
      await db.query("select binder_key from public.binder_favorite_keys($1)", [
        owner
      ])
    ).rows.map(row => row.binder_key),
    [keys[0]],
    "Profile choices never change pack/collection favorites"
  );
  await assert.rejects(
    save([keys[0]], [foreign]),
    /FEATURED_SELECTION_INVALID/
  );
  assert.deepEqual(
    (await read()).binderKeys,
    [keys[1]],
    "Rejected folder ownership rolls back the complete update"
  );
  assert.equal(
    (
      await db.query(
        "select featured from public.license_folders where id=$1",
        [folder]
      )
    ).rows[0].featured,
    true
  );
  await assert.rejects(
    save(["source:" + "f".repeat(64)], []),
    /FEATURED_SELECTION_INVALID/
  );
  await assert.rejects(
    save(Array(101).fill(keys[0]), []),
    /FEATURED_SELECTION_INVALID/
  );
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [owner]
  );
  assert.equal((await read(visitor)).items.length, 2);
  await as(visitor, "select public.set_profile_featured_selection($1,$2) v", [
    [keys[0]],
    []
  ]);
  assert.deepEqual(
    (await read()).binderKeys,
    [keys[1]],
    "The caller can save only their own profile"
  );
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [owner]
  );
  await assert.rejects(read(visitor), /PROFILE_PRIVATE/);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [owner, visitor]
  );
  assert.equal((await read(visitor)).items.length, 2);
  await as(visitor, "select public.block_user($1) v", [owner]);
  await assert.rejects(read(visitor), /PROFILE_PRIVATE/);
  await save([], []);
  result = await read();
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.binderKeys, []);
  assert.equal(
    (
      await db.query(
        "select featured from public.license_folders where id=$1",
        [folder]
      )
    ).rows[0].featured,
    false
  );
  assert.deepEqual(
    (
      await db.query("select binder_key from public.binder_favorite_keys($1)", [
        owner
      ])
    ).rows.map(row => row.binder_key),
    [keys[0]],
    "An explicitly empty profile never falls back to favorites"
  );
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    owner
  ]);
  await assert.rejects(save([], []), /ACCOUNT_BANNED/);
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('authenticated','public.profile_featured_selection','INSERT') allowed"
      )
    ).rows[0].allowed,
    false
  );
});
