import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("a valid trade with both recent connection signals is cancelled before settlement", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`
    alter table auth.users add column created_at timestamptz not null default now(),
      add column banned_until timestamptz, add column updated_at timestamptz;
    create table auth.sessions(user_id uuid);
  `);
  const [primary, ...secondaries] = [1, 2, 3, 4, 5, 6, 7, 8].map(
    id => `ad520000-0000-4000-8000-00000000000${id}`
  );
  const signal = character => `v1:${character.repeat(64)}`;
  for (const [index, id] of [primary, ...secondaries].entries()) {
    await db.query(
      "insert into auth.users(id,created_at,raw_user_meta_data) values($1,now()+$2*interval '1 second',$3)",
      [
        id,
        index === 7 ? 0 : index,
        JSON.stringify({ pseudo: `TradePlayer${index}` })
      ]
    );
    await db.query("insert into auth.sessions values($1)", [id]);
    await db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2)",
      [signal(index === 6 ? "c" : "a"), id]
    );
    if (index !== 5) {
      await db.query(
        "insert into public.anticheat_device_observations(device_identity,user_id) values($1,$2)",
        [signal("b"), id]
      );
    }
    await db.query(
      "select public.record_anticheat_trade_connection($1,$2,$3)",
      [id, signal(index === 6 ? "c" : "a"), signal(index === 5 ? "d" : "b")]
    );
    if (id !== primary) {
      await db.query(
        "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
        [primary, id]
      );
    }
  }
  await db.exec("update public.user_profiles set karas_balance=100");
  const catalog = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('test','shared-trade','Test','Test','Test','LR','https://example.invalid/card.png') returning id"
    )
  ).rows[0].id;
  const card = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'LR') returning id",
      [primary, catalog]
    )
  ).rows[0].id;
  async function makeOffer(from, to, cards = []) {
    return (
      await db.query(
        "insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas,requested_karas) values($1,$2,$3,10,10) returning id",
        [from, to, cards]
      )
    ).rows[0].id;
  }
  async function asUser(player, sql, args) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      player
    ]);
    await db.exec("set role authenticated");
    try {
      return (await db.query(sql, args)).rows[0].result;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }
  const accept = (offer, player, rpc = "respond_trade_offer_with_status") =>
    asUser(player, `select public.${rpc}($1,'accept') as result`, [offer]);
  const status = async offer =>
    (
      await db.query("select status from public.trade_offers where id=$1", [
        offer
      ])
    ).rows[0].status;
  const restriction = async user =>
    (
      await db.query(
        "select case when banned_until='infinity' then 'ban' when banned_until>now() then 'suspension' else 'none' end as state from auth.users where id=$1",
        [user]
      )
    ).rows[0].state;

  const [first, second, third, fourth, ipOnly, browserOnly, sameAge] =
    secondaries;
  await db.query(
    "update auth.users set created_at=(select created_at from auth.users where id=$1) where id=$2",
    [primary, sameAge]
  );
  const disabled = await makeOffer(primary, first);
  assert.equal(await accept(disabled, first), "accepted");
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag in('automatic_sanctions','quarantine_enforcement','discord_alerts_v2')"
  );
  // Independent history still shows the browser previously shared at home.
  await db.query(
    "insert into public.anticheat_device_observations(device_identity,user_id) values($1,$2)",
    [signal("b"), ipOnly]
  );
  // The latest browser replaces the previous one immediately, even inside the
  // observation refresh interval.
  await db.query("select public.record_anticheat_trade_connection($1,$2,$3)", [
    ipOnly,
    signal("a"),
    signal("b")
  ]);
  await db.query("select public.record_anticheat_trade_connection($1,$2,$3)", [
    ipOnly,
    signal("a"),
    signal("d")
  ]);
  await assert.rejects(
    asUser(
      ipOnly,
      "select public.record_anticheat_trade_connection($1,$2,$3)",
      [primary, signal("a"), signal("d")]
    ),
    /permission denied/
  );
  const gift = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_karas) values($1,$2,1) returning id",
      [primary, ipOnly]
    )
  ).rows[0].id;
  assert.equal(await accept(gift, ipOnly), "accepted");
  assert.equal(await restriction(ipOnly), "none");
  await db.query(
    "update public.user_profiles set karas_balance=100 where user_id in ($1,$2)",
    [primary, ipOnly]
  );
  const ordinary = await makeOffer(primary, ipOnly);
  assert.equal(await accept(ordinary, ipOnly), "accepted");
  assert.equal(
    (
      await db.query(
        "select count(*)::int as total from public.account_sanctions"
      )
    ).rows[0].total,
    0
  );
  assert.equal(
    await accept(await makeOffer(primary, browserOnly), browserOnly),
    "accepted"
  );
  // Missing or expired IP/browser pairs cannot activate either enforcement path.
  await db.query(
    "select public.record_anticheat_trade_connection($1,null,$2)",
    [browserOnly, signal("b")]
  );
  assert.equal(
    await accept(await makeOffer(primary, browserOnly), browserOnly),
    "accepted"
  );
  await db.query(
    "update public.anticheat_trade_connections set network_identity=$1, observed_at=now()-interval '8 days' where user_id=$2",
    [signal("a"), browserOnly]
  );
  assert.equal(
    await accept(await makeOffer(primary, browserOnly), browserOnly),
    "accepted"
  );
  assert.equal(await restriction(browserOnly), "none");
  assert.equal(
    await accept(await makeOffer(primary, sameAge), sameAge),
    "quarantined"
  );
  assert.equal(await restriction(sameAge), "none");
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='automatic_decisions_paused'"
  );
  const paused = await makeOffer(primary, first);
  assert.equal(await accept(paused, first), "accepted");
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=false where flag='automatic_decisions_paused'"
  );

  const offer = await makeOffer(primary, first, [card]);
  await assert.rejects(accept(offer, ipOnly), /TRADE_NOT_PENDING/);
  assert.equal(await accept(offer, first), "cancelled");
  assert.equal(await status(offer), "cancelled");
  assert.equal(await restriction(first), "ban");
  assert.equal(await restriction(primary), "none");
  await assert.rejects(accept(offer, first), /ACCOUNT_BANNED/);
  assert.deepEqual(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        card
      ])
    ).rows,
    [{ user_id: primary }]
  );
  assert.deepEqual(
    (await db.query("select distinct karas_balance from public.user_profiles"))
      .rows,
    [{ karas_balance: 100 }]
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as total from auth.sessions where user_id=$1",
        [first]
      )
    ).rows[0].total,
    0
  );
  assert.deepEqual(
    (
      await db.query(
        "select status,reason_codes from public.anticheat_quarantines where subject_id=$1",
        [offer]
      )
    ).rows,
    [
      {
        status: "CANCELLED",
        reason_codes: ["SHARED_NETWORK_AND_BROWSER_TRADE_SANCTION"]
      }
    ]
  );
  const alerts = (
    await db.query(
      "select o.payload from public.anticheat_discord_outbox o join public.anticheat_events e on e.id=o.event_id where e.metadata->>'trade'=$1",
      [offer]
    )
  ).rows;
  assert.equal(alerts.length, 2);
  for (const { payload } of alerts) {
    assert.deepEqual(payload.allowed_mentions.parse, []);
    const embed = payload.embeds[0];
    assert.match(embed.description, /Échange annulé/);
    assert.match(embed.fields[0].value, /TradePlayer0/);
    assert.match(embed.fields[1].value, /TradePlayer1/);
  }

  for (const secondary of [second, third]) {
    const reversed = await makeOffer(secondary, primary);
    assert.equal(await accept(reversed, primary, "respond_trade_offer"), false);
    assert.equal(await status(reversed), "cancelled");
    assert.equal(await restriction(secondary), "ban");
  }
  assert.equal(await restriction(primary), "none");
  const repeated = await makeOffer(fourth, primary);
  assert.equal(await accept(repeated, primary), "cancelled");
  assert.equal(await restriction(primary), "suspension");
  assert.equal(await restriction(fourth), "ban");
  assert.deepEqual(
    (
      await db.query(
        "select extract(epoch from ends_at-applied_at)::int as seconds from public.anticheat_farm_suspensions where user_id=$1",
        [primary]
      )
    ).rows,
    [{ seconds: 172800 }]
  );

  // An upheld correction clears the exact live restriction and keeps the record.
  const admin = "ad520000-0000-4000-8000-000000000009";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [admin, JSON.stringify({ pseudo: "TradeAdmin" })]
  );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  const receipt = async (user, type) =>
    (
      await db.query(
        "select id from public.account_sanctions where user_id=$1 and sanction_type=$2 order by applied_at limit 1",
        [user, type]
      )
    ).rows[0].id;
  async function requestCorrection(user, type) {
    const id = await receipt(user, type);
    const appeal = (
      await db.query(
        "insert into public.anticheat_sanction_appeals(receipt_kind,receipt_id,user_id,reason) values('ACCOUNT',$1,$2,'Test appeal for review') returning id",
        [id, user]
      )
    ).rows[0].id;
    await asUser(
      admin,
      "select public.admin_review_anticheat_appeal($1,'CORRECTION_REQUIRED','Test correction requested') as result",
      [appeal]
    );
    return appeal;
  }
  const warningAppeal = await requestCorrection(
    primary,
    "SHARED_TRADE_WARNING"
  );
  assert.equal(
    await asUser(
      admin,
      "select public.admin_void_anticheat_warning($1,'Test warning corrected') as result",
      [warningAppeal]
    ),
    true
  );
  assert.equal(await restriction(primary), "none");
  const banAppeal = await requestCorrection(first, "SHARED_TRADE_BAN");
  assert.equal(
    await asUser(
      admin,
      "select public.admin_restore_anticheat_restriction($1,'Test restriction corrected') as result",
      [banAppeal]
    ),
    true
  );
  assert.equal(await restriction(first), "none");
});
