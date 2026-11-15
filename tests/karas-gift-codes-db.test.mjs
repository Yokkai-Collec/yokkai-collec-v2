import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("only admins issue secret codes and one valid redemption credits exactly once", async t => {
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
  const redeem = code =>
    value("select public.redeem_karas_gift_code($1) value", [code]);

  await db.exec("set role anon");
  await assert.rejects(redeem("not-a-code"), /permission denied/);
  await assert.rejects(create(100, "Anonymous"), /permission denied/);
  await login(recipient);
  await assert.rejects(create(100, "Forged"), /GIFT_CODE_FORBIDDEN/);
  await assert.rejects(
    db.exec("select * from public.karas_gift_codes"),
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
  await assert.rejects(redeem(code), /GIFT_CODE_UNAVAILABLE/);

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
  await db.query("delete from auth.users where id=$1", [recipient]);
  await login(other);
  await assert.rejects(redeem(code), /GIFT_CODE_UNAVAILABLE/);
});
