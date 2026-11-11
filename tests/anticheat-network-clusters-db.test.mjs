import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("direct network thresholds create one investigation alert per tier without sanctioning accounts", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column created_at timestamptz not null default now()"
  );
  const ids = Array.from(
    { length: 20 },
    (_, index) =>
      `ad520000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
  );
  for (const [index, id] of ids.entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo: `Cluster${index}` })]
    );
  }
  const network = `v1:${"a".repeat(64)}`;
  const otherNetwork = `v1:${"b".repeat(64)}`;
  const observe = (id, identity = network) =>
    db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2)",
      [identity, id]
    );
  await observe(ids[0]);
  await observe(ids[1]);
  await observe(ids[1], otherNetwork);
  await observe(ids[2], otherNetwork);
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag in('ip_cluster_detection','cluster_investigation','discord_alerts_v2')"
  );
  const evaluate = () =>
    db.exec("select public.evaluate_anticheat_network_clusters()");
  const read = async () =>
    (await db.query("select * from public.anticheat_network_clusters")).rows[0];
  const alerts = async () =>
    (
      await db.query(
        "select o.payload from public.anticheat_discord_outbox o join public.anticheat_events e on e.id=o.event_id where e.event_type='network_cluster_threshold' order by e.id"
      )
    ).rows;
  await evaluate();
  assert.equal(await read(), undefined);
  assert.equal((await alerts()).length, 0);
  await observe(ids[2]);
  await evaluate();
  assert.equal((await read()).account_count, 3);
  assert.equal((await alerts()).length, 1);
  for (const [count, priority] of [
    [4, "CRITICAL"],
    [6, "ENHANCED"],
    [10, "PRIORITY"],
    [20, "PRIORITY"]
  ]) {
    for (let index = 3; index < count; index++) {
      await db.query(
        "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2) on conflict do nothing",
        [network, ids[index]]
      );
    }
    await db.exec(
      "update public.anticheat_network_clusters set evaluated_at=now()-interval '11 minutes'"
    );
    await evaluate();
    const cluster = await read();
    assert.equal(cluster.account_count, count);
    assert.equal(cluster.priority, priority);
    assert.equal(cluster.investigation_state, "REVIEWED_SIGNALS");
    assert.equal((await alerts()).length, 2);
  }
  assert.doesNotMatch(JSON.stringify(await alerts()), new RegExp(network));
  const cluster = await read();
  await db.query("insert into public.admin_users(user_id) values($1)", [
    ids[0]
  ]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids[0]
  ]);
  const details = (
    await db.query(
      "select public.admin_list_anticheat_clusters($1) as result",
      [cluster.id]
    )
  ).rows[0].result;
  assert.equal(details[0].members.length, 20);
  assert.doesNotMatch(JSON.stringify(details), new RegExp(network));
});
