import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("rarity announcements capture committed changes, protect the dedicated destination and acknowledge delivery", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const rows = async () =>
    (
      await db.query(
        "select * from public.card_rarity_discord_outbox order by id"
      )
    ).rows;
  const card = (
    await db.query(`insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url)
    values('manual','discord-rarity-test','Son Goku','ANIME/MANGA','Dragon Ball','R','https://example.test/card.webp') returning id`)
  ).rows[0].id;
  await db.query("update public.cards set rarete_base='SR' where id=$1", [
    card
  ]);
  assert.equal(
    (await rows()).length,
    0,
    "unconfigured destination must not accumulate a historical backlog"
  );
  await db.exec(`create schema net;
    create table net.requests(id bigint generated always as identity,url text,body jsonb);
    create table net._http_response(id bigint,status_code integer,timed_out boolean,error_msg text,content text);
    create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer)
    returns bigint language plpgsql as $$ declare request bigint; begin
      insert into net.requests(url,body) values(url,body) returning id into request; return request; end $$;
    insert into public.card_rarity_discord_config(enabled,webhook_url)
      values(true,'https://discord.com/api/webhooks/123456789/fake-test-token');`);
  await db.query(
    "update public.cards set rarete_base='SR',nom='Son Goku' where id=$1",
    [card]
  );
  assert.equal((await rows()).length, 0);
  await db.exec("begin");
  await db.query("update public.cards set rarete_base='LR' where id=$1", [
    card
  ]);
  assert.equal((await rows()).length, 1);
  await db.exec("rollback");
  assert.equal(
    (await rows()).length,
    0,
    "rolled-back card edits must not be announced"
  );
  await db.query("update public.cards set rarete_base='SSR' where id=$1", [
    card
  ]);
  const [event] = await rows();
  assert.equal(event.old_rarity, "SR");
  assert.equal(event.new_rarity, "SSR");
  const embed = event.payload.embeds[0];
  assert.equal(embed.title, "Rareté mise à jour");
  assert.deepEqual(
    embed.fields.map(f => f.value),
    ["SON GOKU", "Dragon Ball", "SR", "SSR"]
  );
  assert.equal(embed.thumbnail.url, "https://example.test/card.webp");
  assert.deepEqual(event.payload.allowed_mentions, { parse: [] });
  assert.match(embed.footer.text, new RegExp(String(event.id)));
  await db.query("update public.cards set rarete_base='LR' where id=$1", [
    card
  ]);
  assert.equal(
    (await rows()).length,
    2,
    "separate changes must retain their individual before/after values"
  );
  await db.exec(
    "select public.dispatch_card_rarity_announcements();select public.dispatch_card_rarity_announcements()"
  );
  const requests = async () =>
    (await db.query("select * from net.requests order by id")).rows;
  assert.equal(
    (await requests()).length,
    1,
    "in-flight request must not be sent again"
  );
  assert.match((await requests())[0].url, /\?wait=true$/);
  await db.exec(
    "insert into net._http_response values(1,200,false,null,'{}');select public.dispatch_card_rarity_announcements()"
  );
  assert.equal((await rows())[0].status, "SENT");
  assert.equal((await requests()).length, 2);
  await db.exec("select public.dispatch_card_rarity_announcements()");
  assert.equal((await requests()).length, 2);
  await db.exec(
    `insert into net._http_response values(2,429,false,null,'{"retry_after":180}');select public.dispatch_card_rarity_announcements()`
  );
  const retry = (await rows())[1];
  assert.equal(retry.status, "PENDING");
  assert.equal(retry.last_error, "HTTP_429");
  assert.ok(new Date(retry.retry_at).getTime() - Date.now() > 170000);
  await db.exec("select public.dispatch_card_rarity_announcements()");
  assert.equal(
    (await requests()).length,
    2,
    "rate-limit delay must be respected"
  );
  await db.exec(
    "update public.card_rarity_discord_outbox set retry_at=now()-interval '1 minute' where status='PENDING';select public.dispatch_card_rarity_announcements()"
  );
  assert.equal((await requests()).length, 3);
  await db.exec(
    "insert into net._http_response values(3,404,false,null,'{}');select public.dispatch_card_rarity_announcements()"
  );
  assert.equal(
    (await rows())[1].status,
    "FAILED",
    "permanent webhook failure must stop automatic retries"
  );
  await db.exec(
    "select public.dispatch_card_rarity_announcements();update public.card_rarity_discord_config set enabled=false"
  );
  await db.query("update public.cards set rarete_base='R' where id=$1", [card]);
  assert.equal((await rows()).length, 2);
  assert.equal((await requests()).length, 3);
  await db.exec("update public.card_rarity_discord_config set enabled=true");
  await db.query("update public.cards set rarete_base='SR' where id=$1", [
    card
  ]);
  await db.exec(
    "select public.dispatch_card_rarity_announcements();update public.card_rarity_discord_outbox set attempted_at=now()-interval '6 minutes' where status='PENDING';select public.dispatch_card_rarity_announcements()"
  );
  assert.equal((await rows())[2].status, "FAILED");
  assert.equal((await rows())[2].last_error, "DELIVERY_UNCONFIRMED");
  assert.equal(
    (await requests()).length,
    4,
    "unknown delivery must require review instead of risking an automatic duplicate"
  );
  await db.query("update public.cards set rarete_base='LR' where id=$1", [
    card
  ]);
  await db.exec(
    "update public.card_rarity_discord_outbox set attempts=11 where status='PENDING';select public.dispatch_card_rarity_announcements();insert into net._http_response values(5,503,false,null,'{}');select public.dispatch_card_rarity_announcements()"
  );
  assert.equal((await rows())[3].status, "FAILED");
  assert.equal((await rows())[3].attempts, 12);
  await db.exec("select public.dispatch_card_rarity_announcements()");
  assert.equal((await requests()).length, 5, "exhausted deliveries must stop");
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query("select webhook_url from public.card_rarity_discord_config"),
      /permission denied/
    );
    await assert.rejects(
      db.query("update public.card_rarity_discord_config set enabled=true"),
      /permission denied/
    );
    await assert.rejects(
      db.query("select * from public.card_rarity_discord_outbox"),
      /permission denied/
    );
    await assert.rejects(
      db.query("select public.dispatch_card_rarity_announcements()"),
      /permission denied/
    );
    await db.exec("reset role");
  }
  const job = (
    await db.query(
      "select command,schedule from cron.job where jobname='dispatch-card-rarity-announcements'"
    )
  ).rows[0];
  assert.deepEqual(job, {
    command: "select public.dispatch_card_rarity_announcements();",
    schedule: "* * * * *"
  });
});

