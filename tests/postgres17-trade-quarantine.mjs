import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { bootstrapSQL } from "../scripts/replay-migrations.mjs";

const container = "yokkai-quarantine-pg-isolated";
assert.equal(
  execFileSync(
    "docker",
    ["inspect", "--format", "{{.Config.Image}}", container],
    {
      encoding: "utf8"
    }
  ).trim(),
  "supabase/postgres:17.6.1.136"
);
const database = `quarantine_concurrency_${process.pid}`;
function session({ db = database, user = "postgres" } = {}) {
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-w",
      "-qAt",
      "-h",
      "127.0.0.1",
      "-U",
      user,
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1"
    ],
    { stdio: "pipe" }
  );
  let out = "";
  let err = "";
  child.stdout.on("data", chunk => (out += chunk));
  child.stderr.on("data", chunk => (err += chunk));
  child.stdin.on("error", () => {});
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err))
    );
  });
  done.catch(() => {});
  const until = marker =>
    Promise.race([
      done.then(() => {
        if (!out.includes(marker)) throw new Error(`Missing marker ${marker}`);
      }),
      new Promise((resolve, reject) => {
        if (out.includes(marker)) return resolve();
        const timer = setTimeout(
          () => reject(new Error(`Timeout: ${marker}`)),
          10000
        );
        timer.unref();
        child.stdout.on("data", function onData() {
          if (!out.includes(marker)) return;
          clearTimeout(timer);
          child.stdout.off("data", onData);
          resolve();
        });
      })
    ]);
  return { child, done, until };
}
function query(sql, options) {
  const connection = session(options);
  connection.child.stdin.end(sql + "\n");
  return connection.done;
}
await query(`create database ${database} owner postgres;`, {
  db: "postgres",
  user: "supabase_admin"
});
const directory = new URL("../supabase/migrations/", import.meta.url);
const migrations = readdirSync(directory)
  .filter(name => name.endsWith(".sql"))
  .sort();
const migrationSQL = names =>
  names.map(name => readFileSync(new URL(name, directory), "utf8")).join("\n");
await query(bootstrapSQL + migrationSQL(migrations));
const [sender, receiver, admin] = [1, 2, 3].map(
  index => `ad530000-0000-4000-8000-00000000000${index}`
);
const actor = user =>
  `set request.jwt.claim.sub='${user}';set role authenticated;`;
const card = await query(`
  insert into auth.users(id,raw_user_meta_data) values
    ('${sender}','{"pseudo":"ConcurrentSender"}'),
    ('${receiver}','{"pseudo":"ConcurrentReceiver"}'),
    ('${admin}','{"pseudo":"ConcurrentAdmin"}');
  insert into public.admin_users(user_id) values('${admin}');
  insert into public.friendships(user_id,friend_id,status) values('${sender}','${receiver}','accepted');
  update public.user_profiles set karas_balance=1000 where user_id in('${sender}','${receiver}');
  insert into public.anticheat_network_observations(network_identity,user_id)
    select 'v1:'||repeat('a',64),id from auth.users where id in('${sender}','${receiver}');
  insert into public.anticheat_device_observations(device_identity,user_id)
    select 'v1:'||repeat('b',64),id from auth.users where id in('${sender}','${receiver}');
  update public.anticheat_runtime_flags set enabled=true where flag='quarantine_enforcement';
  with catalogue as (
    insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url)
    values('test','concurrency-hold','Held','Test','Test','LR','https://example.invalid/card.png') returning id
  )
  insert into public.user_cards(user_id,card_id,rarity) select '${sender}',id,'LR' from catalogue returning id;
`);
const makeOffer = () =>
  query(`
  insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas)
  values('${sender}','${receiver}',array['${card}'::uuid],500) returning id;
`);
const [first, second] = [await makeOffer(), await makeOffer()];
const stale = session();
const holder = session();
try {
  stale.child.stdin.write(
    `begin isolation level repeatable read; select karas_balance from public.user_profiles where user_id='${sender}';select 'STALE_READY';\n`
  );
  await stale.until("STALE_READY");
  holder.child.stdin.write(
    `${actor(receiver)} begin;select public.respond_trade_offer_with_status('${first}','accept');select 'HOLD_READY';\n`
  );
  await holder.until("HOLD_READY");
  const contender = query(
    `${actor(receiver)}set application_name='quarantine-test-contender';set statement_timeout='10s';select public.respond_trade_offer_with_status('${second}','accept');`
  );
  contender.catch(() => {});
  let blocked = false;
  for (let attempt = 0; attempt < 30 && !blocked; attempt++) {
    blocked =
      (await query(
        "select exists(select 1 from pg_stat_activity where application_name='quarantine-test-contender' and wait_event_type='Lock');"
      )) === "t";
    if (!blocked) await delay(25);
  }
  assert.ok(
    blocked,
    "The second acceptance must wait for the first transaction's locks"
  );
  holder.child.stdin.end("commit;\n");
  assert.match(await holder.done, /quarantined/);
  await assert.rejects(contender, /TRADE_CARD_FROZEN/);
  stale.child.stdin.end(
    `update public.user_profiles set karas_balance=100 where user_id='${sender}';commit;\n`
  );
  await assert.rejects(stale.done, /could not serialize access/);
} finally {
  stale.child.stdin.end();
  holder.child.stdin.end();
}
const quarantine = await query(
  `select id from public.anticheat_quarantines where subject_id='${first}';`
);
const decision = action =>
  `${actor(admin)}select public.admin_resolve_trade_quarantine('${quarantine}',1,'${action}','Concurrency test');`;
