import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
  utimesSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  deploymentPlan,
  transactionBody
} from "../scripts/plan-deploy-migrations.mjs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const file = (version, source, name = "probe") => ({
  filename: `${version}_${name}.sql`,
  source
});
const first = file(
  "20260101000000",
  "begin; create table public.deploy_probe(id integer); commit;"
);
const second = file(
  "20260101000001",
  "begin; alter table public.deploy_probe add column value text; commit;"
);

test("registry exceptions accept only the exact listed version and name", () => {
  const exceptions = JSON.parse(
    readFileSync(
      new URL(
        "../supabase/migration-registry-exceptions.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  assert.deepEqual(Object.keys(exceptions), [
    "20260928000000",
    "20261007000004",
    "20261007000005"
  ]);
  assert.ok(exceptions["20260928000000"].justification.trim());
  const legacy = file(
    "20260928000000",
    "select 1;",
    "discard_collection_card_balance"
  );
  const accepted = {
    version: "20260928000000",
    name: exceptions["20260928000000"].name
  };
  assert.deepEqual(deploymentPlan([legacy], [accepted]).pending, []);
  assert.deepEqual(
    deploymentPlan(
      [legacy],
      [{ ...accepted, name: "discard_collection_card_balance" }]
    ).pending,
    []
  );
  for (const name of [
    accepted.name + "_other",
    "discard_collection_card_balance_other",
    "different",
    null,
    undefined
  ]) {
    assert.throws(
      () => deploymentPlan([legacy], [{ ...accepted, name }]),
      /Registry name differs/
    );
  }
  assert.throws(
    () =>
      deploymentPlan(
        [first],
        [{ version: "20260101000000", name: accepted.name }]
      ),
    /Registry name differs/
  );
});

test("NULL registry names are accepted only for the two documented versions", () => {
  const exceptions = JSON.parse(
    readFileSync(
      new URL(
        "../supabase/migration-registry-exceptions.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  for (const [version, name] of [
    ["20261007000004", "remove_kingdom_duplicate_imports"],
    ["20261007000005", "remove_dragon_ball_manual_duplicates"]
  ]) {
    const migration = file(version, "select 1;", name);
    assert.deepEqual(
      deploymentPlan([migration], [{ version, name: null }]).pending,
      []
    );
    assert.equal(exceptions[version].name, null);
    assert.ok(exceptions[version].justification.trim());
    assert.ok(
      readFileSync(
        new URL(`../supabase/${exceptions[version].proof}`, import.meta.url),
        "utf8"
      ).includes("2026-10-09")
    );
    for (const different of ["different", undefined])
      assert.throws(
        () => deploymentPlan([migration], [{ version, name: different }]),
        /Registry name differs/
      );
  }
  assert.throws(
    () => deploymentPlan([first], [{ version: "20260101000000", name: null }]),
    /Registry name differs/
  );
});

test("deployment rejects registry collisions/gaps/unknown versions and nontransactional SQL before writes", () => {
  assert.throws(
    () => deploymentPlan([first, { ...second, filename: first.filename }], []),
    /Duplicate migration version/
  );
  assert.throws(
    () =>
      deploymentPlan(
        [first, second],
        [{ version: "20260101000001", name: "probe" }]
      ),
    /ordered repository prefix/
  );
  assert.throws(
    () =>
      deploymentPlan([first], [{ version: "20260101000002", name: "probe" }]),
    /unknown versions/
  );
  assert.throws(
    () =>
      deploymentPlan(
        [first],
        [{ version: "20260101000000", name: "different" }]
      ),
    /Registry name differs/
  );
  for (const sql of [
    "CREATE /* comment */ UNIQUE INDEX CONCURRENTLY x ON t(id);",
    "DROP INDEX CONCURRENTLY x;",
    "VACUUM t;",
    "REINDEX INDEX CONCURRENTLY x;",
    "CREATE DATABASE x;",
    "ALTER SYSTEM SET work_mem='1MB';"
  ]) {
    assert.throws(
      () => transactionBody(sql, "bad.sql"),
      /bad.sql: instruction incompatible with a single transaction/
    );
  }
  for (const sql of [
    "begin; select 1; commit; select 2;",
    "select 1; COMMIT;",
    "\\i bypass.sql",
    "select 'unclosed"
  ]) {
    assert.throws(
      () => transactionBody(sql, "bad.sql"),
      /transaction control|psql commands|unclosed/
    );
  }
});

test("SQL splitting preserves function bodies, escaped literals and nested comments", () => {
  const source = `-- BEGIN; not a command
    begin; /* outer /* inner ; */ comment */
    create function public.probe() returns text language plpgsql as $body$
    begin return 'COMMIT; CREATE INDEX CONCURRENTLY'; end; $body$;
    select E'escaped\\\';COMMIT;', 'it''s; safe', "semi;colon";
    commit; -- trailing comment`;
  const body = transactionBody(source, "quoted.sql");
  assert.ok(
    body.includes(
      "begin return 'COMMIT; CREATE INDEX CONCURRENTLY'; end; $body$;"
    )
  );
  assert.ok(body.includes("E'escaped"));
  assert.equal(
    transactionBody("begin; select 1; commit;", "wrapped.sql").trim(),
    "select 1;"
  );
});

test("one transaction rolls back every migration and registry entry on failure; successful registry prevents replay", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])"
  );
  const broken = file(
    "20260101000001",
    "begin; insert into public.deploy_probe values (1); select 1/0; commit;"
  );
  await assert.rejects(
    db.exec(deploymentPlan([first, broken], []).sql),
    /division by zero/
  );
  await db.exec("rollback");
  assert.equal(
    (await db.query("select to_regclass('public.deploy_probe') as value"))
      .rows[0].value,
    null
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from supabase_migrations.schema_migrations"
      )
    ).rows[0].count,
    0
  );
  await db.exec(deploymentPlan([first, second], []).sql);
  const registry = (
    await db.query(
      "select version,name from supabase_migrations.schema_migrations order by version"
    )
  ).rows;
  assert.equal(registry.length, 2);
  assert.deepEqual(deploymentPlan([first, second], registry).pending, []);
  const stale = deploymentPlan([first, second], []).sql;
  await assert.rejects(db.exec(stale), /Migration registry changed/);
  await db.exec("rollback");
  const quoted = file(
    "20260101000002",
    String.raw`begin; select E'C:\\folder\\file''name'; commit;`
  );
  await db.exec("set standard_conforming_strings=off");
  await db.exec(deploymentPlan([first, second, quoted], registry).sql);
  assert.equal(
    (
      await db.query(
        "select statements[1] as source from supabase_migrations.schema_migrations where version='20260101000002'"
      )
    ).rows[0].source,
    quoted.source
  );
});

