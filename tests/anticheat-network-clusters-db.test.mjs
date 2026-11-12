import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("direct network thresholds create one investigation alert per tier without sanctioning accounts", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column created_at timestamptz not null default now()"
  );
  const ids = Array.from(
    { length: 20 },
    (_, index) =>
      `ad520000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
  );
  for (const [index, id] of ids.entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo: `Cluster${index}` })]
    );
  }
  const network = `v1:${"a".repeat(64)}`;
  const otherNetwork = `v1:${"b".repeat(64)}`;
  const observe = (id, identity = network) =>
    db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2)",
      [identity, id]
    );
  await observe(ids[0]);
  await observe(ids[1]);
  await observe(ids[1], otherNetwork);
  await observe(ids[2], otherNetwork);
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag in('ip_cluster_detection','cluster_investigation','discord_alerts_v2')"
  );
  const evaluate = () =>
    db.exec("select public.evaluate_anticheat_network_clusters()");
  const read = async () =>
    (await db.query("select * from public.anticheat_network_clusters")).rows[0];
  const alerts = async () =>
    (
      await db.query(
        "select o.payload from public.anticheat_discord_outbox o join public.anticheat_events e on e.id=o.event_id where e.event_type='network_cluster_threshold' order by e.id"
      )
    ).rows;
  await evaluate();
  assert.equal(await read(), undefined);
  assert.equal((await alerts()).length, 0);
  await observe(ids[2]);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [ids[0], ids[1]]
  );
  await db.query(
    "insert into public.trade_offers(from_user,to_user,requested_karas,status) values($1,$2,7,'accepted')",
    [ids[0], ids[1]]
  );
  await evaluate();
  assert.equal((await read()).account_count, 3);
  assert.equal((await alerts()).length, 1);
  const alert = (await alerts())[0].payload;
  const [embed] = alert.embeds;
  assert.deepEqual(alert.allowed_mentions, { parse: [] });
  assert.equal(embed.title, "Yokkai · Réseau partagé · groupe à examiner");
  assert.equal(
    embed.url,
    `https://yokkai-collec.com/admin/security?cluster=${(await read()).id}#anticheat-clusters`
  );
  assert.match(embed.fields[0].value, /Cluster0.*Cluster1.*Cluster2/);
  assert.match(embed.fields[1].value, /Cluster1[^→]+→ \[Cluster0\].*7 Karas/);
  assert.match(embed.fields[2].value, /Aucun parrainage interne/);
  const referral = (
    await db.query(
      `with code as (
        insert into public.referral_codes(user_id,code) values($1,'222222222222')
        on conflict(user_id) do update set user_id=excluded.user_id returning id
      )
      insert into public.referrals(code_id,referrer_id,referred_id)
      select id,$1,$2 from code returning id`,
      [ids[1], ids[2]]
    )
  ).rows[0].id;
  for (const [count, priority] of [
    [4, "CRITICAL"],
    [6, "ENHANCED"],
    [10, "PRIORITY"],
    [20, "PRIORITY"]
  ]) {
    for (let index = 3; index < count; index++) {
      await db.query(
        "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2) on conflict do nothing",
        [network, ids[index]]
      );
    }
    await db.exec(
      "update public.anticheat_network_clusters set evaluated_at=now()-interval '11 minutes'"
    );
    await evaluate();
    const cluster = await read();
    assert.equal(cluster.account_count, count);
    assert.equal(cluster.priority, priority);
    assert.equal(cluster.investigation_state, "REVIEWED_SIGNALS");
    assert.equal((await alerts()).length, 2);
  }
  const criticalAlert = (await alerts())[1].payload.embeds[0];
  assert.equal(criticalAlert.title, "Yokkai · Réseau partagé · seuil critique");
  assert.match(
    criticalAlert.fields[2].value,
    /Cluster1[^→]+→ \[Cluster2\].*récompense non versée/
  );
  await db.query("delete from public.referrals where id=$1", [referral]);
  assert.doesNotMatch(JSON.stringify(await alerts()), new RegExp(network));
  const cluster = await read();
  const admin = "ad520000-0000-4000-8000-000000000099";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [admin, JSON.stringify({ pseudo: "ClusterReviewer" })]
  );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin
  ]);
  const details = (
    await db.query(
      "select public.admin_list_anticheat_clusters($1) as result",
      [cluster.id]
    )
  ).rows[0].result;
  assert.equal(details[0].members.length, 20);
  assert.doesNotMatch(JSON.stringify(details), new RegExp(network));

  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='graph_detection_v2'"
  );
  const investigate = () =>
    db.exec("select public.evaluate_anticheat_farm_evidence()");
  const finding = async () =>
    (
      await db.query(
        "select decision,confidence,secondary_ids,evidence from public.anticheat_farm_evidence where cluster_id=$1",
        [cluster.id]
      )
    ).rows[0];
  await investigate();
  assert.equal(
    (await finding()).decision,
    "INVESTIGATE",
    "shared IP alone is insufficient"
  );
  const beneficiary = ids[0];
  const code =
    (
      await db.query("select id from public.referral_codes where user_id=$1", [
        beneficiary
      ])
    ).rows[0]?.id ??
    (
      await db.query(
        "insert into public.referral_codes(user_id,code) values($1,'111111111111') returning id",
        [beneficiary]
      )
    ).rows[0].id;
  const catalog = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('test','farm-proof','Farm','Test','Test','LR','https://example.invalid/card.png') returning id"
    )
  ).rows[0].id;
  const recordTrade = async (sender, recipient, card) => {
    await db.query(
      "insert into public.friendships(user_id,friend_id,status) values(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),'accepted') on conflict do nothing",
      [sender, recipient]
    );
    const offer = (
      await db.query(
        "insert into public.trade_offers(from_user,to_user,offered_card_ids) values($1,$2,array[$3::uuid]) returning id",
        [sender, recipient, card]
      )
    ).rows[0].id;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      recipient
    ]);
    try {
      assert.equal(
        (
          await db.query(
            "select public.respond_trade_offer($1,'accept') as accepted",
            [offer]
          )
        ).rows[0].accepted,
        true
      );
    } finally {
      await db.exec("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const copies = [];
  for (const donor of ids.slice(1, 4)) {
    await db.query(
      "insert into public.referrals(code_id,referrer_id,referred_id,verified_at,rewarded_at) values($1,$2,$3,now(),now())",
      [code, beneficiary, donor]
    );
    const opening = (
      await db.query(
        "insert into public.regular_pack_openings(opened_by,source) values($1,'timed') returning id",
        [donor]
      )
    ).rows[0].id;
    const copy = (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'LR') returning id",
        [donor, catalog]
      )
    ).rows[0].id;
    await db.query(
      "insert into public.regular_pack_opening_cards(card_instance_id,pack_opening_id,card_id,original_owner_id) values($1,$2,$3,$4)",
      [copy, opening, catalog, donor]
    );
    copies.push(copy);
  }
  const reevaluate = async () => {
    await db.exec(
      "update public.anticheat_network_clusters set evaluated_at=clock_timestamp()"
    );
    await investigate();
  };
  await reevaluate();
  assert.equal(
    (await finding()).decision,
    "INVESTIGATE",
    "rewards and opens without transfers are insufficient"
  );
  await recordTrade(ids[1], beneficiary, copies[0]);
  await recordTrade(ids[2], beneficiary, copies[1]);
  await recordTrade(ids[3], ids[2], copies[2]);
  await reevaluate();
  assert.equal((await finding()).decision, "INVESTIGATE");
  await recordTrade(ids[2], beneficiary, copies[2]);
  await reevaluate();
  const confirmed = await finding();
  assert.equal(confirmed.decision, "ECONOMICALLY_CONFIRMED");
  assert.equal(confirmed.confidence, "CORROBORATED");
  assert.deepEqual(confirmed.secondary_ids, ids.slice(1, 4));
  assert.ok(confirmed.evidence.proofs.some(proof => proof.path.length === 3));
  const readVersion = async () =>
    (
      await db.query(
        "select public.anticheat_farm_evidence_version(e) as version from public.anticheat_farm_evidence e where e.cluster_id=$1",
        [cluster.id]
      )
    ).rows[0].version;
  const version = await readVersion();
  const review = async (actor, decision, evidenceVersion = version) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          "select public.admin_review_anticheat_farm($1,$2,$3,'Reviewed test evidence') as decision",
          [cluster.id, evidenceVersion, decision]
        )
      ).rows[0].decision;
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub','',false)"
      );
    }
  };
  await assert.rejects(review(ids[1], "CONFIRMED"), /ADMIN_REQUIRED/);
  assert.equal(await review(admin, "CONFIRMED"), "CONFIRMED");
  assert.equal(await review(admin, "CONFIRMED"), "CONFIRMED");
  await assert.rejects(review(admin, "DISMISSED"), /FARM_ALREADY_REVIEWED/);
  const verifyReferral = async child => {
    const referral = (
      await db.query(
        "insert into public.referrals(code_id,referrer_id,referred_id) values($1,$2,$3) returning id",
        [code, beneficiary, child]
      )
    ).rows[0].id;
    await db.query(
      "select public.complete_referral_after_verification($1,now())",
      [child]
    );
    return referral;
  };
  const ordinaryReferral = await verifyReferral(ids[4]);
  assert.ok(
    (
      await db.query("select rewarded_at from public.referrals where id=$1", [
        ordinaryReferral
      ])
    ).rows[0].rewarded_at
  );
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='referral_evidence_hold'"
  );
  const heldReferral = await verifyReferral(ids[5]);
  assert.equal(
    (
      await db.query("select rewarded_at from public.referrals where id=$1", [
        heldReferral
      ])
    ).rows[0].rewarded_at,
    null
  );
  assert.ok(
    (
      await db.query(
        "select release_after from public.anticheat_referral_reward_holds where referral_id=$1",
        [heldReferral]
      )
    ).rows[0].release_after
  );
  await db.query(
    "update public.referrals set verified_at=now()-interval '25 hours' where id=$1",
    [heldReferral]
  );
  await db.query(
    "update public.anticheat_referral_reward_holds set release_after=now()-interval '1 minute' where referral_id=$1",
    [heldReferral]
  );
  await db.exec("select public.release_quiet_referral_reward_holds()");
  assert.ok(
    (
      await db.query("select rewarded_at from public.referrals where id=$1", [
        heldReferral
      ])
    ).rows[0].rewarded_at
  );
  // A returned gift is a cycle and no longer qualifies that donor.
  await recordTrade(beneficiary, ids[1], copies[0]);
  await reevaluate();
  const returned = await finding();
  assert.equal(returned.evidence.cycleCards, 1);
  assert.equal(returned.decision, "INVESTIGATE");
  await assert.rejects(review(admin, "CONFIRMED"), /FARM_EVIDENCE_CHANGED/);
  const returnedVersion = await readVersion();
  await assert.rejects(
    review(admin, "CONFIRMED", returnedVersion),
    /FARM_EVIDENCE_INSUFFICIENT/
  );
  assert.equal(await review(admin, "DISMISSED", returnedVersion), "DISMISSED");
});