const decisions = await Promise.allSettled([
  query(decision("release")),
  query(decision("cancel"))
]);
assert.equal(
  decisions.filter(result => result.status === "fulfilled").length,
  1
);
const rejected = decisions.find(result => result.status === "rejected");
assert.match(rejected.reason.message, /QUARANTINE_CHANGED/);
assert.equal(
  await query("select count(*) from public.anticheat_trade_kara_holds;"),
  "0"
);

// A complete manual sanction and an independent quarantine release share
// a payer. Both must commit once while respecting the payer's row lock.
const [smurf, payer, tradePeer] = [4, 5, 6].map(
  index => `ad530000-0000-4000-8000-00000000000${index}`
);
const sanctionFixture = JSON.parse(
  await query(`
  alter table auth.users add column email text,add column banned_until timestamptz,add column updated_at timestamptz;
  create table auth.sessions(user_id uuid);
  insert into auth.users(id,raw_user_meta_data) values
    ('${smurf}','{"pseudo":"SanctionRaceSmurf"}'),
    ('${payer}','{"pseudo":"SanctionRacePayer"}'),
    ('${tradePeer}','{"pseudo":"SanctionRacePeer"}');
  insert into auth.sessions values('${smurf}');
  insert into public.friendships(user_id,friend_id,status) values
    ('${smurf}','${payer}','accepted'),('${payer}','${tradePeer}','accepted');
  update public.user_profiles set karas_balance=1000 where user_id in('${smurf}','${payer}','${tradePeer}');
  insert into public.anticheat_network_observations(network_identity,user_id)
    values('v1:'||repeat('c',64),'${payer}'),('v1:'||repeat('c',64),'${tradePeer}');
  insert into public.anticheat_device_observations(device_identity,user_id)
    values('v1:'||repeat('d',64),'${payer}'),('v1:'||repeat('d',64),'${tradePeer}');
  with copies as (
    insert into public.user_cards(user_id,card_id,rarity)
    select '${payer}',id,'LR' from public.cards where source_id='concurrency-hold'
    returning id
  ), historical as (
    insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas,status)
    select '${smurf}','${payer}',array[id],70,'accepted' from copies returning id
  ), held as (
    insert into public.trade_offers(from_user,to_user,offered_karas)
    values('${payer}','${tradePeer}',10) returning id
  ) select jsonb_build_object('card',(select id from copies),'held',(select id from held));
`)
);
assert.equal(
  await query(
    `${actor(tradePeer)}select public.respond_trade_offer_with_status('${sanctionFixture.held}','accept');`
  ),
  "quarantined"
);
const sanctionHold = await query(
  `select id from public.anticheat_quarantines where subject_id='${sanctionFixture.held}';`
);
const sanctionPreview = JSON.parse(
  await query(`${actor(admin)}
  select public.admin_preview_sanction('${smurf}','active','${payer}','{}');`)
);
assert.equal(sanctionPreview.eligible, true);
const applySanction = `${actor(admin)}set application_name='quarantine-sanction-race';set statement_timeout='10s';
  select public.admin_apply_sanction('${smurf}','active','${payer}','{}',
    'Manually reviewed concurrency test','','${smurf}','${sanctionPreview.previewToken}');`;
