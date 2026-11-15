import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("album RPC filters exact completion before pagination and agrees with the leaderboard", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const player = "a9400000-0000-4000-8000-000000000001";
  await db.query(
    "insert into auth.users(id, raw_user_meta_data) values ($1, $2)",
    [player, JSON.stringify({ pseudo: "CompletedTest" })]
  );
  await db.exec(`
    insert into public.cards(source, source_id, nom, categorie, franchise, rarete_base, image_url)
    values ('test', 'complete-a', 'A', 'SERIE', 'Complete Alpha', 'C', ''),
      ('test', 'complete-b', 'B', 'SERIE', 'Complete Beta', 'C', ''),
      ('test', 'partial-a', 'X', 'SERIE', 'Partial', 'C', ''),
      ('test', 'partial-b', 'Y', 'SERIE', 'Partial', 'C', '');
  `);
  await db.query(
    `
    insert into public.user_cards(user_id, card_id, rarity)
    select $1, id, rarete_base from public.cards cross join generate_series(1, 2)
    where source_id in ('complete-a', 'complete-b', 'partial-a')
  `,
    [player]
  );
  await db.query(
    "insert into public.panini_album_favorites(user_id, license) values ($1, 'Partial'), ($1, 'Complete Beta')",
    [player]
  );
  await db.query("select public.refresh_catalogue_links_cache()");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    player
  ]);
  await db.exec("set role authenticated");

  for (const [statement, rankingKey] of [
    [
      "select public.get_binder_albums_page(null, $1, $2, $3, $4, 1, true) as page",
      "global:progress-score"
    ],
    [
      "select public.get_panini_albums_page($1, $2, $4, 1, $3, true) as page",
      "global:progress-score:legacy"
    ]
  ]) {
    const call = async (
      query = "",
      category = "",
      favorites = false,
      offset = 0
    ) =>
      (await db.query(statement, [query, category, favorites, offset])).rows[0]
        .page;

    const first = await call();
    assert.equal(first.total, 2);
    assert.deepEqual(
      first.items.map(item => item.license),
      ["Complete Beta"]
    );
    const second = await call("", "", false, 1);
    assert.equal(second.total, 2);
    assert.deepEqual(
      second.items.map(item => item.license),
      ["Complete Alpha"]
    );
    assert.equal((await call("Partial")).total, 0);
    assert.equal(
      (await call("Alpha", "FILM")).total,
      1,
      "the completed list covers the whole collection"
    );
    assert.equal((await call("", "", true)).total, 1);
    const { ranking } = (
      await db.query("select public.get_license_leaderboard($1) as ranking", [
        rankingKey
      ])
    ).rows[0];
    assert.equal(first.total, ranking.mine.completedLicenses);
  }
});
