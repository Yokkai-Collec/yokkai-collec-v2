// Required CI job; runs only against a fresh disposable service container, never SSH/prod.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { bootstrapSQL } from "../scripts/replay-migrations.mjs";

const container = process.env.TEST_POSTGRES_CONTAINER;
assert.ok(
  container,
  "TEST_POSTGRES_CONTAINER must identify the disposable PostgreSQL 17 service"
);
const image = execFileSync(
  "docker",
  ["inspect", "--format", "{{.Config.Image}}", container],
  { encoding: "utf8" }
).trim();
assert.equal(image, "supabase/postgres:17.6.1.136");
const database = "auction_lock_ci";
function session(sql, { user = "supabase_admin", db = database } = {}) {
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
      "-U",
      user,
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=verbose"
    ],
    { stdio: "pipe" }
  );
  let out = "",
    err = "";
  child.stdout.on("data", b => {
    out += b;
  });
  child.stderr.on("data", b => {
    err += b;
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim()))
    );
  });
  child.stdin.write(sql + "\n");
  return { child, done, output: () => out };
}
async function query(sql, options) {
  const s = session(sql, options);
  s.child.stdin.end();
  return s.done;
}
async function until(check, description) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error(`Timed out: ${description}`);
}

// Init scripts are disabled on this service. Keep the production migration role NOSUPERUSER.
await query(
  "create role postgres login nosuperuser bypassrls createrole; create role anon; create role authenticated; create role service_role bypassrls; create database auction_lock_ci owner postgres;",
  { db: "postgres" }
);
const version = await query("select version();");
assert.match(version, /PostgreSQL 17\.6\b/);
console.log(version);
assert.deepEqual(
  JSON.parse(
    await query(
      "select json_build_object('superuser',rolsuper,'bypassrls',rolbypassrls) from pg_roles where rolname='postgres';"
    )
  ),
  { superuser: false, bypassrls: true }
);
await query(`set role postgres; ${bootstrapSQL}`);
const directory = new URL("../supabase/migrations/", import.meta.url);
const migrations = readdirSync(directory)
  .filter(n => n.endsWith(".sql"))
  .sort();
for (const name of migrations) {
  try {
    await query(
      `set role postgres; ${readFileSync(new URL(name, directory), "utf8")}`
    );
  } catch (error) {
    throw new Error(`Migration ${name}: ${error.message}`, { cause: error });
  }
}
console.log(
  `${migrations.length}/${migrations.length} migrations replayed as postgres NOSUPERUSER on ${image}`
);

const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  seller = "10000000-0000-4000-8000-000000000003";
const x = "20000000-0000-4000-8000-000000000001",
  y = "20000000-0000-4000-8000-000000000002";
await query(`
  insert into auth.users(id,raw_user_meta_data) values ('${a}','{"pseudo":"BidA"}'),('${b}','{"pseudo":"BidB"}'),('${seller}','{"pseudo":"BidSeller"}');
  insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values ('bid-lock-test','Bid','Anime','Bid','SR','https://example.test/card.png','test');
  insert into public.user_cards(user_id,card_id,rarity)
    select '${seller}',id,'SR' from public.cards where source_id='bid-lock-test';
  insert into public.auctions(id,card_instance_id,seller_id,starting_price,current_price,buyer_id,duration_minutes,ends_at)
    select '${x}',id,'${seller}',10,100,'${b}',60,clock_timestamp()+interval '1 hour' from public.user_cards where user_id='${seller}';
  insert into public.auctions(id,seller_id,starting_price,current_price,buyer_id,duration_minutes,ends_at)
    values ('${y}','${seller}',10,100,'${a}',60,clock_timestamp()+interval '1 hour');
  create function public.ci_pause_debit() returns trigger language plpgsql as $$
  begin
    if new.karas_balance < old.karas_balance then perform pg_advisory_xact_lock_shared(721934); end if;
    return new;
  end $$;
  create trigger ci_pause_debit before update of karas_balance on public.user_profiles for each row execute function public.ci_pause_debit();
`);

for (let iteration = 1; iteration <= 50; iteration++) {
  await query(
    `update public.user_profiles set karas_balance=900 where user_id in ('${a}','${b}'); update public.auctions set buyer_id=case id when '${x}'::uuid then '${b}'::uuid else '${a}'::uuid end,current_price=100,ends_at=clock_timestamp()+interval '1 hour' where id in ('${x}','${y}'); delete from public.bids; delete from public.notifications where type='outbid';`
  );
  const gate = session("select pg_advisory_lock(721934); select 'READY';");
  await until(() => gate.output().includes("READY"), "coordinator lock");
  const bid = (player, auction, label) => {
    const s = session(
      `set application_name='${label}'; set statement_timeout='12s'; begin; set local role authenticated; select set_config('request.jwt.claim.sub','${player}',true); select current_user; select public.place_bid('${auction}',120); commit;`
    );
    s.child.stdin.end();
    return s;
  };
  const [first, second] =
    iteration % 2
      ? [bid(a, x, "ci-bid-a"), bid(b, y, "ci-bid-b")]
      : [bid(b, y, "ci-bid-b"), bid(a, x, "ci-bid-a")];
  // Attach handlers immediately: the expected RED deadlock must not become unhandled.
  const bids = Promise.allSettled([first.done, second.done]);
  try {
    // Before: both debits reach the gate holding opposite profile rows.
    // After: one reaches the gate; the other waits for the ordered profile lock.
    await until(
      async () =>
        Number(
          await query(
            "select count(*) from pg_stat_activity where application_name in ('ci-bid-a','ci-bid-b') and wait_event_type='Lock';"
          )
        ) === 2,
      "two real sessions overlapping on locks"
    );
  } finally {
    gate.child.stdin.end("select pg_advisory_unlock(721934);\n");
    await gate.done;
  }
  const results = await bids;
  const errors = results
    .filter(r => r.status === "rejected")
    .map(r => r.reason.message);
  assert.deepEqual(
    errors,
    [],
    `Crossed bids iteration ${iteration}: ${errors.join("\n")}`
  );
  assert.ok(
    results.every(r => r.value.includes("\nauthenticated\n")),
    "Both callers use the real player role"
  );
  const state = JSON.parse(
    await query(`select json_build_object(
    'balances',(select json_agg(karas_balance order by user_id) from public.user_profiles where user_id in ('${a}','${b}')),
    'buyers',(select json_agg(buyer_id order by id) from public.auctions where id in ('${x}','${y}')),
    'prices',(select json_agg(current_price order by id) from public.auctions where id in ('${x}','${y}')),
    'bids',(select count(*) from public.bids),
    'notifications',(select count(*) from public.notifications where type='outbid'));`)
  );
  assert.deepEqual(state, {
    balances: [880, 880],
    buyers: [a, b],
    prices: [120, 120],
    bids: 2,
    notifications: 2
  });
  console.log(
    `Crossed bids ${iteration}/50: two authenticated sessions committed; balances, escrow, bids and notifications preserved`
  );
}

const asPlayer = (player, sql) =>
  query(
    `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${player}',true); ${sql}; commit;`
  );
