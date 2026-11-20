import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("the admin timeline combines warnings, bans, lifts and sanctions without exposing raw evidence", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const [admin, player, other] = [1, 2, 3].map(
    n => `18000000-0000-4000-8000-00000000001${n}`
  );
  await db.exec("alter table auth.users add column banned_until timestamptz");
  for (const [id, pseudo] of [
    [admin, "Moderator"],
    [player, "HistoryPlayer"],
    [other, "HistoryOther"]
  ]) {
    await db.query(
      "insert into auth.users(id, raw_user_meta_data) values($1, $2)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await db.query(
    "update auth.users set banned_until = now() + interval '1 day' where id=$1",
    [player]
  );
  await db.query(
    `
    insert into public.player_warnings(id, user_id, created_by, reason, created_at, acknowledged_at)
    select gen_random_uuid(), $1, $2, 'Warning ' || n, now() - n * interval '1 day',
      case when n=1 then now() - interval '1 hour' end
    from generate_series(1, 11) n`,
    [player, admin]
  );
  await db.query(
    `
    insert into public.admin_audit_logs(admin_user_id, action, created_at, metadata) values
      ($2, 'player.ban', now()-interval '5 hours', jsonb_build_object('target_user_id', $1::text, 'reason', 'Manual ban', 'privateEvidence', 'secret evidence')),
      ($2, 'player.unban', now()-interval '4 hours', jsonb_build_object('target_user_id', $1::text, 'reason', 'Lifted after review')),
      ($2, 'player.ban', now()-interval '1 hour', jsonb_build_object('target_user_id', $3::text))`,
    [player, admin, other]
  );
  await db.query(
    `
    with audit as (
      insert into public.admin_audit_logs(admin_user_id, action, created_at, metadata)
      values(null,'player.ban',now()-interval '3 hours',jsonb_build_object('target_user_id',$1::uuid::text)) returning id
    )
    insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
      cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
    select 'history-shared-trade-ban',$1,'SHARED_TRADE_BAN','SHARED_TRADE_CONNECTION','NONE','NONE',
      0,0,0,0,now()-interval '3 hours',now()-interval '3 hours','ROLLED_BACK',
      jsonb_build_object('banAuditId',audit.id,'privateEvidence','secret evidence')
    from audit`,
    [player]
  );
  await db.query(
    `
    with receipt as (
      insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
        cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status)
      values('history-farm-suspension',$1,'FARM_SUSPENSION','AFFILIATE_ABUSE','NONE','NONE',
        0,0,0,0,now()-interval '1 day',now()-interval '1 day','APPLIED') returning id,applied_at
    )
    insert into public.anticheat_farm_suspensions(user_id,receipt_id,warning_receipts,applied_at,ends_at)
    select $1,id,array[id,id,id],applied_at,applied_at+interval '48 hours' from receipt`,
    [player]
  );

  const history = async (userId, page = 1) =>
    (
      await db.query(
        "select public.admin_get_player_moderation_history($1,$2) value",
        [userId, page]
      )
    ).rows[0].value;
  async function login(id) {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      id
    ]);
  }

  await db.exec("set role anon");
  await assert.rejects(history(player), /permission denied/);
  await login(other);
  await assert.rejects(history(player), /ADMIN_REQUIRED/);
  await login(admin);
  const first = await history(player);
  assert.equal(first.total, 15);
  assert.equal(first.items.length, 10);
  assert.equal(first.restriction, "temporary");
  assert.ok(first.restrictionEndsAt);
  assert.deepEqual(
    first.items.slice(0, 3).map(item => item.kind),
    ["sanction", "unban", "ban"]
  );
  assert.equal(first.items[0].receiptType, "SHARED_TRADE_BAN");
  assert.equal(first.items[0].receiptState, "ROLLED_BACK");
  assert.equal(first.items[1].reason, "Lifted after review");
  assert.equal(first.items[2].actor, "Moderator");
  assert.ok(
    first.items.find(item => item.receiptType === "FARM_SUSPENSION").endsAt
  );
  assert.ok(
    first.items.find(item => item.reason === "Warning 1").acknowledgedAt
  );
  assert.equal(
    first.items.find(item => item.reason === "Warning 2").acknowledgedAt,
    null
  );
  assert.doesNotMatch(JSON.stringify(first), /privateEvidence|secret evidence/);
  const older = await history(player, 20);
  assert.equal(older.page, 2);
  assert.equal(older.items.length, 5);
  assert.equal(older.items.at(-1).reason, "Warning 11");
  assert.equal((await history(other)).total, 1);

  await db.exec("reset role");
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    player
  ]);
  await login(player);
  await assert.rejects(history(player), /ACCOUNT_BANNED/);
  await login(admin);
  const banned = await history(player);
  assert.equal(banned.restriction, "permanent");
  assert.equal(banned.restrictionEndsAt, null);
});
