import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("manual warnings are private, durable, and acknowledged only by the recipient", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const [admin, recipient, other, warning, second, missing] = [
    1, 2, 3, 4, 5, 6
  ].map(n => `18000000-0000-4000-8000-00000000000${n}`);
  await db.exec("alter table auth.users add column banned_until timestamptz");
  for (const [id, name] of [
    [admin, "WarningAdmin"],
    [recipient, "WarnedPlayer"],
    [other, "OtherPlayer"]
  ]) {
    await db.query(
      "insert into auth.users(id, raw_user_meta_data) values ($1, $2)",
      [id, JSON.stringify({ pseudo: name })]
    );
  }
  await db.query("insert into public.admin_users(user_id) values ($1)", [
    admin
  ]);

  async function login(id) {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      id
    ]);
  }
  const send = (id, userId, reason) =>
    db.query("select public.admin_send_player_warning($1, $2, $3)", [
      id,
      userId,
      reason
    ]);
  const acknowledge = async id =>
    (await db.query("select public.acknowledge_player_warning($1) as ok", [id]))
      .rows[0].ok;
  const pending = async () =>
    (
      await db.query(
        "select id, reason from public.player_warnings where acknowledged_at is null order by created_at, id"
      )
    ).rows;

  await db.exec("set role anon");
  await assert.rejects(
    send(warning, recipient, "Anonymous"),
    /permission denied/
  );
  await assert.rejects(acknowledge(warning), /permission denied/);
  await assert.rejects(pending(), /permission denied/);
  await login(other);
  await assert.rejects(send(warning, recipient, "Forged"), /ADMIN_REQUIRED/);
  await assert.rejects(
    db.exec("update public.player_warnings set acknowledged_at=now()"),
    /permission denied/
  );

  await login(admin);
  await assert.rejects(
    send(warning, recipient, " \n\t "),
    /INVALID_PLAYER_WARNING/
  );
  await assert.rejects(
    send(warning, recipient, "A".repeat(501)),
    /INVALID_PLAYER_WARNING/
  );
  await assert.rejects(
    send(warning, missing, "Missing account"),
    /foreign key/
  );
  const reason = "Respect the other players.\nPlease read the rules.";
  await send(warning, recipient, ` ${reason} \n`);
  await send(warning, recipient, reason);
  await assert.rejects(send(warning, other, reason), /INVALID_PLAYER_WARNING/);
  await send(second, recipient, "Second warning");
  assert.deepEqual(await pending(), []);
  assert.equal(await acknowledge(warning), false);

  await login(other);
  assert.deepEqual(await pending(), []);
  assert.equal(await acknowledge(warning), false);
  await login(recipient);
  assert.deepEqual(await pending(), [
    { id: warning, reason },
    { id: second, reason: "Second warning" }
  ]);
  await assert.rejects(
    db.exec("select created_by from public.player_warnings"),
    /permission denied/
  );
  assert.equal(await acknowledge(warning), true);
  assert.equal(await acknowledge(warning), true);
  assert.deepEqual(await pending(), [{ id: second, reason: "Second warning" }]);
});