await asPlayer(a, `select public.place_bid('${x}',150)`);
assert.equal(
  await query(
    `select karas_balance from public.user_profiles where user_id='${a}';`
  ),
  "850",
  "Self-raise charges only the difference"
);
await assert.rejects(
  asPlayer(seller, `select public.place_bid('${x}',160)`),
  /SELLER_CANNOT_BID/
);
await assert.rejects(
  asPlayer(b, `select public.place_bid('${x}',159)`),
  /BID_TOO_LOW/
);
await assert.rejects(
  asPlayer(b, `select public.place_bid('${x}',1000000)`),
  /INSUFFICIENT_KARAS/
);
await query(
  `update public.auctions set ends_at=clock_timestamp()+interval '4 minutes' where id='${x}';`
);
const before = await query(
  `select ends_at::text from public.auctions where id='${x}';`
);
await asPlayer(a, `select public.place_bid('${x}',160)`);
assert.equal(
  Number(
    await query(
      `select extract(epoch from (ends_at-'${before}'::timestamptz)) from public.auctions where id='${x}';`
    )
  ),
  60
);
assert.equal(
  await query(
    "select has_function_privilege('anon','public.place_bid(uuid,integer)','EXECUTE');"
  ),
  "f"
);
console.log(
  "Auction rules preserved: self-raise delta, seller refusal, minimum bid, insufficient funds, 60s extension and anon denied"
);

// Settlement skips the locked row; the bid must recheck the deadline after waiting.
await query(
  `update public.auctions set ends_at=clock_timestamp()-interval '1 second' where id='${x}';`
);
const expiryState = () =>
  query(`select json_build_object(
  'auction',(select row_to_json(sale) from public.auctions sale where id='${x}'),
  'balances',(select json_agg(karas_balance order by user_id) from public.user_profiles),
  'bids',(select count(*) from public.bids),
  'notifications',(select count(*) from public.notifications));`);
const expiredBefore = await expiryState();
const expiryGate = session(
  `begin; select id from public.auctions where id='${x}' for update; select 'READY';`
);
await until(
  () => expiryGate.output().includes("READY"),
  "expired auction row locked"
);
const lateBid = session(
  `set application_name='ci-expired-bid'; set statement_timeout='12s'; begin; set local role authenticated; select set_config('request.jwt.claim.sub','${b}',true); select public.place_bid('${x}',170); commit;`
);
lateBid.child.stdin.end();
const lateResult = Promise.allSettled([lateBid.done]);
try {
  await until(
    async () =>
      (await query(
        "select count(*) from pg_stat_activity where application_name='ci-expired-bid' and wait_event_type='Lock';"
      )) === "1",
    "late bidder waits after SKIP LOCKED settlement"
  );
} finally {
  expiryGate.child.stdin.end("commit;\n");
  await expiryGate.done;
}
const [lateOutcome] = await lateResult;
assert.equal(
  lateOutcome.status,
  "rejected",
  "An expired auction skipped by settlement must refuse the waiting bid"
);
assert.match(lateOutcome.reason.message, /AUCTION_CLOSED/);
assert.equal(
  await expiryState(),
  expiredBefore,
  "Refused late bid preserves auction, balances, bids and notifications"
);
console.log(
  "Expired auction: real authenticated bidder refused after SKIP LOCKED and row-lock wait; all state preserved"
);

// A committed tombstone must fence both old JWTs and counterpart writes.
const deleting = "30000000-0000-4000-8000-000000000001";
await query(
  `insert into auth.users(id,raw_user_meta_data) values ('${deleting}','{"pseudo":"DeletingPlayer"}');`
);
const deletingCard = await query(
  `insert into public.user_cards(user_id,card_id,rarity) select '${deleting}',id,'SR' from public.cards limit 1 returning id; insert into public.admin_users(user_id) values ('${seller}');`
);
const playerWrite = session(
  `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${deleting}',true); select public.update_profile('DeletingPlayer',null,null); select 'READY';`
);
await until(
  () => playerWrite.output().includes("READY"),
  "in-flight player write holds shared fence"
);
const fence = session(
  `set application_name='ci-deletion-fence'; begin; set local role service_role; select public.begin_account_deletion('${deleting}'); select 'READY';`
);
await until(
  async () =>
    (await query(
      "select count(*) from pg_stat_activity where application_name='ci-deletion-fence' and wait_event_type='Lock';"
    )) === "1",
  "deletion waits for player transaction"
);
playerWrite.child.stdin.end("commit;\n");
await playerWrite.done;
await until(
  () => fence.output().includes("READY"),
  "deletion marker inserted after player commit"
);
const staleWrite = session(
  `set application_name='ci-deleted-jwt'; set role authenticated; select set_config('request.jwt.claim.sub','${deleting}',false); select public.send_friend_request('${seller}');`
);
staleWrite.child.stdin.end();
const outcome = Promise.allSettled([staleWrite.done]);
await until(
  async () =>
    (await query(
      "select count(*) from pg_stat_activity where application_name='ci-deleted-jwt' and wait_event_type='Lock';"
    )) === "1",
  "old JWT waits for marker commit"
);
fence.child.stdin.end("commit;\n");
await fence.done;
const [blocked] = await outcome;
assert.equal(blocked.status, "rejected");
assert.match(blocked.reason.message, /ACCOUNT_DELETED/);
await assert.rejects(
  query(
    `set role authenticated; select set_config('request.jwt.claim.sub','${seller}',false); select public.send_friend_request('${deleting}');`
  ),
  /ACCOUNT_DELETED/
);
assert.equal(
  await query(
    `select count(*) from public.friendships where user_id='${deleting}' or friend_id='${deleting}';`
  ),
  "0"
);
const cleanupLock = session(
  `begin; select pg_advisory_xact_lock(hashtextextended('account-deletion:${deleting}',0)); select 'READY';`
);
await until(
  () => cleanupLock.output().includes("READY"),
  "cleanup holds exclusive fence"
);
try {
  await assert.rejects(
    query(
      `set statement_timeout='2s'; set role authenticated; select set_config('request.jwt.claim.sub','${seller}',false); select public.admin_remove_player_card('${deletingCard}');`
    ),
    /ACCOUNT_DELETED/
  );
} finally {
  cleanupLock.child.stdin.end("rollback;\n");
  await cleanupLock.done;
}
console.log(
  "Account deletion: in-flight write completes before fence; old JWT and counterpart writes blocked; no row-lock/advisory-lock cycle during cleanup"
);

// Chat: real overlapping PostgreSQL sessions, with the second waiting for the author lock.
const chatAuction = "40000000-0000-4000-8000-000000000001";
await query(`insert into public.auctions(id,seller_id,starting_price,current_price,duration_minutes,ends_at)
  values ('${chatAuction}','${seller}',10,10,60,clock_timestamp()+interval '1 hour');`);
