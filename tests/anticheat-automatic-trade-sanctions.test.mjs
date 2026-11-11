import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("linked-account trades ban the newest account, escalate the primary after three warnings, and only queue relevant Discord alerts", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`
    alter table auth.users add column if not exists banned_until timestamptz;
    alter table auth.users add column if not exists updated_at timestamptz;
    alter table auth.users add column if not exists created_at timestamptz;
  `);

  const primary = "ac970000-0000-4000-8000-000000000001";
  const newest = [
    "ac970000-0000-4000-8000-000000000002",
    "ac970000-0000-4000-8000-000000000003",
    "ac970000-0000-4000-8000-000000000004"
  ];
  await db.query(
    "insert into auth.users(id,raw_user_meta_data,created_at) values($1,$2,now()-interval '30 days')",
    [primary, JSON.stringify({ pseudo: "PrimaryPlayer" })]
  );
  for (const [index, userId] of newest.entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,created_at) values($1,$2,now()-$3::interval)",
      [
        userId,
        JSON.stringify({ pseudo: `Recent${index + 1}` }),
        `${2 - index} days`
      ]
    );

  const network = `v1:${"a".repeat(64)}`;
  const device = `v1:${"b".repeat(64)}`;
  for (const userId of [primary, ...newest]) {
    await db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2)",
      [network, userId]
    );
    await db.query(
      "insert into public.anticheat_device_observations(device_identity,user_id) values($1,$2)",
      [device, userId]
    );
  }

  for (const userId of newest) {
    await db.query(
      "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
      [primary, userId]
    );
    const tradeId = (
      await db.query(
        "insert into public.trade_offers(from_user,to_user,offered_karas) values($1,$2,1) returning id",
        [primary, userId]
      )
    ).rows[0].id;
    await db.query(
      "update public.trade_offers set status='accepted',updated_at=clock_timestamp() where id=$1",
      [tradeId]
    );
  }

  const sanctions = (
    await db.query(
      "select primary_user_id,banned_user_id,shared_network,shared_device,primary_warning_number,primary_suspended_until from public.anticheat_automatic_trade_sanctions order by primary_warning_number"
    )
  ).rows;
  assert.deepEqual(
    sanctions.map(row => ({
      primary: row.primary_user_id,
      banned: row.banned_user_id,
      network: row.shared_network,
      device: row.shared_device,
      warning: row.primary_warning_number,
      suspended: row.primary_suspended_until !== null
    })),
    newest.map((userId, index) => ({
      primary,
      banned: userId,
      network: true,
      device: true,
      warning: index + 1,
      suspended: index === 2
    }))
  );
  assert.deepEqual(
    (
      await db.query(
        "select id,banned_until>now() banned from auth.users where id=any($1) order by id",
        [[primary, ...newest]]
      )
    ).rows,
    [primary, ...newest].sort().map(id => ({ id, banned: true }))
  );

  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from public.anticheat_events where event_type='trade_shared_identity'"
      )
    ).rows[0].total,
    3
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from public.anticheat_events where event_type='automatic_trade_sanction'"
      )
    ).rows[0].total,
    3
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from public.anticheat_discord_outbox"
      )
    ).rows[0].total,
    6,
    "one linked-trade and one sanction alert per accepted linked trade"
  );

  await db.query(
    "select public.record_anticheat_event('trade_accepted',$1,$2,null,0,1,$3)",
    [primary, newest[0], JSON.stringify({ offeredTotal: 1, requestedTotal: 0 })]
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from public.anticheat_discord_outbox"
      )
    ).rows[0].total,
    6,
    "ordinary unbalanced trades no longer post to Discord"
  );
});

test("a shared IP or a shared browser independently triggers the automatic linked-trade sanction", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`
    alter table auth.users add column if not exists banned_until timestamptz;
    alter table auth.users add column if not exists updated_at timestamptz;
    alter table auth.users add column if not exists created_at timestamptz;
  `);

  const cases = [
    {
      older: "ac980000-0000-4000-8000-000000000001",
      newer: "ac980000-0000-4000-8000-000000000002",
      network: true,
      device: false
    },
    {
      older: "ac980000-0000-4000-8000-000000000003",
      newer: "ac980000-0000-4000-8000-000000000004",
      network: false,
      device: true
    }
  ];
  for (const [index, item] of cases.entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,created_at) values($1,$2,now()-interval '20 days'),($3,$4,now()-interval '1 day')",
      [
        item.older,
        JSON.stringify({ pseudo: `Older${index}` }),
        item.newer,
        JSON.stringify({ pseudo: `Newer${index}` })
      ]
    );
    await db.query(
      "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
      [item.older, item.newer]
    );
    if (item.network)
      for (const userId of [item.older, item.newer])
        await db.query(
          "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2)",
          [`v1:${String(index + 3).repeat(64)}`, userId]
        );
    if (item.device)
      for (const userId of [item.older, item.newer])
        await db.query(
          "insert into public.anticheat_device_observations(device_identity,user_id) values($1,$2)",
          [`v1:${String(index + 5).repeat(64)}`, userId]
        );
    const tradeId = (
      await db.query(
        "insert into public.trade_offers(from_user,to_user,offered_karas) values($1,$2,1) returning id",
        [item.older, item.newer]
      )
    ).rows[0].id;
    await db.query(
      "update public.trade_offers set status='accepted',updated_at=clock_timestamp() where id=$1",
      [tradeId]
    );
  }

  assert.deepEqual(
    (
      await db.query(
        "select banned_user_id,shared_network,shared_device from public.anticheat_automatic_trade_sanctions order by banned_user_id"
      )
    ).rows,
    [
      {
        banned_user_id: cases[0].newer,
        shared_network: true,
        shared_device: false
      },
      {
        banned_user_id: cases[1].newer,
        shared_network: false,
        shared_device: true
      }
    ]
  );
});

