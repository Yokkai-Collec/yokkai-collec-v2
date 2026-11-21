import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const players = [
  "d8800000-0000-4000-8000-000000000001",
  "d8800000-0000-4000-8000-000000000002",
  "d8800000-0000-4000-8000-000000000003"
];

test("Sunset Edition import keeps the classic LR cards and reuses its own IDs", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const importSql = readFileSync(
    new URL("../scripts/sql/import-gta-sunset.sql", import.meta.url),
    "utf8"
  );
  await db.exec(`
    insert into public.cards (source, source_id, nom, categorie, franchise, rarete_base, image_url)
    values
      ('manual', 'classic-jason', 'Jason Duval', 'VIDEO GAMES', 'GTA VI', 'LR', '/classic-jason.png'),
      ('manual', 'classic-lucia', 'Lucia Caminos', 'VIDEO GAMES', 'GTA VI', 'LR', '/classic-lucia.png');
  `);
  const classics = async () =>
    (
      await db.query(
        "select * from public.cards where source_id like 'classic-%' order by source_id"
      )
    ).rows;
  const originals = await classics();
  await db.exec(importSql);
  const event = async () =>
    (
      await db.query(
        `select jason_card_id, lucia_card_id, starts_on::text,
          (ends_at at time zone 'Europe/Paris')::text as closing,
          (bonus_credit_at at time zone 'Europe/Paris')::text as bonus,
          (1 - power(1 - 2 * lr_rate_per_card, 6))::float8 as six_pack_rate
        from public.gta_sunset_event`
      )
    ).rows[0];
  const imported = await event();
  assert.equal(imported.starts_on, "2026-11-21");
  assert.equal(imported.closing, "2026-11-25 20:00:00");
  assert.equal(imported.bonus, "2026-11-21 20:00:00");
  assert.ok(Math.abs(imported.six_pack_rate - 0.2) < 1e-10);
  assert.deepEqual(
    (
      await db.query(`
      select (credit_at at time zone 'Europe/Paris')::text as credit
      from public.gta_sunset_event e
      cross join lateral public.gta_sunset_pack_schedule(e)
      order by credit_at
    `)
    ).rows.map(row => row.credit),
    [
      "2026-11-21 00:00:00",
      "2026-11-21 20:00:00",
      "2026-11-22 20:00:00",
      "2026-11-23 20:00:00",
      "2026-11-24 20:00:00",
      "2026-11-25 20:00:00"
    ]
  );
  const previewCards = async () =>
    (
      await db.query(
        "select id, nom, rarete_base, event_only, image_url from public.cards where id in ($1, $2) order by source_id",
        [imported.jason_card_id, imported.lucia_card_id]
      )
    ).rows;
  const verified = await previewCards();
  assert.deepEqual(
    verified.map(card => card.nom),
    ["JASON DUVAL (SUNSET EDITION)", "LUCIA CAMINOS (SUNSET EDITION)"]
  );
  assert.deepEqual(
    verified.map(card => card.image_url),
    [
      "/assets/events/gta-sunset/jason.png",
      "/assets/events/gta-sunset/lucia.png"
    ]
  );
  assert(verified.every(card => card.event_only && card.rarete_base === "LR"));
  assert(
    verified.every(card => !originals.some(original => original.id === card.id))
  );
  await db.exec(`
    update public.cards set nom = replace(nom, ' (SUNSET EDITION)', '')
    where source = 'manual' and source_id in ('gta-sunset-jason', 'gta-sunset-lucia');
  `);
  await db.exec(importSql);
  await db.exec(importSql);
  assert.deepEqual(await event(), imported);
  assert.deepEqual(await previewCards(), verified);
  assert.deepEqual(await classics(), originals);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as total from public.cards where source_id like 'gta-sunset-%'"
      )
    ).rows[0].total,
    2
  );
});