async function chatOverlap(waitMs) {
  await query(
    `delete from public.auction_chat_messages where user_id='${seller}';`
  );
  const first = session(`begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${seller}',true);
    select public.send_auction_chat_message('${chatAuction}','first'); select 'READY';`);
  await until(
    () => first.output().includes("READY"),
    "first chat send holds its transaction lock"
  );
  const second =
    session(`set application_name='ci-chat-waiter'; set statement_timeout='12s'; begin;
    select 'STARTED:'||extract(epoch from transaction_timestamp());
    set local role authenticated; select set_config('request.jwt.claim.sub','${seller}',true);
    select public.send_auction_chat_message('${chatAuction}','second'); commit;`);
  second.child.stdin.end();
  const outcome = Promise.allSettled([second.done]);
  let releaseAt;
  try {
    await until(
      async () =>
        (await query(
          "select count(*) from pg_stat_activity where application_name='ci-chat-waiter' and wait_event_type='Lock' and wait_event='advisory';"
        )) === "1",
      "second real chat send waits on advisory lock"
    );
    await delay(waitMs);
    releaseAt = await query("select extract(epoch from clock_timestamp());");
  } finally {
    first.child.stdin.end("commit;\n");
    await first.done;
  }
  const [result] = await outcome;
  const started = Number(second.output().match(/STARTED:([\d.]+)/)[1]);
  return { result, started, releaseAt: Number(releaseAt) };
}
const immediate = await chatOverlap(0);
assert.equal(immediate.result.status, "rejected");
assert.match(immediate.result.reason.message, /CHAT_RATE_LIMITED/);
assert.equal(
  await query(
    `select count(*) from public.auction_chat_messages where user_id='${seller}';`
  ),
  "1"
);
const waited = await chatOverlap(3200);
assert.equal(waited.result.status, "fulfilled");
const insertedAt = Number(
  await query(
    `select extract(epoch from created_at) from public.auction_chat_messages where user_id='${seller}' and message='second';`
  )
);
assert.ok(
  insertedAt >= waited.releaseAt,
  "created_at uses clock_timestamp after lock release"
);
assert.ok(
  insertedAt - waited.started >= 3,
  "transaction start timestamp must not date the waiting message"
);
assert.equal(
  await query(
    `select count(*) from public.auction_chat_messages where user_id='${seller}';`
  ),
  "2"
);
// Counterproof: the same overlap with now() for inserted.created_at must expose stale dating.
const chatDefinition = await query(
  "select pg_get_functiondef('public.send_auction_chat_message(uuid,text,text)'::regprocedure);"
);
assert.ok(chatDefinition.includes("clean_gif,sent_at)"));
await query(chatDefinition.replace("clean_gif,sent_at)", "clean_gif,now())"));
try {
  const stale = await chatOverlap(3200);
  assert.equal(stale.result.status, "fulfilled");
  const staleAt = Number(
    await query(
      `select extract(epoch from created_at) from public.auction_chat_messages where user_id='${seller}' and message='second';`
    )
  );
  assert.ok(
    staleAt < stale.releaseAt,
    "counterproof catches transaction-start dating"
  );
} finally {
  await query(chatDefinition);
}
console.log(
  "Chat: overlapping sends serialize; immediate second refused; waiting second dated after lock release; now() counterproof fails the timing invariant"
);

// Different authors compete for the same read notification: only the first may re-notify.
await query(`insert into public.bids(auction_id,bidder_id,amount) values ('${chatAuction}','${a}',20),('${chatAuction}','${b}',30);
  insert into public.notifications(user_id,type,reference_id,actor_user_id,read_at,created_at)
    values ('${seller}','auction_chat_mention','${chatAuction}','${b}',clock_timestamp(),clock_timestamp()-interval '601 seconds');`);
