import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("account exceptions and admins bypass detection without exempting their IP or counterpart", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column created_at timestamptz not null default now(),add column banned_until timestamptz,add column updated_at timestamptz;create table auth.sessions(user_id uuid)"
  );
  const users = [1, 2, 3, 4, 5].map(
    i => `ac590000-0000-4000-8000-00000000000${i}`
  );
  const [excepted, admin, parent, child1, child2] = users;
  const ip = "v1:" + "a".repeat(64);
  const browser = "v1:" + "b".repeat(64);
  for (const [i, id] of users.entries()) {
    await db.query(
      "insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values($1,now(),$2)",
      [id, JSON.stringify({ pseudo: `ExemptionPlayer${i}` })]
    );
    await db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2)",
      [ip, id]
    );
    await db.query(
      "insert into public.anticheat_device_observations(device_identity,user_id) values($1,$2)",
      [browser, id]
    );
  }
  await db.query("select public.apply_account_ban_core($1,true,null)", [
    excepted
  ]);
  await db.query(
    `
    insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
      cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status,metadata)
    select 'exception-test-ban:'||$1::text,$1::uuid,'FARM_BAN','AFFILIATE_ABUSE','NONE','NONE',
      0,0,0,0,now(),now(),'APPLIED',jsonb_build_object('banAuditId',id)
    from public.admin_audit_logs where action='player.ban' and metadata->>'target_user_id'=$1::text
    order by id desc limit 1
  `,
    [excepted]
  );
  await db.query(
    "insert into public.anticheat_account_exemptions(user_id,reason) values($1,'Approved household exception')",
    [excepted]
  );
  assert.equal(
    (
      await db.query(
        "select public.reconcile_exempt_anticheat_account($1) as result",
        [excepted]
      )
    ).rows[0].result,
    1
  );
  assert.equal(
    (
      await db.query(
        "select public.reconcile_exempt_anticheat_account($1) as result",
        [excepted]
      )
    ).rows[0].result,
    0
  );
  assert.equal(
    (
      await db.query("select banned_until from auth.users where id=$1", [
        excepted
      ])
    ).rows[0].banned_until,
    null
  );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  for (const id of [excepted, admin]) {
    assert.equal(
      (
        await db.query("select public.anticheat_account_exempt($1) as result", [
          id
        ])
      ).rows[0].result,
      true
    );
    assert.equal(
      (
        await db.query(
          "select public.record_anticheat_network_observation($1,$2) as result",
          [id, ip]
        )
      ).rows[0].result,
      false
    );
    assert.equal(
      (
        await db.query(
          "select public.record_anticheat_device_observation($1,$2) as result",
          [id, browser]
        )
      ).rows[0].result,
      false
    );
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::int as total from public.anticheat_network_observations where user_id=any($1)",
        [[excepted, admin]]
      )
    ).rows[0].total,
    0
  );
  await db.query(
    "update public.user_profiles set pseudo='RenamedException' where user_id=$1",
    [excepted]
  );
  assert.equal(
    (
      await db.query("select public.anticheat_account_exempt($1) as result", [
        excepted
      ])
    ).rows[0].result,
    true
  );
  for (const [from, to, expected] of [
    [excepted, parent, false],
    [admin, parent, false],
    [parent, child1, true]
  ]) {
    await db.query(
      "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
      [from, to]
    );
    const { rows } = await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_karas) values($1,$2,1) returning id",
      [from, to]
    );
    assert.equal(
      (
        await db.query(
          "select public.anticheat_trade_shares_connection(t) as result from public.trade_offers t where id=$1",
          [rows[0].id]
        )
      ).rows[0].result,
      expected
    );
  }
  assert.equal(
    (
      await db.query(
        "select public.record_anticheat_event('trade_created',$1,$2,null) as result",
        [excepted, parent]
      )
    ).rows[0].result,
    null
  );
  assert.equal(
    (
      await db.query(
        "select public.record_anticheat_context_signal('trade_shared_network_identity',$1,$2,null,10,'TRADE_SHARED_NETWORK_IDENTITY') as result",
        [admin, parent]
      )
    ).rows[0].result,
    null
  );

  const code = (
    await db.query(
      "insert into public.referral_codes(user_id,code) values($1,'abcdefabcdef') returning id",
      [parent]
    )
  ).rows[0].id;
  for (const id of [child1, child2]) {
    await db.query(
      "insert into public.referrals(code_id,referrer_id,referred_id,verified_at) values($1,$2,$3,now())",
      [code, parent, id]
    );
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::int as total from public.anticheat_referral_farm_candidates($1)",
        [parent]
      )
    ).rows[0].total,
    2
  );
  await db.query(
    "insert into public.anticheat_account_exemptions(user_id,reason) values($1,'Another approved individual exception')",
    [child1]
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as total from public.anticheat_referral_farm_candidates($1)",
        [parent]
      )
    ).rows[0].total,
    0
  );
  assert.equal(
    (
      await db.query("select public.anticheat_account_exempt($1) as result", [
        child2
      ])
    ).rows[0].result,
    false
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query(
        "insert into public.anticheat_account_exemptions(user_id,reason) values($1,'Self bypass attempt')",
        [child2]
      ),
      /permission denied/
    );
    await assert.rejects(
      db.query("select public.anticheat_account_exempt($1)", [child2]),
      /permission denied/
    );
    await db.exec("reset role");
  }
});
