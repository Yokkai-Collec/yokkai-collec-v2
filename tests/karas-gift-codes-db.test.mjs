import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("only admins issue codes and each redemption follows the selected usage mode", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());

  const [admin, recipient, other] = [1, 2, 3].map(
    id => `14100000-0000-4000-8000-00000000000${id}`
  );
  for (const [index, player] of [admin, recipient, other].entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [player, JSON.stringify({ pseudo: `GiftPlayer${index}` })]
    );
  }
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await db.exec("alter table auth.users add column banned_until timestamptz");

  async function login(player) {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      player
    ]);
  }
  async function value(sql, args) {
    return (await db.query(sql, args)).rows[0].value;
  }
  const balance = player =>
    value(
      "select karas_balance value from public.user_profiles where user_id=$1",
      [player]
    );
  const create = (amount, message) =>
    value("select public.admin_create_karas_gift_code($1,$2) value", [
      amount,
      message
    ]);
  const createShareable = (amount, message) =>
    value("select public.admin_create_karas_gift_code($1,$2,true) value", [
      amount,
      message
    ]);
  const redeem = code =>
    value("select public.redeem_karas_gift_code($1) value", [code]);
  const history = (page = 1, giftId = null) =>
    value("select public.admin_get_karas_gift_history($1,$2) value", [
      page,
      giftId
    ]);

  await db.exec("set role anon");
  await assert.rejects(redeem("not-a-code"), /permission denied/);
  await assert.rejects(create(100, "Anonymous"), /permission denied/);
  await assert.rejects(history(), /permission denied/);
  await login(recipient);
  await assert.rejects(create(100, "Forged"), /GIFT_CODE_FORBIDDEN/);
  await assert.rejects(history(), /GIFT_CODE_FORBIDDEN/);
  await assert.rejects(
    db.exec("select * from public.karas_gift_codes"),
    /permission denied/
  );

  await assert.rejects(
    db.exec("select * from public.karas_gift_redemptions"),
    /permission denied/
  );

  await login(admin);
  const message = "Merci <3\nBon jeu !";
  const code = await create(375, message);
  const spareCode = await create(250, "Deuxième cadeau");
  assert.match(code, /^[0-9A-F]{4}(?:-[0-9A-F]{4}){5}$/);
  assert.notEqual(code, spareCode);
  await assert.rejects(create(0, message), /GIFT_CODE_DETAILS_INVALID/);
  await assert.rejects(create(5, " \n\t "), /GIFT_CODE_DETAILS_INVALID/);
  await assert.rejects(create(5, "A".repeat(501)), /GIFT_CODE_DETAILS_INVALID/);

  await db.exec("reset role");
  const originalBalance = await balance(recipient);
  assert.equal(
    await value(
      "select count(*)::int value from public.karas_gift_codes where created_by=$1 and octet_length(code_hash)=32",
      [admin]
    ),
    2
  );
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    recipient
  ]);
  await login(recipient);
  await assert.rejects(redeem(code), /ACCOUNT_BANNED/);
  await db.exec("reset role");
  await db.query("update auth.users set banned_until=null where id=$1", [
    recipient
  ]);
  await db.exec("update public.economic_maintenance_state set active=true");
  await login(recipient);
  await assert.rejects(redeem(code), /ECONOMIC_MAINTENANCE/);
  await db.exec("reset role");
  await db.exec("update public.economic_maintenance_state set active=false");

  await login(recipient);
  await assert.rejects(redeem("wrong code"), /GIFT_CODE_UNAVAILABLE/);
  assert.deepEqual(await redeem(code.toLowerCase().replaceAll("-", " ")), {
    amount: 375,
    message,
    alreadyRedeemed: false
  });
  assert.deepEqual(await redeem(code), {
    amount: 375,
    message,
    alreadyRedeemed: true
  });
  await login(other);
  await assert.rejects(redeem(code), /GIFT_CODE_ALREADY_USED/);

  await db.exec("reset role");
  assert.equal(await balance(recipient), originalBalance + 375);
  await db.query(
    "update public.user_profiles set karas_balance=2147483647 where user_id=$1",
    [other]
  );
  await login(other);
  await assert.rejects(redeem(spareCode), /GIFT_CODE_BALANCE_LIMIT/);
  await db.exec("reset role");
  await db.query(
    "update public.user_profiles set karas_balance=0 where user_id=$1",
    [other]
  );
  await login(other);
  assert.equal((await redeem(spareCode)).amount, 250);

  await db.exec("reset role");
  const beforeShared = await balance(recipient);
  await login(admin);
  await assert.rejects(
    value("select public.admin_create_karas_gift_code(80,$1,null) value", [
      message
    ]),
    /GIFT_CODE_DETAILS_INVALID/
  );
  const sharedCode = await createShareable(80, message);
  await login(recipient);
  assert.deepEqual(await redeem(sharedCode), {
    amount: 80,
    message,
    alreadyRedeemed: false
  });
  await login(other);
  assert.deepEqual(await redeem(sharedCode), {
    amount: 80,
    message,
    alreadyRedeemed: false
  });
  assert.deepEqual(await redeem(sharedCode), {
    amount: 80,
    message,
    alreadyRedeemed: true
  });
  await login(recipient);
  assert.equal((await redeem(sharedCode)).alreadyRedeemed, true);
  await db.exec("reset role");
  assert.equal(await balance(recipient), beforeShared + 80);
  assert.equal(await balance(other), 330);

  await login(admin);
  const listing = await history(2147483647);
  assert.equal(listing.page, 1);
  assert.equal(listing.total, 3);
  const single = listing.items.find(item => item.amount === 375);
  const shared = listing.items.find(item => item.amount === 80);
  assert.equal(single.suffix, code.slice(-4));
  assert.equal(single.creatorName, "GiftPlayer0");
  assert.equal(single.redemptionCount, 1);
  assert.equal(shared.redemptionCount, 2);
  assert.ok(!JSON.stringify(listing).includes(code));
  assert.ok(!JSON.stringify(listing).includes("hash"));
  const singleUses = await history(1, single.id);
  assert.equal(singleUses.items[0].recipientName, "GiftPlayer1");
  assert.ok(singleUses.items[0].redeemedAt);
  assert.deepEqual(
    (await history(1, shared.id)).items.map(item => item.recipientId).sort(),
    [recipient, other]
  );

  await db.exec("reset role");
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  await db.exec("set role service_role");
  const request = "14100000-0000-4000-8000-000000000004";
  await db.query("select public.reserve_data_export($1,$2)", [
    recipient,
    request
  ]);
  const exported = await value("select public.build_data_export($1,$2) value", [
    recipient,
    request
  ]);
  assert.deepEqual(
    exported.karas_gifts_received
      .map(gift => gift.amount)
      .sort((a, b) => a - b),
    [80, 375]
  );
  for (const gift of exported.karas_gifts_received) {
    assert.deepEqual(Object.keys(gift).sort(), [
      "amount",
      "message",
      "redeemed_at"
    ]);
    assert.equal(gift.message, message);
    assert.ok(gift.redeemed_at);
  }

  await db.exec("reset role");
  await db.query("delete from auth.users where id=$1", [recipient]);
  await login(other);
  await assert.rejects(redeem(code), /GIFT_CODE_ALREADY_USED/);
  await login(admin);
  assert.equal(
    (await history()).items.find(item => item.id === single.id).redemptionCount,
    1
  );
  assert.equal((await history(1, single.id)).total, 0);
});