const mentionFirst =
  session(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${a}',true);
  select public.send_auction_chat_message('${chatAuction}','@BidSeller'); reset role;
  select 'NOTIFIED:'||extract(epoch from created_at) from public.notifications where user_id='${seller}' and reference_id='${chatAuction}' and type='auction_chat_mention'; select 'READY';`);
await until(
  () => mentionFirst.output().includes("READY"),
  "first author re-notifies and holds notification row"
);
const mentionSecond =
  session(`set application_name='ci-chat-mention-waiter'; set statement_timeout='12s'; begin; set local role authenticated;
  select set_config('request.jwt.claim.sub','${b}',true); select public.send_auction_chat_message('${chatAuction}','@BidSeller'); commit;`);
mentionSecond.child.stdin.end();
const mentionOutcome = Promise.allSettled([mentionSecond.done]);
try {
  await until(
    async () =>
      (await query(
        "select count(*) from pg_stat_activity where application_name='ci-chat-mention-waiter' and wait_event_type='Lock';"
      )) === "1",
    "second author waits on notification uniqueness"
  );
} finally {
  mentionFirst.child.stdin.end("commit;\n");
  await mentionFirst.done;
}
assert.equal((await mentionOutcome)[0].status, "fulfilled");
assert.equal(
  await query(`select count(*) from public.notifications n where n.user_id='${seller}' and n.reference_id='${chatAuction}'
  and n.type='auction_chat_mention' and n.read_at is null and n.actor_user_id='${a}'
  and extract(epoch from n.created_at)=${Number(mentionFirst.output().match(/NOTIFIED:([\d.]+)/)[1])};`),
  "1"
);
console.log(
  "Mentions: concurrent different authors leave exactly one unread notification with the first actor and timestamp untouched"
);

// Export: simultaneous requests serialize, and a commit between two table scans
// never produces a mixed version. Test hooks live only in this disposable DB.
await query(`set role postgres; create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz); reset role;
  update public.user_profiles set bio='snapshot-before' where user_id='${seller}';
  delete from public.folders where user_id='${seller}';
  insert into public.folders(user_id,nom) values ('${seller}','snapshot-before');`);
const exportRequest = "90000000-0000-4000-8000-000000000001";
const exportNext = "90000000-0000-4000-8000-000000000002";
const reservation = session(`begin; set local role service_role;
  select public.reserve_data_export('${seller}','${exportRequest}'); select 'RESERVED';`);
await until(
  () => reservation.output().includes("RESERVED"),
  "first export reservation"
);
const concurrentExport =
  session(`set statement_timeout='10s'; set role service_role;
  select public.reserve_data_export('${seller}','${exportNext}');`);
concurrentExport.child.stdin.end();
const concurrentResult = Promise.allSettled([concurrentExport.done]);
reservation.child.stdin.end("commit;\n");
await reservation.done;
assert.match(String((await concurrentResult)[0].reason), /EXPORT_IN_PROGRESS/);
const exportDefinition = await query(
  "select pg_get_functiondef('public.build_data_export(uuid,uuid)'::regprocedure);"
);
// Wall exports delegate to owner-only STABLE builders. Instrument the actual
// profile projection, but exercise and mutate the public entry point below.
const exportDefinitions = [exportDefinition];
let projectionDefinition = exportDefinition;
const visitedBuilders = new Set(["build_data_export"]);
while (!projectionDefinition.includes("'bio',t.bio")) {
  const delegate = projectionDefinition.match(
    /public\.(build_data_export_without_[a-z_]+)\(\s*p_user_id\s*,\s*p_request_id\s*\)/i
  )?.[1];
  assert.ok(delegate, "Export must retain the original profile projection");
  assert.ok(
    !visitedBuilders.has(delegate) && visitedBuilders.size < 8,
    "Export delegation must be acyclic and bounded"
  );
  visitedBuilders.add(delegate);
  assert.equal(
    await query(`select not has_function_privilege('anon','public.${delegate}(uuid,uuid)','EXECUTE')
    and not has_function_privilege('authenticated','public.${delegate}(uuid,uuid)','EXECUTE')
    and not has_function_privilege('service_role','public.${delegate}(uuid,uuid)','EXECUTE');`),
    "t"
  );
  projectionDefinition = await query(
    `select pg_get_functiondef('public.${delegate}(uuid,uuid)'::regprocedure);`
  );
  exportDefinitions.push(projectionDefinition);
}
assert.ok(projectionDefinition.includes("'bio',t.bio"));
for (const definition of exportDefinitions)
  assert.match(definition, /\bSTABLE\b/i);
await query(
  `create function public.export_test_pause() returns text language plpgsql volatile as $$begin perform pg_sleep(2); return ''; end;$$;`
);
async function snapshotOverlap(definition) {
  await query(`update public.user_profiles set bio='snapshot-before' where user_id='${seller}';
    update public.folders set nom='snapshot-before' where user_id='${seller}';`);
  await query(
    projectionDefinition.replace(
      "'bio',t.bio",
      "'bio',t.bio||public.export_test_pause()"
    )
  );
  if (exportDefinitions.length > 1) await query(definition);
  else
    await query(
      definition.replace(
        "'bio',t.bio",
        "'bio',t.bio||public.export_test_pause()"
      )
    );
  const reader =
    session(`set application_name='ci-export-snapshot-reader'; set role service_role;
    select public.build_data_export('${seller}','${exportRequest}');`);
  reader.child.stdin.end();
  const outcome = Promise.allSettled([reader.done]);
  await until(
    async () =>
      (await query(
        "select count(*) from pg_stat_activity where application_name='ci-export-snapshot-reader' and wait_event='PgSleep';"
      )) === "1",
    "export paused between projections"
  ).catch(async error => {
    const result = (await outcome)[0];
    throw result.status === "rejected" ? result.reason : error;
  });
  await query(`begin; update public.user_profiles set bio='snapshot-after' where user_id='${seller}';
    update public.folders set nom='snapshot-after' where user_id='${seller}'; commit;`);
  const result = (await outcome)[0];
  assert.equal(result.status, "fulfilled");
  const data = JSON.parse(result.value);
  return { profile: data.profile.bio, folder: data.folders[0].nom };
}
try {
  assert.deepEqual(await snapshotOverlap(exportDefinition), {
    profile: "snapshot-before",
    folder: "snapshot-before"
  });
  // Counterproof: re-reading a section in a second VOLATILE statement breaks it.
  const splitRead = exportDefinition.replace(/\bSTABLE\b/i, "VOLATILE").replace(
    "return result;",
    `
    result:=jsonb_set(result,'{folders}',(select jsonb_agg(jsonb_build_object('nom',nom)) from public.folders where user_id=p_user_id));
    return result;`
  );
  assert.deepEqual(await snapshotOverlap(splitRead), {
    profile: "snapshot-before",
    folder: "snapshot-after"
  });
} finally {
  for (const definition of exportDefinitions) await query(definition);
  await query(
    `select public.finish_data_export('${seller}','${exportRequest}',false); drop function public.export_test_pause();`
  );
}
console.log(
  "Export: concurrent reservations refuse the second caller; one statement preserves the snapshot; split-read counterproof mixes versions"
);

// Additional current-policy counterproof: distinct cards must not bypass the
// seller's membership cap when listings arrive through separate connections.
const proScope = "test:acct_concurrency:price_concurrency";
await query(
  `set role service_role; select public.billing_set_entitlement_scope('${proScope}',true);`
);
for (const [owner, cap, paid] of [
  ["6d000000-0000-4000-8000-000000000001", 3, false],
  ["6d000000-0000-4000-8000-000000000002", 6, true]
]) {
  await query(
    `insert into auth.users(id,raw_user_meta_data) values('${owner}',jsonb_build_object('pseudo','Cap'||${cap}));`
  );
  if (paid)
    await query(`insert into public.billing_accounts(user_id,scope,active,status,period_end,verified_at)
    values('${owner}','${proScope}',true,'active',clock_timestamp()+interval '1 month',clock_timestamp());`);
  const copies = JSON.parse(
    await query(`with copies as (
    insert into public.user_cards(user_id,card_id,rarity)
    select '${owner}',c.id,c.rarete_base from (select * from public.cards order by id limit 1)c cross join generate_series(1,10) returning id
  ) select jsonb_agg(id) from copies;`)
  );
  const outcomes = await Promise.allSettled(
    copies.slice(0, 9).map(id =>
      query(`set role authenticated;
    select set_config('request.jwt.claim.sub','${owner}',false);
    select public.create_auction('${id}',10,60);`)
    )
  );
  assert.equal(
    outcomes.filter(result => result.status === "fulfilled").length,
    cap
  );
  for (const result of outcomes.filter(result => result.status === "rejected"))
    assert.match(result.reason.message, /AUCTION_LIMIT_REACHED/);
  assert.equal(
    Number(
      await query(
        `select count(*) from public.auctions where seller_id='${owner}' and status='active';`
      )
    ),
    cap
  );
  if (paid) {
    await query(
      `update public.billing_accounts set period_end=clock_timestamp()-interval '1 second' where user_id='${owner}';`
    );
    await assert.rejects(
      query(
        `set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);select public.create_auction('${copies[9]}',10,60);`
      ),
      /AUCTION_LIMIT_REACHED/
    );
    assert.equal(
      Number(
        await query(
          `select count(*) from public.auctions where seller_id='${owner}' and status='active';`
        )
      ),
      6
    );
  }
}
console.log(
  "Membership auction caps: concurrent listings remain at Basic 3 / Pro 6; expiry preserves sales but blocks new over-limit listings"
);

// BIZ-07: hold the first successful RPC open, then prove that another real
// authenticated session overlaps before committing it. No scheduling sleeps.
async function heldRpcOverlap(player, sql) {
  const first =
    session(`set statement_timeout='12s'; begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${player}',true);
    ${sql}; select 'BIZ_READY';`);
  const firstOutcome = Promise.allSettled([first.done]);
  let second, secondOutcome;
  try {
    await until(
      () => first.output().includes("BIZ_READY"),
      "first BIZ RPC completed before commit"
    );
    second =
      session(`set application_name='ci-biz-second'; set statement_timeout='12s';
      begin; set local role authenticated;
      select set_config('request.jwt.claim.sub','${player}',true); ${sql}; commit;`);
    second.child.stdin.end();
    secondOutcome = Promise.allSettled([second.done]);
    await until(
      async () =>
        (await query(
          "select count(*) from pg_stat_activity where application_name='ci-biz-second' and wait_event_type='Lock';"
        )) === "1",
      "second BIZ RPC overlaps the uncommitted first RPC"
    );
  } finally {
    first.child.stdin.end("commit;\n");
    await firstOutcome;
  }
  const [one] = await firstOutcome;
  const [two] = await secondOutcome;
  assert.equal(one.status, "fulfilled", "first BIZ RPC commits");
  return [one, two];
}

async function bizPlayers() {
  const players = JSON.parse(
    await query("select json_build_array(gen_random_uuid(),gen_random_uuid());")
  );
  for (const id of players) {
    await query(`insert into auth.users(id,raw_user_meta_data)
      values('${id}',jsonb_build_object('pseudo','Biz'||left('${id}',8)));
      update public.user_profiles set karas_balance=1000,
        next_regular_pack_at=clock_timestamp()-interval '1 second',
        next_decision_pack_at=clock_timestamp()-interval '1 second' where user_id='${id}';
      select public.ensure_achievement_stats('${id}');`);
  }
  return players;
}
await query(`insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
  select 'biz-'||r,'Concurrency card','Anime','Concurrency',r::public.card_rarity,'https://example.test/card.png','test'
  from unnest(array['C','R','SR','SSR','LR']) r;`);

function singleWinner(results, error) {
  assert.equal(
    results.filter(r => r.status === "fulfilled").length,
    1,
    "exactly one RPC commits"
  );
  assert.match(
    results.find(r => r.status === "rejected").reason.message,
    error,
    "second RPC must return the domain refusal"
  );
}
async function regularPackOverlap() {
  const [player] = await bizPlayers();
  const results = await heldRpcOverlap(
    player,
    "select public.open_regular_pack()"
  );
  singleWinner(results, /PACK_NOT_READY/);
  const state = JSON.parse(
    await query(`select json_build_object(
    'cards',(select count(*) from public.user_cards where user_id='${player}'),
    'opened',(select regular_packs_opened from public.user_achievement_stats where user_id='${player}'),
    'cooldown',(select next_regular_pack_at>clock_timestamp() from public.user_profiles where user_id='${player}'));`)
  );
  assert.deepEqual(state, { cards: 5, opened: 1, cooldown: true });
}
async function decisionPackOverlap() {
  const [player] = await bizPlayers();
  const results = await heldRpcOverlap(
    player,
    "select public.open_decision_pack()"
  );
  assert.ok(
    results.every(r => r.status === "fulfilled"),
    "both opens return the same pending pack"
  );
  // First output has an extra READY line, but both contain the exact JSON result.
  const cards = results.map(r =>
    JSON.parse(r.value.split("\n").find(line => line.startsWith("[")))
  );
  assert.equal(cards[0].length, 5);
  assert.deepEqual(cards[0], cards[1]);
  const state = JSON.parse(
    await query(`select json_build_object(
    'packs',(select count(*) from public.decision_packs where user_id='${player}'),
    'choices',(select count(*) from public.decision_pack_choices c join public.decision_packs p on p.id=c.pack_id where p.user_id='${player}'),
    'cards',(select count(*) from public.user_cards where user_id='${player}'),
    'cooldown',(select next_decision_pack_at>clock_timestamp() from public.user_profiles where user_id='${player}'));`)
  );
  assert.deepEqual(state, { packs: 1, choices: 5, cards: 0, cooldown: true });
}
async function doubleTradeOverlap() {
  const [from, to] = await bizPlayers();
  await query(
    `insert into public.friendships(user_id,friend_id,status) values('${from}','${to}','accepted');`
  );
  const offer = (
    await asPlayer(
      from,
      `select public.create_trade_offer('${to}','{}',100,'{}',30)`
    )
  )
    .split("\n")
    .at(-1);
  const results = await heldRpcOverlap(
    to,
    `select public.respond_trade_offer('${offer}','accept')`
  );
  singleWinner(results, /TRADE_NOT_PENDING/);
  const state = JSON.parse(
    await query(`select json_build_object(
    'balances',(select json_agg(karas_balance order by user_id='${to}') from public.user_profiles where user_id in ('${from}','${to}')),
    'status',(select status from public.trade_offers where id='${offer}'),
    'notifications',(select count(*) from public.notifications where reference_id='${offer}' and type='trade_offer_accepted'),
    'completed',(select json_agg(trades_completed order by user_id='${to}') from public.user_achievement_stats where user_id in ('${from}','${to}')));`)
  );
  assert.deepEqual(state, {
    balances: [930, 1070],
    status: "accepted",
    notifications: 1,
    completed: [1, 1]
  });
}
async function achievementOverlap() {
  const [player] = await bizPlayers();
  await query(`insert into public.user_achievements(user_id,achievement_id,completed_at)
    values('${player}','premier-rituel',clock_timestamp())
    on conflict(user_id,achievement_id) do update set completed_at=excluded.completed_at,claimed_at=null;`);
  const reward = Number(
    await query(
      "select karas_reward from public.achievements where id='premier-rituel';"
    )
  );
  const results = await heldRpcOverlap(
    player,
    "select public.claim_achievement('premier-rituel')"
  );
  singleWinner(results, /ACHIEVEMENT_ALREADY_CLAIMED/);
  assert.equal(
    Number(
      await query(
        `select karas_balance from public.user_profiles where user_id='${player}';`
      )
    ),
    1000 + reward
  );
  assert.equal(
    await query(
      `select count(*) from public.user_achievements where user_id='${player}' and achievement_id='premier-rituel' and claimed_at is not null;`
    ),
    "1"
  );
}

// Force both debits to overlap. Ordered profile locks serialize the safe RPC;
// without them each transaction holds its sender row and deadlocks on its peer.
await query(`create function public.ci_biz_pause_debit() returns trigger language plpgsql as $$
  begin
    if new.karas_balance<old.karas_balance then perform pg_advisory_xact_lock_shared(721935); end if;
    return new;
  end $$;
  create trigger ci_biz_pause_debit before update of karas_balance on public.user_profiles
    for each row execute function public.ci_biz_pause_debit();`);
async function crossedTradeOverlap() {
  const [from, to] = await bizPlayers();
  await query(
    `insert into public.friendships(user_id,friend_id,status) values('${from}','${to}','accepted');`
  );
  const copies = [];
  for (const player of [from, to])
    copies.push(
      await query(`insert into public.user_cards(user_id,card_id,rarity)
    select '${player}',id,'SR' from public.cards where source_id='biz-SR' returning id;`)
    );
  const offers = [];
  offers.push(
    (
      await asPlayer(
        from,
        `select public.create_trade_offer('${to}',array['${copies[0]}']::uuid[],100,'{}',0)`
      )
    )
      .split("\n")
      .at(-1)
  );
  offers.push(
    (
      await asPlayer(
        to,
        `select public.create_trade_offer('${from}',array['${copies[1]}']::uuid[],40,'{}',0)`
      )
    )
      .split("\n")
      .at(-1)
  );
  const gate = session("select pg_advisory_lock(721935); select 'READY';");
  const calls = [];
  let outcomes;
  try {
    await until(
      () => gate.output().includes("READY"),
      "crossed trade coordinator"
    );
    for (const [i, player] of [to, from].entries()) {
      const s =
        session(`set application_name='ci-biz-cross-${i}'; set statement_timeout='12s';
        begin; set local role authenticated; select set_config('request.jwt.claim.sub','${player}',true);
        select public.respond_trade_offer('${offers[i]}','accept'); commit;`);
      s.child.stdin.end();
      calls.push(s.done);
    }
    outcomes = Promise.allSettled(calls);
    await until(
      async () =>
        (await query(
          "select count(*) from pg_stat_activity where application_name in ('ci-biz-cross-0','ci-biz-cross-1') and wait_event_type='Lock';"
        )) === "2",
      "both crossed trade sessions overlap on locks"
    );
  } finally {
    gate.child.stdin.end("select pg_advisory_unlock(721935);\n");
    await gate.done;
  }
  const results = await outcomes;
  assert.deepEqual(
    results.filter(r => r.status === "rejected").map(r => r.reason.message),
    [],
    "crossed trades must both commit without deadlock"
  );
  const state = JSON.parse(
    await query(`select json_build_object(
    'balances',json_build_array((select karas_balance from public.user_profiles where user_id='${from}'),(select karas_balance from public.user_profiles where user_id='${to}')),
    'owners',json_build_array((select user_id from public.user_cards where id='${copies[0]}'),(select user_id from public.user_cards where id='${copies[1]}')),
    'accepted',(select count(*) from public.trade_offers where id in ('${offers[0]}','${offers[1]}') and status='accepted'),
    'notifications',(select count(*) from public.notifications where reference_id in ('${offers[0]}','${offers[1]}') and type='trade_offer_accepted'),
    'completed',(select json_agg(trades_completed order by user_id) from public.user_achievement_stats where user_id in ('${from}','${to}')));`)
  );
  assert.deepEqual(state, {
    balances: [940, 1060],
    owners: [to, from],
    accepted: 2,
    notifications: 2,
    completed: [2, 2]
  });
}

// #390: the cron settlement and a trade accept touching the sold card. The
// settlement is held right after its card transfer; the trade then overlaps.
// Unsafe order (card before seller profile): the trade holds the seller profile
// and waits for the card, the settlement waits for the profile, 40P01.
await query(`create function public.ci_settle_pause() returns trigger language plpgsql as $$
  begin
    if current_setting('application_name')='ci-settle' then perform pg_advisory_xact_lock_shared(721936); end if;
    return new;
  end $$;
  create trigger ci_settle_pause after update of user_id on public.user_cards
    for each row execute function public.ci_settle_pause();`);
async function settlementTradeOverlap() {
  // Fixture housekeeping formerly happened as a side effect of create_auction.
  // Drain unrelated sales before this scenario's lock overlap.
  await query("select public.settle_expired_auctions();");
  const message = "settlement and trade must not deadlock";
  const [seller, friend] = await bizPlayers();
  const [buyer] = await bizPlayers();
  await query(
    `insert into public.friendships(user_id,friend_id,status) values('${seller}','${friend}','accepted');`
  );
  const card =
    await query(`insert into public.user_cards(user_id,card_id,rarity)
    select '${seller}',id,'SR' from public.cards where source_id='biz-SR' returning id;`);
  const offer = (
    await asPlayer(
      seller,
      `select public.create_trade_offer('${friend}',array['${card}']::uuid[],0,'{}',10)`
    )
  )
    .split("\n")
    .at(-1);
  const auction = (
    await asPlayer(seller, `select public.create_auction('${card}',10,60)`)
  )
    .split("\n")
    .at(-1);
  await asPlayer(buyer, `select public.place_bid('${auction}',100)`);
  await query(
    `update public.auctions set ends_at=clock_timestamp()-interval '1 second' where id='${auction}';`
  );
  const gate = session("select pg_advisory_lock(721936); select 'READY';");
  let outcomes;
  try {
    await until(() => gate.output().includes("READY"), "settlement gate");
    const settle = session(
      "set application_name='ci-settle'; set statement_timeout='12s'; select public.settle_expired_auctions();"
    );
    settle.child.stdin.end();
    const settled = settle.done;
    await until(
      async () =>
        (await query(
          "select count(*) from pg_stat_activity where application_name='ci-settle' and wait_event_type='Lock';"
        )) === "1",
      "settlement held after its card transfer"
    );
    const trade =
      session(`set application_name='ci-trade'; set statement_timeout='12s';
      begin; set local role authenticated; select set_config('request.jwt.claim.sub','${friend}',true);
      select public.respond_trade_offer('${offer}','accept'); commit;`);
    trade.child.stdin.end();
    outcomes = Promise.allSettled([settled, trade.done]);
    await until(
      async () =>
        (await query(
          "select count(*) from pg_stat_activity where application_name='ci-trade' and wait_event_type='Lock';"
        )) === "1",
      "trade accept overlaps the uncommitted settlement"
    );
  } finally {
    gate.child.stdin.end("select pg_advisory_unlock(721936);\n");
    await gate.done;
  }
  const [settled, traded] = await outcomes;
  assert.equal(
    settled.status,
    "fulfilled",
    `${message}: ${settled.reason?.message}`
  );
  assert.equal(traded.status, "rejected", message);
  assert.match(traded.reason.message, /TRADE_CARD_UNAVAILABLE/, message);
  const state = JSON.parse(
    await query(`select json_build_object(
    'auction',(select status from public.auctions where id='${auction}'),
    'owner',(select user_id from public.user_cards where id='${card}'),
    'balances',json_build_array((select karas_balance from public.user_profiles where user_id='${seller}'),
      (select karas_balance from public.user_profiles where user_id='${friend}'),
      (select karas_balance from public.user_profiles where user_id='${buyer}')),
    'offer',(select status from public.trade_offers where id='${offer}'));`)
  );
  assert.deepEqual(
    state,
    {
      auction: "sold",
      owner: buyer,
      balances: [1100, 1000, 900],
      offer: "pending"
    },
    message
  );
}

// Lock-order audit after #390. Each scenario holds the first RPC at a precise
// point (trigger keyed on application_name), starts a second real session,
// then releases. Unsafe (old) orders deadlock; safe orders serialize.
await query(`create function public.ci_order_pause() returns trigger language plpgsql as $$
  begin
    if current_setting('application_name') like 'ci-order-hold%' then perform pg_advisory_xact_lock_shared(721937); end if;
    return coalesce(new, old);
  end $$;
  create trigger ci_order_pause_delete after delete on public.user_cards
    for each row execute function public.ci_order_pause();
  create trigger ci_order_pause_insert after insert on public.user_cards
    for each row execute function public.ci_order_pause();
  create trigger ci_order_pause_update after update of user_id on public.user_cards
    for each row execute function public.ci_order_pause();`);
const settledOrWaiting = name => async () =>
  Number(
    await query(
      `select count(*) from pg_stat_activity where application_name like '${name}%' and wait_event_type='Lock';`
    )
  ) === 1;
// The first session is held (or already done when the safe order no longer
// reaches the pause point); the second overlaps it, then the gate opens.
async function heldPair(first, second, describe) {
  const gate = session("select pg_advisory_lock(721937); select 'READY';");
  let outcomes;
  try {
    await until(() => gate.output().includes("READY"), `${describe} gate`);
    const one = session(first);
    one.child.stdin.end();
    const oneDone = Promise.allSettled([one.done]);
    let oneFinished = false;
    oneDone.then(() => (oneFinished = true));
    await until(
      async () => oneFinished || (await settledOrWaiting("ci-order-hold")()),
      `${describe}: first RPC held`
    );
    const two = session(second);
    two.child.stdin.end();
    const twoDone = Promise.allSettled([two.done]);
    let twoFinished = false;
    twoDone.then(() => (twoFinished = true));
    await until(
      async () => twoFinished || (await settledOrWaiting("ci-order-second")()),
      `${describe}: second RPC overlaps`
    );
    outcomes = Promise.all([oneDone, twoDone]);
  } finally {
    gate.child.stdin.end("select pg_advisory_unlock(721937);\n");
    await gate.done;
  }
  return (await outcomes).map(([result]) => result);
}
const rpcSession = (name, player, sql) =>
  `set application_name='${name}'; set statement_timeout='12s'; begin; set local role authenticated;
   select set_config('request.jwt.claim.sub','${player}',true); ${sql}; commit;`;

// 1. Destroying a card that a friend is accepting in a trade.
function discardTradeOverlap(destroy) {
  return async () => {
    const message = "card destruction and trade must not deadlock";
    const [owner, friend] = await bizPlayers();
    await query(
      `insert into public.friendships(user_id,friend_id,status) values('${owner}','${friend}','accepted');`
    );
    const card =
      await query(`insert into public.user_cards(user_id,card_id,rarity)
      select '${owner}',id,'SR' from public.cards where source_id='biz-SR' returning id;`);
    const offer = (
      await asPlayer(
        owner,
        `select public.create_trade_offer('${friend}',array['${card}']::uuid[],0,'{}',10)`
      )
    )
      .split("\n")
      .at(-1);
    const reward = Number(
      await query("select public.card_destruction_value('SR');")
    );
    const [destroyed, traded] = await heldPair(
      rpcSession("ci-order-hold-discard", owner, destroy(card)),
      rpcSession(
        "ci-order-second-trade",
        friend,
        `select public.respond_trade_offer('${offer}','accept')`
      ),
      "discard vs trade"
    );
    assert.equal(
      destroyed.status,
      "fulfilled",
      `${message}: ${destroyed.reason?.message}`
    );
    assert.equal(traded.status, "rejected", message);
    assert.match(traded.reason.message, /TRADE_CARD_UNAVAILABLE/, message);
    assert.deepEqual(
      JSON.parse(
        await query(`select json_build_object(
        'card',(select count(*) from public.user_cards where id='${card}'),
        'balances',json_build_array((select karas_balance from public.user_profiles where user_id='${owner}'),
          (select karas_balance from public.user_profiles where user_id='${friend}')),
        'offer',(select status from public.trade_offers where id='${offer}'));`)
      ),
      { card: 0, balances: [1000 + reward, 1000], offer: "pending" },
      message
    );
  };
}

// 2. A bid used to settle other expired auctions inline before its own row.
async function bidSettlementOverlap() {
  await query("select public.settle_expired_auctions();");
  const message = "bid and settlement must not deadlock";
  // Earlier scenarios may leave expired sales: settle them as the cron would.
  await query("select public.settle_expired_auctions();");
  const [seller, buyer] = await bizPlayers();
  const [bidder, otherSeller] = await bizPlayers();
  const listed = async owner => {
    const card =
      await query(`insert into public.user_cards(user_id,card_id,rarity)
      select '${owner}',id,'SR' from public.cards where source_id='biz-SR' returning id;`);
    return (
      await asPlayer(owner, `select public.create_auction('${card}',10,60)`)
    )
      .split("\n")
      .at(-1);
  };
  const expired = await listed(seller);
  await asPlayer(buyer, `select public.place_bid('${expired}',50)`);
  // Keep fixture creation separate from the deliberately elapsed sale.
  const live = await listed(otherSeller);
  await query(
    `update public.auctions set ends_at=clock_timestamp()-interval '1 second' where id='${expired}';`
  );
  // Old order: the first bid settles `expired` (locking the buyer's profile),
  // the buyer's own bid then holds `live` and waits for that profile.
  const [first, second] = await heldPair(
    rpcSession(
      "ci-order-hold-bid",
      bidder,
      `select public.place_bid('${live}',100)`
    ),
    rpcSession(
      "ci-order-second-bid",
      buyer,
      `select public.place_bid('${live}',200)`
    ),
    "bid vs inline settlement"
  );
  assert.equal(
    first.status,
    "fulfilled",
    `${message}: ${first.reason?.message}`
  );
  assert.equal(
    second.status,
    "fulfilled",
    `${message}: ${second.reason?.message}`
  );
  assert.equal(
    await query(`select status from public.auctions where id='${expired}';`),
    "active",
    `${message}: bids no longer settle other auctions`
  );
  await query("select public.settle_expired_auctions();");
  assert.deepEqual(
    JSON.parse(
      await query(`select json_build_object(
      'expired',(select status from public.auctions where id='${expired}'),
      'live',(select json_build_array(buyer_id,current_price) from public.auctions where id='${live}'),
      'balances',json_build_array((select karas_balance from public.user_profiles where user_id='${seller}'),
        (select karas_balance from public.user_profiles where user_id='${buyer}'),
        (select karas_balance from public.user_profiles where user_id='${bidder}')));`)
    ),
    {
      expired: "sold",
      live: [buyer, 200],
      balances: [1050, 750, 1000]
    },
    message
  );
}

// 3. Keeping a Decision Pack card while the same player opens one in another tab.
async function decisionKeepOpenOverlap() {
  const message = "decision keep and open must not deadlock";
  const [player] = await bizPlayers();
  await asPlayer(player, "select public.open_decision_pack()");
  const choice = await query(`select c.id from public.decision_pack_choices c
    join public.decision_packs p on p.id=c.pack_id
    where p.user_id='${player}' and p.status='pending' order by c.position limit 1;`);
  const reward = Number(
    await query(`select coalesce(sum(public.card_destruction_value(rarity)),0)
      from public.decision_pack_choices where pack_id=(select pack_id from public.decision_pack_choices where id='${choice}')
      and id<>'${choice}';`)
  );
  const [kept, opened] = await heldPair(
    rpcSession(
      "ci-order-hold-keep",
      player,
      `select public.keep_decision_pack_card('${choice}')`
    ),
    rpcSession(
      "ci-order-second-open",
      player,
      "select public.open_decision_pack()"
    ),
    "decision keep vs open"
  );
  assert.equal(kept.status, "fulfilled", `${message}: ${kept.reason?.message}`);
  if (opened.status === "rejected")
    assert.match(
      opened.reason.message,
      /DECISION_PACK_NOT_READY/,
      `${message}: ${opened.reason.message}`
    );
  assert.deepEqual(
    JSON.parse(
      await query(`select json_build_object(
      'claimed',(select count(*) from public.decision_packs where user_id='${player}' and status='claimed'),
      'balance',(select karas_balance from public.user_profiles where user_id='${player}'));`)
    ),
    { claimed: 1, balance: 1000 + reward },
    message
  );
}

// Counterproofs alter definitions ONLY in this disposable database. Every
// scenario must reject a specific unsafe implementation and pass after restore.
const orderedProfiles =
  /perform 1 from public\.user_profiles where user_id in \(p_offer\.from_user,p_offer\.to_user\)\s+order by user_id for update;/;
for (const [name, signature, scenario, mutate] of [
  [
    "Regular Pack double open",
    "open_regular_pack()",
    regularPackOverlap,
    sql =>
      sql
        .replace("perform public.billing_sync_pack_timing(player_id);", "")
        .replace(
          "where user_id=player_id for update;",
          "where user_id=player_id;"
        )
  ],
  [
    "Decision Pack double open",
    "open_decision_pack()",
    decisionPackOverlap,
    sql =>
      sql
        .replace("perform public.billing_sync_pack_timing(player_id);", "")
        .replace(
          "where user_id=player_id for update;",
          "where user_id=player_id;"
        )
  ],
  [
    "Trade double accept",
    "respond_trade_offer(uuid,text)",
    doubleTradeOverlap,
    sql =>
      sql.replace("where id=p_offer_id for update;", "where id=p_offer_id;")
  ],
  [
    "Crossed A/B trades",
    "anticheat_settle_trade(public.trade_offers,uuid)",
    crossedTradeOverlap,
    sql => sql.replace(orderedProfiles, "")
  ],
  [
    "Auction settlement vs trade accept",
    "settle_expired_auctions()",
    settlementTradeOverlap,
    sql =>
      sql.replace(
        "perform 1 from public.user_profiles where user_id in (sale.seller_id,sale.buyer_id) order by user_id for update;",
        ""
      )
  ],
  [
    "Card destruction vs trade accept",
    "discard_collection_card(uuid)",
    discardTradeOverlap(
      card => `select public.discard_collection_card('${card}')`
    ),
    sql =>
      sql.replace(
        "perform 1 from public.user_profiles where user_id=player_id for update;",
        ""
      )
  ],
  [
    "Bulk card destruction vs trade accept",
    "discard_collection_cards(uuid[])",
    discardTradeOverlap(
      card => `select public.discard_collection_cards(array['${card}']::uuid[])`
    ),
    sql =>
      sql.replace(
        "perform 1 from public.user_profiles where user_id = player_id for update;",
        ""
      )
  ],
  [
    "Pack card destruction vs trade accept",
    "discard_regular_pack_card(uuid)",
    discardTradeOverlap(
      card => `select public.discard_regular_pack_card('${card}')`
    ),
    sql =>
      sql.replace(
        "perform 1 from public.user_profiles where user_id=auth.uid() for update;",
        ""
      )
  ],
  [
    "Bid vs inline settlement",
    "place_bid(uuid,integer)",
    bidSettlementOverlap,
    sql =>
      sql.replace(
        "if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;",
        "if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;\n  perform public.settle_expired_auctions();"
      )
  ],
  [
    "Decision keep vs open",
    "keep_decision_pack_card(uuid)",
    decisionKeepOpenOverlap,
    sql =>
      sql.replace(
        "perform 1 from public.user_profiles where user_id=player_id for update;",
        ""
      )
  ],
  [
    "Achievement double claim",
    "claim_achievement(text)",
    achievementOverlap,
    sql =>
      sql.replace(
        "achievement_id=p_achievement_id for update;",
        "achievement_id=p_achievement_id;"
      )
  ]
]) {
  const definition = await query(
    `select pg_get_functiondef('public.${signature}'::regprocedure);`
  );
  const unsafe = mutate(definition);
  assert.notEqual(
    unsafe,
    definition,
    `${name}: counterproof must change the effective definition`
  );
  await query(unsafe);
  try {
    await assert.rejects(
      scenario,
      error => {
        assert.equal(error.code, "ERR_ASSERTION");
        assert.match(
          error.message,
          /exactly one RPC commits|second RPC must return the domain refusal|both opens return the same pending pack|crossed trades must both commit without deadlock|settlement and trade must not deadlock|card destruction and trade must not deadlock|bid and settlement must not deadlock|decision keep and open must not deadlock/
        );
        console.log(
          `BIZ-07 ${name} counterproof: ${error.message.split("\n")[0]}`
        );
        return true;
      },
      `${name}: unsafe implementation must fail the invariant`
    );
  } finally {
    await query(definition);
  }
  await scenario();
  console.log(
    `BIZ-07 ${name}: unsafe counterproof rejected; restored RPC passes with two authenticated sessions`
  );
}

// Batch draws retain the same profile lock across the entire outer transaction.
// The second real authenticated session must wait, then refuse the whole lot.
for (const count of [5, 10]) {
  const [player] = await bizPlayers();
  await query(`update public.user_profiles set
    next_regular_pack_at=clock_timestamp()-interval '2 hours',
    bonus_regular_packs=${count === 10 ? 5 : 0} where user_id='${player}';`);
  const results = await heldRpcOverlap(
    player,
    `select public.open_regular_packs(${count})`
  );
  singleWinner(results, /INSUFFICIENT_PACKS/);
  const state = JSON.parse(
    await query(`select json_build_object(
    'cards',(select count(*) from public.user_cards where user_id='${player}'),
    'opened',(select regular_packs_opened from public.user_achievement_stats where user_id='${player}'),
    'bonus',(select bonus_regular_packs from public.user_profiles where user_id='${player}'),
    'cooldown',(select next_regular_pack_at>clock_timestamp() from public.user_profiles where user_id='${player}'));`)
  );
  assert.deepEqual(state, {
    cards: count * 5,
    opened: count,
    bonus: 0,
    cooldown: true
  });
  console.log(
    `Regular Pack ×${count}: two overlapping authenticated sessions consume exactly one complete lot`
  );
}

// #375: the last admission slot is shared by truly overlapping RPC sessions.
{
  const [sender, recipient] = await bizPlayers();
  await query(`insert into public.friendships(user_id,friend_id,status) values('${sender}','${recipient}','accepted');
    insert into public.trade_offer_submission_limits values('${sender}',clock_timestamp(),9);`);
  const results = await heldRpcOverlap(
    sender,
    `select public.create_trade_offer('${recipient}','{}',1,'{}',0)`
  );
  singleWinner(results, /TRADE_OFFER_RATE_LIMITED/);
  const state = JSON.parse(
    await query(`select json_build_object(
    'submissions',(select submissions from public.trade_offer_submission_limits where user_id='${sender}'),
    'offers',(select count(*) from public.trade_offers where from_user='${sender}'),
    'notifications',(select count(*) from public.notifications where user_id='${recipient}' and type='trade_offer_received'));`)
  );
  assert.deepEqual(state, { submissions: 10, offers: 1, notifications: 1 });
  console.log(
    "Trade admission: overlapping final-slot submissions create exactly one offer and notification"
  );
}

// #557: creating a listing must finish while an unrelated expired seller's
// profile is locked. The old inline settlement waits on that unrelated lock.
async function creationVsUnrelatedProfile() {
  await query("select public.settle_expired_auctions();");
  const [seller, creator] = await bizPlayers();
  const card = await query(`select id from public.cards order by id limit 1;`);
  const owned = [];
  for (const owner of [seller, creator])
    owned.push(
      await query(`insert into public.user_cards(user_id,card_id,rarity)
    values('${owner}','${card}','SR') returning id;`)
    );
  await query(`insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at)
    values('${owned[0]}','${seller}','${creator}',10,10,60,clock_timestamp()-interval '1 second');
    update public.user_profiles set karas_balance=karas_balance-10 where user_id='${creator}';`);
  const holder = session(
    `begin;select user_id from public.user_profiles where user_id='${seller}' for update;select 'PROFILE_LOCKED';`
  );
  let attempted;
  try {
    await until(
      () => holder.output().includes("PROFILE_LOCKED"),
      "unrelated profile held"
    );
    const listing =
      session(`set application_name='ci-listing-probe';set statement_timeout='12s';
      set role authenticated;select set_config('request.jwt.claim.sub','${creator}',false);
      select public.create_auction('${owned[1]}',10,60);`);
    listing.child.stdin.end();
    attempted = Promise.allSettled([listing.done]);
    let completed = false;
    attempted.then(() => {
      completed = true;
    });
    await until(
      async () =>
        completed ||
        Number(
          await query(
            "select count(*) from pg_stat_activity where application_name='ci-listing-probe' and wait_event_type='Lock';"
          )
        ) > 0,
      "listing finishes or waits on unrelated profile"
    );
    assert.equal(
      completed,
      true,
      "listing must not wait for an unrelated expired seller profile"
    );
    const [result] = await attempted;
    assert.equal(result.status, "fulfilled", result.reason?.message);
    assert.equal(
      await query(
        `select count(*) from public.auctions where seller_id='${seller}' and status='active';`
      ),
      "1",
      "unrelated sale remains for cron settlement"
    );
  } finally {
    holder.child.stdin.end("commit;\n");
    await holder.done;
    if (attempted) await attempted;
  }
}
{
  const definition = await query(
    "select pg_get_functiondef('public.create_auction(uuid,integer,integer)'::regprocedure);"
  );
  const anchor =
    "if player is null then raise exception 'AUTH_REQUIRED'; end if;";
  const old = definition.replace(
    anchor,
    anchor + " perform public.settle_expired_auctions();"
  );
  assert.notEqual(old, definition, "counterproof restores inline settlement");
  await query(old);
  try {
    await assert.rejects(creationVsUnrelatedProfile, error => {
      assert.equal(error.code, "ERR_ASSERTION");
      assert.match(error.message, /listing must not wait/);
      return true;
    });
  } finally {
    await query(definition);
  }
  await creationVsUnrelatedProfile();
  console.log(
    "Listing: unsafe inline settlement counterproof fails; current listing completes while unrelated profile is locked"
  );
}
