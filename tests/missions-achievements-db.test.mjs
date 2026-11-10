import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const player = "10000000-0000-4000-8000-000000000099";
test("fixed missions: shared Paris resets, launch gate, overlapping goals and exactly-once rewards", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const period = async (stamp, kind) =>
    (
      await db.query(
        "select public.mission_period_start($1::timestamptz,$2) value",
        [stamp, kind]
      )
    ).rows[0].value;
  assert.equal(
    new Date(await period("2026-11-09T18:59:59Z", "weekly")).toISOString(),
    "2026-11-02T19:00:00.000Z"
  );
  assert.equal(
    new Date(await period("2026-11-09T19:00:00Z", "weekly")).toISOString(),
    "2026-11-09T19:00:00.000Z"
  );
  assert.equal(
    new Date(await period("2027-07-05T18:00:00Z", "weekly")).toISOString(),
    "2027-07-05T18:00:00.000Z"
  );
  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values($1,'{"pseudo":"MissionTest"}')`,
    [player]
  );
  await db.query(
    `select public.advance_player_progress($1,'regular_packs_opened',30,'2026-11-09T18:59:59Z')`,
    [player]
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) count from public.user_mission_progress where user_id=$1",
          [player]
        )
      ).rows[0].count
    ),
    0
  );
  await db.query(
    `select public.advance_player_progress($1,'regular_packs_opened',30,'2026-11-09T19:00:00Z')`,
    [player]
  );
  assert.equal(
    Number(
      (
        await db.query(
          `select public.mission_points($1,'daily','2026-11-09T19:00:00Z') points`,
          [player]
        )
      ).rows[0].points
    ),
    65
  );
  await db.query(
    `select public.advance_player_progress($1,'cards_destroyed',10,'2026-11-09T19:00:00Z')`,
    [player]
  );
  await db.query(
    `select public.advance_player_progress($1,'wishlist_added',1,'2026-11-09T19:00:00Z')`,
    [player]
  );
  await db.query(
    `select public.advance_player_progress($1,'decision_days',1,'2026-11-09T19:00:00Z')`,
    [player]
  );
  assert.equal(
    Number(
      (
        await db.query(
          `select public.mission_points($1,'daily','2026-11-09T19:00:00Z') points`,
          [player]
        )
      ).rows[0].points
    ),
    100
  );
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
    player
  ]);
  const claimDefinition = (
    await db.query(
      "select pg_get_functiondef('public.claim_mission_milestone(text,timestamptz,integer)'::regprocedure) def"
    )
  ).rows[0].def;
  // Freeze the server clock only inside this disposable database: the launch can be in the future when CI runs.
  await db.exec(
    claimDefinition.replaceAll(
      "clock_timestamp()",
      "'2026-11-10T19:00:00Z'::timestamptz"
    )
  );
  await db.exec("set role authenticated");
  const claim = (
    await db.query(
      `select public.claim_mission_milestone('daily','2026-11-09T19:00:00Z',20) result`
    )
  ).rows[0].result;
  assert.equal(claim.reward, 15);
  await assert.rejects(
    db.query(
      `select public.claim_mission_milestone('daily','2026-11-09T19:00:00Z',20)`
    ),
    /MISSION_ALREADY_CLAIMED/
  );
  await assert.rejects(
    db.query(
      `select public.advance_player_progress('${player}','regular_packs_opened',100,now())`
    ),
    /permission denied/
  );
  await db.exec("reset role");
});
test("rollover settles all unpaid gauges once and applies Pro only to milestone rewards", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values($1,'{"pseudo":"Rollover"}')`,
    [player]
  );
  for (const day of ["2026-11-09T19:00:00Z", "2026-11-10T19:00:00Z"])
    for (const [metric, n] of [
      ["regular_packs_opened", 30],
      ["cards_destroyed", 10],
      ["wishlist_added", 1],
      ["decision_days", 1]
    ])
      await db.query("select public.advance_player_progress($1,$2,$3,$4)", [
        player,
        metric,
        n,
        day
      ]);
  const def = (
    await db.query(
      "select pg_get_functiondef('public.get_missions()'::regprocedure) def"
    )
  ).rows[0].def;
  const claimDef = (
    await db.query(
      "select pg_get_functiondef('public.claim_mission_milestone(text,timestamptz,integer)'::regprocedure) def"
    )
  ).rows[0].def;
  for (const source of [def, claimDef])
    await db.exec(
      source.replaceAll(
        "clock_timestamp()",
        "'2026-11-20T19:00:00Z'::timestamptz"
      )
    );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  await db.exec("set role authenticated");
  await db.query("select public.get_missions()");
  await db.query("select public.get_missions()");
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [player]
      )
    ).rows[0].karas_balance,
    220
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) n from public.user_milestone_claims where user_id=$1",
          [player]
        )
      ).rows[0].n
    ),
    8
  );
  await db.exec("set role service_role");
  await db.query(
    "select public.billing_set_manual_pro_access($1,true,'Mission Pro test')",
    [player]
  );
  await db.exec("reset role");
  await db.query(
    `select public.advance_player_progress($1,'regular_packs_opened',15,'2026-11-20T19:00:00Z')`,
    [player]
  );
  await db.exec("set role authenticated");
  const bonus = (
    await db.query(
      "select public.claim_mission_milestone('daily','2026-11-20T19:00:00Z',20) result"
    )
  ).rows[0].result;
  assert.equal(bonus.reward, 23);
});
test("real recycling counts once, reveals Regret and never counts evolution ingredients as destruction", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values($1,'{"pseudo":"RecycleTest"}')`,
    [player]
  );
  const card = (
    await db.query(
      `insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values('regret-fixture','SSR fixture','ANIME/MANGA','Fixture','SSR','https://example.test/card.png','test') returning id`
    )
  ).rows[0].id;
  const copy = (
    await db.query(
      `insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'SSR') returning id`,
      [player, card]
    )
  ).rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  await db.exec("set role authenticated");
  await db.query("select public.discard_collection_card($1)", [copy]);
  await assert.rejects(
    db.query("select public.discard_collection_card($1)", [copy]),
    /CARD_NOT_OWNED/
  );
  const catalogue = (
    await db.query("select public.get_achievement_catalogue() result")
  ).rows[0].result;
  assert.ok(catalogue.find(a => a.id === "regret-1").completedAt);
  await db.exec("reset role");
  const copies = (
    await db.query(
      `insert into public.user_cards(user_id,card_id,rarity) select $1,$2,'SSR' from generate_series(1,5) returning id`,
      [player, card]
    )
  ).rows.map(r => r.id);
  await db.exec("set role authenticated");
  await db.query("select public.evolve_ssr_card($1::uuid[])", [copies]);
  await db.exec("reset role");
  assert.equal(
    Number(
      (
        await db.query(
          "select value from public.user_progress_counters where user_id=$1 and metric='cards_destroyed'",
          [player]
        )
      ).rows[0].value
    ),
    1
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select value from public.user_progress_counters where user_id=$1 and metric='ssr_infinity'",
          [player]
        )
      ).rows[0].value
    ),
    1
  );
});
test("extended legacy claims pay the full new reward once and preserve the old claim", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values($1,'{"pseudo":"FullUpgrade"}')`,
    [player]
  );
  await db.query("select public.advance_player_progress($1,'ssr_infinity',1)", [
    player
  ]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  await db.exec("set role authenticated");
  await db.query("select public.get_achievement_catalogue()");
  const result = (
    await db.query(
      "select public.claim_catalogue_achievement('transcendance') result"
    )
  ).rows[0].result;
  assert.equal(result.reward, 1000);
  await assert.rejects(
    db.query("select public.claim_catalogue_achievement('transcendance')"),
    /ACHIEVEMENT_ALREADY_CLAIMED/
  );
  await assert.rejects(
    db.query("select public.claim_achievement('transcendance')"),
    /ACHIEVEMENT_ALREADY_CLAIMED/
  );
  const catalogue = (
    await db.query("select public.get_achievement_catalogue() result")
  ).rows[0].result;
  assert.equal(
    catalogue.find(a => a.id === "transcendance").upgradeReward,
    0,
    "no second bonus after the new amount was already paid"
  );
  await assert.rejects(
    db.query("select * from public.achievement_catalogue"),
    /permission denied/
  );
  await assert.rejects(
    db.query("select * from public.user_catalogue_achievements"),
    /permission denied/
  );
});

