import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const id = n => `99300000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("unlimited auctions require both live admin and Pro privileges; other caps and card protections remain enforced", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (let n = 1; n <= 4; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [
        id(n),
        JSON.stringify({
          pseudo: `AuctionPolicy${n}`,
          is_admin: true,
          is_pro: true,
          role: "admin"
        })
      ]
    );
  await db.query("insert into public.admin_users(user_id) values($1),($2)", [
    id(1),
    id(2)
  ]);
  for (const n of [1, 3])
    await db.query(
      "insert into public.pro_access_grants(user_id,reason,expires_at) values($1,'Auction policy fixture',clock_timestamp()+interval '1 day')",
      [id(n)]
    );
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source) values('admin-pro-auction','Fixture','ANIME/MANGA','SSR','https://example.test/card.png','test') returning id"
    )
  ).rows[0].id;
  const copies = {};
  for (let n = 1; n <= 4; n++)
    copies[n] = (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity) select $1,$2,'SSR' from generate_series(1,18) returning id",
        [id(n), card]
      )
    ).rows.map(r => r.id);
  const asPlayer = async (n, sql, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(n)
    ]);
    await db.exec("set role authenticated");
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const create = (n, index, price = 10, duration = 60) =>
    asPlayer(n, "select public.create_auction($1,$2,$3) id", [
      copies[n][index],
      price,
      duration
    ]);
  const active = async n =>
    (
      await db.query(
        "select count(*)::integer n from public.auctions where seller_id=$1 and status='active'",
        [id(n)]
      )
    ).rows[0].n;
  for (const [n, cap] of [
    [2, 5],
    [3, 10],
    [4, 5]
  ]) {
    for (let i = 0; i < cap; i++) await create(n, i);
    await assert.rejects(create(n, cap), /AUCTION_LIMIT_REACHED/);
    assert.equal(await active(n), cap);
  }
  for (let i = 0; i < 12; i++) await create(1, i);
  assert.equal(
    await active(1),
    12,
    "Admin Pro can list beyond both standard caps"
  );
  await assert.rejects(
    asPlayer(1, "select public.create_auction($1,10,60)", [copies[4][10]]),
    /CARD_NOT_OWNED/
  );
  await db.query("update public.user_cards set is_locked=true where id=$1", [
    copies[1][17]
  ]);
  await assert.rejects(create(1, 17), /CARD_LOCKED/);
  await assert.rejects(create(1, 0), /CARD_FROZEN/);
  await assert.rejects(create(1, 12, 9), /INVALID_AUCTION_PRICE/);
  await assert.rejects(create(1, 12, 10, 1), /INVALID_AUCTION_DURATION/);
  assert.equal(await active(1), 12);
  // Untrusted metadata does not grant access to either server-side privilege.
  for (const sql of [
    "insert into public.admin_users(user_id) values($1)",
    "insert into public.pro_access_grants(user_id,reason) values($1,'Fake client grant')"
  ])
    await assert.rejects(asPlayer(4, sql, [id(4)]), /permission denied/);
  await db.query("delete from public.admin_users where user_id=$1", [id(1)]);
  await assert.rejects(create(1, 12), /AUCTION_LIMIT_REACHED/);
  assert.equal(await active(1), 12, "Revocation preserves existing sales");
  await db.query("insert into public.admin_users(user_id) values($1)", [id(1)]);
  await db.query(
    "update public.pro_access_grants set expires_at=clock_timestamp()-interval '1 second' where user_id=$1",
    [id(1)]
  );
  await assert.rejects(create(1, 12), /AUCTION_LIMIT_REACHED/);
  await db.query(
    "update public.pro_access_grants set expires_at=clock_timestamp()+interval '1 day' where user_id=$1",
    [id(1)]
  );
  await create(1, 12);
  assert.equal(await active(1), 13);
  // A verified Stripe entitlement also qualifies, then risk/expiry revokes it.
  await db.query("delete from public.pro_access_grants where user_id=$1", [
    id(1)
  ]);
  const scope = "test:acct_auctionadmin:price_auctionadmin";
  await db.query("select public.billing_set_entitlement_scope($1,true)", [
    scope
  ]);
  await db.query(
    "insert into public.billing_accounts(user_id,scope,active,status,period_end,verified_at) values($1,$2,true,'active',clock_timestamp()+interval '1 month',clock_timestamp())",
    [id(1), scope]
  );
  await create(1, 13);
  assert.equal(await active(1), 14);
  await db.query(
    "update public.billing_accounts set risk_hold=true where user_id=$1",
    [id(1)]
  );
  await assert.rejects(create(1, 14), /AUCTION_LIMIT_REACHED/);
  await db.query(
    "update public.billing_accounts set risk_hold=false,period_end=clock_timestamp()-interval '1 second' where user_id=$1",
    [id(1)]
  );
  await assert.rejects(create(1, 14), /AUCTION_LIMIT_REACHED/);
  await db.query(
    "update public.billing_accounts set period_end=clock_timestamp()+interval '1 month',verified_at=clock_timestamp()-interval '20 minutes' where user_id=$1",
    [id(1)]
  );
  await assert.rejects(create(1, 14), /AUCTION_LIMIT_REACHED/);
  assert.equal(await active(1), 14);
  await db.query(
    "update public.billing_accounts set verified_at=clock_timestamp() where user_id=$1",
    [id(1)]
  );
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [id(1)]
  );
  await assert.rejects(create(1, 14), /ACCOUNT_BANNED/);
  assert.equal(await active(1), 14);
  await db.query("update auth.users set banned_until=null where id=$1", [
    id(1)
  ]);
  await create(1, 14);
  assert.equal(await active(1), 15);
  await assert.rejects(
    db.query("select public.create_auction($1,10,60)", [copies[1][15]]),
    /AUTH_REQUIRED/
  );
  for (const role of ["anon", "service_role"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query("select public.create_auction($1,10,60)", [copies[1][15]]),
      /permission denied/
    );
    await db.exec("reset role");
  }
});
