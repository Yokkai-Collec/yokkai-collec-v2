import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";
import { prepareLicenseSeed } from "../scripts/prepare-license-binder-seed.mjs";
import { anilistEvidenceDigest } from "../scripts/anilist-import-provenance.mjs";

test("a confirmed license groups every provenance while preserving sources, favorites, exceptions and rollback", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  const owner = "a9100000-0000-4000-8000-000000000001";
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"LicenseOwner"}\')',
    [owner]
  );
  const ids = Array.from(
    { length: 11 },
    (_, i) => `a9200000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
  );
  const names = [
    "Naruto",
    "Naruto: Shippuden",
    "Bleach",
    "One Piece",
    "ONE PIECE in LOVE",
    "Tokyo Ghoul",
    "Tokyo Ghoul:re",
    "JoJo Part 1",
    "JoJo Part 2",
    "Yu-Gi-Oh! GX",
    "Yu-Gi-Oh!"
  ];
  for (let i = 0; i < ids.length; i++) {
    await db.query("insert into public.anime_series_binders values($1,$2,$3)", [
      ids[i],
      1000 + i,
      names[i]
    ]);
    await db.query(
      "insert into public.anime_series_media_rules values($1,$2,'A',true)",
      [1000 + i, ids[i]]
    );
  }
  const add = async (sourceId, source, license, media = null) => {
    const row = (
      await db.query(
        "insert into public.cards(source_id,nom,source,franchise,categorie,rarete_base,image_url) values($1,$2,$3,$4,'ANIME/MANGA','C','https://example.test/license.png') returning *",
        [sourceId, "Character " + sourceId, source, license]
      )
    ).rows[0];
    if (media !== null) {
      await db.query(
        "insert into public.anime_series_origin_evidence(card_id,character_id,media_id,verified_snapshot,import_evidence_sha256) select id,source_id::int,$2,to_jsonb(cards),repeat('a',64) from public.cards where id=$1",
        [row.id, media]
      );
      await db.query(
        "insert into public.anime_series_card_assignments values($1,$2,$3)",
        [row.id, license, media]
      );
    }
    return row;
  };
  const naruto = await add("101", "anilist", "Naruto", 1000),
    ship = await add("102", "anilist", "Naruto", 1001);
  const manual = await add("manual-1", "manual", "Naruto"),
    unknown = await add("unknown-1", "unknown", "Naruto"),
    excluded = await add("103", "anilist", "Naruto");
  await db.query(
    "insert into public.anime_series_protected_cards values($1,'Manual protected'),($2,'Uncertain protected')",
    [manual.id, excluded.id]
  );
  await add("201", "anilist", "Bleach", 1002);
  await add("manual-2", "manual", "Bleach");
  const piece = await add("301", "anilist", "One Piece", 1003),
    parody = await add("302", "anilist", "One Piece", 1004);
  for (let i = 5; i < ids.length; i++)
    await add(String(400 + i), "anilist", names[i], 1000 + i);
  await db.query("insert into public.card_franchises values($1,'Bleach',1)", [
    naruto.id
  ]);
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'C'),($1,$2,'R')",
    [owner, naruto.id]
  );
  await db.exec("update public.anime_series_settings set enabled=true");
  const sourceKey =
    "source:" +
    createHash("sha256").update("ANIME/MANGA\u001fNaruto").digest("hex");
  await db.query(
    "insert into public.binder_favorite_preferences(user_id,binder_key,favorite) values($1,$2,false),($1,$3,true),($1,$4,true)",
    [owner, "series:" + ids[0], "series:" + ids[1], sourceKey]
  );
  await db.query(
    "insert into public.panini_album_favorites values($1,'Naruto',now())",
    [owner]
  );
  const widgets = [
    { category: "ANIME/MANGA", entries: ["series:" + ids[1], sourceKey] }
  ];
  await db.query(
    "update public.user_profiles set profile_widgets=$2 where user_id=$1",
    [owner, JSON.stringify(widgets)]
  );
  const all = table =>
    db.query(
      `select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`
    );
  const tables = [
    "cards",
    "card_franchises",
    "user_cards",
    "user_profiles",
    "panini_album_favorites",
    "binder_favorite_preferences"
  ];
  const before = Object.fromEntries(
    await Promise.all(tables.map(async name => [name, (await all(name)).rows]))
  );
  const oldLinks = (
    await db.query(
      "select * from public.catalogue_binder_links order by card_id,source_license"
    )
  ).rows;
  const mapping = {
    version: 1,
    binders: ids
      .filter((_, i) => i !== 1)
      .map((id, i) => ({ id, display_name: names[ids.indexOf(id)] })),
    source_rules: names
      .filter((_, i) => i !== 1)
      .map((source_license, i) => ({
        source_license,
        binder_id: ids[names.indexOf(source_license)]
      })),
    media_rules: ids.map((id, i) => ({
      media_id: 1000 + i,
      binder_id: i === 1 ? ids[0] : id,
      enforce_separation: i >= 4
    })),
    aliases: ids
      .filter((_, i) => i !== 1)
      .map(id => ({ binder_id: id, alias: names[ids.indexOf(id)] }))
      .concat([{ binder_id: ids[0], alias: "Naruto: Shippuden" }]),
    key_redirects: [
      { old_key: "series:" + ids[1], binder_id: ids[0] },
      { old_key: sourceKey, binder_id: ids[0] }
    ]
  };
  mapping.source_rules.push({
    source_license: "Naruto: Shippuden",
    binder_id: ids[0]
  });
  const digest = createHash("sha256")
    .update(JSON.stringify(mapping))
    .digest("hex");
  const approval = {
    mapping_sha256: digest,
    policy_approved: true,
    manual_display_change_approved: true,
    production_approved: false
  };
  assert.throws(() =>
    prepareLicenseSeed(
      mapping,
      { ...approval, manual_display_change_approved: false },
      digest
    )
  );
  const seed = prepareLicenseSeed(mapping, approval, digest);
  await db.exec(seed);
  for (const table of tables)
    assert.deepEqual(
      (await all(table)).rows,
      before[table],
      table + " unchanged by loading"
    );
  await db.exec(
    "update public.anime_series_settings set license_grouping_enabled=true"
  );
  const links = (await db.query("select * from public.catalogue_binder_links"))
    .rows;
  for (const c of [naruto, ship, manual, unknown, excluded])
    assert.equal(
      links.find(l => l.card_id === c.id && l.source_license === "Naruto")
        .binder_key,
      "series:" + ids[0]
    );
  assert.equal(
    links.find(l => l.card_id === piece.id).binder_key,
    "series:" + ids[3]
  );
  assert.equal(
    links.find(l => l.card_id === parody.id).binder_key,
    "series:" + ids[4]
  );
  const login = async (role, id = "") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role " + role);
  };
  const value = async (statement, params = []) =>
    (await db.query(statement, params)).rows[0].value;
  await login("authenticated", owner);
  const albums = await value(
    "select public.get_binder_albums_page(null,'Naruto','ANIME/MANGA',false,0,72) value"
  );
  assert.equal(albums.total, 1);
  assert.equal(albums.items[0].total, 5);
  assert.equal(albums.items[0].owned, 1);
  assert.equal(albums.items[0].favorite, true);
  assert.equal(albums.favoriteConflicts.length, 0);
  const cards = await value(
    "select public.get_binder_cards_page(null,$1,'','ANIME/MANGA','',false,0,60) value",
    ["series:" + ids[1]]
  );
  assert.equal(cards.total, 5);
  assert.equal(cards.binderOwned, 1);
  assert(cards.items.every(c => c.anime === "Naruto"));
  const search = await value(
    "select public.get_binder_catalogue_page('Shippuden','ANIME/MANGA','',0,60) value"
  );
  assert.equal(
    search.total,
    5,
    "Alias includes unassigned/manual cards of the confirmed license"
  );
  const profile = await value(
    "select public.get_profile_details_with_binders(null) value"
  );
  assert.deepEqual(profile.widgets[0].entries, ["series:" + ids[0]]);
  assert.equal(
    profile.favoriteAlbums.filter(a => a.license === "Naruto").length,
    1
  );
  await db.query("select public.set_binder_favorite($1,false)", [
    "series:" + ids[1]
  ]);
  assert.equal(
    (
      await value(
        "select public.get_binder_albums_page(null,'Naruto','ANIME/MANGA',false,0,72) value"
      )
    ).items[0].favorite,
    false
  );
  await db.query("select public.set_binder_favorite($1,true)", [sourceKey]);
  assert.equal(
    (
      await value(
        "select public.get_binder_albums_page(null,'Naruto','ANIME/MANGA',false,0,72) value"
      )
    ).items[0].favorite,
    true
  );
  for (const table of [
    "anime_license_binders",
    "anime_license_source_rules",
    "anime_license_media_rules",
    "anime_license_aliases",
    "anime_license_key_redirects"
  ])
    await assert.rejects(
      db.query("select * from public." + table),
      /permission denied/i
    );
  await login("postgres");
  for (const table of tables.filter(t => t !== "binder_favorite_preferences"))
    assert.deepEqual((await all(table)).rows, before[table]);
  const preferences = (await all("binder_favorite_preferences")).rows;
  for (const row of preferences)
    assert.equal(
      row.row.favorite,
      before.binder_favorite_preferences.find(
        x => x.row.binder_key === row.row.binder_key
      ).row.favorite
    );
  await db.exec(
    "update public.anime_series_settings set license_grouping_enabled=false"
  );
  assert.deepEqual(
    (
      await db.query(
        "select * from public.catalogue_binder_links order by card_id,source_license"
      )
    ).rows,
    oldLinks
  );
  await db.exec(
    "update public.anime_series_settings set license_grouping_enabled=true"
  );
  await login("service_role");
  const imported = {
    source: "anilist",
    source_id: "104",
    nom: "Future Naruto",
    categorie: "ANIME/MANGA",
    franchise: "Naruto: Shippuden",
    franchise_romaji: "NARUTO: Shippuuden",
    rarete_base: "C",
    image_url: "https://example.test/future.png",
    anilist_media_id: 1001,
    anilist_proof_version: "anilist-import-v1"
  };
  imported.anilist_evidence_sha256 = anilistEvidenceDigest(imported);
  const unverified = {
    ...imported,
    source_id: "105",
    anilist_media_id: null,
    anilist_proof_version: null,
    anilist_evidence_sha256: null
  };
  await db.query("select public.import_anilist_cards($1::jsonb,$2)", [
    JSON.stringify([imported, unverified]),
    "a9300000-0000-4000-8000-000000000001"
  ]);
  await login("postgres");
  for (const row of (
    await db.query(
      "select c.franchise,l.binder_key from public.cards c join public.catalogue_binder_links l on l.card_id=c.id where c.source_id in ('104','105')"
    )
  ).rows) {
    assert.equal(row.binder_key, "series:" + ids[0]);
    assert.equal(row.franchise, "Naruto: Shippuden");
  }
  await assert.rejects(db.exec(seed), /LICENSE_MAPPING_ALREADY_LOADED/);
});