test("an entire 500-row import produces one message for all licences across write chunks", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "insert into public.card_rarity_discord_config(enabled,webhook_url) values(true,'https://discord.com/api/webhooks/123456789/fake-test-token')"
  );
  const batch = "db600000-0000-4000-8000-000000000001";
  const make = (i, licence = "Dragon Ball") => ({
    source: "manual",
    source_id: `bulk-announcement-${i}`,
    nom: `New character ${i}`,
    categorie: "ANIME/MANGA",
    franchise: licence,
    rarete_base: "SR",
    image_url: "https://example.test/card.webp",
    favoris_count: 0
  });
  for (let offset = 0; offset < 500; offset += 25) {
    await db.query("select public.import_catalogue_cards_announced($1,$2)", [
      JSON.stringify(Array.from({ length: 25 }, (_, i) => make(offset + i))),
      batch
    ]);
  }
  const counts = async () =>
    (
      await db.query(
        "select status,event_kind,count(*)::int total from public.card_rarity_discord_outbox group by status,event_kind order by status,event_kind"
      )
    ).rows;
  assert.deepEqual(await counts(), [
    { status: "COLLECTING", event_kind: "ADDITION", total: 500 }
  ]);
  assert.equal(
    (
      await db.query(
        "select public.finish_catalogue_discord_import($1) result",
        [batch]
      )
    ).rows[0].result,
    1
  );
  assert.deepEqual(await counts(), [
    { status: "PENDING", event_kind: "IMPORT", total: 1 }
  ]);
  const message = (
    await db.query("select payload from public.card_rarity_discord_outbox")
  ).rows[0].payload.embeds[0];
  assert.equal(message.title, "Ajouts au catalogue");
  assert.equal(message.description, "• Dragon Ball — 500 cartes ajoutées");
  assert.deepEqual(message.fields, [
    { name: "Licences", value: "1", inline: true },
    { name: "Cartes ajoutées", value: "500", inline: true }
  ]);
  assert.equal(
    (
      await db.query(
        "select public.finish_catalogue_discord_import($1) result",
        [batch]
      )
    ).rows[0].result,
    0,
    "finalisation is idempotent"
  );
  await assert.rejects(
    db.query("select public.import_catalogue_cards_announced($1,$2)", [
      JSON.stringify([make(500)]),
      batch
    ]),
    /IMPORT_ALREADY_FINISHED/
  );
  const second = "db600000-0000-4000-8000-000000000002";
  await db.query("select public.import_catalogue_cards_announced($1,$2)", [
    JSON.stringify([
      make(0),
      ...Array.from({ length: 6 }, (_, i) =>
        make(500 + i, i < 3 ? "Dragon Ball" : "Naruto")
      )
    ]),
    second
  ]);
  await db.query("select public.finish_catalogue_discord_import($1)", [second]);
  const summaries = (
    await db.query(
      "select payload->'embeds'->0 as embed from public.card_rarity_discord_outbox where import_id=$1",
      [second]
    )
  ).rows;
  assert.equal(summaries.length, 1, "all licences share one Discord message");
  assert.equal(
    summaries[0].embed.description,
    "• Dragon Ball — 3 cartes ajoutées\n• Naruto — 3 cartes ajoutées"
  );
  assert.deepEqual(
    summaries[0].embed.fields.map(f => f.value),
    ["2", "6"],
    "unchanged cards do not inflate counts"
  );
  const small = "db600000-0000-4000-8000-000000000003";
  await db.query("select public.import_catalogue_cards_announced($1,$2)", [
    JSON.stringify(Array.from({ length: 5 }, (_, i) => make(600 + i))),
    small
  ]);
  await db.query("select public.finish_catalogue_discord_import($1)", [small]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int total from public.card_rarity_discord_outbox where import_id=$1 and status='PENDING' and event_kind='ADDITION'",
        [small]
      )
    ).rows[0].total,
    5
  );
  const changes = "db600000-0000-4000-8000-000000000004";
  await db.query("select public.import_catalogue_cards_announced($1,$2)", [
    JSON.stringify(
      Array.from({ length: 6 }, (_, i) => ({ ...make(i), rarete_base: "SSR" }))
    ),
    changes
  ]);
  await db.query("select public.finish_catalogue_discord_import($1)", [
    changes
  ]);
  const changed = (
    await db.query(
      "select payload->'embeds'->0 as embed from public.card_rarity_discord_outbox where import_id=$1",
      [changes]
    )
  ).rows[0].embed;
  assert.equal(changed.title, "Raretés mises à jour");
  assert.deepEqual(
    changed.fields.map(f => f.value),
    ["1", "0", "6"]
  );
  const longBatch = "db600000-0000-4000-8000-000000000005";
  await db.query("select public.import_catalogue_cards_announced($1,$2)", [
    JSON.stringify(
      Array.from({ length: 50 }, (_, i) =>
        make(700 + i, `Very long licence ${i} ${"x".repeat(100)}`)
      )
    ),
    longBatch
  ]);
  await db.query("select public.finish_catalogue_discord_import($1)", [
    longBatch
  ]);
  const longMessage = (
    await db.query(
      "select payload->'embeds'->0 as embed from public.card_rarity_discord_outbox where import_id=$1",
      [longBatch]
    )
  ).rows[0].embed;
  assert.ok(longMessage.description.length < 4096);
  assert.ok(
    longMessage.description.includes(`/api/catalogue-imports/${longBatch}`)
  );
  await db.exec("set role anon");
  const fullList = (
    await db.query("select public.get_catalogue_import_summary($1) summary", [
      longBatch
    ])
  ).rows[0].summary;
  assert.equal(
    fullList.length,
    50,
    "oversized lists remain complete through the same message link"
  );
  assert.deepEqual(Object.keys(fullList[0]).sort(), [
    "added",
    "changed",
    "license"
  ]);
  await db.exec("reset role");
  const matched = "db600000-0000-4000-8000-000000000006";
  const existing = (
    await db.query(
      "select id from public.cards where source_id='bulk-announcement-0'"
    )
  ).rows[0].id;
  await db.query("select public.update_catalogue_card_announced($1,$2,$3)", [
    existing,
    JSON.stringify({
      rarete_base: "LR",
      franchise: "Dragon Ball",
      image_url: "https://example.test/updated.webp"
    }),
    matched
  ]);
  await db.query("select public.finish_catalogue_discord_import($1)", [
    matched
  ]);
  const matchEvent = (
    await db.query(
      "select old_rarity,new_rarity from public.card_rarity_discord_outbox where import_id=$1",
      [matched]
    )
  ).rows[0];
  assert.deepEqual(matchEvent, { old_rarity: "SSR", new_rarity: "LR" });
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query(
        "select public.import_catalogue_cards_announced('[]',gen_random_uuid())"
      ),
      /permission denied|ADMIN_REQUIRED/
    );
    await assert.rejects(
      db.query("select public.finish_catalogue_discord_import($1)", [small]),
      /permission denied|ADMIN_REQUIRED/
    );
    await assert.rejects(
      db.query("select public.update_catalogue_card_announced($1,'{}',$2)", [
        existing,
        matched
      ]),
      /permission denied|ADMIN_REQUIRED/
    );
    await db.exec("reset role");
  }
});
