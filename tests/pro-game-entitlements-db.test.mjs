import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const owner = "6b000000-0000-4000-8000-000000000001";
const other = "6b000000-0000-4000-8000-000000000002";
const scope = "test:acct_fixture:price_fixture";

test("paid server state activates actual game limits, never client flags; expiry/risk/scope revoke them without deleting assets", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const [id, pseudo] of [
    [owner, "PaidFixture"],
    [other, "BasicFixture"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  const login = async id => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const admin = () => db.exec("reset role");
  const eligible = async () => {
    await admin();
    return (
      await db.query("select public.billing_has_game_pro($1) value", [owner])
    ).rows[0].value;
  };
  const status = async () => {
    await login(owner);
    return (await db.query("select public.get_regular_pack_status() value"))
      .rows[0].value;
  };
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values('paid-fixture','Fixture','ANIME/MANGA','Fixture','SSR','https://example.test/card.png','test') returning id"
    )
  ).rows[0].id;
  for (const rarity of ["C", "R", "SR", "LR"])
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA','Fixture',$2,'https://example.test/card.png','test')",
      [`paid-${rarity}`, rarity]
    );
  const copies = [];
  for (let index = 0; index < 12; index++)
    copies.push(
      (
        await db.query(
          "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'SSR') returning id",
          [owner, card]
        )
      ).rows[0].id
    );
  await login(owner);
  for (const sql of [
    "select * from public.billing_entitlement_config",
    `select public.billing_set_entitlement_scope('${scope}',true)`,
    `select public.billing_has_game_pro('${other}')`,
    `select public.billing_sync_pack_timing('${other}')`,
    "update public.user_profiles set regular_pack_interval_seconds=300"
  ])
    await assert.rejects(db.query(sql), /permission denied/);
  assert.equal((await status()).refillSeconds, 300);
  assert.equal((await status()).maximum, 5);
  await admin();
  await db.query(
    "update public.user_profiles set next_regular_pack_at=clock_timestamp()+interval '5 minutes',next_decision_pack_at=clock_timestamp()+interval '24 hours' where user_id=$1",
    [owner]
  );
  await db.query(
    "insert into public.billing_accounts(user_id,scope,active,status,period_end,verified_at) values($1,$2,true,'active',clock_timestamp()+interval '1 month',clock_timestamp())",
    [owner, scope]
  );
  assert.equal(
    await eligible(),
    false,
    "closed deployment scope grants no bonus even with a paid mirror"
  );
  await db.query("select public.billing_set_entitlement_scope($1,true)", [
    scope
  ]);
  assert.equal(await eligible(), true);
  const paidTiming = (
    await db.query(
      "select regular_pack_interval_seconds r,decision_pack_interval_seconds d,extract(epoch from(next_regular_pack_at-clock_timestamp())) seconds from public.user_profiles where user_id=$1",
      [owner]
    )
  ).rows[0];
  assert.equal(paidTiming.r, 300);
  assert.equal(paidTiming.d, 43200);
  assert.ok(
    Number(paidTiming.seconds) > 295 && Number(paidTiming.seconds) <= 300
  );
  assert.equal(
    (await status()).available,
    0,
    "upgrade preserves progress rather than minting a reserve"
  );
  assert.equal((await status()).maximum, 10);
  await admin();
  await db.query(
    "update public.user_profiles set next_regular_pack_at=clock_timestamp()-interval '45 minutes' where user_id=$1",
    [owner]
  );
  const fullProReserve = await status();
  assert.equal(fullProReserve.reserve, 10);
  assert.equal(fullProReserve.maximum, 10);
  await admin();
  await db.query(
    "update public.user_profiles set next_regular_pack_at=clock_timestamp(),next_decision_pack_at=clock_timestamp() where user_id=$1",
    [owner]
  );
  await login(owner);
  const drawn = (await db.query("select public.open_regular_pack() value"))
    .rows[0].value;
  assert.equal(drawn.length, 5);
  assert.equal((await status()).refillSeconds, 300);
  await assert.rejects(
    db.query("select public.open_regular_pack()"),
    /PACK_NOT_READY/
  );
  await db.query("select public.open_decision_pack()");
  const decision = (
    await db.query("select public.get_decision_pack_status() value")
  ).rows[0].value;
  assert.equal(decision.refillSeconds, 43200);
  assert.equal(decision.pending.length, 5);
  await db.query(
    "select public.update_profile('Paid showcase',null,$1::uuid[],null)",
    [copies.slice(0, 10)]
  );
  await assert.rejects(
    db.query("select public.update_profile('',null,$1::uuid[],null)", [
      copies.slice(0, 11)
    ]),
    /FEATURED_CARDS_INVALID/
  );
  for (const id of copies.slice(0, 10))
    await db.query("select public.create_auction($1,10,60)", [id]);
  await assert.rejects(
    db.query("select public.create_auction($1,10,60)", [copies[10]]),
    /AUCTION_LIMIT_REACHED/
  );
  await admin();
  await db.query(
    "update public.billing_accounts set risk_hold=true where user_id=$1",
    [owner]
  );
  assert.equal(await eligible(), false);
  assert.equal((await status()).refillSeconds, 300);
  assert.equal((await status()).maximum, 5);
  await login(owner);
  await assert.rejects(
    db.query("select public.create_auction($1,10,60)", [copies[10]]),
    /AUCTION_LIMIT_REACHED/
  );
  await db.query(
    "select public.update_profile('Biography after downgrade',null,$1::uuid[],null)",
    [copies.slice(0, 10)]
  );
  await assert.rejects(
    db.query("select public.update_profile('',null,$1::uuid[],null)", [
      copies.slice(0, 6)
    ]),
    /FEATURED_CARDS_INVALID/
  );
  await admin();
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.auctions where seller_id=$1 and status='active'",
        [owner]
      )
    ).rows[0].n,
    10
  );
  assert.equal(
    (
      await db.query(
        "select cardinality(featured_card_ids) n from public.user_profiles where user_id=$1",
        [owner]
      )
    ).rows[0].n,
    10
  );
  for (const patch of [
    "risk_hold=false,active=false,status='incomplete'",
    "active=true,status='past_due'",
    "status='active',period_end=clock_timestamp()-interval '1 second'",
    "period_end=clock_timestamp()+interval '1 month',verified_at=clock_timestamp()-interval '16 minutes'",
    "verified_at=clock_timestamp(),scope='live:acct_fixture:price_fixture'"
  ]) {
    await db.query(
      `update public.billing_accounts set ${patch} where user_id=$1`,
      [owner]
    );
    assert.equal(await eligible(), false);
  }
  await db.query(
    "update public.billing_accounts set scope=$2 where user_id=$1",
    [owner, scope]
  );
  assert.equal(await eligible(), true);
  await db.query("select public.billing_set_entitlement_scope($1,false)", [
    scope
  ]);
  assert.equal(await eligible(), false);
  assert.equal((await status()).refillSeconds, 300);
  await login(other);
  await assert.rejects(
    db.query("select public.update_profile('',null,$1::uuid[],null)", [
      copies.slice(0, 5)
    ]),
    /CARD_NOT_OWNED/
  );
  await admin();
  const basicCopies = [];
  for (let index = 0; index < 6; index++)
    basicCopies.push(
      (
        await db.query(
          "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'SSR') returning id",
          [other, card]
        )
      ).rows[0].id
    );
  await login(other);
  for (const id of basicCopies.slice(0, 5))
    await db.query("select public.create_auction($1,10,60)", [id]);
  await assert.rejects(
    db.query("select public.create_auction($1,10,60)", [basicCopies[5]]),
    /AUCTION_LIMIT_REACHED/
  );
  // Use the exact fenced persistence RPC called by the verified Stripe service:
  // an unpaid state grants nothing, a paid state triggers timers in the same commit.
  await admin();
  await db.exec("set role service_role");
  await db.query("select public.billing_set_entitlement_scope($1,true)", [
    scope
  ]);
  const account = (
    await db.query("select public.billing_claim($1,$2) value", [other, scope])
  ).rows[0].value;
  const save = state =>
    db.query(
      "select public.billing_save($1,$2,null,null,false,$3,null,false,false,false)",
      [account.id, account.lease_token, JSON.stringify(state)]
    );
  const state = {
    active: false,
    status: "incomplete",
    endsAt: Math.floor(Date.now() / 1000) + 86400,
    cancelAtPeriodEnd: false
  };
  await save(state);
  assert.equal(
    (await db.query("select public.billing_has_game_pro($1) value", [other]))
      .rows[0].value,
    false
  );
  await save({ ...state, active: true, status: "active" });
  assert.equal(
    (await db.query("select public.billing_has_game_pro($1) value", [other]))
      .rows[0].value,
    true
  );
  await login(other);
  assert.equal(
    (await db.query("select public.get_regular_pack_status() value")).rows[0]
      .value.refillSeconds,
    300
  );
  await db.query("select public.create_auction($1,10,60)", [basicCopies[5]]);
});