test("the gift history migration includes earlier codes and preserves known uses", async t => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migration = "20261120006000_karas_gift_history.sql";
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(name => name.endsWith(".sql") && name < migration)
      .sort()
  });
  t.after(() => db.close());
  const recipient = "14200000-0000-4000-8000-000000000001";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
    [recipient, JSON.stringify({ pseudo: "LegacyGiftPlayer" })]
  );
  await db.exec(`
    insert into public.karas_gift_codes(code_hash,amount,message,consumed_at)
      values(sha256('earlier single'::bytea),50,'Earlier single',now());
    insert into public.karas_gift_codes(code_hash,amount,message,shareable)
      values(sha256('earlier shared'::bytea),75,'Earlier shared',true);
  `);
  await db.query(
    "insert into public.karas_gift_redemptions(code_hash,recipient_id) values(sha256('earlier shared'::bytea),$1)",
    [recipient]
  );
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  const { rows } = await db.query(`
    select history_id, code_suffix, redemption_count::int
    from public.karas_gift_codes order by amount
  `);
  assert.equal(new Set(rows.map(row => row.history_id)).size, 2);
  for (const row of rows) {
    assert.match(row.history_id, /^[0-9a-f-]{36}$/);
    assert.equal(row.code_suffix, null);
    assert.equal(row.redemption_count, 1);
  }
});
