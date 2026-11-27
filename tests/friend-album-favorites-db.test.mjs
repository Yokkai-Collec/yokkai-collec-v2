import assert from "node:assert/strict";
import test from "node:test";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";

const viewer = "81000000-0000-4000-8000-000000000001";
const owner = "81000000-0000-4000-8000-000000000002";
const stranger = "81000000-0000-4000-8000-000000000003";

test("les favoris du joueur consulté précèdent la pagination sans révéler de profil privé", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  for (const [id, pseudo] of [
    [viewer, "BinderViewer"],
    [owner, "BinderOwner"],
    [stranger, "BinderStranger"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.exec(`
    insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    select 'fav-binder-' || i, 'Card ' || i, 'ANIME/MANGA', 'Binder ' || lpad(i::text,3,'0'),
      'C','https://example.test/' || i || '.png','fav-binder-test'
    from generate_series(1,75) i;
    insert into public.user_cards(user_id,card_id,rarity)
    select '${owner}',id,'C' from public.cards where source_id in ('fav-binder-1','fav-binder-74');
    insert into public.card_franchises(card_id,franchise,position)
    select id,'Crossed favorite',1 from public.cards where source_id='fav-binder-75';
    insert into public.panini_album_favorites(user_id,license) values
      ('${owner}','Binder 074'),('${owner}','Binder 075'),('${owner}','Crossed favorite'),
      ('${viewer}','Binder 002');
    update public.user_profiles set is_public=true where user_id='${owner}';
    set role authenticated;
  `);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer
  ]);
  const albums = async (query = "", category = "", offset = 0, limit = 72) =>
    (
      await db.query(
        "select public.get_friend_panini_albums_page($1,$2,$3,$4,$5) as value",
        [owner, query, category, offset, limit]
      )
    ).rows[0].value;

  const first = await albums();
  assert.equal(first.total, 76);
  assert.equal(first.items.length, 72);
  assert.deepEqual(
    first.items
      .slice(0, 4)
      .map(item => [item.license, item.favorite, item.owned]),
    [
      ["Binder 074", true, 1],
      ["Binder 075", true, 0],
      ["Crossed favorite", true, 0],
      ["Binder 001", false, 1]
    ]
  );
  assert.equal(
    first.items.find(item => item.license === "Binder 002").favorite,
    false,
    "les favoris du visiteur ne sont pas utilisés"
  );
  assert.deepEqual((await albums("", "", 0, 1)).items, [first.items[0]]);
  assert.deepEqual((await albums("", "", 1, 1)).items, [first.items[1]]);
  const last = await albums("", "", 72);
  assert.equal(last.total, 76);
  assert.equal(last.items.length, 4);
  assert.equal(
    new Set([...first.items, ...last.items].map(item => item.license)).size,
    76
  );
  assert.equal((await albums("", "", 0, 999)).items.length, 72);
  assert.equal((await albums("", "FILM")).items.length, 0);
  assert.deepEqual((await albums("Crossed", " anime/manga ")).items, [
    {
      license: "Crossed favorite",
      total: 1,
      owned: 0,
      percent: 0,
      favorite: true
    }
  ]);

  await db.exec(
    `reset role; update public.user_profiles set is_public=false where user_id='${owner}'; set role authenticated;`
  );
  await assert.rejects(albums(), /PROFILE_PRIVATE/);
  await db.exec(
    `reset role; insert into public.friendships(user_id,friend_id,status) values ('${viewer}','${owner}','accepted'); set role authenticated;`
  );
  assert.deepEqual(
    (await albums()).items,
    first.items,
    "un ami autorisé conserve le même tri"
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    stranger
  ]);
  await assert.rejects(albums(), /PROFILE_PRIVATE/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [""]);
  await assert.rejects(albums(), /AUTH_REQUIRED/);
  await db.exec("reset role");
  for (const role of ["public", "anon"]) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.get_friend_panini_albums_page(uuid,text,text,integer,integer)','EXECUTE') as allowed",
          [role]
        )
      ).rows[0].allowed,
      false
    );
    assert.equal(
      (
        await db.query(
          "select has_table_privilege($1,'public.panini_album_favorites','SELECT') as allowed",
          [role]
        )
      ).rows[0].allowed,
      false
    );
  }
});
