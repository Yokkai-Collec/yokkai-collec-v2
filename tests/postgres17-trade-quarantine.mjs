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
await query(
  bootstrapSQL +
    readdirSync(directory)
      .filter(name => name.endsWith(".sql"))
      .sort()
      .map(name => readFileSync(new URL(name, directory), "utf8"))
      .join("\n")
);
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

const timings = await query(`
  update public.anticheat_runtime_flags set enabled=false where flag='quarantine_enforcement';
  create temp table samples(elapsed double precision);
  create temp table offers as
    with seed as (
      insert into public.trade_offers(from_user,to_user,offered_karas,requested_karas)
      select '${sender}','${receiver}',1,1 from generate_series(1,100) returning id
    ) select id from seed;
  set request.jwt.claim.sub='${receiver}';
  do $$
  declare item record; started timestamptz;
  begin
    for item in select id from offers loop
      started:=clock_timestamp();
      perform public.respond_trade_offer_with_status(item.id,'accept');
      insert into samples values(extract(epoch from clock_timestamp()-started)*1000);
    end loop;
  end;
  $$;
  select json_build_object('samples',count(*),'unit','ms',
    'p50',percentile_cont(.5) within group(order by elapsed),
    'p95',percentile_cont(.95) within group(order by elapsed),
    'p99',percentile_cont(.99) within group(order by elapsed)) from samples;
`);
console.log("PostgreSQL 17 concurrent reservation and review passed.");
console.log(timings);
