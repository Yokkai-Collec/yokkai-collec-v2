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

  // Combine A and C with direct gift paths and affirmative participation by
  // the beneficiary. C alone must remain non-punitive.
  assert.equal(
    (
      await adminQuery(
        "select public.admin_simulate_anticheat_farm($1) as result",
        [cluster]
      )
    ).decision,
    "CORROBORATED"
  );
  await db.exec(
    "alter table auth.users add column banned_until timestamptz,add column updated_at timestamptz;create table auth.sessions(user_id uuid)"
  );
  let cardToRecover;
  for (const donor of referrals.slice(1)) {
    await friend(donor, referrals[0]);
    const heldCards = (
      await db.query(
        `select u.id from public.user_cards u join public.regular_pack_opening_cards pc on pc.card_instance_id=u.id
      where u.user_id=$1 and pc.original_owner_id=$1 order by u.id`,
        [donor]
      )
    ).rows;
    if (heldCards.length === 2)
      cardToRecover = { id: heldCards[1].id, owner: donor };
    const request = await create(
      "insert into public.trade_offers(from_user,to_user,requested_card_ids) values($1,$2,array[$3::uuid]) returning id",
      [referrals[0], donor, heldCards[0].id]
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      donor
    ]);
    await db.query("select public.respond_trade_offer($1,'accept')", [request]);
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
    await db.query("insert into auth.sessions(user_id) values($1)", [donor]);
  }
  const pending = await create(
    "insert into public.trade_offers(from_user,to_user,offered_karas) values($1,$2,10) returning id",
    [referrals[1], referrals[0]]
  );
  await db.exec(
    "update public.anticheat_network_clusters set evaluated_at=clock_timestamp();select public.evaluate_anticheat_farm_evidence()"
  );
  const dry = await adminQuery(
    "select public.admin_simulate_anticheat_farm($1) as result",
    [cluster]
  );
  assert.equal(dry.decision, "CORROBORATED");
  assert.deepEqual(dry.secondaries, referrals.slice(1));
  assert.equal(dry.principalInvolved, true);
  assert.ok(dry.recovery.attributedCards > 0);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer count from auth.users where banned_until>now()"
      )
    ).rows[0].count,
    0
  );
  for (const [index, oldDonors] of [
    timed.slice(1),
    accounts.slice(9, 12)
  ].entries()) {
    const oldCase = await create("select gen_random_uuid() as id");
    const oldReceipt = await create(
      `insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
      cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status)
      values($1,$2,'AFFILIATE_ABUSE_WARNING','AFFILIATE_ABUSE','NONE','NONE',0,0,0,0,now(),now(),'APPLIED') returning id`,
      [`previous-warning-fixture-${index}`, referrals[0]]
    );
    await db.query(
      "insert into public.anticheat_farm_warnings values($1,$2,$3,$4,'fixture')",
      [oldCase, referrals[0], oldReceipt, oldDonors]
    );
  }
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag in('farm_policy_v1','auto_farm_ban','auto_farm_warning','auto_farm_suspension','discord_alerts_v2')"
  );
  await db.exec(`create function public.fail_fixture_farm_run() returns trigger language plpgsql as
    $$ begin raise exception 'FIXTURE_FARM_FAILURE'; end; $$;
    create trigger fail_fixture_farm_run before insert on public.anticheat_farm_runs
      for each row when (new.mode='APPLY') execute function public.fail_fixture_farm_run();`);
  assert.ok(
    (await db.query("select public.run_anticheat_farm_policy() as count"))
      .rows[0].count > 0
  );
  assert.equal(
    (
      await db.query(
        "select last_error from public.anticheat_farm_job_progress where cluster_id=$1",
        [cluster]
      )
    ).rows[0].last_error,
    "P0001"
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer count from auth.users where banned_until>now()"
      )
    ).rows[0].count,
    0
  );
  assert.equal(
    (await db.query("select count(*)::integer count from auth.sessions"))
      .rows[0].count,
    3
  );
  await db.exec(`drop trigger fail_fixture_farm_run on public.anticheat_farm_runs;
    drop function public.fail_fixture_farm_run();
    update public.anticheat_farm_job_progress set checked_at=now()-interval '6 minutes';`);
  assert.ok(
    (await db.query("select public.run_anticheat_farm_policy() as count"))
      .rows[0].count > 0
  );
  assert.deepEqual(
    (
      await db.query(
        "select last_error,retries from public.anticheat_farm_job_progress where cluster_id=$1",
        [cluster]
      )
    ).rows[0],
    { last_error: null, retries: 1 }
  );
  const applied = (
    await db.query(
      "select snapshot from public.anticheat_farm_runs where cluster_id=$1 and mode='APPLY'",
      [cluster]
    )
  ).rows[0].snapshot;
  assert.equal(applied.decision, "CONFIRMED");
  assert.equal(applied.bansApplied, 3);
  assert.equal(
    (
      await db.query(
        "select public.apply_anticheat_farm_policy($1) as result",
        [cluster]
      )
    ).rows[0].result.bansApplied,
    0
  );
  const alerts = (
    await db.query(`select e.metadata->>'category' category, o.payload
    from public.anticheat_events e join public.anticheat_discord_outbox o on o.event_id=e.id
    where e.event_type='anticheat_operational_alert' order by category`)
  ).rows;
  assert.deepEqual(
    alerts.map(alert => alert.category),
    [
      "ENFORCEMENT_JOB_FAILURE",
      "FARM_BAN",
      "FARM_BAN",
      "FARM_BAN",
      "FARM_CONFIRMED",
      "FARM_SUSPENSION",
      "FARM_WARNING"
    ]
  );
  for (const alert of alerts) {
    assert.deepEqual(alert.payload.allowed_mentions, { parse: [] });
    assert.doesNotMatch(
      JSON.stringify(alert.payload),
      new RegExp(alert.category)
    );
    assert.match(
      alert.payload.embeds[0].fields[0].value,
      /\(https:\/\/yokkai-collec\.com\/profile\/[0-9a-f-]{36}\)/
    );
  }
  const confirmedAlert = alerts.find(
    alert => alert.category === "FARM_CONFIRMED"
  ).payload.embeds[0];
  assert.equal(confirmedAlert.title, "Yokkai · Ferme de comptes confirmée");
  assert.match(confirmedAlert.url, new RegExp(cluster));
  assert.match(
    confirmedAlert.fields[1].name,
    /Comptes secondaires impliqués \(3\)/
  );
  const banAlert = alerts.find(alert => alert.category === "FARM_BAN").payload
    .embeds[0];
  assert.equal(banAlert.title, "Yokkai · Bannissement définitif appliqué");
  assert.equal(banAlert.fields[0].name, "Compte secondaire banni");
  assert.equal(banAlert.fields[1].name, "Bénéficiaire du dossier");
  assert.equal(
    (await db.query("select count(*)::integer count from auth.sessions"))
      .rows[0].count,
    0
  );
  assert.equal(
    (
      await db.query("select status from public.trade_offers where id=$1", [
        pending
      ])
    ).rows[0].status,
    "cancelled"
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer count from public.anticheat_farm_suspensions"
      )
    ).rows[0].count,
    1
  );
  assert.equal(
    (
      await db.query("select banned_until from auth.users where id=$1", [
        outsider
      ])
    ).rows[0].banned_until,
    null
  );

  const previewAsset = (kind, asset) =>
    adminQuery(
      "select public.admin_preview_anticheat_asset_recovery($1,$2,$3) as result",
      [cluster, kind, asset]
    );
  const applyAsset = (kind, asset, token) =>
    adminQuery(
      "select public.admin_apply_anticheat_asset_recovery($1,$2,$3,$4,'Verified exact fixture asset') as result",
      [cluster, kind, asset, token]
    );
  const salePlan = await previewAsset("SALE", sold);
  assert.equal(salePlan.protectedHolder, true);
  assert.equal(salePlan.recoverable, 300);
  assert.equal(salePlan.unrecoverable, 477);
  await db.query(
    "update public.user_profiles set karas_balance=299 where user_id=$1",
    [referrals[1]]
  );
  await assert.rejects(
    applyAsset("SALE", sold, salePlan.token),
    /RECOVERY_PREVIEW_CHANGED/
  );
  await db.query(
    "update public.user_profiles set karas_balance=300 where user_id=$1",
    [referrals[1]]
  );
  const saleRecovery = await applyAsset("SALE", sold, salePlan.token);
  assert.equal(await applyAsset("SALE", sold, salePlan.token), saleRecovery);
  assert.equal((await previewAsset("CARD", resaleCard)).eligible, false);
  const cardPlan = await previewAsset("CARD", cardToRecover.id);
  assert.equal(cardPlan.eligible, true);
  const cardRecovery = await applyAsset(
    "CARD",
    cardToRecover.id,
    cardPlan.token
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        cardToRecover.id
      ])
    ).rows.length,
    0
  );

  const appealFor = async receipt => {
    const token = await adminQuery(
      "select public.admin_issue_anticheat_appeal_token($1,'Verified account identity in fixture') as result",
      [receipt]
    );
    await db.exec("set role anon");
    try {
      const claimed = (
        await db.query(
          "select public.consume_anticheat_appeal_token($1,'This restriction should be reviewed') as result",
          [token]
        )
      ).rows[0].result;
      assert.equal(claimed.status, "PENDING");
      await assert.rejects(
        db.query("select public.consume_anticheat_appeal_token($1,null)", [
          token
        ]),
        /INVALID_APPEAL_TOKEN/
      );
    } finally {
      await db.exec("reset role");
    }
    const appeal = (
      await db.query(
        "select id from public.anticheat_sanction_appeals where receipt_id=$1",
        [receipt]
      )
    ).rows[0].id;
    await adminQuery(
      "select public.admin_review_anticheat_appeal($1,'CORRECTION_REQUIRED','Fixture correction approved') as result",
      [appeal]
    );
    return appeal;
  };
  const donorReceipt = async user =>
    (
      await db.query(
        "select receipt_id from public.anticheat_farm_bans where user_id=$1",
        [user]
      )
    ).rows[0].receipt_id;
  const saleAppeal = await appealFor(await donorReceipt(referrals[1]));
  assert.equal(
    await adminQuery(
      "select public.admin_restore_anticheat_restriction($1,'Correct this fixture ban') as result",
      [saleAppeal]
    ),
    true
  );
  const cardAppeal = await appealFor(await donorReceipt(cardToRecover.owner));
  const compensate = (appeal, kind, recovery) =>
    adminQuery(
      "select public.admin_compensate_anticheat_recovery($1,$2,$3,'Restore exact recorded asset') as result",
      [appeal, kind, recovery]
    );
  await assert.rejects(
    compensate(saleAppeal, "SALE", saleRecovery),
    /COMPENSATION_DISABLED/
  );
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='farm_compensation'"
  );
  const refund = await compensate(saleAppeal, "SALE", saleRecovery);
  assert.equal(await compensate(saleAppeal, "SALE", saleRecovery), refund);
  await compensate(saleAppeal, "PACK", recoverable.id);
  await db.query(
    "insert into public.user_cards(id,user_id,card_id,rarity) values($1,$2,$3,'LR')",
    [cardToRecover.id, outsider, catalog]
  );
  const proposed = await compensate(cardAppeal, "CARD", cardRecovery);
  assert.equal(await compensate(cardAppeal, "CARD", cardRecovery), proposed);
  assert.equal(
    (
      await db.query(
        "select amount from public.anticheat_compensation_proposals where id=$1",
        [proposed]
      )
    ).rows[0].amount,
    1
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        cardToRecover.id
      ])
    ).rows[0].user_id,
    outsider
  );
  await db.query("delete from public.user_cards where id=$1", [
    cardToRecover.id
  ]);
  await compensate(cardAppeal, "CARD", cardRecovery);
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        cardToRecover.id
      ])
    ).rows[0].user_id,
    cardToRecover.owner
  );
  assert.deepEqual(await remaining(), {
    remaining_packs: 3,
    bonus_regular_packs: 3
  });
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [referrals[1]]
      )
    ).rows[0].karas_balance,
    300
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        resaleCard
      ])
    ).rows[0].user_id,
    outsider
  );
  const temporaryBan = (
    await db.query("select banned_until from auth.users where id=$1", [
      referrals[0]
    ])
  ).rows[0].banned_until;
  await assert.rejects(
    db.query("select public.assert_player_not_banned($1)", [referrals[0]]),
    /ACCOUNT_BANNED/
  );
  await db.query(
    "update auth.users set banned_until=now()-interval '1 second' where id=$1",
    [referrals[0]]
  );
  assert.equal(
    (
      await db.query("select public.assert_player_not_banned($1) as allowed", [
        referrals[0]
      ])
    ).rows[0].allowed,
    true
  );
  await db.query("update auth.users set banned_until=$2 where id=$1", [
    referrals[0],
    temporaryBan
  ]);
  const warning = (
    await db.query(
      "select receipt_id from public.anticheat_farm_warnings where cluster_id=$1",
      [cluster]
    )
  ).rows[0].receipt_id;
  const warningAppeal = await appealFor(warning);
  await adminQuery(
    "select public.admin_void_anticheat_warning($1,'Fixture warning no longer supported') as result",
    [warningAppeal]
  );
  assert.equal(
    (
      await db.query("select banned_until from auth.users where id=$1", [
        referrals[0]
      ])
    ).rows[0].banned_until,
    null
  );

  const timedCase = (
    await db.query(
      "select cluster_id,public.anticheat_farm_evidence_version(f) version from public.anticheat_farm_evidence f where beneficiary_id=$1",
      [timed[0]]
    )
  ).rows[0];
  const timedCode =
    (
      await db.query("select id from public.referral_codes where user_id=$1", [
        timed[0]
      ])
    ).rows[0]?.id ??
    (await create(
      "insert into public.referral_codes(user_id,code) values($1,'333333333333') returning id",
      [timed[0]]
    ));
  const heldReward = await create(
    "insert into public.referrals(code_id,referrer_id,referred_id,verified_at) values($1,$2,$3,now()) returning id",
    [timedCode, timed[0], timed[1]]
  );
  const unrelatedReward = await create(
    "insert into public.referrals(code_id,referrer_id,referred_id,verified_at) values($1,$2,$3,now()) returning id",
    [timedCode, timed[0], outsider]
  );
  for (const referral of [heldReward, unrelatedReward])
    await db.query(
      "insert into public.anticheat_referral_reward_holds(referral_id,referrer_id,network_identity,release_after) values($1,$2,$3,now())",
      [referral, timed[0], `v1:${"a".repeat(64)}`]
    );
  const cancelReward = referral =>
    adminQuery(
      "select public.admin_cancel_anticheat_pending_reward($1,$2,$3,'Reviewed two exact timed pack gifts') as result",
      [timedCase.cluster_id, timedCase.version, referral]
    );
  await assert.rejects(cancelReward(heldReward), /REWARD_PREVIEW_CHANGED/);
  await adminQuery(
    "select public.admin_review_anticheat_farm($1,$2,'CONFIRMED','Confirmed direct gift provenance') as result",
    [timedCase.cluster_id, timedCase.version]
  );
  const pendingPlan = await adminQuery(
    "select public.admin_preview_anticheat_farm_recovery($1) as result",
    [timedCase.cluster_id]
  );
  assert.deepEqual(
    pendingPlan.pendingRewards.map(reward => reward.id),
    [heldReward]
  );
  await assert.rejects(cancelReward(unrelatedReward), /REWARD_PREVIEW_CHANGED/);
  assert.equal(await cancelReward(heldReward), heldReward);
  assert.equal(await cancelReward(heldReward), heldReward);
  await db.query(
    "select public.complete_referral_after_verification($1,now())",
    [timed[1]]
  );
  assert.equal(
    (
      await db.query("select rewarded_at from public.referrals where id=$1", [
        heldReward
      ])
    ).rows[0].rewarded_at,
    null
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