test("automatic sanctions recover historic direct-trade gains and auction proceeds without taking a buyer's card", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`
    alter table auth.users add column if not exists banned_until timestamptz;
    alter table auth.users add column if not exists updated_at timestamptz;
    alter table auth.users add column if not exists created_at timestamptz;
  `);
  const primary = "ac990000-0000-4000-8000-000000000001";
  const newest = "ac990000-0000-4000-8000-000000000002";
  const buyer = "ac990000-0000-4000-8000-000000000003";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data,created_at) values($1,$2,now()-interval '30 days'),($3,$4,now()-interval '1 day'),($5,$6,now()-interval '20 days')",
    [
      primary,
      JSON.stringify({ pseudo: "Primary" }),
      newest,
      JSON.stringify({ pseudo: "Newest" }),
      buyer,
      JSON.stringify({ pseudo: "AuctionBuyer" })
    ]
  );
  await db.query(
    "update public.user_profiles set karas_balance=200 where user_id=$1",
    [primary]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [primary, newest]
  );
  const cardId = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('test','automatic-recovery','Recovery card','TEST','TEST','C','https://example.invalid/card.png') returning id"
    )
  ).rows[0].id;
  const copyId = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity,is_first_owner) values($1,$2,'C',false) returning id",
      [newest, cardId]
    )
  ).rows[0].id;
  const historicTrade = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas) values($1,$2,$3,50) returning id",
      [newest, primary, [copyId]]
    )
  ).rows[0].id;
  await db.query(
    "update public.trade_offers set status='accepted',updated_at=clock_timestamp() where id=$1",
    [historicTrade]
  );
  await db.query("update public.user_cards set user_id=$2 where id=$1", [
    copyId,
    primary
  ]);
  await db.query(
    "update public.user_profiles set karas_balance=karas_balance+50 where user_id=$1",
    [primary]
  );
  const auctionId = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,status,current_price,buyer_id) values($1,$2,10,60,clock_timestamp(),'sold',120,$3) returning id",
      [copyId, primary, buyer]
    )
  ).rows[0].id;
  await db.query("update public.user_cards set user_id=$2 where id=$1", [
    copyId,
    buyer
  ]);
  await db.query(
    "update public.user_profiles set karas_balance=karas_balance+120 where user_id=$1",
    [primary]
  );
  const identity = `v1:${"c".repeat(64)}`;
  for (const userId of [primary, newest])
    await db.query(
      "insert into public.anticheat_device_observations(device_identity,user_id) values($1,$2)",
      [identity, userId]
    );
  const triggeringTrade = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_karas) values($1,$2,1) returning id",
      [newest, primary]
    )
  ).rows[0].id;
  await db.query(
    "update public.trade_offers set status='accepted',updated_at=clock_timestamp() where id=$1",
    [triggeringTrade]
  );

  const receipt = (
    await db.query(
      "select accepted_trade_ids,source_auction_ids,recovered_card_ids,unavailable_card_ids,recovered_trade_karas,recovered_sale_karas,unrecovered_karas from public.anticheat_automatic_trade_sanctions"
    )
  ).rows[0];
  assert.deepEqual(receipt.accepted_trade_ids, [
    historicTrade,
    triggeringTrade
  ]);
  assert.deepEqual(receipt.source_auction_ids, [auctionId]);
  assert.deepEqual(receipt.recovered_card_ids, []);
  assert.deepEqual(receipt.unavailable_card_ids, [copyId]);
  assert.equal(receipt.recovered_trade_karas, 51);
  assert.equal(receipt.recovered_sale_karas, 120);
  assert.equal(receipt.unrecovered_karas, 0);
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        copyId
      ])
    ).rows[0].user_id,
    buyer,
    "an unrelated winning bidder keeps the sold card"
  );
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [primary]
      )
    ).rows[0].karas_balance,
    199,
    "the primary loses the direct-trade gain and the proven auction proceeds"
  );
});

test("a same-device referral farm is blocked even when no shared IP is present", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`
    alter table auth.users add column if not exists banned_until timestamptz;
    alter table auth.users add column if not exists updated_at timestamptz;
  `);
  const referrer = "ac9a0000-0000-4000-8000-000000000001";
  const referred = [2, 3, 4, 5].map(
    n => `ac9a0000-0000-4000-8000-00000000000${n}`
  );
  await db.query(
    "insert into auth.users(id,raw_user_meta_data,email_confirmed_at) values($1,$2,clock_timestamp())",
    [referrer, JSON.stringify({ pseudo: "FarmReferrer" })]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    referrer
  ]);
  const code = (await db.query("select public.create_referral_code() value"))
    .rows[0].value;
  await db.exec("reset role");
  for (const [index, userId] of referred.entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,email_confirmed_at) values($1,$2,clock_timestamp())",
      [userId, JSON.stringify({ pseudo: `Farm${index}`, referral_code: code })]
    );
  const device = `v1:${"d".repeat(64)}`;
  for (const userId of [referrer, ...referred])
    await db.query(
      "insert into public.anticheat_device_observations(device_identity,user_id) values($1,$2)",
      [device, userId]
    );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from auth.users where id=any($1) and banned_until>clock_timestamp()",
        [referred]
      )
    ).rows[0].total,
    4
  );
  assert.equal(
    (
      await db.query(
        "select bonus_regular_packs from public.user_profiles where user_id=$1",
        [referrer]
      )
    ).rows[0].bonus_regular_packs,
    0
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from public.anticheat_discord_outbox"
      )
    ).rows[0].total,
    1,
    "the automatic referral sanction creates one Discord alert"
  );
});