test("auction timing achievements use the deadline before anti-snipe extension and the final winner", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  // Freeze the clock in this disposable database only, avoiding a timing race on busy CI runners.
  for (const signature of [
    "public.capture_game_progress()",
    "public.place_bid(uuid,integer)"
  ]) {
    const definition = (
      await db.query("select pg_get_functiondef($1::regprocedure) def", [
        signature
      ])
    ).rows[0].def;
    await db.exec(
      definition.replaceAll(
        "clock_timestamp()",
        "'2026-11-10T19:00:00Z'::timestamptz"
      )
    );
  }
  const ids = [
    "10000000-0000-4000-8000-000000000061",
    "10000000-0000-4000-8000-000000000062",
    "10000000-0000-4000-8000-000000000063"
  ];
  for (let i = 0; i < ids.length; i++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [ids[i], JSON.stringify({ pseudo: "Timing" + i })]
    );
  const card = (
    await db.query(
      `insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values('timing','Timing','ANIME/MANGA','Fixture','SSR','https://example.test/card.png','test') returning id`
    )
  ).rows[0].id;
  const copy = (
    await db.query(
      `insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'SSR') returning id`,
      [ids[0], card]
    )
  ).rows[0].id;
  const auction = (
    await db.query(
      `insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at,buyer_id) values($1,$2,10,10,15,'2026-11-10T19:00:03Z'::timestamptz,$3) returning id`,
      [copy, ids[0], ids[1]]
    )
  ).rows[0].id;
  await db.query(
    "update public.user_profiles set karas_balance=1000 where user_id=any($1::uuid[])",
    [ids]
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids[2]
  ]);
  await db.exec("set role authenticated");
  await db.query("select public.place_bid($1,20)", [auction]);
  await db.exec("reset role");
  assert.equal(
    new Date(
      (
        await db.query("select ends_at from public.auctions where id=$1", [
          auction
        ])
      ).rows[0].ends_at
    ).toISOString(),
    "2026-11-10T19:01:03.000Z",
    "existing anti-snipe extension remains active"
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select value from public.user_progress_counters where user_id=$1 and metric='last_second'",
          [ids[2]]
        )
      ).rows[0].value
    ),
    1
  );
  assert.equal(
    (
      await db.query(
        "select count(*) n from public.user_progress_counters where metric in('sniper','so_close') and user_id=any($1::uuid[])",
        [ids]
      )
    ).rows[0].n,
    0,
    "candidates are not awarded before settlement"
  );
  await db.query(`update public.auctions set status='sold' where id=$1`, [
    auction
  ]);
  assert.equal(
    Number(
      (
        await db.query(
          "select value from public.user_progress_counters where user_id=$1 and metric='sniper'",
          [ids[2]]
        )
      ).rows[0].value
    ),
    1
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select value from public.user_progress_counters where user_id=$1 and metric='so_close'",
          [ids[1]]
        )
      ).rows[0].value
    ),
    1
  );
});
