import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("Discord reward is server-only, atomic and permanent for both identities", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const first = "d1500000-0000-4000-8000-000000000001";
  const second = "d1500000-0000-4000-8000-000000000002";
  await db.query(
    `insert into auth.users(id,raw_user_meta_data,email_confirmed_at)
    values ($1,'{"pseudo":"DiscordFirst"}',now()),($2,'{"pseudo":"DiscordSecond"}',now())`,
    [first, second]
  );
  const claim = async (user, discord) =>
    (
      await db.query("select public.claim_discord_reward($1,$2) value", [
        user,
        discord
      ])
    ).rows[0].value;
  await db.exec("set role authenticated");
  await assert.rejects(claim(first, "123456789012345678"), /permission denied/);
  await db.exec("reset role; set role service_role");
  assert.equal(await claim(first, "123456789012345678"), "claimed");
  assert.equal(await claim(first, "123456789012345678"), "already-claimed");
  assert.equal(await claim(first, "223456789012345678"), "already-claimed");
  assert.equal(await claim(second, "123456789012345678"), "discord-used");
  await assert.rejects(claim(second, "forged"), /INVALID_DISCORD_ID/);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    first
  ]);
  await db.exec("set role authenticated");
  const status = async () =>
    (await db.query("select public.get_discord_reward_status() value")).rows[0]
      .value;
  assert.deepEqual(await status(), { claimed: true, dismissed: false });
  await db.query("select public.dismiss_discord_reward_prompt()");
  await db.query("select public.dismiss_discord_reward_prompt()");
  assert.deepEqual(await status(), { claimed: true, dismissed: true });
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    second
  ]);
  assert.deepEqual(await status(), { claimed: false, dismissed: false });
  await db.exec("reset role");
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  const request = "d1500000-0000-4000-8000-000000000099";
  await db.query("select public.reserve_data_export($1,$2)", [first, request]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [
      first,
      request
    ])
  ).rows[0].value;
  assert.equal(exported.discord_reward.discord_id, "123456789012345678");
  assert.ok(exported.discord_reward.claimed_at);
  assert.ok(exported.discord_reward_prompt.dismissed_at);
  assert.deepEqual(
    (
      await db.query(
        "select bonus_regular_packs from public.user_profiles where user_id in ($1,$2) order by user_id",
        [first, second]
      )
    ).rows.map(r => r.bonus_regular_packs),
    [5, 0]
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    second
  ]);
  await db.exec("set role authenticated");
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.discord_reward_claims"
      )
    ).rows[0].n,
    0
  );
  await assert.rejects(
    db.query("delete from public.discord_reward_claims"),
    /permission denied/
  );
  await db.exec("reset role");
  // Removing an account must not reset the Discord entitlement.
  await db.query("delete from auth.users where id=$1", [first]);
  await db.exec("set role service_role");
  assert.equal(await claim(second, "123456789012345678"), "discord-used");
  assert.equal(await claim(second, "223456789012345678"), "claimed");
});

test("bans, deletion fences and failed credits cannot consume a Discord gift", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const user = "d1500000-0000-4000-8000-000000000003";
  await db.exec("alter table auth.users add column banned_until timestamptz");
  await db.query(
    `insert into auth.users(id,raw_user_meta_data,email_confirmed_at,banned_until)
    values($1,'{"pseudo":"DiscordGuard"}',now(),now()+interval '1 day')`,
    [user]
  );
  const claim = () =>
    db.query("select public.claim_discord_reward($1,'323456789012345678')", [
      user
    ]);
  await assert.rejects(claim(), /ACCOUNT_UNAVAILABLE/);
  await db.query("update auth.users set banned_until=null where id=$1", [user]);
  await db.exec("begin");
  await db.query("select public.begin_account_deletion($1)", [user]);
  await assert.rejects(claim(), /ACCOUNT_DELETED/);
  await db.exec("rollback");
  await db.exec("begin");
  await db.query("delete from public.user_profiles where user_id=$1", [user]);
  await assert.rejects(claim(), /ACCOUNT_UNAVAILABLE/);
  await db.exec("rollback");
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.discord_reward_claims"
      )
    ).rows[0].n,
    0
  );
  assert.equal((await claim()).rows[0].claim_discord_reward, "claimed");
});
