import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

function assertRate(count, percent, n) {
  const p = percent / 100,
    expected = n * p;
  assert.ok(
    Math.abs(count - expected) <= 6 * Math.sqrt(n * p * (1 - p)) + 1,
    `${count}/${n} differs from advertised ${percent}%`
  );
}
async function definition(db, name) {
  return (
    await db.query("select pg_get_functiondef($1::regprocedure) as sql", [
      `public.${name}()`
    ])
  ).rows[0].sql;
}
async function histogram(db, sql, rates, n) {
  // SQL comes from the effective function in this disposable database, not copied thresholds.
  const expression = sql.match(
    /rarity_index\s*:=\s*(case[\s\S]*?end)\s*;/i
  )?.[1];
  assert.ok(
    expression,
    "SQL draw structure changed: update the test explicitly"
  );
  const result = await db.query(
    `with rolls as materialized (
    select random() as roll,$1::jsonb as rates from generate_series(1,$2::integer)
  ) select ${expression} as idx,count(*) as count from rolls group by idx`,
    [JSON.stringify(rates), n]
  );
  const counts = new Map(
    result.rows.map(r => [Number(r.idx), Number(r.count)])
  );
  assert.equal(
    [...counts.values()].reduce((a, b) => a + b, 0),
    n
  );
  rates.forEach((r, i) => assertRate(counts.get(i + 1) ?? 0, r.percent, n));
}

test("effective SQL drop expressions match advertised rates and real authenticated pack RPCs", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`insert into auth.users(id,raw_user_meta_data)
    select md5('sql-rate-'||i)::uuid,jsonb_build_object('pseudo','SqlRate'||lpad(i::text,4,'0')) from generate_series(1,200)i;
    update public.user_profiles set next_regular_pack_at=now()-interval '1 hour',next_decision_pack_at=now()-interval '1 day';
    insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    select 'rate-'||rarity,'Rate '||rarity,'Anime/Manga','Rates',rarity,'https://example.test/card','test'
    from unnest(enum_range(null::public.card_rarity))rarity;
    -- Past the new-player boost: the RPC loop below checks the advertised rates.
    select public.ensure_achievement_stats(user_id) from public.user_profiles;
    update public.user_achievement_stats set regular_packs_opened=10;
    select set_config('request.jwt.claim.sub',md5('sql-rate-1')::uuid::text,false);`);
  const info = (await db.query("select public.get_game_info() as info")).rows[0]
    .info;
  assert.deepEqual(info.dropRates, [
    { rarity: "C", percent: 69.4 },
    { rarity: "R", percent: 20 },
    { rarity: "SR", percent: 10 },
    { rarity: "SSR", percent: 0.5 },
    { rarity: "LR", percent: 0.1 }
  ]);
  assert.deepEqual(info.decisionDropRates, [
    { rarity: "SR", percent: 96.5 },
    { rarity: "SSR", percent: 3 },
    { rarity: "LR", percent: 0.5 }
  ]);
  assert.equal(info.shinyRate, 0.5);
  const regular = await definition(db, "open_regular_pack"),
    decision = await definition(db, "open_decision_pack"),
    referral = await definition(db, "settle_referral_events");
  assert.match(referral, /shiny\s*:=\s*random\(\)\s*<\s*0\.005\s*;/);
  await db.exec("select setseed(0.314159)");
  const n = 200_000;
  await histogram(db, regular, info.dropRates, n);
  await histogram(db, decision, info.decisionDropRates, n);
  // Undisclosed boost on a player's first 10 Regular Packs (product decision).
  const boosted = [
    ...regular.matchAll(/rarity_index\s*:=\s*(case[\s\S]*?end)\s*;/gi)
  ][1]?.[1];
  assert.ok(boosted, "new-player boost CASE missing");
  assert.match(regular, /regular_packs_opened[\s\S]*?<\s*10\s*;/);
  await histogram(
    db,
    `rarity_index:=${boosted};`,
    [
      { rarity: "C", percent: 63.9 },
      { rarity: "R", percent: 20 },
      { rarity: "SR", percent: 15 },
      { rarity: "SSR", percent: 1 },
      { rarity: "LR", percent: 0.1 }
    ],
    n
  );
  t.diagnostic(
    "PostgreSQL evaluates 200,000 draws per effective SQL CASE; no JavaScript random generator"
  );

  for (const sql of [regular, decision]) {
    const expression = sql.match(/shiny\s*:=\s*([^;]+);/i)?.[1];
    assert.ok(
      expression?.includes("selected_card.rarete_base"),
      "SQL Shiny structure changed"
    );
    const lr = expression.replaceAll(
      "selected_card.rarete_base",
      "'LR'::public.card_rarity"
    );
    const count = Number(
      (
        await db.query(
          `select count(*) filter(where ${lr}) as count from generate_series(1,1000000)`
        )
      ).rows[0].count
    );
    assertRate(count, info.shinyRate, 1_000_000);
  }
  await db.exec("set role authenticated");
  const counts = { regular: {}, decision: {} };
  for (let i = 1; i <= 200; i++) {
    await db.query(
      "select set_config('request.jwt.claim.sub',md5('sql-rate-'||$1)::uuid::text,false)",
      [String(i)]
    );
    for (const [kind, name] of [
      ["regular", "open_regular_pack"],
      ["decision", "open_decision_pack"]
    ]) {
      const cards = (await db.query(`select public.${name}() as cards`)).rows[0]
        .cards;
      assert.equal(cards.length, 5);
      for (const card of cards) {
        counts[kind][card.rarity] = (counts[kind][card.rarity] ?? 0) + 1;
        assert.ok(!card.shiny || card.rarity === "LR");
      }
    }
  }
  for (const [kind, rates] of [
    ["regular", info.dropRates],
    ["decision", info.decisionDropRates]
  ]) {
    assert.equal(
      Object.values(counts[kind]).reduce((a, b) => a + b, 0),
      1000
    );
    assert.ok(
      Object.keys(counts[kind]).every(r =>
        rates.some(expected => expected.rarity === r)
      )
    );
    rates.forEach(r =>
      assertRate(counts[kind][r.rarity] ?? 0, r.percent, 1000)
    );
  }
  t.diagnostic(
    `200 real RPC calls per pack type under authenticated: ${JSON.stringify(counts)}`
  );
});
