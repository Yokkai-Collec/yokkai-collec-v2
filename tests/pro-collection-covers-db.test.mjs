import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("personal covers require own Pro media, respect privacy and expire without losing the saved preference", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const owner = "86000000-0000-4000-8000-000000000001",
    other = "86000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [owner, "CoverOwner"],
    [other, "CoverVisitor"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values('cover-fixture','Cover','ANIME/MANGA','Cover License','SR','https://example.test/default.png','test') returning id"
    )
  ).rows[0].id;
  const key = (
    await db.query(
      "select binder_key from public.catalogue_binder_links where card_id=$1 limit 1",
      [card]
    )
  ).rows[0].binder_key;
  const as = async (id, query, args = []) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    try {
      return (await db.query(query, args)).rows[0]?.v;
    } finally {
      await db.exec(
        "reset role;select set_config('request.jwt.claim.sub','',false)"
      );
    }
  };
  const save = (id, target, url) =>
    as(id, "select public.set_collection_cover($1,$2) v", [target, url]);
  const read = (id, keys) =>
    as(id, "select public.get_collection_covers($1,$2) v", [owner, keys]);
  await assert.rejects(
    save(owner, key, "https://example.test/arbitrary.gif"),
    /PRO_REQUIRED/
  );
  const scope = "test:acct_covers:price_covers";
  await db.query("select public.billing_set_entitlement_scope($1,true)", [
    scope
  ]);
  await db.query(
    "insert into public.billing_accounts(user_id,scope,active,status,period_end,verified_at) values($1,$2,true,'active',clock_timestamp()+interval '1 month',clock_timestamp())",
    [owner, scope]
  );
  await assert.rejects(
    save(owner, key, "https://example.test/arbitrary.gif"),
    /COLLECTION_COVER_INVALID/
  );
  const url =
    "https://example.test/storage/v1/object/public/avatars/" +
    owner +
    "/collection-cover-test.gif";
  await db.query(
    "insert into public.profile_media_assets(path,user_id,purpose,mime_type,animated,public_url) values($1,$2,'collection-cover','image/gif',true,$3)",
    [owner + "/collection-cover-test.gif", owner, url]
  );
  await save(owner, key, url);
  assert.deepEqual(await read(owner, [key]), { [key]: url });
  for (const external of [
    "https://i.imgur.com/cover.gif",
    "https://i.pinimg.com/originals/cover.gif"
  ]) {
    await save(owner, key, external);
    assert.deepEqual(await read(owner, [key]), { [key]: external });
  }
  for (const invalid of [
    "http://i.imgur.com/cover.gif",
    "https://i.imgur.com.evil.test/cover.gif",
    "https://i.imgur.com@evil.test/cover.gif",
    "javascript:alert(1)",
    "https://evil.test/cover.gif"
  ]) {
    await assert.rejects(save(owner, key, invalid), /COLLECTION_COVER_INVALID/);
  }
  await save(owner, key, url);
  await assert.rejects(save(other, key, url), /PRO_REQUIRED/);
  await db.query(
    "insert into public.billing_accounts(user_id,scope,active,status,period_end,verified_at) values($1,$2,true,'active',clock_timestamp()+interval '1 month',clock_timestamp())",
    [other, scope]
  );
  await assert.rejects(save(other, key, url), /COLLECTION_COVER_INVALID/);
  const folder = await as(
    owner,
    "select public.save_license_folder(null,$1,'Cover folder',$2,false) v",
    [key, [card]]
  );
  const folderKey = "folder:" + folder;
  await save(owner, folderKey, url);
  await assert.rejects(
    save(other, folderKey, null),
    /COLLECTION_COVER_INVALID/
  );
  await as(owner, "select public.set_profile_privacy(true)");
  assert.deepEqual(await read(other, [key, folderKey]), { [key]: url });
  await as(
    owner,
    "select public.save_license_folder($1,$2,'Cover folder',$3,true) v",
    [folder, key, [card]]
  );
  assert.deepEqual(await read(other, [folderKey]), { [folderKey]: url });
  await as(owner, "select public.set_profile_privacy(false)");
  await assert.rejects(read(other, [key]), /PROFILE_PRIVATE/);
  await assert.rejects(
    read(owner, Array(201).fill(key)),
    /COLLECTION_COVER_INVALID/
  );
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("select * from public.collection_covers"),
    /permission denied/
  );
  await db.exec("reset role");
  await db.query(
    "update public.billing_accounts set active=false,status='canceled' where user_id=$1",
    [owner]
  );
  assert.deepEqual(await read(owner, [key]), {});
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.collection_covers where user_id=$1",
        [owner]
      )
    ).rows[0].n,
    2
  );
  await save(owner, key, null);
  await as(owner, "select public.delete_license_folder($1) v", [folder]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.collection_covers where user_id=$1",
        [owner]
      )
    ).rows[0].n,
    0
  );
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select public.get_collection_covers($1,$2)", [owner, [key]]),
    /permission denied/
  );
  await db.exec("reset role");
});