test("Sunset credits stack at 20:00 in Paris and opening retries keep the same cards", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`
    alter table auth.users add column if not exists banned_until timestamptz;
    alter table auth.users add column if not exists created_at timestamptz;
  `);
  const today = "(now() at time zone 'Europe/Paris')::date";
  for (const [index, player] of players.entries()) {
    await db.query(
      `insert into auth.users (id, raw_user_meta_data, created_at)
      values ($1, $2, (${today} - $3::int)::timestamp at time zone 'Europe/Paris')`,
      [
        player,
        JSON.stringify({ pseudo: "SunsetTest" + index }),
        index === 2 ? 0 : 7
      ]
    );
  }
  await db.exec(`
    insert into public.cards (source, source_id, nom, categorie, franchise, rarete_base, image_url, event_only)
    values
      ('test', 'ordinary-c', 'Ordinary C', 'VIDEO GAMES', 'Test', 'C', '/c.png', false),
      ('test', 'ordinary-r', 'Ordinary R', 'VIDEO GAMES', 'Test', 'R', '/r.png', false),
      ('test', 'ordinary-sr', 'Ordinary SR', 'VIDEO GAMES', 'Test', 'SR', '/sr.png', false),
      ('test', 'jason', 'Jason Duval', 'VIDEO GAMES', 'GTA VI', 'LR', '/jason.png', true),
      ('test', 'lucia', 'Lucia Caminos', 'VIDEO GAMES', 'GTA VI', 'LR', '/lucia.png', true);
  `);
  const asPlayer = async (player, call, parameters = []) => {
    await db.exec("set role authenticated");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        player
      ]);
      return (await db.query(call, parameters)).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  const getEvent = player =>
    asPlayer(player, "select public.get_gta_sunset_event() as value");
  const open = (player, day) =>
    asPlayer(
      player,
      "select public.open_gta_sunset_booster($1::date) as value",
      [day]
    );
  const dates = (
    await db.query(`
    select
      (${today} - 3)::text as three_days_ago,
      (${today} - 2)::text as two_days_ago,
      (${today} - 1)::text as yesterday,
      ${today}::text as today,
      (${today} + 1)::text as tomorrow,
      to_jsonb((${today} + time '20:00') at time zone 'Europe/Paris') #>> '{}' as today_credit_at,
      to_jsonb(((${today} + 1) + time '20:00') at time zone 'Europe/Paris') #>> '{}' as tomorrow_credit_at,
      to_jsonb(((${today} + 3) + time '20:00') at time zone 'Europe/Paris') #>> '{}' as ends_at
  `)
  ).rows[0];
  assert.equal(await getEvent(players[0]), null);
  await assert.rejects(open(players[0], dates.today), {
    message: "GTA_SUNSET_EVENT_CLOSED"
  });

  await db.exec(`
    insert into public.gta_sunset_event (starts_on, ends_at, jason_card_id, lucia_card_id, midnight_credits_through)
    select ${today} - 1, ((${today} + 3) + time '20:00') at time zone 'Europe/Paris', j.id, l.id, ${today} - 1
    from public.cards j cross join public.cards l
    where j.source_id = 'jason' and l.source_id = 'lucia'
  `);
  const functionDefinition = async signature =>
    (
      await db.query(
        "select pg_get_functiondef($1::regprocedure) as definition",
        [signature]
      )
    ).rows[0].definition;
  const readDefinition = await functionDefinition(
    "public.get_gta_sunset_event()"
  );
  const openDefinition = await functionDefinition(
    "public.open_gta_sunset_booster(date)"
  );
  const atParisTime = async (day, time) => {
    const stamp = `(timestamp '${day} ${time}' at time zone 'Europe/Paris')`;
    const read = readDefinition.replace(
      "stamp timestamptz := statement_timestamp();",
      `stamp timestamptz := ${stamp};`
    );
    const draw = openDefinition.replace(
      "stamp := clock_timestamp();",
      `stamp := ${stamp};`
    );
    assert.notEqual(read, readDefinition);
    assert.notEqual(draw, openDefinition);
    await db.exec(read);
    await db.exec(draw);
  };

  await db.exec(`
    update public.gta_sunset_event
    set bonus_credit_at = (starts_on + time '20:00') at time zone 'Europe/Paris';
  `);
  await atParisTime(dates.yesterday, "19:59:59.999999");
  assert.deepEqual((await getEvent(players[0])).availableDays, [
    dates.yesterday
  ]);
  await assert.rejects(open(players[0], dates.two_days_ago), {
    message: "GTA_SUNSET_PACK_UNAVAILABLE"
  });
  await atParisTime(dates.yesterday, "20:00:00");
  const bonusEvent = await getEvent(players[0]);
  assert.deepEqual(bonusEvent.availableDays, [
    dates.yesterday,
    dates.two_days_ago
  ]);
  assert.equal(bonusEvent.nextResetAt, dates.today_credit_at);
  assert.deepEqual((await getEvent(players[2])).availableDays, []);
  await db.exec("update public.gta_sunset_event set bonus_credit_at = null");

  await atParisTime(dates.today, "19:59:59.999999");
  const beforeCredit = await getEvent(players[0]);
  assert.equal(beforeCredit.nextResetAt, dates.today_credit_at);
  assert.deepEqual(beforeCredit.availableDays, [dates.yesterday]);
  assert.deepEqual((await getEvent(players[2])).availableDays, []);
  await assert.rejects(open(players[0], dates.today), {
    message: "GTA_SUNSET_PACK_UNAVAILABLE"
  });

  await atParisTime(dates.today, "20:00:00");
  const initialEvent = await getEvent(players[0]);
  assert.equal(initialEvent.lrRatePerCard, 0.025);
  assert.equal(initialEvent.endsAt, dates.ends_at);
  assert.equal(initialEvent.nextResetAt, dates.tomorrow_credit_at);
  assert.deepEqual(initialEvent.availableDays, [dates.yesterday, dates.today]);
  assert.deepEqual((await getEvent(players[2])).availableDays, [dates.today]);
  await assert.rejects(open(players[0], dates.tomorrow), {
    message: "GTA_SUNSET_PACK_UNAVAILABLE"
  });
  await assert.rejects(open(players[2], dates.yesterday), {
    message: "GTA_SUNSET_PACK_UNAVAILABLE"
  });

  const definition = await functionDefinition(
    "public.open_gta_sunset_booster(date)"
  );
  const forceRoll = async (roll, drawDefinition = definition) => {
    const patched = drawDefinition.replace(
      "roll := random();",
      "roll := " + roll + ";"
    );
    assert.notEqual(patched, drawDefinition);
    await db.exec(patched);
  };
  await forceRoll(0.024999);
  const first = await open(players[0], dates.yesterday);
  assert.equal(first.length, 3);
  assert.deepEqual(
    first.filter(card => card.rarity === "LR").map(card => card.name),
    ["JASON DUVAL"]
  );
  assert.equal(first[2].isFirstOwner, true);

  await forceRoll(0.025);
  assert.deepEqual(await open(players[0], dates.yesterday), first);
  const current = await getEvent(players[0]);
  assert.deepEqual(current.openedCards, first);
  assert.deepEqual(current.availableDays, [dates.today]);
  assert.equal((await getEvent(players[1])).openedCards, null);
  const second = await open(players[0], dates.today);
  assert.deepEqual(
    second.filter(card => card.rarity === "LR").map(card => card.name),
    ["LUCIA CAMINOS"]
  );
  assert.deepEqual((await getEvent(players[0])).openedCards, second);
  assert.deepEqual((await getEvent(players[0])).availableDays, []);
  assert.equal(
    (await db.query("select count(*)::int as count from public.user_cards"))
      .rows[0].count,
    6
  );

  // Move the five-day edition into the past while preserving its opening history.
  await db.exec(`
    update public.gta_sunset_openings set event_start = event_start - 4, opening_day = opening_day - 4;
    update public.gta_sunset_event set starts_on = starts_on - 4, midnight_credits_through = midnight_credits_through - 4,
      ends_at = ((${today} - 1) + time '20:00') at time zone 'Europe/Paris';
  `);
  const remaining = [dates.three_days_ago, dates.two_days_ago, dates.yesterday];
  await atParisTime(dates.yesterday, "19:59:59.999999");
  const beforeClose = await getEvent(players[0]);
  assert.equal(beforeClose.nextResetAt, beforeClose.endsAt);
  assert.deepEqual(beforeClose.availableDays, remaining.slice(0, -1));
  await assert.rejects(open(players[0], dates.yesterday), {
    message: "GTA_SUNSET_PACK_UNAVAILABLE"
  });
  await atParisTime(dates.yesterday, "20:00:00");
  const atClose = await getEvent(players[0]);
  assert.equal(atClose.nextResetAt, null);
  assert.deepEqual(atClose.availableDays, remaining);
  await atParisTime(dates.today, "19:59:59.999999");
  assert.deepEqual((await getEvent(players[0])).availableDays, remaining);
  assert.deepEqual((await getEvent(players[2])).availableDays, []);
  await assert.rejects(open(players[0], dates.today), {
    message: "GTA_SUNSET_PACK_UNAVAILABLE"
  });
  await forceRoll(
    0.05,
    await functionDefinition("public.open_gta_sunset_booster(date)")
  );
  for (const day of remaining) {
    const pack = await open(players[0], day);
    assert.equal(pack.length, 3);
    assert.ok(pack.every(card => card.rarity !== "LR"));
  }
  assert.deepEqual((await getEvent(players[0])).availableDays, []);
  assert.equal(
    (await db.query("select count(*)::int as count from public.user_cards"))
      .rows[0].count,
    15
  );
  await atParisTime(dates.today, "20:00:00");
  const expired = await getEvent(players[1]);
  assert.deepEqual(expired.availableDays, []);
  assert.equal(
    Date.parse(expired.packsExpireAt),
    Date.parse(expired.endsAt) + 86_400_000
  );
  await assert.rejects(open(players[1], dates.yesterday), {
    message: "GTA_SUNSET_PACK_UNAVAILABLE"
  });
  assert.equal((await getEvent(players[0])).openedCards.length, 3);
  assert.equal(
    (await db.query("select count(*)::int as count from public.user_cards"))
      .rows[0].count,
    15
  );
});
