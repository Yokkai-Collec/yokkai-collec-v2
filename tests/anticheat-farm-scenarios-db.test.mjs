import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("farm scenarios corroborate independent evidence and keep third-party cards protected", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column created_at timestamptz not null default now()"
  );
  const create = async (sql, params = []) =>
    (await db.query(sql, params)).rows[0]?.id;
  const accounts = Array.from(
    { length: 14 },
    (_, i) => `ad540000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
  );
  for (const [index, id] of accounts.entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo: `FarmPhaseThree${index}` })]
    );
  const [admin, outsider] = accounts.slice(12);
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  const catalog = await create(
    "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('test','farm-phase3','Farm','Test','Test','LR','https://example.invalid/card.png') returning id"
  );
  const cohort = async (start, hex) => {
    const members = accounts.slice(start, start + 4);
    for (const user of members)
      await db.query(
        "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2)",
        [`v1:${hex.repeat(64)}`, user]
      );
    return members;
  };
  const proof = async members =>
    (
      await db.query(
        "select public.anticheat_additional_farm_scenarios($1) as result",
        [members]
      )
    ).rows[0].result;
  const open = async (user, source = "timed", reward = null) => {
    const pack = reward
      ? await create(
          "insert into public.regular_pack_openings(opened_by,source,referral_id,referral_reward_lot_id,beneficiary_role) values($1,$2,$3,$4,'referred') returning id",
          [user, source, reward.id, reward.lot]
        )
      : await create(
          "insert into public.regular_pack_openings(opened_by,source) values($1,$2) returning id",
          [user, source]
        );
    const card = await create(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'LR') returning id",
      [user, catalog]
    );
    await db.query(
      "insert into public.regular_pack_opening_cards(card_instance_id,pack_opening_id,card_id,original_owner_id) values($1,$2,$3,$4)",
      [card, pack, catalog, user]
    );
    return card;
  };
  const friend = async (from, to) =>
    db.query(
      "insert into public.friendships(user_id,friend_id,status) values(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),'accepted') on conflict do nothing",
      [from, to]
    );
  const gift = async (from, to, card) => {
    await friend(from, to);
    const offer = await create(
      "insert into public.trade_offers(from_user,to_user,offered_card_ids) values($1,$2,array[$3::uuid]) returning id",
      [from, to, card]
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [to]);
    try {
      assert.equal(
        (
          await db.query(
            "select public.respond_trade_offer($1,'accept') as ok",
            [offer]
          )
        ).rows[0].ok,
        true
      );
    } finally {
      await db.exec("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const sale = async (seller, buyer, card, price) => {
    const auction = await create(
      "insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at,status) values($1,$2,$3,10,$4,15,now(),'sold') returning id",
      [card, seller, buyer, price]
    );
    await db.query("update public.user_cards set user_id=$1 where id=$2", [
      buyer,
      card
    ]);
    return auction;
  };

  const timed = await cohort(0, "a");
  assert.deepEqual(
    await proof(timed),
    {},
    "four shared-network accounts are not sufficient"
  );
  for (const donor of timed.slice(1))
    await gift(donor, timed[0], await open(donor));
  assert.deepEqual(
    await proof(timed),
    {},
    "one gift per donor is not sufficient"
  );
  for (const donor of timed.slice(1))
    await gift(donor, timed[0], await open(donor));
  const resultB = await proof(timed);
  assert.equal(resultB.B.decision, "ECONOMICALLY_CONFIRMED");
  assert.equal(resultB.B.cards, 6);
  assert.equal(resultB.C, undefined);

  const referrals = await cohort(4, "b");
  const code =
    (
      await db.query("select id from public.referral_codes where user_id=$1", [
        referrals[0]
      ])
    ).rows[0]?.id ??
    (await create(
      "insert into public.referral_codes(user_id,code) values($1,'222222222222') returning id",
      [referrals[0]]
    ));
  let resaleCard;
  for (const donor of referrals.slice(1)) {
    const id = await create(
      "insert into public.referrals(code_id,referrer_id,referred_id) values($1,$2,$3) returning id",
      [code, referrals[0], donor]
    );
    await db.query(
      "update public.referrals set verified_at=now(),rewarded_at=now() where id=$1",
      [id]
    );
    const lot = (
      await db.query(
        "select id from public.referral_pack_reward_lots where referral_id=$1 and beneficiary_role='referred'",
        [id]
      )
    ).rows[0].id;
    await db.query(
      "update public.referral_pack_reward_lots set remaining_packs=3 where id=$1",
      [lot]
    );
    const firstCard = await open(donor, "referral_reward", { id, lot });
    resaleCard ??= firstCard;
    await open(donor, "referral_reward", { id, lot });
  }
  assert.deepEqual(
    await proof(referrals),
    {},
    "affiliation consumption without additional coordination is insufficient"
  );
  for (const donor of referrals.slice(1))
    await db.query(
      "insert into public.anticheat_device_observations(device_identity,user_id) values($1,$2)",
      [`v1:${"f".repeat(64)}`, donor]
    );
  assert.equal((await proof(referrals)).C.decision, "ECONOMICALLY_CONFIRMED");
  const sold = await sale(referrals[1], outsider, resaleCard, 777);
  await db.query(
    "update public.user_profiles set karas_balance=300 where user_id=$1",
    [referrals[1]]
  );
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag in('ip_cluster_detection','cluster_investigation','graph_detection_v2'); select public.evaluate_anticheat_network_clusters(); select public.evaluate_anticheat_farm_evidence();"
  );
  const cluster = (
    await db.query(
      "select cluster_id from public.anticheat_farm_evidence where beneficiary_id=$1",
      [referrals[0]]
    )
  ).rows[0].cluster_id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin
  ]);
  const preview = (
    await db.query(
      "select public.admin_preview_anticheat_farm_recovery($1) as result",
      [cluster]
    )
  ).rows[0].result;
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  assert.equal(preview.protectedCards, 1);
  assert.equal(preview.availableCards, 5);
  assert.equal(preview.unusedPacks, 24);
  assert.equal(preview.creditedKaras, 777);
  assert.equal(preview.possibleKaras, 300);
  assert.equal(preview.sales[0].id, sold);
  assert.equal(
    preview.cards.find(card => card.card_instance_id === resaleCard).holder,
    outsider
  );
  const recoverable = preview.referredLots.find(
    lot => lot.owner === referrals[1]
  );
  assert.equal(recoverable.packs, 3);
  assert.equal(preview.recoveryEnabled, false);
  const version = (
    await db.query(
      "select public.anticheat_farm_evidence_version(f) as version from public.anticheat_farm_evidence f where cluster_id=$1",
      [cluster]
    )
  ).rows[0].version;
  const adminQuery = async (sql, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin
    ]);
    try {
      return (await db.query(sql, params)).rows[0]?.result;
    } finally {
      await db.exec("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const recover = () =>
    adminQuery(
      "select public.admin_recover_anticheat_unused_reward_lot($1,$2,$3,3,'Verified reward lot provenance') as result",
      [cluster, version, recoverable.id]
    );
  await assert.rejects(recover(), /ADVANCED_RECOVERY_DISABLED/);
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='advanced_recovery'"
  );
  await assert.rejects(recover(), /FARM_EVIDENCE_CHANGED/);
  await adminQuery(
    "select public.admin_review_anticheat_farm($1,$2,'CONFIRMED','Verified fixture evidence') as result",
    [cluster, version]
  );
  await assert.rejects(recover(), /PACK_BALANCE_UNRECONCILED/);
  await db.query(
    "update public.user_profiles set bonus_regular_packs=3 where user_id=$1",
    [referrals[1]]
  );
  await db.exec(`create function public.reject_fixture_recovery() returns trigger language plpgsql as $$
    begin raise exception 'FIXTURE_RECOVERY_FAILURE'; end; $$;
    create trigger reject_fixture_recovery before insert on public.anticheat_reward_pack_recoveries
      for each row execute function public.reject_fixture_recovery();`);
  const remaining = async () =>
    (
      await db.query(
        "select l.remaining_packs,p.bonus_regular_packs from public.referral_pack_reward_lots l join public.user_profiles p on p.user_id=l.beneficiary_id where l.id=$1",
        [recoverable.id]
      )
    ).rows[0];
  await assert.rejects(recover(), /FIXTURE_RECOVERY_FAILURE/);
  assert.deepEqual(await remaining(), {
    remaining_packs: 3,
    bonus_regular_packs: 3
  });
  await db.exec(
    "drop trigger reject_fixture_recovery on public.anticheat_reward_pack_recoveries; drop function public.reject_fixture_recovery()"
  );
  assert.equal(await recover(), 3);
  assert.equal(await recover(), 3);
  assert.deepEqual(await remaining(), {
    remaining_packs: 0,
    bonus_regular_packs: 0
  });
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        resaleCard
      ])
    ).rows[0].user_id,
    outsider
  );

  const karas = await cohort(8, "c");
  for (const donor of karas.slice(1)) {
    await friend(donor, karas[0]);
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_karas,status) select $1,$2,400,'accepted' from generate_series(1,3)",
      [donor, karas[0]]
    );
  }
  const resultD = await proof(karas);
  assert.equal(resultD.D.netKaras, 3600);
  assert.equal(
    resultD.D.decision,
    "INVESTIGATE",
    "fragmentation by itself is insufficient"
  );
  const cycleCard = await open(karas[0]);
  const cycledSale = await sale(karas[0], karas[1], cycleCard, 700);
  for (const bidder of karas.slice(1, 3))
    await db.query(
      "insert into public.bids(auction_id,bidder_id,amount) values($1,$2,700)",
      [cycledSale, bidder]
    );
  await gift(karas[1], karas[0], cycleCard);
  const corroboratedD = await proof(karas);
  assert.equal(corroboratedD.D.decision, "ECONOMICALLY_CONFIRMED");
  assert.equal(corroboratedD.D.auctions[0].auction, cycledSale);
});