test("historical nontransactional migrations are explicitly refused when pending", async t => {
  const { db, migrations } = await replayMigrations();
  t.after(() => db.close());
  const incompatible = [];
  for (const filename of migrations) {
    const source = readFileSync(
      new URL(`../supabase/migrations/${filename}`, import.meta.url),
      "utf8"
    );
    try {
      transactionBody(source, filename);
    } catch (error) {
      assert.match(
        error.message,
        /instruction incompatible with a single transaction/
      );
      incompatible.push(filename);
    }
  }
  assert.deepEqual(incompatible, ["20261005000001_cards_category_index.sql"]);
});

test("catalogue omits redundant NOT NULL constraints but detects a real missing NOT NULL", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const sql = readFileSync(
    new URL("../scripts/schema-catalog.sql", import.meta.url),
    "utf8"
  );
  const catalog = async () =>
    (await db.query(sql)).rows.map(r => JSON.parse(Object.values(r)[0]));
  const before = await catalog();
  assert.ok(
    !before.some(
      r => r.kind === "constraint" && r.value.definition.startsWith("NOT NULL ")
    )
  );
  assert.equal(
    before.find(
      r => r.kind === "column" && r.name === "public.user_profiles.bio"
    ).value.not_null,
    true
  );
  await db.exec(
    "alter table public.user_profiles alter column bio drop not null"
  );
  const after = await catalog();
  assert.equal(
    after.find(
      r => r.kind === "column" && r.name === "public.user_profiles.bio"
    ).value.not_null,
    false
  );
  const directory = mkdtempSync(path.join(tmpdir(), "yokkai-not-null-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const production = path.join(directory, "catalog.jsonl");
  const compare = rows => {
    writeFileSync(production, rows.map(r => JSON.stringify(r)).join("\n"));
    return spawnSync(
      process.execPath,
      ["scripts/compare-schema-catalog.mjs", production],
      {
        encoding: "utf8",
        env: { ...process.env, DRIFT_MIGRATIONS_JSON: undefined }
      }
    );
  };
  const identical = compare(before);
  assert.equal(identical.status, 0, identical.stderr);
  assert.match(identical.stdout, /0 divergences/);
  const missing = compare(after);
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stdout, /CHANGED column: public.user_profiles.bio/);
  assert.match(missing.stdout, /1 divergences/);
});