const releasing = session();
try {
  releasing.child.stdin.write(`${actor(admin)}begin;
    select public.admin_resolve_trade_quarantine('${sanctionHold}',1,'release','Manual concurrent review');
    select 'QUARANTINE_SETTLED';\n`);
  await releasing.until("QUARANTINE_SETTLED");
  const sanction = query(applySanction);
  sanction.catch(() => {});
  let blocked = false;
  for (let attempt = 0; attempt < 30 && !blocked; attempt++) {
    blocked =
      (await query(
        "select exists(select 1 from pg_stat_activity where application_name='quarantine-sanction-race' and wait_event_type='Lock');"
      )) === "t";
    if (!blocked) await delay(25);
  }
  assert.ok(
    blocked,
    "The sanction must wait for the releasing transaction's payer lock"
  );
  releasing.child.stdin.end("commit;\n");
  assert.match(await releasing.done, /RELEASED/);
  assert.ok(JSON.parse(await sanction).receiptId);
  await assert.rejects(
    query(applySanction),
    /SANCTION_PREVIEW_CHANGED|MANUAL_SANCTION_NOT_ELIGIBLE/
  );
} finally {
  if (!releasing.child.stdin.writableEnded)
    releasing.child.stdin.end("rollback;\n");
}
assert.equal(
  await query(
    `select count(*) from public.anticheat_smurf_sanctions where smurf_user_id='${smurf}';`
  ),
  "1"
);
assert.equal(
  await query(`select count(*) from auth.sessions where user_id='${smurf}';`),
  "0"
);
assert.equal(
  await query(
    `select user_id from public.user_cards where id='${sanctionFixture.card}';`
  ),
  smurf
);
assert.equal(
  await query(
    `select karas_balance from public.user_profiles where user_id='${payer}';`
  ),
  "920"
);

const baseline = `${database}_baseline`;
await query(`create database ${baseline} owner postgres;`, {
  db: "postgres",
  user: "supabase_admin"
});
const baselineFiles = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", "f38ce2d2", "--", "supabase/migrations"],
  { encoding: "utf8" }
)
  .trim()
  .split(/\r?\n/)
  .filter(path => path.endsWith(".sql"))
  .map(path => path.split("/").at(-1))
  .sort();
