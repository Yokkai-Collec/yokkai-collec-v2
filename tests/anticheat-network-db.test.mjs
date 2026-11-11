import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("network identities are private, expiring context and shared-network trades are flagged", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`
    alter table auth.users add column if not exists banned_until timestamptz;
    alter table auth.users add column if not exists updated_at timestamptz;
    alter table auth.users add column if not exists created_at timestamptz;
  `);
  const first = "ac300000-0000-4000-8000-000000000001";
  const second = "ac300000-0000-4000-8000-000000000002";
  const admin = "ac300000-0000-4000-8000-000000000003";
  for (const [id, pseudo] of [
    [first, "NetworkOne"],
    [second, "NetworkTwo"],
    [admin, "NetworkAdmin"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);

  const identity = `v1:${"a".repeat(64)}`;
  await db.query(
    "insert into public.anticheat_network_observations(network_identity,user_id,first_seen_at,last_seen_at) values($1,$2,now()-interval '8 days',now()-interval '8 days')",
    [`v1:${"b".repeat(64)}`, first]
  );
  await db.exec(
    "select set_config('request.jwt.claim.role','service_role',false); set role service_role"
  );
  await db.query("select public.record_anticheat_network_observation($1,$2)", [
    first,
    identity
  ]);
  await db.query("select public.record_anticheat_network_observation($1,$2)", [
    second,
    identity
  ]);
  await db.exec("reset role");

  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from public.anticheat_network_observations"
      )
    ).rows[0].total,
    2,
    "the write purges observations older than seven days"
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from public.anticheat_events where event_type='network_identity_shared'"
      )
    ).rows[0].total,
    1
  );
  const networkSubjects = (
    await db.query(
      "select risk_points,reason_codes from public.anticheat_event_subjects s join public.anticheat_events e on e.id=s.event_id where e.event_type='network_identity_shared' order by s.user_id"
    )
  ).rows;
  assert.deepEqual(networkSubjects, [
    { risk_points: 3, reason_codes: ["SHARED_NETWORK_IDENTITY"] },
    { risk_points: 3, reason_codes: ["SHARED_NETWORK_IDENTITY"] }
  ]);

  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [first, second]
  );
  const trade = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_karas) values($1,$2,10) returning id",
      [first, second]
    )
  ).rows[0].id;
  await db.query(
    "update public.trade_offers set status='accepted' where id=$1",
    [trade]
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from public.anticheat_events where event_type='trade_shared_identity' and subject_id=$1",
        [trade]
      )
    ).rows[0].total,
    1
  );

  const asAuthenticated = async (user, sql, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec("set role authenticated");
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec("reset role");
    }
  };
  await assert.rejects(
    asAuthenticated(
      first,
      "select public.record_anticheat_network_observation($1,$2)",
      [first, identity]
    ),
    /permission denied/
  );
  await assert.rejects(
    asAuthenticated(
      first,
      "select * from public.anticheat_network_observations"
    ),
    /permission denied/
  );
  await assert.rejects(
    asAuthenticated(
      first,
      "select public.admin_review_anticheat_case($1,'reviewed','Not allowed')",
      [first]
    ),
    /ADMIN_REQUIRED/
  );

  await asAuthenticated(
    admin,
    "select public.admin_review_anticheat_case($1,'reviewed','Reviewed economic and network evidence.')",
    [first]
  );
  const reviewed = (
    await db.query(
      "select status,reviewed_by from public.anticheat_cases where user_id=$1",
      [first]
    )
  ).rows[0];
  assert.deepEqual(reviewed, { status: "reviewed", reviewed_by: admin });
  await assert.rejects(
    db.query("update public.anticheat_case_reviews set note='Changed'"),
    /ANTICHEAT_LEDGER_IMMUTABLE/
  );
  await asAuthenticated(
    admin,
    "select public.admin_review_anticheat_case($1,'dismissed','Shared household reviewed as a false positive.')",
    [first]
  );
  const dismissedCases = (
    await asAuthenticated(
      admin,
      "select public.admin_list_anticheat_cases('NetworkOne') value"
    )
  ).rows[0].value;
  assert.equal(dismissedCases.cases[0].score, 0);
  assert.equal(dismissedCases.cases[0].networkLinkedAccounts, 1);
  assert.equal(dismissedCases.cases[0].latestReview.decision, "dismissed");

  await db.query(
    "select public.record_anticheat_event('trade_accepted',$1,$2,null,0,0,$3)",
    [first, second, JSON.stringify({ offeredTotal: 1, requestedTotal: 0 })]
  );
  const reopened = (
    await asAuthenticated(
      admin,
      "select public.admin_list_anticheat_cases('NetworkOne') value"
    )
  ).rows[0].value.cases[0];
  assert.equal(reopened.status, "open");
  assert.ok(reopened.score > 0, "only signals after dismissal rebuild risk");
});
