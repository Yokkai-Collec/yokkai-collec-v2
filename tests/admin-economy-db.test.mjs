import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("the economy observes real wallet, escrow and settlement events without changing them", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const [admin, buyer, seller, emptyUser] = Array.from({ length: 4 }, () =>
    randomUUID()
  );
  await db.exec(
    "alter table auth.users add column if not exists created_at timestamptz not null default now()"
  );
  for (const [id, pseudo] of [
    [admin, "EconomyAdmin"],
    [buyer, "EconomyBuyer"],
    [seller, "EconomySeller"],
    [emptyUser, "EconomyZero"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await db.query(
    "update auth.users set created_at=now()-interval '100 days' where id=$1",
    [seller]
  );
  const read = async (sql, args = []) =>
    (await db.query(sql, args)).rows[0]?.value;
  const rpc = async (user, sql, args = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec("set role authenticated");
    try {
      return await read(sql, args);
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const report = (name, args = []) =>
    rpc(
      admin,
      "select public.admin_get_economy($1,$2,$3,$4,$5,$6) value",
      [name, 30, "day", false, 0, ""].map((item, index) => args[index] ?? item)
    );
  const overview = () => report("overview");
  const offer = (from, to, amount, state = "pending") =>
    read(
      "insert into public.trade_offers(from_user,to_user,offered_karas,status) values($1,$2,$3,$4) returning id value",
      [from, to, amount, state]
    );
  const cards = {};
  for (const rarity of ["C", "R", "SR", "SSR", "LR"])
    cards[rarity] = await read(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('test',$1,$1,'ANIME/MANGA','Economy fixture',$2,'https://example.invalid/card.png') returning id value",
      ["economy-" + rarity, rarity]
    );

  await t.test(
    "admin permission and missing pre-activation history",
    async () => {
      await assert.rejects(
        rpc(buyer, "select public.admin_get_economy() value"),
        /ADMIN_REQUIRED/
      );
      await assert.rejects(
        rpc(
          buyer,
          "select public.admin_set_economy_thresholds(5,3,15,10,20,20)"
        ),
        /ADMIN_REQUIRED/
      );
      await assert.rejects(
        rpc(buyer, "select * from economy_private.wallet"),
        /permission denied/
      );
      const start = await overview();
      assert.equal(start.partial, true);
      assert.equal(start.previous, null);
      assert.equal(start.growth, null);
      assert.equal(start.created, "0");
      assert.equal(start.series.length, 1);
      assert.equal((await report("market")).stats.length, 0);
      assert.equal((await report("distribution")).players, 4);
      assert.equal((await report("cohorts")).cards, null);
      await assert.rejects(
        report("players", ["players", 30, "day", false, -1]),
        /INVALID_ECONOMY_FILTER/
      );
    }
  );

  await t.test(
    "a 1,000 Kara grant creates 1,000 once even when the client retries",
    async () => {
      const code = await rpc(
        admin,
        "select public.admin_create_karas_gift_code(1000,'Economy test') value"
      );
      const redeem = () =>
        rpc(buyer, "select public.redeem_karas_gift_code($1) value", [code]);
      assert.equal((await redeem()).alreadyRedeemed, false);
      assert.equal((await redeem()).alreadyRedeemed, true);
      assert.equal((await overview()).created, "1000");
      const { categories } = await report("flows", ["flows", 1, "week"]);
      assert.deepEqual(
        categories.find(row => row.category === "gift_code"),
        {
          kind: "source",
          category: "gift_code",
          amount: "1000",
          operations: 1,
          players: 1,
          share: 100
        }
      );
    }
  );

  await t.test(
    "an actual shop debit is a sink and a purchase retry leaves a single movement",
    async () => {
      await db.exec(
        "create or replace function public.blackout_schedule() returns table(opens_at timestamptz,closes_at timestamptz) language sql stable set search_path='' as $$ select now()-interval '1 hour',now()+interval '2 hours' $$"
      );
      await db.exec("select public.publish_blackout_cards()");
      const key = randomUUID();
      const purchase = () =>
        rpc(buyer, "select public.buy_blackout_packs(1,$1) value", [key]);
      await purchase();
      await purchase();
      const data = await overview();
      assert.equal(data.created, "1000");
      assert.equal(data.destroyed, "750");
      assert.equal(data.money, "250");
    }
  );

  await t.test(
    "trade transfers Kara once and quarantine holds do not settle a second transfer",
    async () => {
      await db.query(
        "update public.user_profiles set karas_balance=20000 where user_id in ($1,$2,$3)",
        [admin, buyer, seller]
      );
      await db.query(
        "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
        [buyer, seller]
      );
      const previous = await overview();
      const trade = await offer(buyer, seller, 2000);
      assert.equal(
        await rpc(
          seller,
          "select public.respond_trade_offer($1,'accept') value",
          [trade]
        ),
        true
      );
      assert.equal((await report("activity")).tradeVolume, "2000");
      assert.equal((await overview()).net, previous.net);
      assert.equal((await overview()).money, previous.money);

      const held = await offer(buyer, seller, 500, "quarantined");
      await db.query(
        `
      with new_hold as (
        insert into public.anticheat_quarantines(subject_type,subject_id,status,sender_user_id,recipient_user_id,case_user_id,
          evidence_confidence,economic_severity,reason_codes,asset_snapshot,expires_at)
        values('trade',$1,'AWAITING_REVIEW',$2,$3,$2,'CORROBORATED','MEDIUM',array['TRADE_TEST'],'{}',now()+interval '1 day')
        returning id
      ) insert into public.anticheat_trade_kara_holds(quarantine_id,user_id,amount)
        select id,$2,500 from new_hold
    `,
        [held, buyer, seller]
      );
      assert.equal((await report("activity")).tradeCount, 1);
      assert.equal((await overview()).tradeHolds, "500");
      assert.equal((await overview()).money, previous.money);
      const players = await report("players");
      assert.equal(players.rows.find(row => row.id === buyer).sent, "2000");
      assert.equal(
        players.rows.find(row => row.id === seller).received,
        "2000"
      );
    }
  );

  async function listing() {
    const instance = await read(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'LR') returning id value",
      [seller, cards.LR]
    );
    return rpc(seller, "select public.create_auction($1,10,60) value", [
      instance
    ]);
  }
  const bid = (by, id, amount) =>
    rpc(by, "select public.place_bid($1,$2) value", [id, amount]);
  await t.test(
    "escrow, outbid refunds, and a 10,000 Kara player sale are not destruction",
    async () => {
      const original = await overview();
      const sale = await listing();
      await bid(admin, sale, 4000);
      assert.equal((await overview()).escrow, "4000");
      await bid(buyer, sale, 10000);
      assert.equal(
        await read(
          "select karas_balance value from public.user_profiles where user_id=$1",
          [admin]
        ),
        20000
      );
      assert.equal((await overview()).money, original.money);
      assert.equal((await overview()).destroyed, original.destroyed);
      assert.equal((await report("activity")).sold, 0);
      await db.query(
        "update public.auctions set ends_at=now()-interval '1 second' where id=$1",
        [sale]
      );
      await db.exec("select public.settle_expired_auctions()");
      await db.exec("select public.settle_expired_auctions()");
      assert.equal((await overview()).escrow, "0");
      assert.equal((await overview()).money, original.money);
      assert.equal((await overview()).destroyed, original.destroyed);
      const activity = await report("activity");
      assert.equal(activity.volume, "10000");
      assert.equal(activity.transferCount, 2);
      assert.equal(activity.transferVolume, "12000");
      assert.deepEqual(
        (await report("market")).stats.map(row => [
          row.rarity,
          row.median,
          row.sales
        ]),
        [["LR", "10000.00", 1]]
      );
      assert.equal(
        (
          await report("market", [
            "market",
            30,
            "day",
            false,
            0,
            "does not match"
          ])
        ).stats.length,
        0
      );
    }
  );

  await t.test(
    "a system auction destroys 500 Kara only on successful settlement",
    async () => {
      const before = await overview();
      const { transferCount } = await report("activity");
      const market = await report("market");
      await db.exec(
        "update public.event_runtime_config set enabled=true where singleton"
      );
      const sale = await read(
        `insert into public.auctions(is_mystery,mystery_day,starting_price,current_price,duration_minutes,ends_at,mystery_lr_chance,mystery_misses)
         values(true,'2099-01-07',50,50,1440,now()+interval '1 hour',1,0) returning id value`
      );
      await rpc(buyer, "select public.place_bid($1,500) value", [sale]);
      assert.equal((await overview()).money, before.money);
      assert.equal((await overview()).destroyed, before.destroyed);
      await db.query(
        "update public.auctions set ends_at=now()-interval '1 second' where id=$1",
        [sale]
      );
      await db.exec(
        "select public.settle_expired_auctions(); select public.settle_expired_auctions()"
      );
      const result = await overview();
      assert.equal(BigInt(before.money) - BigInt(result.money), 500n);
      assert.equal(BigInt(result.destroyed) - BigInt(before.destroyed), 500n);
      assert.deepEqual((await report("market")).stats, market.stats);
      assert.equal((await report("activity")).transferCount, transferCount);
    }
  );

  await t.test(
    "ordinary cancellations are observed and only a verified commission counts as a sink",
    async () => {
      const cancelled = await listing();
      assert.equal(
        await rpc(seller, "select public.cancel_auction($1) value", [
          cancelled
        ]),
        true
      );
      assert.equal((await report("activity")).cancelled, 1);
      const before = await overview();
      // Production player auctions have no commission. Verify the reporting
      // contract with a fixture that explicitly documents a real burn of 500.
      await db.query(
        `
      insert into economy_private.operations(action,subject_id,seller,buyer,amount,burned,channel,rarity)
      values('sale',$1,$2,$3,10000,500,'auction','SR')
    `,
        [randomUUID(), seller, buyer]
      );
      assert.equal(
        BigInt((await overview()).destroyed) - BigInt(before.destroyed),
        500n
      );
    }
  );

  await t.test(
    "snapshots are idempotent, a banned player stays in the supply and exact totals exceed JS precision",
    async () => {
      const before = await overview();
      await db.exec(
        "select economy_private.take_snapshot(); select economy_private.take_snapshot()"
      );
      assert.equal(
        await read("select count(*)::int value from economy_private.snapshots"),
        1
      );
      await db.exec(
        "alter table auth.users add column if not exists banned_until timestamptz"
      );
      await db.query(
        "update auth.users set banned_until=now()+interval '1 day' where id=$1",
        [seller]
      );
      assert.equal((await overview()).money, before.money);
      await db.query(
        `
      insert into economy_private.wallet(user_id,delta,kind,category)
      values($1,9007199254740993,'unknown','unclassified')
    `,
        [buyer]
      );
      assert.equal(
        BigInt((await overview()).unknown) - BigInt(before.unknown),
        9007199254740993n
      );
      assert.equal(
        (await report("players", ["players", 7, "month", false, 1])).rows
          .length,
        0
      );
      await rpc(
        admin,
        "select public.admin_set_economy_thresholds(4,3,15,10,20,25)"
      );
      assert.equal((await report("risks")).minSales, 25);
      const stable = await rpc(
        admin,
        "select jsonb_build_array(public.admin_get_economy('flows'),public.admin_get_economy('cohorts'),public.admin_get_economy('distribution')) value"
      );
      assert.equal(stable.length, 3);
    }
  );

  await t.test(
    "the journal separates daily and weekly rewards and the scheduled snapshot calculates card cohorts",
    async () => {
      await db.query(
        "insert into public.user_mission_progress(user_id,period,period_start,metric,value) select $1,period,public.mission_period_start(now(),period),metric,max(target) from public.mission_definitions group by period,metric on conflict(user_id,period,period_start,metric) do update set value=greatest(user_mission_progress.value,excluded.value)",
        [buyer]
      );
      for (const [period, amount] of [
        ["daily", 15],
        ["weekly", 50]
      ]) {
        const start = await read(
          "select public.mission_period_start(now(),$1)::text value",
          [period]
        );
        const result = await rpc(
          buyer,
          "select public.claim_mission_milestone($1,$2,20) value",
          [period, start]
        );
        assert.equal(result.reward, amount);
      }
      const flows = await report("flows");
      assert.equal(
        flows.categories.find(row => row.category === "mission_daily")?.amount,
        "15"
      );
      assert.equal(
        flows.categories.find(row => row.category === "mission_weekly")?.amount,
        "50"
      );
      // Simulate a previous-day baseline in the disposable test database so the
      // actual scheduled worker can take today's complete card-count snapshot.
      await db.exec(
        "update economy_private.snapshots set day=day-1; select economy_private.take_snapshot(true); select economy_private.take_snapshot(true)"
      );
      const cohorts = await report("cohorts");
      assert.ok(
        cohorts.cards.some(
          row => row.generation === "new" && Number(row.lr) >= 1
        )
      );
      assert.equal(
        await read("select count(*)::int value from economy_private.snapshots"),
        2
      );
    }
  );
});
