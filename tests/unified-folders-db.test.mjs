import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("unified folders preserve legacy IDs and copies, support mixed categories, shared filters and private access", async t => {
  const migration = "20261106110000_unified_collection_folders.sql";
  const names = readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter(n => n.endsWith(".sql") && n < migration)
    .sort();
  const { db } = await replayMigrations({ migrations: names });
  t.after(() => db.close());
  const owner = "86000000-0000-4000-8000-000000000001",
    visitor = "86000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [owner, "UnifiedOwner"],
    [visitor, "UnifiedVisitor"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  const ids = [];
  for (const [name, category, license] of [
    ["Ninja", "ANIME/MANGA", "Naruto"],
    ["Driver", "SPORT", "Tennis"]
  ])
    ids.push(
      (
        await db.query(
          "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,$2,$3,'SR','','test') returning id",
          [name, category, license]
        )
      ).rows[0].id
    );
  const folder = (
    await db.query(
      "insert into public.folders(user_id,nom) values($1,'Legacy') returning id",
      [owner]
    )
  ).rows[0].id;
  const instances = [];
  for (const card of ids)
    instances.push(
      (
        await db.query(
          "insert into public.user_cards(user_id,card_id,rarity,folder_id) values($1,$2,'SR',$3) returning id",
          [owner, card, folder]
        )
      ).rows[0].id
    );
  await db.exec(
    readFileSync(
      new URL("../supabase/migrations/" + migration, import.meta.url),
      "utf8"
    )
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
  const list = () =>
    as(owner, "select public.get_license_folders(null,null,false) v");
  let result = await list();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, folder);
  assert.equal(result[0].name, "Legacy");
  assert.equal(result[0].total, 2);
  assert.equal(
    (await as(owner, "select public.get_collection_counts() v")).folders[
      folder
    ],
    2
  );
  const count = () =>
    as(
      owner,
      "select (public.get_collection_groups_page(p_folder=>$1)->>'total')::int v",
      [folder]
    );
  assert.equal(await count(), 2);
  // Existing license folders now accept every category while preserving their origin.
  const binder = (
    await db.query(
      "select binder_key from public.catalogue_binder_links where card_id=$1 limit 1",
      [ids[0]]
    )
  ).rows[0].binder_key;
  await as(owner, "select public.save_license_folder($1,$2,$3,$4,true) v", [
    folder,
    binder,
    "Mixed",
    ids
  ]);
  assert.equal((await list())[0].total, 2);
  const free = await as(owner, "select public.create_folder('Free') v");
  await as(owner, "select public.move_cards_to_folder($1,$2) v", [
    [instances[1]],
    free.id
  ]);
  assert.equal((await list()).find(f => f.id === folder).total, 1);
  assert.equal((await list()).find(f => f.id === free.id).total, 1);
  // Removing a catalogue entry must also clear old instance assignments.
  await as(owner, "select public.save_license_folder($1,null,$2,$3,false) v", [
    folder,
    "Mixed",
    []
  ]);
  assert.equal(await count(), 0);
  assert.equal(
    (await as(owner, "select public.get_collection_counts() v")).unfiled,
    1
  );
  await assert.rejects(
    as(visitor, "select public.save_license_folder($1,null,$2,$3,false) v", [
      free.id,
      "Stolen",
      ids
    ]),
    /LICENSE_FOLDER_NOT_FOUND/
  );
  await assert.rejects(
    as(visitor, "select public.get_license_folder_cards($1,'',false,0,24) v", [
      free.id
    ]),
    /LICENSE_FOLDER_NOT_FOUND/
  );
  const catalogue = await as(
    owner,
    "select public.get_license_folder_cards(null,'Driver',false,0,5000) v"
  );
  assert.equal(catalogue.items.length, 1);
  assert.equal(catalogue.items[0].id, ids[1]);
  await as(owner, "select public.move_card_to_folder($1,null) v", [
    instances[1]
  ]);
  assert.equal((await list()).find(f => f.id === free.id).total, 0);
  await as(owner, "select public.delete_license_folder($1) v", [folder]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.user_cards where user_id=$1",
        [owner]
      )
    ).rows[0].n,
    2
  );
  assert.equal(
    (
      await db.query("select count(*)::int n from public.folders where id=$1", [
        folder
      ])
    ).rows[0].n,
    0
  );
});
