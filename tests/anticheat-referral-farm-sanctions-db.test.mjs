import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("two recent referrals on one IP trigger sanctions regardless of browser or sponsor IP", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`
    alter table auth.users add column banned_until timestamptz, add column updated_at timestamptz;
    create table auth.sessions(user_id uuid);
    update public.anticheat_runtime_flags set enabled=true where flag='discord_alerts_v2';
  `);
  let nextId = 0;
  const ip = code => `v1:${code.repeat(64)}`;
  const makeUser = async pseudo => {
    const id = `ac520000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;
    await db.query(
      "insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values($1,now(),$2)",
      [id, JSON.stringify({ pseudo })]
    );
    await db.query("insert into auth.sessions values($1)", [id]);
    return id;
  };
  const observe = (user, hash) =>
    db.query("select public.record_anticheat_network_observation($1,$2)", [
      user,
      ip(hash)
    ]);
  const makeSponsor = async (pseudo, code) => {
    const user = await makeUser(pseudo);
    const { rows } = await db.query(
      "insert into public.referral_codes(user_id,code) values($1,$2) returning id",
      [user, code.repeat(12)]
    );
    return { user, code: rows[0].id };
  };
  const invite = async (sponsor, pseudo, hash) => {
    const user = await makeUser(pseudo);
    const { rows } = await db.query(
      "insert into public.referrals(code_id,referrer_id,referred_id) values($1,$2,$3) returning id",
      [sponsor.code, sponsor.user, user]
    );
    if (hash) await observe(user, hash);
    return { user, referral: rows[0].id };
  };
  const verify = child =>
    db.query("select public.complete_referral_after_verification($1,now())", [
      child.user
    ]);
  const worker = async () =>
    (await db.query("select public.run_anticheat_referral_farms() as total"))
      .rows[0].total;
  const bonus = async user =>
    (
      await db.query(
        "select bonus_regular_packs from public.user_profiles where user_id=$1",
        [user]
      )
    ).rows[0].bonus_regular_packs;
  const restriction = async user =>
    (
      await db.query(
        "select case when banned_until='infinity' then 'ban' when banned_until>now() then 'suspension' else 'none' end as state from auth.users where id=$1",
        [user]
      )
    ).rows[0].state;
  const assetWorker = async () =>
    (
      await db.query(
        "select public.run_anticheat_referral_asset_recovery() as total"
      )
    ).rows[0].total;

  const sponsor = await makeSponsor("ReferralSponsor", "a");
  const unrelated = await makeSponsor("OtherSponsor", "b");
  await observe(sponsor.user, "f");
  const first = await invite(sponsor, "SharedFirst", "a");
  await verify(first);
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='referral_farm_sanctions'"
  );
  const separate = await invite(sponsor, "DifferentIP", "b");
  await verify(separate);
  const other = await invite(unrelated, "OtherChild", "a");
  await verify(other);
  assert.equal(await worker(), 0);
  assert.equal(await bonus(sponsor.user), 10);
  assert.equal(await bonus(unrelated.user), 5);

  const buyer = await makeUser("HonestBuyer");
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [sponsor.user, buyer]
  );
  await db.query(
    "update public.user_profiles set karas_balance=1000 where user_id=$1",
    [buyer]
  );
  const { rows: catalog } = await db.query(
    "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('test','referral','ReferralCard','Test','Test','LR','https://example.invalid/card.png') returning id"
  );
  const catalogId = catalog[0].id;
  const { rows: openings } = await db.query(
    `
    insert into public.regular_pack_openings(opened_by,source,referral_reward_lot_id,referral_id,
      source_referrer_id,source_referred_id,beneficiary_role)
    select beneficiary_id,'referral_reward',id,referral_id,referrer_id,referred_id,beneficiary_role
    from public.referral_pack_reward_lots where referral_id=$1 and beneficiary_role='referrer' returning id
  `,
    [first.referral]
  );
  const makeCard = async (tracked = true) => {
    const { rows } = await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'LR') returning id",
      [sponsor.user, catalogId]
    );
    const card = rows[0].id;
    if (tracked)
      await db.query(
        "insert into public.regular_pack_opening_cards(card_instance_id,pack_opening_id,card_id,original_owner_id) values($1,$2,$3,$4)",
        [card, openings[0].id, catalogId, sponsor.user]
      );
    return card;
  };
  const kept = await makeCard();
  const sold = await makeCard();
  const active = await makeCard();
  const lateSale = await makeCard();
  const mixed = [await makeCard(), await makeCard(), await makeCard(false)];
  const onlyFraud = [await makeCard(), await makeCard()];
  const free = await makeCard();
  const legitimate = await makeCard(false);
  async function trade(cardIds, requested, offered = 0, reverse = false) {
    const { rows } = await db.query(
      `
      insert into public.trade_offers(from_user,to_user,offered_card_ids,requested_card_ids,offered_karas,requested_karas)
      values($1,$2,$3,$4,$5,$6) returning id
    `,
      reverse
        ? [buyer, sponsor.user, [], cardIds, requested, offered]
        : [sponsor.user, buyer, cardIds, [], offered, requested]
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      reverse ? sponsor.user : buyer
    ]);
    try {
      const { rows: response } = await db.query(
        "select public.respond_trade_offer($1,'accept') as accepted",
        [rows[0].id]
      );
      assert.equal(response[0].accepted, true);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    return rows[0].id;
  }
  await db.query(
    "update public.user_profiles set karas_balance=20 where user_id=$1",
    [sponsor.user]
  );
  const mixedId = await trade(mixed, 121, 20);
  const pureId = await trade(onlyFraud, 70, 0, true);
  await trade([free], 0);
  await db.query(
    `
    insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at)
    values($1,$2,$3,10,50,15,now()-interval '1 minute'),($4,$2,null,10,10,15,now()+interval '1 day'),
      ($5,$2,$3,10,40,15,now()+interval '1 day')
  `,
    [sold, sponsor.user, buyer, active, lateSale]
  );
  await db.exec("select public.settle_expired_auctions()");

  await observe(sponsor.user, "a");
  const second = await invite(sponsor, "SharedSecond", "a");
  await db.query("select public.record_anticheat_device_observation($1,$2)", [
    first.user,
    ip("c")
  ]);
  await db.query("select public.record_anticheat_device_observation($1,$2)", [
    second.user,
    ip("d")
  ]);
  await verify(second);
  assert.equal(await bonus(sponsor.user), 10);
  assert.equal(await bonus(second.user), 0);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.anticheat_referral_reward_holds where referral_id=$1",
        [second.referral]
      )
    ).rows[0].count,
    1
  );
  // Simulate consumption of two attributable packs before the second signup.
  await db.query(
    "update public.referral_pack_reward_lots set remaining_packs=3 where referral_id=$1 and beneficiary_role='referrer'",
    [first.referral]
  );
  await db.query(
    "update public.user_profiles set bonus_regular_packs=8 where user_id=$1",
    [sponsor.user]
  );
  assert.equal(await worker(), 2);
  assert.equal(await bonus(sponsor.user), 5);
  assert.equal(await bonus(first.user), 0);
  assert.equal(await bonus(second.user), 0);
  assert.equal(await bonus(separate.user), 5);
  assert.equal(await bonus(other.user), 5);
  assert.equal(await restriction(first.user), "ban");
  assert.equal(await restriction(second.user), "ban");
  assert.equal(await restriction(sponsor.user), "none");
  assert.equal(await restriction(separate.user), "none");
  assert.equal(await restriction(other.user), "none");
  assert.equal(await assetWorker(), 1);
  assert.equal(await assetWorker(), 0);
  const { rows: recoveries } = await db.query(`
    select asset_kind,sum(recovered_karas)::int as karas,count(*)::int as instances
    from public.anticheat_asset_recoveries group by asset_kind order by asset_kind
  `);
  assert.deepEqual(recoveries, [
    { asset_kind: "CARD", karas: 0, instances: 1 },
    { asset_kind: "SALE", karas: 50, instances: 1 },
    { asset_kind: "TRADE", karas: 150, instances: 4 }
  ]);
  const tradeDebit = async id =>
    (
      await db.query(
        "select sum(recovered_karas)::int as debit from public.anticheat_asset_recoveries where source_trade_id=$1",
        [id]
      )
    ).rows[0].debit;
  assert.equal(await tradeDebit(mixedId), 80);
  assert.equal(await tradeDebit(pureId), 70);
  const owner = async id =>
    (await db.query("select user_id from public.user_cards where id=$1", [id]))
      .rows[0]?.user_id;
  assert.equal(await owner(kept), undefined);
  assert.equal(await owner(legitimate), sponsor.user);
  assert.equal(await owner(active), sponsor.user);
  assert.equal(await owner(lateSale), sponsor.user);
  for (const id of [sold, ...mixed, ...onlyFraud, free])
    assert.equal(await owner(id), buyer);
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [sponsor.user]
      )
    ).rows[0].karas_balance,
    41
  );
  await db.query(
    "update public.auctions set status='expired' where card_instance_id=$1",
    [active]
  );
  await db.query(
    "update public.auctions set ends_at=now()-interval '1 minute' where card_instance_id=$1",
    [lateSale]
  );
  await db.exec("select public.settle_expired_auctions()");
  await db.query(
    "update public.user_profiles set karas_balance=6 where user_id=$1",
    [sponsor.user]
  );
  await db.exec(
    "update public.anticheat_referral_asset_queue set next_check_at=now()"
  );
  assert.equal(await assetWorker(), 1);
  assert.equal(await owner(active), undefined);
  assert.equal(await owner(lateSale), buyer);
  assert.deepEqual(
    (
      await db.query(
        "select recovered_karas,unrecovered_karas from public.anticheat_asset_recoveries where card_instance_id=$1",
        [lateSale]
      )
    ).rows,
    [{ recovered_karas: 6, unrecovered_karas: 34 }]
  );
  assert.equal(await assetWorker(), 0);
  await verify(second);
  await observe(second.user, "a");
  assert.equal(await worker(), 0);
  assert.equal(await bonus(sponsor.user), 5);
  const { rows: alerts } = await db.query(
    `
    select o.payload from public.anticheat_discord_outbox o
    join public.anticheat_events e on e.id=o.event_id
    where e.event_type='referral_network_enforcement' and e.actor_user_id=$1
  `,
    [sponsor.user]
  );
  assert.equal(alerts.length, 1);
  const embed = alerts[0].payload.embeds[0];
  assert.match(embed.title, /IP commune/);
  assert.match(
    embed.fields.find(field => field.name.startsWith("Filleuls")).value,
    /SharedFirst.*SharedSecond/
  );
  assert.match(
    embed.fields.find(field => field.name === "Packs bonus").value,
    /5 bloqués.*3 packs non ouverts retirés/
  );
  assert.ok(!JSON.stringify(alerts).includes(ip("a")));
  const { rows: recoveryAlerts } = await db.query(
    `
    select o.payload from public.anticheat_discord_outbox o
    join public.anticheat_events e on e.id=o.event_id
    where e.metadata->>'category'='REFERRAL_ASSET_RECOVERY' and e.actor_user_id=$1
    order by e.id
  `,
    [sponsor.user]
  );
  assert.deepEqual(
    recoveryAlerts.map(({ payload }) =>
      payload.embeds[0].fields.slice(1).map(field => field.value)
    ),
    [
      ["1", "200", "0"],
      ["1", "6", "34"]
    ]
  );
  assert.equal(
    (
      await db.query(
        `
    select count(*)::int as count from public.anticheat_discord_outbox o
    join public.anticheat_events e on e.id=o.event_id
    where e.event_type='anticheat_operational_alert' and e.actor_user_id=any($1::uuid[])
        and e.metadata->>'category'<>'REFERRAL_ASSET_RECOVERY'
  `,
        [[sponsor.user, first.user, second.user]]
      )
    ).rows[0].count,
    3
  );

  for (let repeat = 1; repeat <= 3; repeat++) {
    const child = await invite(sponsor, `RepeatChild${repeat}`, "a");
    await verify(child);
    assert.equal(await worker(), 1);
    assert.equal(await restriction(child.user), "ban");
    assert.equal(
      await restriction(sponsor.user),
      repeat === 3 ? "suspension" : "none"
    );
  }
  assert.equal(
    (
      await db.query(
        "select extract(epoch from ends_at-applied_at)::int as seconds from public.anticheat_farm_suspensions where user_id=$1",
        [sponsor.user]
      )
    ).rows[0].seconds,
    172800
  );

  // Verification can happen before either browser has sent the IP observation.
  const late = await invite(unrelated, "LateObservation");
  await verify(late);
  assert.equal(await bonus(unrelated.user), 10);
  assert.equal(await worker(), 0);
  await observe(late.user, "a");
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='automatic_decisions_paused'"
  );
  assert.equal(await worker(), 0);
  assert.equal(await restriction(other.user), "none");
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=false where flag='automatic_decisions_paused'"
  );
  assert.equal(await worker(), 2);
  assert.equal(await bonus(unrelated.user), 0);
  assert.equal(await restriction(other.user), "ban");
  assert.equal(await restriction(late.user), "ban");
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.anticheat_farm_warnings where user_id=$1",
        [unrelated.user]
      )
    ).rows[0].count,
    0
  );
});
