import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("manual sanctions unite both paths, recover locked assets and refund bidders without automatic network prerequisites", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column email text, add column banned_until timestamptz, add column updated_at timestamptz; create table auth.sessions(user_id uuid)"
  );
  const ids = Array.from(
    { length: 7 },
    (_, i) => `ac600000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
  );
  const [admin, smurf, primary, bidder, deleted, banOnly, donor] = ids;
  for (const [i, id] of ids.entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2)",
      [id, JSON.stringify({ pseudo: `Manual${i}` })]
    );
  await db.query("insert into public.admin_users(user_id)values($1)", [admin]);
  await db.query(
    "update public.user_profiles set karas_balance=1000 where user_id=any($1::uuid[])",
    [ids]
  );
  const catalog = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url)values('manual','manual-sanction','BROLY','ANIME/MANGA','Dragon Ball','LR','https://example.invalid/broly.png')returning id"
    )
  ).rows[0].id;
  const copy = async user =>
    (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity)values($1,$2,'LR')returning id",
        [user, catalog]
      )
    ).rows[0].id;
  const direct = await copy(primary),
    auctionCopy = await copy(primary),
    historical = await copy(primary),
    sold = await copy(bidder),
    legit = await copy(primary);
  for (const other of [smurf, deleted, bidder, banOnly, donor])
    await db.query(
      "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted')",
      [primary, other]
    );
  const trade = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas,status)values($1,$2,$3,70,'accepted')returning id",
      [smurf, primary, [direct, auctionCopy, sold]]
    )
  ).rows[0].id;
  const pending = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_card_ids,status)values($1,$2,$3,'pending')returning id",
      [primary, bidder, [direct]]
    )
  ).rows[0].id;
  const sale = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at,status)values($1,$2,$3,10,100,15,now()+interval '15 minutes','active')returning id",
      [auctionCopy, primary, bidder]
    )
  ).rows[0].id;
  await db.query(
    "update public.user_profiles set karas_balance=900 where user_id=$1",
    [bidder]
  );
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount)values($1,$2,100)",
    [sale, bidder]
  );
  const resale = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at,status)values($1,$2,$3,10,200,15,now(),'sold')returning id",
      [sold, primary, bidder]
    )
  ).rows[0].id;
  await db.query("update public.user_cards set is_locked=true where id=$1", [
    direct
  ]);
  const asUser = async (user, sql, args = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec("set role authenticated");
    try {
      return await db.query(sql, args);
    } finally {
      await db.exec("reset role");
    }
  };
  const preview = async (
    subject,
    mode = "active",
    counterpart = primary,
    trades = []
  ) =>
    (
      await asUser(
        admin,
        "select public.admin_preview_sanction($1,$2,$3,$4)value",
        [subject, mode, counterpart, trades]
      )
    ).rows[0].value;
  const apply = async (
    subject,
    mode = "active",
    counterpart = primary,
    trades = [],
    note = "Manual evidence and account roles independently checked.",
    confirm = subject,
    token
  ) =>
    (
      await asUser(
        admin,
        "select public.admin_apply_sanction($1,$2,$3,$4,$5,$6,$7,$8)value",
        [
          subject,
          mode,
          counterpart,
          trades,
          note,
          "",
          confirm,
          token ??
            (await preview(subject, mode, counterpart, trades)).previewToken
        ]
      )
    ).rows[0].value;
  await assert.rejects(
    asUser(bidder, "select public.admin_preview_sanction($1,$2,$3,$4)", [
      smurf,
      "active",
      primary,
      []
    ]),
    /ADMIN_REQUIRED/
  );
  await assert.rejects(
    asUser(
      bidder,
      "select public.admin_apply_sanction($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        smurf,
        "active",
        primary,
        [],
        "Attempted unauthorized sanction.",
        "",
        smurf,
        "invalid"
      ]
    ),
    /ADMIN_REQUIRED/
  );
  const initial = await preview(smurf);
  assert.equal(initial.eligible, true);
  assert.equal(initial.evidence.sharedNetwork, false);
  assert.equal(initial.evidence.sharedDevice, false);
  assert.equal(initial.recovery.cards, 2);
  assert.equal(initial.recovery.activeAuctions, 1);
  assert.equal(initial.recovery.pendingTrades, 1);
  assert.equal(initial.recovery.karas, 270);
  assert.equal(initial.cardLabels[direct].name, "BROLY");
  assert.equal(initial.cardLabels[direct].franchise, "Dragon Ball");
  const heldCase = (
    await db.query(
      "insert into public.anticheat_quarantines(subject_type,subject_id,status,sender_user_id,recipient_user_id,evidence_confidence,economic_severity,expires_at) values('trade',$1,'AWAITING_REVIEW',$2,$3,'CORROBORATED','MEDIUM',now()+interval '1 hour') returning id",
      [pending, primary, bidder]
    )
  ).rows[0].id;
  await db.query(
    "update public.trade_offers set status='quarantined' where id=$1",
    [pending]
  );
  await db.query(
    "insert into public.anticheat_trade_card_holds(card_id,quarantine_id) values($1,$2)",
    [direct, heldCase]
  );
  await db.query(
    "insert into public.anticheat_trade_kara_holds(quarantine_id,user_id,amount) values($1,$2,900)",
    [heldCase, primary]
  );
  const blockedPreview = await preview(smurf);
  assert.equal(blockedPreview.eligible, false);
  assert.deepEqual(blockedPreview.recovery.quarantineConflicts, [
    { id: heldCase, cards: 1, karas: 900 }
  ]);
  await assert.rejects(
    apply(smurf, "active", primary, [], undefined, smurf, initial.previewToken),
    /SANCTION_PREVIEW_CHANGED/
  );
  await assert.rejects(apply(smurf), /MANUAL_SANCTION_NOT_ELIGIBLE/);
  await asUser(
    admin,
    "select public.admin_resolve_trade_quarantine($1,1,'cancel','Reviewed conflict')",
    [heldCase]
  );
  assert.equal((await preview(smurf)).eligible, true);
  await assert.rejects(
    apply(smurf, "active", primary, [], undefined, smurf, "stale"),
    /SANCTION_PREVIEW_CHANGED/
  );
  await assert.rejects(
    apply(smurf, "active", primary, [], "short"),
    /INVALID_SANCTION_NOTE/
  );
  await assert.rejects(
    apply(smurf, "active", primary, [], undefined, primary),
    /SANCTION_CONFIRMATION_REQUIRED/
  );
  await db.query(
    "update public.user_profiles set karas_balance=100 where user_id=$1",
    [primary]
  );
  assert.equal((await preview(smurf)).eligible, false);
  await assert.rejects(apply(smurf), /MANUAL_SANCTION_NOT_ELIGIBLE/);
  assert.equal(
    (await db.query("select status from public.auctions where id=$1", [sale]))
      .rows[0].status,
    "active"
  );
  assert.equal(
    (
      await db.query("select is_locked from public.user_cards where id=$1", [
        direct
      ])
    ).rows[0].is_locked,
    true
  );
  await db.query(
    "update public.user_profiles set karas_balance=1000 where user_id=$1",
    [primary]
  );
  const result = await apply(smurf);
  assert.equal(result.banned, true);
  assert.equal(result.cardsRecovered, 2);
  assert.equal(result.karasRecovered, 270);
  for (const id of [direct, auctionCopy])
    assert.deepEqual(
      (
        await db.query(
          "select user_id,is_locked from public.user_cards where id=$1",
          [id]
        )
      ).rows[0],
      { user_id: smurf, is_locked: false }
    );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        sold
      ])
    ).rows[0].user_id,
    bidder
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        legit
      ])
    ).rows[0].user_id,
    primary
  );
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [bidder]
      )
    ).rows[0].karas_balance,
    1000
  );
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [primary]
      )
    ).rows[0].karas_balance,
    730
  );
  assert.equal(
    (await db.query("select status from public.auctions where id=$1", [sale]))
      .rows[0].status,
    "expired"
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.bids where auction_id=$1",
        [sale]
      )
    ).rows[0].n,
    1
  );
  assert.equal(
    (
      await db.query("select status from public.trade_offers where id=$1", [
        pending
      ])
    ).rows[0].status,
    "cancelled"
  );
  const receipt = (
    await db.query(
      "select history,evidence,source_auction_ids from public.anticheat_smurf_sanctions where id=$1",
      [result.receiptId]
    )
  ).rows[0];
  assert.equal(receipt.evidence.manualDecision, true);
  assert.equal(receipt.history.cardLabels[direct].name, "BROLY");
  assert.equal(receipt.history.preparation.cancelledAuctions[0].refund, 100);
  assert.deepEqual(receipt.source_auction_ids, [resale]);
  await assert.rejects(apply(smurf), /MANUAL_SANCTION_NOT_ELIGIBLE/);
  // A ban is possible even when the suspected smurf is only a recipient and
  // there are no traceable gains on the selected primary account.
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query(
    "insert into public.trade_offers(from_user,to_user,offered_karas,status)values($1,$2,10,'accepted')",
    [primary, banOnly]
  );
  assert.equal((await preview(banOnly)).recovery.karas, 0);
  assert.equal((await preview(banOnly)).eligible, true);
  assert.equal((await apply(banOnly)).banned, true);
  // Deleted source: real deletion preserves the name snapshot. Manual handling
  // unlocks and confiscates without recreating any deleted identity.
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  const oldTrade = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas,status)values($1,$2,$3,20,'accepted')returning id",
      [deleted, primary, [historical]]
    )
  ).rows[0].id;
  await db.exec("set role service_role");
  await db.query("select public.begin_account_deletion($1)", [deleted]);
  await db.query("select public.prepare_account_deletion($1)", [deleted]);
  await db.exec("reset role");
  await db.query("delete from auth.users where id=$1", [deleted]);
  await db.query("update public.user_cards set is_locked=true where id=$1", [
    historical
  ]);
  const oldPreview = await preview(primary, "deleted", null, [oldTrade]);
  assert.equal(oldPreview.eligible, true);
  assert.equal(oldPreview.cardLabels[historical].name, "BROLY");
  assert.deepEqual(
    oldPreview.candidates.find(row => row.id === oldTrade).incomingNames,
    ["BROLY"]
  );
  const recovered = await apply(primary, "deleted", null, [oldTrade]);
  assert.equal(recovered.cardsRecovered, 1);
  assert.equal(recovered.karasRecovered, 20);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.user_cards where id=$1",
        [historical]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await db.query("select count(*)::integer n from auth.users where id=$1", [
        deleted
      ])
    ).rows[0].n,
    0
  );
  const oldReceipt = (
    await db.query(
      "select history from public.anticheat_deleted_smurf_recoveries where id=$1",
      [recovered.receiptId]
    )
  ).rows[0];
  assert.equal(oldReceipt.history.cardLabels[historical].name, "BROLY");
  await assert.rejects(
    apply(primary, "deleted", null, [oldTrade]),
    /MANUAL_SANCTION_NOT_ELIGIBLE/
  );
  // Privilege and invalid mode/role checks remain independent of evidence.
  await assert.rejects(preview(smurf, "unknown"), /INVALID_SANCTION_MODE/);
  assert.equal((await preview(smurf, "active", admin)).eligible, false);
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("select * from public.anticheat_smurf_sanctions"),
    { code: "42501" }
  );
  await db.exec("reset role");
});