test("pre-deployment catalogue detects structural drift as well as grants and functions", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const sql = readFileSync(
    new URL("../scripts/schema-catalog.sql", import.meta.url),
    "utf8"
  );
  const catalog = async () =>
    (await db.query(sql)).rows.map(r => JSON.parse(Object.values(r)[0]));
  const before = await catalog();
  assert.ok(
    before.some(
      r =>
        r.kind === "column" &&
        r.name === "public.cards.id" &&
        r.value.not_null === true
    )
  );
  assert.ok(
    !before.some(
      r => r.kind === "constraint" && /^NOT NULL\b/.test(r.value.definition)
    )
  );
  await db.exec(
    "alter table public.cards add column unexpected_drift integer; drop index public.cards_rarete_base_idx;"
  );
  const after = await catalog();
  assert.ok(
    after.some(
      r => r.kind === "column" && r.name === "public.cards.unexpected_drift"
    )
  );
  assert.ok(
    before.some(
      r => r.kind === "index" && r.name === "public.cards_rarete_base_idx"
    )
  );
  assert.ok(
    !after.some(
      r => r.kind === "index" && r.name === "public.cards_rarete_base_idx"
    )
  );
});

test("drift detects changed, missing and extra cron jobs", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const sql = readFileSync(
    new URL("../scripts/schema-catalog.sql", import.meta.url),
    "utf8"
  );
  const rows = (await db.query(sql)).rows.map(r =>
    JSON.parse(Object.values(r)[0])
  );
  const jobs = rows.filter(r => r.kind === "cron-job");
  const anticheatJobs = new Map([
    [
      "archive-failed-anticheat-discord-alerts@postgres",
      ["*/5 * * * *", "archive_failed_anticheat_discord_alerts"]
    ],
    [
      "dispatch-card-rarity-announcements@postgres",
      ["* * * * *", "dispatch_card_rarity_announcements"]
    ],
    [
      "evaluate-anticheat-farm-evidence@postgres",
      ["2-59/5 * * * *", "evaluate_anticheat_farm_evidence"]
    ],
    [
      "evaluate-anticheat-network-clusters@postgres",
      ["*/5 * * * *", "evaluate_anticheat_network_clusters"]
    ],
    [
      "expire-active-trade-quarantines@postgres",
      ["*/5 * * * *", "expire_active_trade_quarantines"]
    ],
    [
      "expire-anticheat-shadow-quarantines@postgres",
      ["*/5 * * * *", "expire_anticheat_shadow_quarantines"]
    ],
    [
      "run-anticheat-farm-policy@postgres",
      ["4-59/5 * * * *", "run_anticheat_farm_policy"]
    ],
    [
      "run-anticheat-referral-asset-recovery@postgres",
      ["* * * * *", "run_anticheat_referral_asset_recovery"]
    ],
    [
      "run-anticheat-referral-farms@postgres",
      ["* * * * *", "run_anticheat_referral_farms"]
    ]
  ]);
  const existingJobs = jobs.filter(job => !anticheatJobs.has(job.name));
  assert.deepEqual(
    jobs.filter(job => anticheatJobs.has(job.name)).map(job => job.name),
    [...anticheatJobs.keys()]
  );
  for (const [name, [schedule, fn]] of anticheatJobs) {
    assert.deepEqual(jobs.find(job => job.name === name).value, {
      schedule,
      command: `select public.${fn}();`,
      username: "postgres",
      database: "postgres",
      active: true
    });
  }
  assert.deepEqual(
    existingJobs.map(j => j.name),
    [
      "dispatch-anticheat-discord-alerts@postgres",
      "fold-collection-score-changes@postgres",
      "fold-license-score-changes@postgres",
      "purge-anticheat-deleted-identities@postgres",
      "purge-cron-history@postgres",
      "purge-deleted-email-cooldowns@postgres",
      "purge-friend-request-events@postgres",
      "refresh-catalogue-links-cache@postgres",
      "release-quiet-referral-reward-holds@postgres",
      "settle-expired-auctions@postgres",
      "weekly-mystery-auction@postgres"
    ]
  );
  assert.deepEqual(
    jobs.find(job => job.name === "weekly-mystery-auction@postgres").value,
    {
      schedule: "0 * * * *",
      command: "select public.create_weekly_mystery_auction();",
      username: "postgres",
      database: "postgres",
      active: true
    }
  );
  assert.deepEqual(existingJobs[0].value, {
    schedule: "* * * * *",
    command: "select public.dispatch_anticheat_discord_alerts();",
    username: "postgres",
    database: "postgres",
    active: true
  });
  assert.deepEqual(existingJobs[1].value, {
    schedule: "* * * * *",
    command: "select public.fold_collection_score_changes();",
    username: "postgres",
    database: "postgres",
    active: true
  });
  assert.deepEqual(existingJobs[2].value, {
    schedule: "* * * * *",
    command: "select public.fold_license_score_changes();",
    username: "postgres",
    database: "postgres",
    active: true
  });
  assert.deepEqual(existingJobs[3].value, {
    schedule: "*/15 * * * *",
    command: "select public.purge_anticheat_deleted_identities();",
    username: "postgres",
    database: "postgres",
    active: true
  });
  assert.deepEqual(existingJobs[4].value, {
    schedule: "0 3 * * *",
    command:
      "delete from cron.job_run_details where end_time < now() - interval '7 days';",
    username: "postgres",
    database: "postgres",
    active: true
  });
  assert.deepEqual(existingJobs[5].value, {
    schedule: "*/15 * * * *",
    command: "select public.purge_deleted_email_cooldowns();",
    username: "postgres",
    database: "postgres",
    active: true
  });
  assert.deepEqual(existingJobs[6].value, {
    schedule: "17 * * * *",
    command:
      "delete from public.friend_request_events where occurred_at<=clock_timestamp()-interval '24 hours'",
    username: "postgres",
    database: "postgres",
    active: true
  });
  assert.deepEqual(existingJobs[7].value, {
    schedule: "* * * * *",
    command: "select public.refresh_catalogue_links_cache();",
    username: "postgres",
    database: "postgres",
    active: true
  });
  assert.deepEqual(existingJobs[8].value, {
    schedule: "*/15 * * * *",
    command: "select public.release_quiet_referral_reward_holds();",
    username: "postgres",
    database: "postgres",
    active: true
  });
  assert.deepEqual(existingJobs[9].value, {
    schedule: "* * * * *",
    command: "select public.settle_expired_auctions();",
    username: "postgres",
    database: "postgres",
    active: true
  });
  const directory = mkdtempSync(path.join(tmpdir(), "yokkai-cron-drift-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const production = path.join(directory, "production.jsonl");
  const compare = actual => {
    writeFileSync(production, actual.map(r => JSON.stringify(r)).join("\n"));
    return spawnSync(
      process.execPath,
      ["scripts/compare-schema-catalog.mjs", production],
      {
        encoding: "utf8",
        env: { ...process.env, DRIFT_MIGRATIONS_JSON: undefined }
      }
    );
  };
  assert.equal(compare(rows).status, 0);
  for (const job of jobs) {
    for (const patch of [
      { schedule: "*/11 * * * *" },
      { command: "select 1;" },
      { active: false },
      { username: "supabase_admin" }
    ]) {
      const changed = compare(
        rows.map(r =>
          r === job ? { ...r, value: { ...r.value, ...patch } } : r
        )
      );
      assert.equal(changed.status, 1, changed.stderr);
      assert.match(changed.stdout, /CHANGED cron-job/);
    }
    const missing = compare(rows.filter(r => r !== job));
    assert.equal(missing.status, 1, missing.stderr);
    assert.ok(missing.stdout.includes(`MISSING IN PROD cron-job: ${job.name}`));
  }
  assert.match(
    compare([...rows, { ...jobs[0], name: "unexpected@postgres" }]).stdout,
    /PROD ONLY cron-job/
  );
});

test(
  "shell deployment gates dry-run, drift, confirmation and invalid backup before SQL",
  {
    skip:
      process.platform === "win32"
        ? "Interactive PTY integration runs on Linux CI; planner and transaction tests run on Windows too"
        : false
  },
  async t => {
    const directory = mkdtempSync(path.join(tmpdir(), "yokkai-deploy-test-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(path.join(directory, "scripts"));
    mkdirSync(path.join(directory, "supabase/migrations"), { recursive: true });
    mkdirSync(path.join(directory, "bin"));
    cpSync(
      new URL(
        "../supabase/migration-registry-exceptions.json",
        import.meta.url
      ),
      path.join(directory, "supabase/migration-registry-exceptions.json")
    );
    for (const name of [
      "deploy-migrations.sh",
      "check-prod-drift.sh",
      "plan-deploy-migrations.mjs",
      "replay-migrations.mjs",
      "compare-schema-catalog.mjs",
      "check-constraint-canonical.mjs",
      "schema-catalog.sql"
    ])
      cpSync(
        new URL(`../scripts/${name}`, import.meta.url),
        path.join(directory, "scripts", name)
      );
    // Own node_modules: the empty-cluster cache lands in this directory.
    mkdirSync(path.join(directory, "node_modules/@electric-sql"), {
      recursive: true
    });
    symlinkSync(
      path.resolve("node_modules/@electric-sql/pglite"),
      path.join(directory, "node_modules/@electric-sql/pglite"),
      "dir"
    );
    writeFileSync(
      path.join(directory, "supabase/migrations", first.filename),
      first.source
    );
    writeFileSync(
      path.join(directory, "supabase/migrations", second.filename),
      second.source
    );
    const { db } = await replayMigrations({ migrations: [] });
    const catalogue = async () =>
      (
        await db.query(
          readFileSync(
            new URL("../scripts/schema-catalog.sql", import.meta.url),
            "utf8"
          )
        )
      ).rows
        .map(r => Object.values(r)[0])
        .join("\n");
    const before = await catalogue();
    await db.exec(transactionBody(first.source, first.filename));
    await db.exec(transactionBody(second.source, second.filename));
    const after = await catalogue();
    await db.close();
    const stateFile = path.join(directory, "state.json"),
      logFile = path.join(directory, "calls.jsonl");
    writeFileSync(
      path.join(directory, "bin/ssh"),
      `#!/usr/bin/env node
const fs=require('fs'); const state=JSON.parse(fs.readFileSync(process.env.MOCK_STATE,'utf8')); const input=fs.readFileSync(0,'utf8');
const command=process.argv.slice(2).join(' '); let kind=input.includes('json_agg')?'registry':input.includes('pg_get_functiondef')?'drift':input.includes('set -euo pipefail')?'backup':'apply';
fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify({kind,command,input})+'\\n');
if((kind==='registry'&&state.registryInterrupted)||(kind==='drift'&&(state.interrupted||(state.interruptedAfterBackup&&fs.readFileSync(process.env.MOCK_LOG,'utf8').includes('"kind":"backup"'))))) {console.error('Connection reset by peer');process.exit(255)}
if(kind==='registry') console.log('[]');
if(kind==='drift') { const applied=fs.existsSync(process.env.MOCK_APPLIED); const changed=state.driftAfterBackup&&fs.readFileSync(process.env.MOCK_LOG,'utf8').includes('"kind":"backup"'); console.log(state.malformed?'[]':state.drift||changed?JSON.stringify({kind:'relation',name:'public.unexpected',value:{rls:false}}):applied?state.after:state.before); }
if(kind==='backup') { if(state.badBackup) {console.error('Backup empty or suspicious');process.exit(1)} console.log('Validated backup on VPS'); }
if(kind==='apply') {if(state.failApply){console.error('transaction failed');process.exit(1)}fs.writeFileSync(process.env.MOCK_APPLIED,'yes');console.log('BEGIN\\nINSERT 0 1\\nINSERT 0 1\\nCOMMIT');}
`,
      { mode: 0o755 }
    );
    const env = {
      ...process.env,
      DRIFT_MIGRATIONS_JSON: "[]",
      // The test may keep the cache; a real --apply defaults to off (below).
      YOKKAI_PGLITE_CACHE: "on",
      PATH: path.join(directory, "bin") + ":" + process.env.PATH,
      PROD_SSH_ALIAS: "fixture",
      PROD_DB_CONTAINER: "fixture-db",
      MOCK_STATE: stateFile,
      MOCK_LOG: logFile,
      MOCK_APPLIED: path.join(directory, "applied")
    };
    const calls = () =>
      readFileSync(logFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    const run = (state = {}, mode = "--dry-run", confirmation) => {
      writeFileSync(stateFile, JSON.stringify({ before, after, ...state }));
      writeFileSync(logFile, "");
      rmSync(env.MOCK_APPLIED, { force: true });
      if (confirmation === undefined)
        return spawnSync(
          "bash",
          [path.join(directory, "scripts/deploy-migrations.sh"), mode],
          { env, encoding: "utf8", timeout: 30000 }
        );
      // Real controlling terminal, not a production-only confirmation bypass.
      const python = `import os,pty,subprocess,fcntl,termios,select,time,sys
master,slave=pty.openpty()
def session():
 os.setsid();fcntl.ioctl(slave,termios.TIOCSCTTY,0)
p=subprocess.Popen(sys.argv[1:],stdin=slave,stdout=slave,stderr=slave,preexec_fn=session);os.close(slave)
out=b'';sent=False;deadline=time.time()+30
while time.time()<deadline:
 if select.select([master],[],[],0.1)[0]:
  try: chunk=os.read(master,65536)
  except OSError: break
  out+=chunk
  if b'Type APPLY:' in out and not sent: os.write(master,os.environ['CONFIRMATION'].encode()+b'\\n');sent=True
 if p.poll() is not None: break
if p.poll() is None: p.kill()
print(out.decode(),end='');sys.exit(p.wait())`;
      return spawnSync(
        "python3",
        [
          "-c",
          python,
          "bash",
          path.join(directory, "scripts/deploy-migrations.sh"),
          mode
        ],
        {
          env: { ...env, CONFIRMATION: confirmation },
          encoding: "utf8",
          timeout: 35000
        }
      );
    };
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      calls().map(c => c.kind),
      ["registry", "drift"]
    );
    assert.match(result.stdout, /Dry-run: no production writes/);
    result = spawnSync(
      "bash",
      [path.join(directory, "scripts/deploy-migrations.sh")],
      { env, encoding: "utf8", timeout: 30000 }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dry-run: no production writes/);
    // Without an explicit setting, --apply neither reads nor rewrites the
    // cache, while --dry-run still uses it (garbage is replaced by a cluster).
    const cache = path.join(
      directory,
      "node_modules/.cache/yokkai-pglite",
      `empty-${JSON.parse(readFileSync("node_modules/@electric-sql/pglite/package.json", "utf8")).version}.tar`
    );
    writeFileSync(cache, "not a cluster");
    delete env.YOKKAI_PGLITE_CACHE;
    result = run({}, "--apply", "NO");
    assert.notEqual(result.status, 0);
    assert.deepEqual(
      calls().map(c => c.kind),
      ["registry", "drift"]
    );
    assert.equal(readFileSync(cache, "utf8"), "not a cluster");
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.notEqual(readFileSync(cache, "utf8"), "not a cluster");
    env.YOKKAI_PGLITE_CACHE = "on";
    result = run({ drift: true }, "--apply", "APPLY");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /1 divergences/);
    assert.deepEqual(
      calls().map(c => c.kind),
      ["registry", "drift"]
    );
    result = run({ malformed: true }, "--apply", "APPLY");
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout + result.stderr, /divergence detected/);
    assert.deepEqual(
      calls().map(c => c.kind),
      ["registry", "drift"]
    );
    result = run({}, "--apply");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /interactive terminal/);
    result = run({}, "--apply", "NO");
    assert.notEqual(result.status, 0);
    assert.deepEqual(
      calls().map(c => c.kind),
      ["registry", "drift"]
    );
    result = run({ badBackup: true }, "--apply", "APPLY");
    assert.notEqual(result.status, 0);
    assert.deepEqual(
      calls().map(c => c.kind),
      ["registry", "drift", "backup"]
    );
    result = run({ driftAfterBackup: true }, "--apply", "APPLY");
    assert.equal(result.status, 1);
    assert.deepEqual(
      calls().map(c => c.kind),
      ["registry", "drift", "backup", "drift"]
    );
    for (const [state, expectedCalls] of [
      [{ registryInterrupted: true }, ["registry"]],
      [{ interrupted: true }, ["registry", "drift"]],
      [
        { interruptedAfterBackup: true },
        ["registry", "drift", "backup", "drift"]
      ]
    ]) {
      result = run(state, "--apply", "APPLY");
      assert.equal(result.status, 3, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, /connection interrupted/);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /divergence detected|production changed/
      );
      assert.deepEqual(
        calls().map(c => c.kind),
        expectedCalls
      );
    }
    result = run({ failApply: true }, "--apply", "APPLY");
    assert.notEqual(result.status, 0);
    assert.deepEqual(
      calls().map(c => c.kind),
      ["registry", "drift", "backup", "drift", "apply"]
    );
    result = run({}, "--apply", "APPLY");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(
      calls().map(c => c.kind),
      ["registry", "drift", "backup", "drift", "apply", "drift"]
    );
    assert.ok(
      calls().every(
        c =>
          !c.command.includes("supabase_admin") &&
          !c.input.includes("-U supabase_admin")
      )
    );
    assert.match(calls().find(c => c.kind === "apply").command, /-U postgres/);
    assert.match(result.stdout, /Deployment complete; no drift/);

    // Execute the actual VPS backup/retention shell body on a disposable host
    // directory with mocked Docker/archive tools; no production connection.
    const backupDirectory = path.join(directory, "backups");
    mkdirSync(backupDirectory, { mode: 0o700 });
    for (let i = 1; i <= 12; i++) {
      const archive = path.join(
        backupDirectory,
        `yokkai-migrations-20250101T0000${String(i).padStart(2, "0")}-${i}.dump`
      );
      writeFileSync(archive, "old backup");
      utimesSync(archive, 1000000000 + i, 1000000000 + i);
    }
    writeFileSync(path.join(backupDirectory, "unrelated.dump"), "preserve");
    writeFileSync(
      path.join(directory, "bin/stat"),
      `#!/usr/bin/env node
const {spawnSync}=require('child_process');const args=process.argv.slice(2);if(args[0]==='-c'&&args[1]==='%u')console.log('0');else{const r=spawnSync('/usr/bin/stat',args);process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status)}
`,
      { mode: 0o755 }
    );
    writeFileSync(
      path.join(directory, "bin/docker"),
      `#!/usr/bin/env node
const args=process.argv.slice(2);if(args.includes('pg_dump')){if(args[args.indexOf('-U')+1]!=='postgres')process.exit(2);if(!process.env.MOCK_EMPTY)process.stdout.write(Buffer.alloc(2048));}
else if(args.includes('pg_restore')){require('fs').readFileSync(0);if(process.env.MOCK_BAD_ARCHIVE)process.exit(1);console.log('archive inventory');}else process.exit(2);
`,
      { mode: 0o755 }
    );
    const backupBody = readFileSync(
      new URL("../scripts/deploy-migrations.sh", import.meta.url),
      "utf8"
    ).match(/<<'BACKUP'\n([\s\S]*?)\nBACKUP/)[1];
    const backup = extra =>
      spawnSync("bash", ["-s", "--", "fixture-db", backupDirectory], {
        input: backupBody,
        env: { ...env, ...extra },
        encoding: "utf8"
      });
    for (const extra of [{ MOCK_EMPTY: "1" }, { MOCK_BAD_ARCHIVE: "1" }]) {
      assert.notEqual(backup(extra).status, 0);
      assert.equal(
        readdirSync(backupDirectory).length,
        13,
        "Invalid backups must neither be published nor prune good backups"
      );
    }
    const backedUp = backup({});
    assert.equal(backedUp.status, 0, backedUp.stderr);
    const archives = readdirSync(backupDirectory);
    assert.equal(
      archives.filter(f => /^yokkai-migrations-.*\.dump$/.test(f)).length,
      10
    );
    assert.ok(archives.includes("unrelated.dump"));
    assert.ok(!archives.some(f => f.endsWith(".partial")));
    for (let i = 1; i <= 3; i++)
      assert.ok(
        !archives.some(f => f.endsWith(`-${i}.dump`)),
        "Prune oldest by modification time"
      );

    // The actual administrative shell body must never reach SQL after a bad dump.
    const admin = new URL(
      "../scripts/admin/enable-pg-cron.sh",
      import.meta.url
    );
    const source = readFileSync(admin, "utf8");
    const body = source.match(/<<'REMOTE'\n([\s\S]*?)\nREMOTE/)[1];
    const adminDirectory = path.join(directory, "admin-backups");
    const adminLog = path.join(directory, "admin-sql.txt");
    writeFileSync(
      path.join(directory, "bin/docker"),
      `#!/usr/bin/env node
const fs=require('fs');const args=process.argv.slice(2);
if(args.includes('pg_dump')){if(!process.env.MOCK_EMPTY)process.stdout.write(Buffer.alloc(2048));}
else if(args.includes('pg_restore')){fs.readFileSync(0);if(process.env.MOCK_BAD_ARCHIVE)process.exit(1);}
else if(args.includes('psql')){if(args[args.indexOf('-U')+1]!=='supabase_admin')process.exit(2);fs.writeFileSync(process.env.ADMIN_LOG,fs.readFileSync(0));}
else process.exit(2);
`,
      { mode: 0o755 }
    );
    const enable = extra =>
      spawnSync("bash", ["-s", "--", "fixture-db", adminDirectory], {
        input: body,
        env: { ...env, ADMIN_LOG: adminLog, ...extra },
        encoding: "utf8"
      });
    for (const extra of [{ MOCK_EMPTY: "1" }, { MOCK_BAD_ARCHIVE: "1" }]) {
      assert.notEqual(enable(extra).status, 0);
      assert.equal(readdirSync(adminDirectory).length, 0);
      assert.throws(() => readFileSync(adminLog));
    }
    const enabled = enable({});
    assert.equal(enabled.status, 0, enabled.stderr);
    const adminSql = readFileSync(adminLog, "utf8");
    assert.match(adminSql, /create extension if not exists pg_cron/);
    assert.match(adminSql, /set local role postgres/);
    assert.doesNotMatch(adminSql, /select cron.schedule/);
    assert.equal(
      readdirSync(adminDirectory).filter(n => n.endsWith(".dump")).length,
      1
    );
    writeFileSync(logFile, "");
    const dry = spawnSync("bash", [admin.pathname], { env, encoding: "utf8" });
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(calls(), []);
    const unattended = spawnSync("bash", [admin.pathname, "--apply"], {
      env,
      encoding: "utf8"
    });
    assert.notEqual(unattended.status, 0);
    assert.match(unattended.stderr, /interactive terminal/);
    assert.deepEqual(calls(), []);
  }
);
