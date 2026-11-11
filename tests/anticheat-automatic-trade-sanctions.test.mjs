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
