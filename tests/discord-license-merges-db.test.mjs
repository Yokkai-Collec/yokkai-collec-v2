import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";
import { prepareDiscordLicenseMerges } from "../scripts/prepare-discord-license-merges.mjs";

const mapping = JSON.parse(
  readFileSync(
    new URL(
      "../data/editorial/discord-license-merges-2026-10-25.json",
      import.meta.url
    ),
    "utf8"
  )
);
const recipe = readFileSync(
  new URL(
    "../supabase/recipes/merge_discord_licenses_20261025.sql",
    import.meta.url
  ),
  "utf8"
);
const owner = "d1500000-0000-4000-8000-000000000001";
const id = i => `d1600000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const sourceKey = (category, license) =>
  "source:" +
  createHash("sha256")
    .update(category + "\u001f" + license)
    .digest("hex");
const groupKey = title =>
  "series:" + mapping.groups.find(g => g.target === title).group_id;
const all = async (db, table) =>
  (
    await db.query(
      `select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`
    )
  ).rows;
const value = async (db, sql, params = []) =>
  (await db.query(sql, params)).rows[0].value;
async function activateFixture(db) {
  await db.query(
    "update public.anime_series_settings set enabled=true,license_grouping_enabled=true,mapping_version=$1,license_mapping_version=$2",
    [
      mapping.active_projection.mapping_version,
      mapping.active_projection.license_mapping_version
    ]
  );
}
async function addCard(
  db,
  cardId,
  license,
  category = "ANIME/MANGA",
  name = "Character"
) {
  await db.query(
    "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1::uuid,$1::uuid::text,$2,$3,$4,'SR','https://example.test/discord.png','discord-review')",
    [cardId, name, category, license]
  );
}
test("the reviewed list generates the exact offline recipe and preserves the confirmed editorial exclusions", () => {
  assert.equal(recipe, prepareDiscordLicenseMerges(mapping));
  assert.equal(mapping.groups.length, 184);
  assert.equal(
    mapping.groups.reduce((n, g) => n + g.sources.length, 0),
    537
  );
  assert.equal(mapping.already_grouped, 119);
  assert.equal(mapping.remaining_groups, 65);
  assert.equal(mapping.excluded_binder_groups.length, 1);
  const yugi = mapping.excluded_binder_groups[0];
  assert.equal(yugi.target, "Yu-Gi-Oh!");
  assert.equal(yugi.sources.length, 10);
  for (const key of yugi.merge_keys)
    assert(!mapping.groups.some(group => group.merge_keys.includes(key)), key);
  assert.equal(mapping.kept_separate.length, 3);
  const sources = new Set(
    mapping.groups.flatMap(g => g.sources.map(s => s.license))
  );
  for (const license of [
    ...mapping.excluded,
    ...mapping.kept_separate.flatMap(g => g.licenses),
    mapping.deletion.license
  ])
    assert(!sources.has(license), license);
  assert.deepEqual(
    mapping.groups[0].sources.map(s => s.license).sort(),
    ["Zoids", "Zoids Fuzors", "Zoids Genesis", "Zoids New Century/Zero"].sort()
  );
  assert.equal(
    mapping.groups.find(g => g.target === "The Daily Life").sources.length,
    3
  );
  assert.equal(
    mapping.groups.find(g => g.target === "Space Battleship Yamato").sources
      .length,
    8
  );
  assert.equal(mapping.deletion.observed_owned_copies, 1);
  assert.throws(() =>
    prepareDiscordLicenseMerges({ ...mapping, production_applied: true })
  );
});

test("all reviewed merges preserve source cards, secondary memberships, proofs and player preferences; counts and category filters stay correct", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  await activateFixture(db);
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"DiscordReview"}\')',
    [owner]
  );
  const sources = mapping.groups.flatMap(g => g.sources);
  for (let i = 0; i < sources.length; i++)
    await addCard(db, id(i + 1), sources[i].license, sources[i].category);
  assert.equal(
    (await db.query("select count(*)::int n from public.cards")).rows[0].n,
    537
  );
  await db.query(
    "insert into public.card_franchises values($1,'Zoids Genesis',4),($1,'Unrelated license',7)",
    [id(1)]
  );
  await addCard(db, id(1001), null);
  await db.query(
    "insert into public.card_franchises values($1,'Zoids Fuzors',3)",
    [id(1001)]
  );
  await addCard(db, id(1002), "Zoids Fuzors", "VIDEO GAMES");
  const untouched = [
    ...mapping.excluded,
    ...mapping.kept_separate.flatMap(g => g.licenses),
    "Puella Magi Madoka Magica"
  ];
  for (let i = 0; i < untouched.length; i++)
    await addCard(db, id(1100 + i), untouched[i]);
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'C'),($1,$2,'SR')",
    [owner, id(1)]
  );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values($1,$2)",
    [owner, id(2)]
  );
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values($1,'Zoids Fuzors'),($1,'Rick and Morty: The Anime')",
    [owner]
  );
  await db.query(
    "insert into public.binder_favorite_preferences(user_id,binder_key,favorite,license_favorite) values($1,$2,true,true),($1,$3,false,false)",
    [
      owner,
      sourceKey("ANIME/MANGA", "Zoids Fuzors"),
      sourceKey("ANIME/MANGA", "Zoids Genesis")
    ]
  );
  const widgets = [
    {
      category: "ANIME/MANGA",
      entries: [
        "Zoids Fuzors",
        "Zoids",
        sourceKey("ANIME/MANGA", "Zoids Genesis")
      ]
    },
    { category: "VIDEO GAMES", entries: ["Zoids Fuzors"] }
  ];
  await db.query(
    "update public.user_profiles set profile_widgets=$2 where user_id=$1",
    [owner, JSON.stringify(widgets)]
  );
  await db.query(
    "insert into public.binder_profile_widgets(user_id,widgets) values($1,$2)",
    [owner, JSON.stringify(widgets)]
  );
  // Exercise old configured series keys, alias searches, and a redirect not listed
  // directly in the recipe: it must follow the prior canonical key into the merge.
  const daily = mapping.groups.find(g => g.target === "The Daily Life");
  const priorId = daily.current_binder_keys
    .find(k => k.startsWith("series:"))
    .slice(7);
  await db.query(
    "insert into public.anime_series_binders values($1,900001,'Daily prior')",
    [priorId]
  );
  await db.query(
    "insert into public.anime_license_binders values($1,'Daily prior')",
    [priorId]
  );
  await db.query(
    "insert into public.anime_license_source_rules values('The Daily Life of the Immortal King',$1),('Daily extra source',$1)",
    [priorId]
  );
  await db.query(
    "insert into public.anime_license_aliases values($1,'Daily historical alias')",
    [priorId]
  );
  await db.query(
    "insert into public.anime_license_key_redirects values($1,$2)",
    ["source:" + "a".repeat(64), priorId]
  );
  await addCard(db, id(1200), "Daily extra source");
  const tables = [
    "cards",
    "card_franchises",
    "user_cards",
    "wishlists",
    "user_profiles",
    "panini_album_favorites",
    "binder_favorite_preferences",
    "binder_profile_widgets",
    "anime_series_origin_evidence",
    "anime_series_card_assignments",
    "anime_license_source_rules"
  ];
  const before = Object.fromEntries(
    await Promise.all(tables.map(async table => [table, await all(db, table)]))
  );
  const oldLinks = await all(db, "catalogue_binder_links");
  await db.exec(recipe);
  for (const table of tables)
    assert.deepEqual(
      await all(db, table),
      before[table],
      table + " remains byte-for-byte unchanged by merging"
    );
  const links = (await db.query("select * from public.catalogue_binder_links"))
    .rows;
  for (let i = 0; i < sources.length; i++) {
    const g = mapping.groups.find(g =>
      g.sources.some(
        s =>
          s.category === sources[i].category && s.license === sources[i].license
      )
    );
    assert.equal(
      links.find(
        l => l.card_id === id(i + 1) && l.source_license === sources[i].license
      ).binder_key,
      "series:" + g.group_id,
      sources[i].license
    );
  }
  for (let i = 0; i < untouched.length; i++)
    assert.equal(
      links.find(l => l.card_id === id(1100 + i)).binder_key,
      sourceKey("ANIME/MANGA", untouched[i])
    );
  const yugiLicenses = new Set(
    mapping.excluded_binder_groups[0].sources.map(source => source.license)
  );
  const yugiLinks = links.filter(link => yugiLicenses.has(link.source_license));
  assert.equal(new Set(yugiLinks.map(link => link.binder_key)).size, 10);
  assert.deepEqual(
    yugiLinks.map(link => [link.source_license, link.display_name]).sort(),
    [...yugiLicenses].map(license => [license, license]).sort(),
    "All ten Yu-Gi-Oh binders retain their separate keys and display names"
  );
  assert.equal(
    links.find(l => l.card_id === id(1002)).binder_key,
    sourceKey("VIDEO GAMES", "Zoids Fuzors")
  );
  assert.equal(
    await value(db, "select public.canonical_binder_key($1) value", [
      "source:" + "a".repeat(64)
    ]),
    groupKey("The Daily Life")
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);
  const albums = await value(
    db,
    "select public.get_binder_albums_page(null,'Zoids','ANIME/MANGA',false,0,72) value"
  );
  assert.equal(albums.total, 1);
  assert.equal(albums.items[0].total, 5);
  assert.equal(albums.items[0].owned, 1);
  assert.equal(albums.items[0].favorite, true);
  const cards = await value(
    db,
    "select public.get_binder_cards_page(null,$1,'','ANIME/MANGA','',false,0,60,'rarity') value",
    [sourceKey("ANIME/MANGA", "Zoids Fuzors")]
  );
  assert.equal(cards.total, 5);
  assert.equal(cards.binderOwned, 1);
  const catalogue = await value(
    db,
    "select public.get_binder_catalogue_page('Zoids Genesis','ANIME/MANGA','',0,60) value"
  );
  assert.equal(
    catalogue.total,
    5,
    "A historical source alias finds every card of the merged binder"
  );
  const profile = await value(
    db,
    "select public.get_profile_details_with_binders(null) value"
  );
  assert.deepEqual(profile.widgets[0].entries, [groupKey("Zoids")]);
  assert.deepEqual(profile.widgets[1].entries, [
    sourceKey("VIDEO GAMES", "Zoids Fuzors")
  ]);
  const globalRick = await value(
    db,
    "select public.get_binder_albums_page(null,'Rick and Morty','',false,0,72) value"
  );
  assert.equal(globalRick.total, 1);
  assert.equal(globalRick.items[0].total, 4);
  assert.equal(globalRick.items[0].favorite, true);
  for (const [category, count] of [
    ["ANIME/MANGA", 3],
    ["SERIE", 1]
  ]) {
    const r = await value(
      db,
      "select public.get_binder_albums_page(null,'Rick and Morty',$1,false,0,72) value",
      [category]
    );
    assert.equal(r.total, 1);
    assert.equal(r.items[0].total, count);
  }
  const dailySearch = await value(
    db,
    "select public.get_binder_albums_page(null,'Daily historical alias','ANIME/MANGA',false,0,72) value"
  );
  assert.equal(dailySearch.total, 1);
  assert.equal(dailySearch.items[0].total, 4);
  await db.query("select public.set_binder_favorite($1,false)", [
    groupKey("Zoids")
  ]);
  assert.equal(
    (
      await value(
        db,
        "select public.get_binder_albums_page(null,'Zoids','ANIME/MANGA',false,0,72) value"
      )
    ).items[0].favorite,
    false,
    "A post-merge choice overrides the folded historical positives"
  );
  await assert.rejects(
    db.query("select * from public.catalogue_binder_group_merges"),
    /permission denied/
  );
  await db.exec("reset role");
  const afterCards = await all(db, "cards");
  await db.exec(recipe);
  assert.deepEqual(
    await all(db, "cards"),
    afterCards,
    "Second application preserves every card"
  );
  await db.exec("update public.catalogue_binder_groups set enabled=false");
  assert.deepEqual(
    await all(db, "catalogue_binder_links"),
    oldLinks,
    "Disabling the additive layer restores the previous catalogue"
  );
  await db.exec(
    "update public.anime_series_settings set mapping_version='changed'"
  );
  await assert.rejects(db.exec(recipe), /DISCORD_MERGE_PROJECTION_CHANGED/);
  await db.exec("rollback");
  assert.deepEqual(await all(db, "cards"), afterCards);
});

test("Sonico deletion removes only four audited cards and the reviewed owned copy; changed references abort the entire transaction", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  await activateFixture(db);
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"SonicoReview"}\')',
    [owner]
  );
  for (const card of mapping.deletion.cards)
    await addCard(
      db,
      card.id,
      mapping.deletion.license,
      "ANIME/MANGA",
      card.name
    );
  await addCard(db, id(3001), "Puella Magi Madoka Magica");
  await addCard(db, id(3002), mapping.deletion.license);
  await assert.rejects(db.exec(recipe), /DISCORD_SONICO_CARD_SET_CHANGED/);
  await db.exec("rollback");
  assert.equal(
    (await db.query("select count(*)::int n from public.cards")).rows[0].n,
    6
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.catalogue_binder_groups"
      )
    ).rows[0].n,
    0,
    "Configuration changes also roll back"
  );
  await db.query("delete from public.cards where id=$1", [id(3002)]);
  const copy = mapping.deletion.expected_copy_rarities[0];
  await db.query(
    "insert into public.user_cards(id,user_id,card_id,rarity) values($1,$2,$3,'R'),($4,$2,$5,'SSR')",
    [copy.id, owner, copy.card_id, id(4001), id(3001)]
  );
  await db.query(
    "insert into public.user_cards(id,user_id,card_id,rarity) values($1,$2,$3,'C')",
    [id(4002), owner, copy.card_id]
  );
  await assert.rejects(
    db.exec(recipe),
    /DISCORD_SONICO_PLAYER_REFERENCES_CHANGED/
  );
  await db.exec("rollback");
  assert.equal(
    (await db.query("select count(*)::int n from public.user_cards")).rows[0].n,
    3
  );
  await db.query("delete from public.user_cards where id=$1", [id(4002)]);
  await db.query(
    "insert into public.wishlists(user_id,card_id) values($1,$2)",
    [owner, copy.card_id]
  );
  await assert.rejects(
    db.exec(recipe),
    /DISCORD_SONICO_PLAYER_REFERENCES_CHANGED/
  );
  await db.exec("rollback");
  await db.query("delete from public.wishlists where card_id=$1", [
    copy.card_id
  ]);
  await db.query(
    "insert into public.card_franchises values($1,'Puella Magi Madoka Magica',1)",
    [copy.card_id]
  );
  await assert.rejects(db.exec(recipe), /DISCORD_SONICO_CARD_SET_CHANGED/);
  await db.exec("rollback");
  await db.query(
    "delete from public.card_franchises where card_id=$1 and position=1",
    [copy.card_id]
  );
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values($1,'Puella Magi Sonico Magica'),($1,'Puella Magi Madoka Magica')",
    [owner]
  );
  await db.query(
    "update public.user_profiles set profile_widgets=$2 where user_id=$1",
    [
      owner,
      JSON.stringify([
        {
          category: "ANIME/MANGA",
          entries: [mapping.deletion.license, "Puella Magi Madoka Magica"]
        }
      ])
    ]
  );
  await db.exec(
    "insert into storage.objects(bucket_id,name) values('card-images','sonico-image-preserved')"
  );
  const madoka = (
    await db.query("select * from public.cards where id=$1", [id(3001)])
  ).rows;
  const goodCopy = (
    await db.query("select * from public.user_cards where id=$1", [id(4001)])
  ).rows;
  await db.exec(recipe);
  assert.deepEqual((await db.query("select * from public.cards")).rows, madoka);
  assert.deepEqual(
    (await db.query("select * from public.user_cards")).rows,
    goodCopy
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.card_franchises where franchise='Puella Magi Sonico Magica'"
      )
    ).rows[0].n,
    0
  );
  assert.deepEqual(
    (await db.query("select license from public.panini_album_favorites")).rows,
    [{ license: "Puella Magi Madoka Magica" }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select profile_widgets from public.user_profiles where user_id=$1",
        [owner]
      )
    ).rows[0].profile_widgets,
    [{ category: "ANIME/MANGA", entries: ["Puella Magi Madoka Magica"] }]
  );
  assert.deepEqual((await db.query("select name from storage.objects")).rows, [
    { name: "sonico-image-preserved" }
  ]);
  await db.exec(recipe);
  assert.deepEqual((await db.query("select * from public.cards")).rows, madoka);
});
