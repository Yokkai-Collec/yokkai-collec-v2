import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("trade review reserves cards and Karas and settles exactly once", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const [sender, receiver, admin] = [1, 2, 3].map(
    id => `ad510000-0000-4000-8000-00000000000${id}`
  );
  for (const [id, pseudo] of [
    [sender, "HeldSender"],
    [receiver, "HeldReceiver"],
    [admin, "HeldAdmin"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [sender, receiver]
  );
  await db.query(
    "update public.user_profiles set karas_balance=100 where user_id in($1,$2)",
    [sender, receiver]
  );
  for (const id of [sender, receiver]) {
    await db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2)",
      [`v1:${"a".repeat(64)}`, id]
    );
    await db.query(
      "insert into public.anticheat_device_observations(device_identity,user_id) values($1,$2)",
      [`v1:${"b".repeat(64)}`, id]
    );
    await db.query(
      "select public.record_anticheat_trade_connection($1,$2,$3)",
      [id, `v1:${"a".repeat(64)}`, `v1:${"b".repeat(64)}`]
    );
  }
  const catalog = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('test','held','Test','Test','Test','LR','https://example.invalid/card.png') returning id"
    )
  ).rows[0].id;
  const card = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'LR') returning id",
      [sender, catalog]
    )
  ).rows[0].id;
  const opening = (
    await db.query(
      "insert into public.regular_pack_openings(opened_by,source) values($1,'timed') returning id",
      [sender]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.regular_pack_opening_cards(card_instance_id,pack_opening_id,card_id,original_owner_id) values($1,$2,$3,$4)",
    [card, opening, catalog, sender]
  );
  async function asUser(id, sql, args) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
    try {
      return (await db.query(sql, args)).rows[0].result;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }
  const makeOffer = async (cards, karas) =>
    (
      await db.query(
        "insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas) values($1,$2,$3,$4) returning id",
        [sender, receiver, cards, karas]
      )
    ).rows[0].id;
  const accept = id =>
    asUser(receiver, "select public.respond_trade_offer($1,'accept') result", [
      id
    ]);
  const normal = await makeOffer([], 1);
  assert.equal(await accept(normal), true);
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='quarantine_enforcement'"
  );
  const held = await makeOffer([card], 90);
  assert.equal(await accept(held), false);
  assert.equal(await accept(held), false);
  const status = async id =>
    (await db.query("select status from public.trade_offers where id=$1", [id]))
      .rows[0].status;
  assert.equal(await status(held), "quarantined");
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        card
      ])
    ).rows[0].user_id,
    sender
  );
  await assert.rejects(
    db.query(
      "update public.user_profiles set karas_balance=89 where user_id=$1",
      [sender]
    ),
    /TRADE_INSUFFICIENT_KARAS/
  );
  await assert.rejects(
    asUser(sender, "select public.create_auction($1,10,15) result", [card]),
    /TRADE_CARD_FROZEN/
  );
  const overlapping = await makeOffer([card], 0);
  await assert.rejects(accept(overlapping), /TRADE_CARD_FROZEN/);
  const quarantine = async id =>
    (
      await db.query(
        "select id,version,status from public.anticheat_quarantines where subject_id=$1",
        [id]
      )
    ).rows[0];
  const q = await quarantine(held);
  const resolve = (actor, entry, action) =>
    asUser(
      actor,
      "select public.admin_resolve_trade_quarantine($1,$2,$3,'Reviewed evidence') result",
      [entry.id, entry.version, action]
    );
  await assert.rejects(resolve(receiver, q, "release"), /ADMIN_REQUIRED/);
  assert.equal(await resolve(admin, q, "release"), "RELEASED");
  await assert.rejects(resolve(admin, q, "cancel"), /QUARANTINE_CHANGED/);
  assert.equal(await status(held), "accepted");
  assert.deepEqual(
    (
      await db.query(
        "select transfer_type,trade_offer_id from public.regular_pack_card_transfers where card_instance_id=$1",
        [card]
      )
    ).rows,
    [{ transfer_type: "trade", trade_offer_id: held }]
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        card
      ])
    ).rows[0].user_id,
    receiver
  );
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [sender]
      )
    ).rows[0].karas_balance,
    9
  );
  const cancelled = await makeOffer([], 5);
  assert.equal(await accept(cancelled), false);
  assert.equal(
    await resolve(admin, await quarantine(cancelled), "cancel"),
    "CANCELLED"
  );
  assert.equal(await status(cancelled), "cancelled");
  const expiring = await makeOffer([], 5);
  assert.equal(await accept(expiring), false);
  await db.query(
    "update public.anticheat_quarantines set expires_at=now()-interval '1 minute' where subject_id=$1",
    [expiring]
  );
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='quarantine_auto_release'"
  );
  await db.exec("update public.anticheat_cases set status='reviewed'");
  await db.exec("select public.expire_active_trade_quarantines()");
  assert.equal(await status(expiring), "quarantined");
  const escalated = await quarantine(expiring);
  assert.equal(escalated.status, "AWAITING_REVIEW");
  assert.equal(
    (
      await db.query(
        "select analysis_outcome from public.anticheat_quarantines where id=$1",
        [escalated.id]
      )
    ).rows[0].analysis_outcome,
    "SIGNALS_UNRESOLVED"
  );
  assert.equal(await resolve(admin, escalated, "release"), "RELEASED");
  assert.equal(
    (
      await db.query(
        "select count(*)::integer count from public.anticheat_trade_kara_holds"
      )
    ).rows[0].count,
    0
  );

  const critical = await makeOffer([], 1);
  const missingEvidence = await makeOffer([], 1);
  const failure = await makeOffer([], 1);
  for (const id of [critical, missingEvidence, failure]) {
    assert.equal(await accept(id), false);
    await db.query(
      "update public.anticheat_quarantines set expires_at=now()-interval '1 minute' where subject_id=$1",
      [id]
    );
  }
  await db.query(
    "update public.anticheat_quarantines set economic_severity='CRITICAL' where subject_id=$1",
    [critical]
  );
  await db.exec("update public.anticheat_cases set status='reviewed'");
  await db.exec("delete from public.anticheat_trade_connections");
  // Fault-inject only for the third case. Real worker runs against isolated test data.
  const analysis = (
    await db.query(
      "select pg_get_functiondef('public.reassess_quarantined_trade(public.trade_offers,public.anticheat_quarantines)'::regprocedure) as definition"
    )
  ).rows[0].definition;
  await db.exec(
    analysis.replace(
      "begin",
      `begin
    if p_offer.id='${failure}'::uuid then raise exception 'test-only analysis error'; end if;`
    )
  );
  await db.exec("select public.expire_active_trade_quarantines()");
  await db.exec("select public.expire_active_trade_quarantines()");
  for (const [id, expected] of [
    [critical, "CRITICAL_UNRESOLVED"],
    [missingEvidence, "INSUFFICIENT_EVIDENCE"],
    [failure, "ANALYSIS_ERROR"]
  ]) {
    assert.equal(await status(id), "quarantined");
    const details = (
      await db.query(
        "select analysis_outcome, review_due_at, analysis_retry_at from public.anticheat_quarantines where subject_id=$1",
        [id]
      )
    ).rows[0];
    assert.equal(details.analysis_outcome, expected);
    assert.ok(details.review_due_at);
    if (expected === "ANALYSIS_ERROR") assert.ok(details.analysis_retry_at);
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::integer as total from public.anticheat_quarantine_audit where action='ACTION_REJECTED'"
      )
    ).rows[0].total,
    1
  );
});
