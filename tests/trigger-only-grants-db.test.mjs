import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const functions = [
  "on_profile_create_achievement_stats",
  "on_card_acquired_achievements",
  "on_decision_pack_completed_achievement",
  "on_auction_won_achievement",
  "on_trade_completed_achievement",
  "normalize_card_category",
  "normalize_card_name",
  "prevent_frozen_card_change",
  "prevent_locked_card_transfer_or_delete",
  "prevent_locked_trade_offer",
  "clear_custom_image_on_owner_change"
];
const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";

async function authenticated(db, id, sql, params = []) {
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    assert.deepEqual(
      (await db.query("select current_user as role,auth.uid() as uid")).rows,
      [{ role: "authenticated", uid: id }]
    );
    return (await db.query(sql, params)).rows[0]?.result;
  } finally {
    await db.exec("reset role");
  }
}

async function completed(db, player, achievement) {
  const achievements = await authenticated(
    db,
    player,
    "select public.get_achievements() as result"
  );
  assert.ok(
    achievements.find(a => a.id === achievement)?.completedAt,
    achievement
  );
}

test("trigger-only EXECUTE is denied to PUBLIC, anon and authenticated", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const name of functions) {
    for (const role of ["public", "anon", "authenticated"]) {
      const { allowed } = (
        await db.query(
          "select has_function_privilege($1,$2,'EXECUTE') as allowed",
          [role, `public.${name}()`]
        )
      ).rows[0];
      assert.equal(allowed, false, `${role} must not execute ${name}`);
    }
    await assert.rejects(authenticated(db, alice, `select public.${name}()`), {
      code: "42501"
    });
  }
});

