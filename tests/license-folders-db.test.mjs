import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("license folders validate membership, preserve copies, export own data and respect profile privacy", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const owner = "85000000-0000-4000-8000-000000000001",
    visitor = "85000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [owner, "FolderOwner"],
    [visitor, "FolderVisitor"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  const cards = [];
  for (let i = 0; i < 27; i++)
    cards.push(
      (
        await db.query(
          "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA','Folder License','SR','https://example.test/card.png','test') returning id",
          ["FolderCard" + String(i).padStart(2, "0")]
        )
      ).rows[0].id
    );
  const other = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values('FolderOther','Other','ANIME/MANGA','Another License','LR','','test') returning id"
    )
  ).rows[0].id;
  const binder = (
    await db.query(
      "select binder_key from public.catalogue_binder_links where card_id=$1 limit 1",
      [cards[0]]
    )
  ).rows[0].binder_key;
  const instance = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'SR') returning id",
      [owner, cards[0]]
    )
  ).rows[0].id;
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
  const save = (user, id, name, ids, featured = true) =>
    as(user, "select public.save_license_folder($1,$2,$3,$4,$5) v", [
      id,
      binder,
      name,
      ids,
      featured
    ]);
  const list = (user, who = owner) =>
    as(user, "select public.get_license_folders($1,$2,false) v", [who, binder]);
  const read = (user, id, offset = 0, owned = false) =>
    as(user, "select public.get_license_folder_cards($1,'',$2,$3,24) v", [
      id,
      owned,
      offset
    ]);
  const id = await save(owner, null, "Akatsuki", cards);
  assert.equal((await list(owner))[0].total, 27);
  assert.equal((await list(owner))[0].owned, 1);
  assert.equal((await list(owner))[0].cardIds.length, 27);
  assert.equal((await read(owner, id)).items.length, 24);
  assert.equal((await read(owner, id, 24)).items.length, 3);
  assert.equal((await read(owner, id, 0, true)).items.length, 1);
  await assert.rejects(
    save(owner, null, "Other", [other]),
    /LICENSE_FOLDER_CARDS_INVALID/
  );
  await assert.rejects(
    save(owner, null, "akatsuki", cards),
    /LICENSE_FOLDER_NAME_TAKEN/
  );
  await assert.rejects(
    save(visitor, id, "Stolen", cards),
    /LICENSE_FOLDER_NOT_FOUND/
  );
  await assert.rejects(
    as(visitor, "select public.delete_license_folder($1) v", [id]),
    /LICENSE_FOLDER_NOT_FOUND/
  );
  assert.equal(
    (await list(owner)).length,
    1,
    "A rejected write does not partially create a folder"
  );
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [owner]
  );
  assert.equal((await list(visitor))[0].name, "Akatsuki");
  assert.deepEqual((await list(visitor))[0].cardIds, []);
  assert.equal((await read(visitor, id)).total, 27);
  await save(owner, id, "Akatsuki", cards, false);
  assert.deepEqual(await list(visitor), []);
  await assert.rejects(read(visitor, id), /LICENSE_FOLDER_NOT_FOUND/);
  await save(owner, id, "Akatsuki", cards, true);
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [owner]
  );
  await assert.rejects(list(visitor), /PROFILE_PRIVATE/);
  await assert.rejects(read(visitor, id), /PROFILE_PRIVATE/);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [owner, visitor]
  );
  assert.equal((await list(visitor)).length, 1);
  await as(visitor, "select public.block_user($1) v", [owner]);
  await assert.rejects(list(visitor), /PROFILE_PRIVATE/);
  await assert.rejects(read(visitor, id), /PROFILE_PRIVATE/);
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  const request = "85000000-0000-4000-8000-000000000003";
  await db.query("select public.reserve_data_export($1,$2)", [owner, request]);
  const exportData = (
    await db.query("select public.build_data_export($1,$2) v", [owner, request])
  ).rows[0].v;
  assert.equal(exportData.license_folders.length, 1);
  assert.equal(exportData.license_folder_cards.length, 27);
  assert.equal(exportData.license_folders[0].name, "Akatsuki");
  const visitorRequest = "85000000-0000-4000-8000-000000000004";
  await db.query("select public.reserve_data_export($1,$2)", [
    visitor,
    visitorRequest
  ]);
  const visitorExport = (
    await db.query("select public.build_data_export($1,$2) v", [
      visitor,
      visitorRequest
    ])
  ).rows[0].v;
  assert.deepEqual(visitorExport.license_folders, []);
  assert.deepEqual(visitorExport.license_folder_cards, []);
  await assert.rejects(
    save(owner, null, "", []),
    /LICENSE_FOLDER_NAME_INVALID/
  );
  await assert.rejects(
    save(owner, null, "Too many", Array(501).fill(cards[0])),
    /LICENSE_FOLDER_CARDS_INVALID/
  );
  await as(owner, "select public.delete_license_folder($1) v", [id]);
  assert.deepEqual(await list(owner), []);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.license_folder_cards where folder_id=$1",
        [id]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (await db.query("select id from public.user_cards where id=$1", [instance]))
      .rows[0].id,
    instance,
    "Editing and deleting thematic folders never consumes owned cards"
  );
  for (const table of ["license_folders", "license_folder_cards"]) {
    const grants = (
      await db.query(
        "select has_table_privilege('authenticated',$1,'INSERT') granted",
        ["public." + table]
      )
    ).rows[0].granted;
    assert.equal(
      grants,
      false,
      "Direct writes cannot bypass membership validation"
    );
  }
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    owner
  ]);
  await assert.rejects(save(owner, null, "Banned", []), /ACCOUNT_BANNED/);
  await assert.rejects(
    as(owner, "select public.delete_license_folder($1) v", [id]),
    /ACCOUNT_BANNED/
  );
});
