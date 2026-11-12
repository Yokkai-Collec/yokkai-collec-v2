import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the quarantine foundation is private, additive and disabled by default", async () => {
  const migration = await read(
    "supabase/migrations/20261111193000_anticheat_quarantine_shadow_foundation.sql"
  );

  for (const table of [
    "anticheat_runtime_flags",
    "anticheat_quarantines",
    "anticheat_quarantine_audit"
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`)
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on public\\.${table} from public,anon,authenticated,service_role`
      )
    );
  }

  assert.match(migration, /\('quarantine_shadow'\)/);
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(
    migration,
    /not public\.anticheat_runtime_flag_enabled\('quarantine_shadow'\)/
  );
  assert.match(migration, /'SHADOW'/);
  assert.match(migration, /'PENDING_ANALYSIS'/);
  assert.match(migration, /'AWAITING_REVIEW'/);
  assert.match(migration, /'RELEASED'/);
  assert.match(migration, /'CANCELLED'/);
  assert.match(migration, /'EXPIRED'/);
});

test("the shadow evaluator cannot impose a sanction or move an asset", async () => {
  const migration = await read(
    "supabase/migrations/20261111193000_anticheat_quarantine_shadow_foundation.sql"
  );
  const evaluator = migration.match(
    /create function public\.capture_trade_quarantine_shadow\(\)[\s\S]+?revoke all on function public\.capture_trade_quarantine_shadow\(\)/
  )?.[0];
  assert.ok(evaluator);
  assert.match(migration, /after update of status on public\.trade_offers/);
  assert.doesNotMatch(evaluator, /update public\.user_cards/);
  assert.doesNotMatch(evaluator, /update public\.user_profiles/);
  assert.doesNotMatch(evaluator, /update public\.trade_offers set status/);
  assert.doesNotMatch(
    evaluator,
    /admin_set_user_ban|banned_until|delete from auth\.sessions/
  );
});

test("admin quarantine reads are bounded and never expose pseudonymous identifiers", async () => {
  const migration = await read(
    "supabase/migrations/20261111193000_anticheat_quarantine_shadow_foundation.sql"
  );
  const reader = migration.match(
    /create function public\.admin_list_anticheat_quarantines\([\s\S]+?grant execute on function public\.admin_list_anticheat_quarantines\(text,integer,integer\) to authenticated/
  )?.[0];
  assert.ok(reader);
  assert.match(reader, /if not public\.is_current_user_admin\(\)/);
  assert.match(
    reader,
    /p_limit:=least\(greatest\(coalesce\(p_limit,50\),1\),100\)/
  );
  assert.doesNotMatch(reader, /network_identity|device_identity|v[1-9]\[/);
});

test("the audit record is immutable and expiry is idempotent", async () => {
  const migration = await read(
    "supabase/migrations/20261111193000_anticheat_quarantine_shadow_foundation.sql"
  );
  assert.match(
    migration,
    /create trigger anticheat_quarantine_audit_immutable/
  );
  assert.match(
    migration,
    /execute function public\.prevent_anticheat_ledger_mutation\(\)/
  );
  assert.match(migration, /unique\(quarantine_id,idempotency_key\)/);
  assert.match(migration, /for update skip locked/);
  assert.match(
    migration,
    /where id=item\.id and status='SHADOW' and version=item\.version/
  );
});

test("shadow quarantine observation is opt-in and never changes an accepted trade", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const first = "ad500000-0000-4000-8000-000000000001";
  const second = "ad500000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [first, "ShadowOne"],
    [second, "ShadowTwo"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  const network = `v1:${"a".repeat(64)}`;
  const device = `v1:${"b".repeat(64)}`;
  for (const userId of [first, second]) {
    await db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2)",
      [network, userId]
    );
    await db.query(
      "insert into public.anticheat_device_observations(device_identity,user_id) values($1,$2)",
      [device, userId]
    );
  }
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [first, second]
  );

  const createAcceptedTrade = async () => {
    const trade = (
      await db.query(
        "insert into public.trade_offers(from_user,to_user,offered_karas) values($1,$2,1) returning id",
        [first, second]
      )
    ).rows[0].id;
    await db.query(
      "update public.trade_offers set status='accepted' where id=$1",
      [trade]
    );
    return trade;
  };

  await createAcceptedTrade();
  assert.equal(
    (
      await db.query(
        "select count(*)::integer count from public.anticheat_quarantines"
      )
    ).rows[0].count,
    0,
    "disabled shadow mode cannot record or affect an accepted trade"
  );

  await db.query(
    "update public.anticheat_runtime_flags set enabled=true where flag='quarantine_shadow'"
  );
  const observedTrade = await createAcceptedTrade();
  const quarantine = (
    await db.query(
      "select subject_id,status,evidence_confidence,economic_severity from public.anticheat_quarantines"
    )
  ).rows[0];
  assert.deepEqual(quarantine, {
    subject_id: observedTrade,
    status: "SHADOW",
    evidence_confidence: "CORROBORATED",
    economic_severity: "MEDIUM"
  });
  assert.equal(
    (
      await db.query("select status from public.trade_offers where id=$1", [
        observedTrade
      ])
    ).rows[0].status,
    "accepted",
    "shadow mode is observational and does not reserve or rewrite the trade"
  );
});