test("wishlist compatibility view has no client privileges or acquisition cleanup callers", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const role of ["public", "anon", "authenticated"]) {
    for (const privilege of [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER"
    ]) {
      assert.equal(
        (
          await db.query(
            "select has_table_privilege($1,'public.wishlist',$2) as allowed",
            [role, privilege]
          )
        ).rows[0].allowed,
        false,
        `${role} ${privilege} wishlist`
      );
    }
  }
  assert.deepEqual(
    (
      await db.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and pg_get_functiondef(p.oid) ~ $1 order by p.proname`,
        [String.raw`\mpublic\.wishlist\M`]
      )
    ).rows.map(row => row.proname),
    [],
    "acquisition no longer removes wishlist entries through the compatibility view"
  );
  await assert.rejects(
    authenticated(db, alice, "select * from public.wishlist"),
    { code: "42501" }
  );
});

test("normalization and protection triggers still execute under authenticated", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const [id, pseudo] of [
    [alice, "GuardAlice"],
    [bob, "GuardBob"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  const friendship = await authenticated(
    db,
    alice,
    "select public.send_friend_request($1) as result",
    [bob]
  );
  await authenticated(
    db,
    bob,
    "select public.respond_friend_request($1,true) as result",
    [friendship]
  );
  await db.query("insert into public.admin_users(user_id) values ($1)", [
    alice
  ]);
  const cardId = await authenticated(
    db,
    alice,
    `insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values ('guards',' mixed name ',' video game ','Guards','SR','https://example.test/card.png','test') returning id as result`
  );
  assert.deepEqual(
    (
      await db.query("select nom,categorie from public.cards where id=$1", [
        cardId
      ])
    ).rows[0],
    { nom: "MIXED NAME", categorie: "VIDEO GAMES" }
  );
  await db.query("delete from public.admin_users where user_id=$1", [alice]);
  const copy = async locked =>
    (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity,is_locked) values ($1,$2,'SR',$3) returning id",
        [alice, cardId, locked]
      )
    ).rows[0].id;
  const locked = await copy(true),
    frozen = await copy(false);
  await authenticated(
    db,
    alice,
    "select public.create_auction($1,10,15) as result",
    [frozen]
  );
  // Disposable-only write privileges expose the actual BEFORE triggers directly,
  // so an upstream RPC check cannot hide a broken trigger or wrong player role.
  await db.exec(`grant delete,update(user_id) on public.user_cards to authenticated;
    create policy ci_guard_cards on public.user_cards for all to authenticated using(user_id=auth.uid()) with check(true);
    grant select on public.auctions to authenticated;
    create policy ci_guard_auctions on public.auctions for select to authenticated using(true);
    grant insert on public.trade_offers to authenticated;
    create policy ci_guard_offers on public.trade_offers for insert to authenticated with check(from_user=auth.uid());`);
  await assert.rejects(
    authenticated(db, alice, "delete from public.user_cards where id=$1", [
      locked
    ]),
    /CARD_LOCKED/
  );
  await assert.rejects(
    authenticated(
      db,
      alice,
      "update public.user_cards set user_id=$2 where id=$1",
      [locked, bob]
    ),
    /CARD_LOCKED/
  );
  await assert.rejects(
    authenticated(db, alice, "delete from public.user_cards where id=$1", [
      frozen
    ]),
    /CARD_FROZEN/
  );
  await assert.rejects(
    authenticated(
      db,
      alice,
      "insert into public.trade_offers(from_user,to_user,offered_card_ids) values ($1,$2,$3::uuid[])",
      [alice, bob, [locked]]
    ),
    /CARD_LOCKED/
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.user_cards where id=any($1::uuid[])",
        [[locked, frozen]]
      )
    ).rows[0].count,
    2
  );
});

test("authenticated actions still fire all five achievement triggers", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());

  // Only the disposable Auth stub gets INSERT: simulate signup through its real
  // trigger chain as authenticated, without opening any public application table.
  await db.exec("grant insert on auth.users to authenticated");
  for (const [id, pseudo] of [
    [alice, "TriggerAlice"],
    [bob, "TriggerBob"]
  ]) {
    await authenticated(
      db,
      id,
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.exec("revoke insert on auth.users from authenticated");
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('authenticated','public.user_profiles','INSERT') as allowed"
      )
    ).rows[0].allowed,
    false
  );
  // Inspect immediately: later RPCs also initialize stats and could mask a broken signup trigger.
  assert.deepEqual(
    (
      await db.query(
        "select user_id from public.user_achievement_stats order by user_id"
      )
    ).rows,
    [{ user_id: alice }, { user_id: bob }]
  );

  // Catalogue and balances are fixtures; every achievement-producing action below
  // is issued under authenticated, through the production RPCs.
  await db.exec("update public.user_profiles set karas_balance=100");
  for (const rarity of ["C", "R", "SR", "SSR", "LR"]) {
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ($1,$1,$1,'Triggers',$2,'https://example.test/card.png','test')",
      [`trigger-${rarity}`, rarity]
    );
  }
  const pack = await authenticated(
    db,
    alice,
    "select public.open_regular_pack() as result"
  );
  assert.equal(pack.length, 5);
  // Each category has one card: any roll completes the collection achievement.
  await completed(db, alice, "specialiste");
  await completed(db, alice, "premier-rituel");

  const choices = await authenticated(
    db,
    alice,
    "select public.open_decision_pack() as result"
  );
  await authenticated(
    db,
    alice,
    "select public.keep_decision_pack_card($1) as result",
    [choices[0].instanceId]
  );
  await completed(db, alice, "decision-decisive");

  const friendship = await authenticated(
    db,
    alice,
    "select public.send_friend_request($1) as result",
    [bob]
  );
  await authenticated(
    db,
    bob,
    "select public.respond_friend_request($1,true) as result",
    [friendship]
  );
  const trade = await authenticated(
    db,
    alice,
    "select public.create_trade_offer($1,$2::uuid[]) as result",
    [bob, [pack[0].instanceId]]
  );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values ($1,$2) on conflict do nothing",
    [bob, pack[0].id]
  );
  await authenticated(
    db,
    bob,
    "select public.respond_trade_offer($1,'accept') as result",
    [trade]
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.wishlists where user_id=$1 and card_id=$2",
        [bob, pack[0].id]
      )
    ).rows[0].count,
    0
  );
  await completed(db, alice, "marche-conclu");
  await completed(db, bob, "marche-conclu");
  await completed(db, bob, "specialiste");

  const auction = await authenticated(
    db,
    alice,
    "select public.create_auction($1,10,15) as result",
    [pack[1].instanceId]
  );
  await authenticated(db, bob, "select public.place_bid($1,20) as result", [
    auction
  ]);
  await db.query(
    "insert into public.wishlists(user_id,card_id) values ($1,$2) on conflict do nothing",
    [bob, pack[1].id]
  );
  // Move the clock only; never set the sale status or achievement directly.
  await db.query(
    "update public.auctions set ends_at=now()-interval '1 minute' where id=$1",
    [auction]
  );
  // Listing no longer settles unrelated auctions. The private scheduled command
  // runs under its configured owner, while players remain unable to invoke it.
  await authenticated(
    db,
    alice,
    "select public.create_auction($1,10,15) as result",
    [pack[2].instanceId]
  );
  await assert.rejects(
    authenticated(
      db,
      alice,
      "select public.settle_expired_auctions() as result"
    ),
    /permission denied/
  );
  const job = (
    await db.query(
      "select command,username,active from cron.job where command ilike '%settle_expired_auctions%' limit 1"
    )
  ).rows[0];
  assert.equal(job.active, true);
  assert.equal(job.username, "postgres");
  await db.exec(job.command);
  await completed(db, bob, "adjuge");
  assert.equal(
    (
      await db.query("select status from public.auctions where id=$1", [
        auction
      ])
    ).rows[0].status,
    "sold"
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        pack[1].instanceId
      ])
    ).rows[0].user_id,
    bob
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.wishlists where user_id=$1 and card_id=$2",
        [bob, pack[1].id]
      )
    ).rows[0].count,
    0
  );
});
