import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261009000012_pack_achievement_performance.sql";
const transferMigration = "20261116120000_batch_transfer_achievements.sql";
const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";
const directory = new URL("../supabase/migrations/", import.meta.url);

async function rpc(db, user, sql, params = []) {
  await db.exec("set role authenticated");
  let failed = false;
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    return (await db.query(sql, params)).rows[0]?.result;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (failed) await db.exec("rollback");
    await db.exec("reset role");
  }
}

async function fixtures(db) {
  for (const [id, pseudo] of [
    [alice, "PerfAlice"],
    [bob, "PerfBob"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.exec(`update public.user_profiles set karas_balance=10000;
    insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
    select md5('perf-'||g)::uuid,'perf-'||g,'Perf '||g,
      'Category '||((g-1)/5),'Perf',
      (array['C','R','SR','SSR','LR'])[1+(g-1)%5]::public.card_rarity,'https://example.test/card.png','test'
    from generate_series(1,30) g;`);
}

async function snapshot(db) {
  // Compare live (uncapped) progress, persisted completion/claim state, action
  // counters, notifications and card attributes. Generated IDs/timestamps differ
  // between runs; compare their meaning and verify completion timestamps persist.
  return (
    await db.query(`select jsonb_build_object(
    'progress',(select jsonb_agg(x order by user_id,condition_type) from (
      select p.user_id,a.condition_type,public.achievement_progress(p.user_id,a.condition_type) as value
      from public.user_profiles p cross join (select distinct condition_type from public.achievements) a) x),
    'completed',(select jsonb_agg(x order by user_id,achievement_id) from (
      select user_id,achievement_id,completed_at is not null as completed,claimed_at is not null as claimed from public.user_achievements) x),
    'stats',(select jsonb_agg(s order by user_id) from public.user_achievement_stats s),
    'notifications',(select jsonb_agg(x order by user_id,achievement_id) from (
      select user_id,achievement_id,count(*) from public.notifications where type='achievement_completed' group by 1,2) x),
    'cards',(select jsonb_agg(x order by user_id,card_id,rarity,is_shiny,is_evolved) from (
      select user_id,card_id,rarity,is_shiny,is_evolved,is_first_owner from public.user_cards) x)
  ) as value`)
  ).rows[0].value;
}

async function scenario(db) {
  await db.exec("begin; select setseed(0.314159)");
  const states = [];
  const record = async label =>
    states.push({ label, state: await snapshot(db) });
  try {
    for (let i = 0; i < 6; i++) {
      await db.query(
        "update public.user_profiles set next_regular_pack_at=now()-interval '1 hour' where user_id=$1",
        [alice]
      );
      const pack = await rpc(
        db,
        alice,
        "select public.open_regular_pack() as result"
      );
      assert.equal(pack.length, 5);
      await record(`regular pack ${i + 1}`);
    }
    const choices = await rpc(
      db,
      alice,
      "select public.open_decision_pack() as result"
    );
    await record("decision choices do not acquire cards");
    await rpc(
      db,
      alice,
      "select public.keep_decision_pack_card($1) as result",
      [choices[0].instanceId]
    );
    await record("decision kept, other choices destroyed");
    const discardedChoices = await rpc(
      db,
      bob,
      "select public.open_decision_pack() as result"
    );
    for (const [i, choice] of discardedChoices.slice(0, 4).entries()) {
      await rpc(
        db,
        bob,
        "select public.discard_decision_pack_card($1) as result",
        [choice.instanceId]
      );
      await record(`decision choice discarded ${i + 1}`);
    }
    // The last choice remains protected from destruction; the zero-reward keep
    // is now covered by its dedicated fix and stays identical across batching.
    await db.exec("savepoint last_choice; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      bob
    ]);
    try {
      await assert.rejects(
        db.query("select public.discard_decision_pack_card($1)", [
          discardedChoices[4].instanceId
        ]),
        /DECISION_LAST_CHOICE/
      );
    } finally {
      await db.exec(
        "rollback to savepoint last_choice; reset role; release savepoint last_choice"
      );
    }
    await record("last Decision choice protected from destruction");
    const lastKept = await rpc(
      db,
      bob,
      "select public.keep_decision_pack_card($1) as result",
      [discardedChoices[4].instanceId]
    );
    assert.equal(lastKept.karasReward, 0);
    await record("last Decision choice kept without a second reward");
    const friendship = await rpc(
      db,
      alice,
      "select public.send_friend_request($1) as result",
      [bob]
    );
    await rpc(
      db,
      bob,
      "select public.respond_friend_request($1,true) as result",
      [friendship]
    );
    const owned = (
      await db.query(
        "select id from public.user_cards where user_id=$1 order by card_id,id",
        [alice]
      )
    ).rows;
    const trade = await rpc(
      db,
      alice,
      "select public.create_trade_offer($1,$2::uuid[]) as result",
      [bob, owned.slice(0, 3).map(r => r.id)]
    );
    await rpc(
      db,
      bob,
      "select public.respond_trade_offer($1,'accept') as result",
      [trade]
    );
    await record("trade: recipient gains cards, sender loses cards");
    const back = await rpc(
      db,
      bob,
      "select public.create_trade_offer($1,$2::uuid[],0,$3::uuid[]) as result",
      [alice, [owned[0].id], [owned[3].id]]
    );
    await rpc(
      db,
      alice,
      "select public.respond_trade_offer($1,'accept') as result",
      [back]
    );
    await record("two-way trade");
    const auction = await rpc(
      db,
      alice,
      "select public.create_auction($1,10,15) as result",
      [owned[4].id]
    );
    await rpc(db, bob, "select public.place_bid($1,20) as result", [auction]);
    await db.query(
      "update public.auctions set ends_at=now()-interval '1 minute' where id=$1",
      [auction]
    );
    await db.exec("select public.settle_expired_auctions()"); // same postgres command as cron
    await record("auction won: buyer gains, seller loses");
    await rpc(
      db,
      alice,
      "select public.discard_regular_pack_card($1) as result",
      [owned[5].id]
    );
    await record("regular pack destruction");
    await rpc(db, bob, "select public.discard_collection_card($1) as result", [
      owned[1].id
    ]);
    await record("collection destruction");
    // Fixture five identical SSR copies; the evolution itself uses the real player RPC.
    const copies = (
      await db.query(
        `insert into public.user_cards(user_id,card_id,rarity)
      select $1,md5('perf-4')::uuid,'SSR' from generate_series(1,5) returning id`,
        [alice]
      )
    ).rows;
    await record("five SSR copies acquired together");
    const evolved = await rpc(
      db,
      alice,
      "select public.evolve_ssr_card($1::uuid[]) as result",
      [copies.map(r => r.id)]
    );
    await record("evolution consumes five copies and creates a shiny");
    const evolutionTrade = await rpc(
      db,
      alice,
      "select public.create_trade_offer($1,$2::uuid[]) as result",
      [bob, [evolved.instanceId]]
    );
    await rpc(
      db,
      bob,
      "select public.respond_trade_offer($1,'accept') as result",
      [evolutionTrade]
    );
    await record(
      "evolved card transferred (historical evolution counter behavior)"
    );
    // Cross all four acquisition thresholds, including 25 unique cards, in a
    // single batch. This catches a dropped condition even when read-side live
    // progress is unchanged. Both versions receive precisely the same cards.
    await db.query(
      `insert into public.user_cards(user_id,card_id,rarity,is_shiny)
      select $1,id,rarete_base,rarete_base='LR' from public.cards order by id limit 25`,
      [bob]
    );
    for (const id of [
      "collection-en-marche",
      "legende-naissante",
      "eclat-inattendu",
      "specialiste"
    ]) {
      assert.equal(
        (
          await db.query(
            "select completed_at is not null as completed from public.user_achievements where user_id=$1 and achievement_id=$2",
            [bob, id]
          )
        ).rows[0]?.completed,
        true,
        id
      );
    }
    await record("all four collection thresholds crossed together");
    await rpc(
      db,
      alice,
      "select public.claim_achievement('premier-rituel') as result"
    );
    await record("achievement claimed");
    const timestamps = (
      await db.query(
        "select user_id,achievement_id,completed_at from public.user_achievements order by 1,2"
      )
    ).rows;
    await db.exec(
      "update public.user_cards set user_id=user_id; update public.user_cards set folder_id=null"
    );
    assert.deepEqual(
      (
        await db.query(
          "select user_id,achievement_id,completed_at from public.user_achievements order by 1,2"
        )
      ).rows,
      timestamps
    );
    await record("same owner and cosmetic updates do not trigger achievements");
    await db.exec(
      "insert into public.user_cards(user_id,card_id) select user_id,card_id from public.user_cards where false"
    );
    await record("empty insertion changes nothing");
    return states;
  } finally {
    await db.exec("rollback");
  }
}

test("all acquisition/removal paths preserve exact achievement progress before/after", async t => {
  const migrations = readdirSync(directory)
    .filter(
      n => n.endsWith(".sql") && n !== migration && n !== transferMigration
    )
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  await fixtures(db);
  // Past the new-player boost, which the historical draw below does not have.
  await db.exec(`select public.ensure_achievement_stats(user_id) from public.user_profiles;
    update public.user_achievement_stats set regular_packs_opened=10;`);
  const before = await scenario(db);
  // The historical optimization also redefines the Regular draw. Compare its
  // achievement behavior with identical, product-approved odds on both sides.
  const historicalSQL = readFileSync(new URL(migration, directory), "utf8");
  assert.match(historicalSQL, /roll<\.724/);
  assert.match(historicalSQL, /roll<\.924/);
  assert.match(historicalSQL, /random\(\) < \.001/);
  const performanceSQL = historicalSQL
    .replace("roll<.724", "roll<.694")
    .replace("roll<.924", "roll<.894")
    .replace("random() < .001", "random() < .1");
  await db.exec(performanceSQL);
  const transferSQL = readFileSync(
    new URL(transferMigration, directory),
    "utf8"
  );
  await db.exec(transferSQL);
  assert.deepEqual(await scenario(db), before);
  // Replaying the new migration must not duplicate triggers or change any data.
  await db.exec(performanceSQL);
  await db.exec(transferSQL);
  assert.deepEqual(await scenario(db), before);
});

test("one collection achievement evaluation per pack, trigger-only ACL and audited FK indexes", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await fixtures(db);
  await db.exec("create table public.perf_calls(types text[])");
  const def = (
    await db.query(
      "select pg_get_functiondef('public.complete_achievements(uuid,text[])'::regprocedure) as def"
    )
  ).rows[0].def;
  await db.exec(
    def.replace(
      /\bbegin\b/i,
      "begin insert into public.perf_calls values(p_condition_types);"
    )
  );
  await rpc(db, alice, "select public.open_regular_pack() as result");
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) from public.perf_calls where 'unique_cards_collected'=any(types)"
        )
      ).rows[0].count
    ),
    1
  );
  for (const role of ["public", "anon", "authenticated"]) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.on_cards_inserted_achievements()','EXECUTE') as allowed",
          [role]
        )
      ).rows[0].allowed,
      false
    );
  }
  for (const [table, column] of [
    ["trade_offers", "to_user"],
    ["auctions", "seller_id"],
    ["auctions", "buyer_id"],
    ["wishlists", "card_id"],
    ["notifications", "actor_user_id"],
    ["auction_watchers", "auction_id"],
    ["user_reports", "reported_id"]
  ]) {
    assert.ok(
      (
        await db.query(
          `select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
      where i.indrelid=$1::regclass and a.attname=$2 and i.indisvalid and i.indpred is null`,
          [`public.${table}`, column]
        )
      ).rows.length,
      `${table}.${column} needs an unconditional leading-column index`
    );
  }
});