test("Discord V2 is feature-gated, selective and has a private dead-letter queue", async () => {
  const migration = await read(
    "supabase/migrations/20261111194500_anticheat_discord_v2_shadow.sql"
  );
  assert.match(
    migration,
    /create table public\.anticheat_discord_dead_letters/
  );
  assert.match(
    migration,
    /revoke all on public\.anticheat_discord_dead_letters from public,anon,authenticated,service_role/
  );
  assert.match(
    migration,
    /anticheat_runtime_flag_enabled\('discord_alerts_v2'\)/
  );
  assert.match(migration, /'referral_network_enforcement'/);
  assert.match(migration, /'automatic_trade_sanction'/);
  assert.match(migration, /'asset_recovery_failed'/);
  assert.match(migration, /'sanction_circumvention'/);
  assert.match(
    migration,
    /coalesce\(\(event_row\.metadata->>'sharedDevice'\)::boolean,false\)/
  );
  assert.match(migration, /attempts>=12/);
  assert.match(migration, /for update skip locked/);
  assert.doesNotMatch(
    migration,
    /network_identity.*jsonb_build_object|device_identity.*jsonb_build_object/
  );
});

test("Discord suppresses score-only legacy reviews while preserving V2 alerts and applied sanctions", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const actor = "ad570000-0000-4000-8000-000000000001";
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"DiscordFixture"}\')',
    [actor]
  );
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='discord_alerts_v2'"
  );
  async function record(type, points, metadata = {}) {
    const {
      rows: [event]
    } = await db.query(
      "insert into public.anticheat_events(event_type,actor_user_id,subject_id,metadata) values($1,$2,gen_random_uuid(),$3) returning id",
      [type, actor, JSON.stringify(metadata)]
    );
    await db.query(
      "insert into public.anticheat_event_subjects(event_id,user_id,risk_points,reason_codes) values($1,$2,$3,array['FIXTURE'])",
      [event.id, actor, points]
    );
    return event.id;
  }
  const review = await record("referral_network_review", 100);
  const unbalanced = await record("trade_accepted", 100);
  const uncorroborated = await record("trade_shared_network_identity", 100);
  const corroborated = await record("trade_shared_network_identity", 20, {
    sharedDevice: true
  });
  const applied = await record("referral_network_enforcement", 30);
  const queued = async () =>
    (
      await db.query(
        "select event_id from public.anticheat_discord_outbox order by event_id"
      )
    ).rows.map(row => row.event_id);
  assert.deepEqual(await queued(), [corroborated, applied]);

  await db.query(
    `insert into public.anticheat_discord_outbox(event_id,payload,dispatched_at,request_id)
     values($1,'{}',null,null),($2,'{}',now(),null),($3,'{}',null,42)`,
    [review, unbalanced, uncorroborated]
  );
  await db.exec("select public.dispatch_anticheat_discord_alerts()");
  assert.deepEqual(await queued(), [
    unbalanced,
    uncorroborated,
    corroborated,
    applied
  ]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as total from public.anticheat_events where id=$1",
        [review]
      )
    ).rows[0].total,
    1
  );

  await db.exec(
    "update public.anticheat_runtime_flags set enabled=false where flag='discord_alerts_v2'"
  );
  await record("referral_network_enforcement", 100);
  assert.deepEqual(await queued(), [
    unbalanced,
    uncorroborated,
    corroborated,
    applied
  ]);
});