assert.equal(
  execFileSync(
    "git",
    [
      "diff",
      "--diff-filter=MD",
      "--name-only",
      "f38ce2d2",
      "--",
      "supabase/migrations"
    ],
    { encoding: "utf8" }
  ).trim(),
  "",
  "Baseline migration sources must be unchanged"
);
await query(bootstrapSQL + migrationSQL(baselineFiles), { db: baseline });
const [loadSender, loadReceiver, loadPeer, loadFourth] = [7, 8, 9, 10].map(
  index => `ad530000-0000-4000-8000-${String(index).padStart(12, "0")}`
);
await query(`
  alter table auth.users add column if not exists created_at timestamptz not null default now();
  insert into auth.users(id,raw_user_meta_data) values
    ('${loadSender}','{"pseudo":"LoadHoldSender"}'),('${loadReceiver}','{"pseudo":"LoadHoldReceiver"}'),
    ('${loadPeer}','{"pseudo":"LoadHoldPeer"}'),('${loadFourth}','{"pseudo":"LoadHoldFourth"}');
  insert into public.friendships(user_id,friend_id,status) values('${loadSender}','${loadReceiver}','accepted');
  update public.user_profiles set karas_balance=1000 where user_id='${loadSender}';
  insert into public.anticheat_network_observations(network_identity,user_id)
    select 'v1:'||repeat('e',64),id from auth.users where id in('${loadSender}','${loadReceiver}','${loadPeer}','${loadFourth}');
  insert into public.anticheat_device_observations(device_identity,user_id)
    select 'v1:'||repeat('f',64),id from auth.users where id in('${loadSender}','${loadReceiver}');
  update public.anticheat_runtime_flags set enabled=true
    where flag in('quarantine_enforcement','quarantine_auto_release','ip_cluster_detection','cluster_investigation','graph_detection_v2');
`);
const loadOffers = (
  await query(`
  with copies as (
    insert into public.user_cards(user_id,card_id,rarity)
    select '${loadSender}',id,'LR' from public.cards cross join generate_series(1,2)
    where source_id='concurrency-hold' returning id
  )
  insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas)
  select '${loadSender}','${loadReceiver}',array[id],300 from copies returning id;
`)
).split(/\r?\n/);
for (const offer of loadOffers) {
  assert.equal(
    await query(
      `${actor(loadReceiver)}select public.respond_trade_offer_with_status('${offer}','accept');`
    ),
    "quarantined"
  );
}
await query(
  `update public.anticheat_quarantines set expires_at=clock_timestamp() where subject_id='${loadOffers[0]}';`
);
const analysis = () =>
  query(`
  select public.expire_active_trade_quarantines();
  select public.evaluate_anticheat_network_clusters();
  select public.evaluate_anticheat_farm_evidence();
  set request.jwt.claim.sub='${admin}';
  select public.admin_simulate_anticheat_farm(id)->>'mode'
    from public.anticheat_network_clusters where network_identity='v1:'||repeat('e',64);
`);
const benchmarkWorker = (db, response, size, slot) => {
  const id = offset =>
    `ad530000-0000-4000-8000-${String(slot * 2 + offset).padStart(12, "0")}`;
  const benchSender = id(101);
  const benchReceiver = id(102);
  return query(
    `
  insert into auth.users(id,raw_user_meta_data) values
    ('${benchSender}','{"pseudo":"BenchSender${slot}"}'),('${benchReceiver}','{"pseudo":"BenchReceiver${slot}"}');
  insert into public.friendships(user_id,friend_id,status) values('${benchSender}','${benchReceiver}','accepted');
  update public.user_profiles set karas_balance=1000 where user_id in('${benchSender}','${benchReceiver}');
  create temp table samples(elapsed double precision);
  create temp table offers as
    with seed as (
      insert into public.trade_offers(from_user,to_user,offered_karas,requested_karas)
      select '${benchSender}','${benchReceiver}',1,1 from generate_series(1,${size + 10}) returning id
    ) select id from seed;
  set request.jwt.claim.sub='${benchReceiver}';
  do $$
  declare item record; started timestamptz; iteration integer:=0;
  begin
    for item in select id from offers loop
      started:=clock_timestamp();
      perform public.${response}(item.id,'accept');
      iteration:=iteration+1;
      if iteration>10 then
        insert into samples values(extract(epoch from clock_timestamp()-started)*1000);
      end if;
    end loop;
  end;
  $$;
  select json_agg(elapsed) from samples;
`,
    { db }
  );
};
const percentile = (samples, fraction) => {
  const index = (samples.length - 1) * fraction;
  const low = Math.floor(index);
  return Number(
    (
      samples[low] +
      (samples[Math.ceil(index)] - samples[low]) * (index - low)
    ).toFixed(3)
  );
};
const benchmark = async (db, response, count, workers, firstSlot) => {
  const started = performance.now();
  const runs = await Promise.all(
    Array.from({ length: workers }, (_, i) =>
      benchmarkWorker(db, response, count / workers, firstSlot + i)
    )
  );
  const samples = runs.flatMap(run => JSON.parse(run)).sort((a, b) => a - b);
  assert.equal(samples.length, count);
  return {
    samples: count,
    workers,
    unit: "ms",
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
    wallMs: Math.round(performance.now() - started)
  };
};
console.log("PostgreSQL 17 concurrent reservation and review passed.");
const workloads = [
  [100, 1, 0],
  [1000, 4, 1]
];
if (process.env.YOKKAI_TRADE_LOAD_10000 === "1") workloads.push([10000, 10, 5]);
for (const [count, workers, slot] of workloads) {
  console.log(
    "Base f38ce2d2",
    await benchmark(baseline, "respond_trade_offer", count, workers, slot)
  );
  console.log(
    "Current",
    await Promise.all([
      benchmark(
        database,
        "respond_trade_offer_with_status",
        count,
        workers,
        slot
      ),
      analysis()
    ]).then(([timings, result]) => {
      assert.match(result, /DRY_RUN/);
      return timings;
    })
  );
}
const diagnostics = JSON.parse(
  await query(`
  select json_build_object(
    'activeHolds',(select count(*) from public.anticheat_trade_card_holds h
      join public.user_cards c on c.id=h.card_id where c.user_id='${loadSender}'),
    'reservedKaras',(select coalesce(sum(amount),0) from public.anticheat_trade_kara_holds where user_id='${loadSender}'),
    'deadlocks',(select deadlocks from pg_catalog.pg_stat_database where datname=current_database()));
`)
);
assert.deepEqual(diagnostics, {
  activeHolds: 2,
  reservedKaras: 600,
  deadlocks: 0
});
console.log("Mixed workload diagnostics", diagnostics);
