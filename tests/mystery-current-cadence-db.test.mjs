import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const migration = "20261118130000_mystery_apply_current_cadence.sql";
test("Cadence transition advances only old active Mystery deadlines, without touching cards, odds or escrow", async t => {
  const { db } = await replayMigrations({
    migrations: readdirSync("supabase/migrations")
      .filter(n => n.endsWith(".sql") && n < migration)
      .sort()
  });
  t.after(() => db.close());
  await db.exec(`
 insert into auth.users(id,raw_user_meta_data) values('22000000-0000-4000-8000-000000000001','{"pseudo":"TransitionBidder"}');
 update public.user_profiles set karas_balance=1000 where user_id='22000000-0000-4000-8000-000000000001';
 insert into public.auctions(is_mystery,mystery_day,starting_price,current_price,duration_minutes,ends_at) values
 (true,'2099-01-01',50,50,1380,'2099-01-02 18:00+00'),
 (true,'2099-01-02',50,50,1440,'2099-01-03 09:30+00');
 insert into public.auctions(is_mystery,mystery_day,starting_price,current_price,duration_minutes,ends_at,mystery_lr_chance,mystery_misses)
 values(true,'2099-01-03',50,50,900,'2099-01-04 10:00+00',0.02,2);
 insert into public.auctions(is_mystery,mystery_day,starting_price,current_price,duration_minutes,ends_at,status)
 values(true,'2098-01-01',50,50,1380,'2098-01-02 18:00+00','expired');
 insert into public.auctions(seller_id,starting_price,current_price,duration_minutes,ends_at)
 values('22000000-0000-4000-8000-000000000001',50,50,1440,'2099-01-02 18:00+00');
 select set_config('request.jwt.claim.sub','22000000-0000-4000-8000-000000000001',true);
 select public.place_bid((select id from public.auctions where mystery_day='2099-01-01'),60);
 `);
  const sql = readFileSync("supabase/migrations/" + migration, "utf8");
  await db.exec(sql);
  const { rows } = await db.query(
    `select mystery_day::text as edition_day,ends_at::text deadline,duration_minutes duration,mystery_lr_chance::float8 chance,mystery_misses misses,card_snapshot,card_instance_id,status from public.auctions where is_mystery order by mystery_day`
  );
  assert.equal(
    Date.parse(rows[1].deadline),
    Date.parse("2099-01-02T10:00:00Z")
  );
  assert.equal(
    Date.parse(rows[2].deadline),
    Date.parse("2099-01-03T09:30:00Z")
  );
  assert.equal(rows[1].duration, 900);
  assert.equal(rows[2].duration, 900);
  assert.equal(
    Date.parse(rows[0].deadline),
    Date.parse("2098-01-02T18:00:00Z")
  );
  assert.equal(rows[3].chance, 0.02);
  assert.equal(rows[3].misses, 2);
  for (const row of rows) {
    assert.equal(row.card_snapshot, null);
    assert.equal(row.card_instance_id, null);
  }
  assert.equal(rows[1].chance, null);
  assert.equal(
    (
      await db.query(
        `select karas_balance from public.user_profiles where user_id='22000000-0000-4000-8000-000000000001'`
      )
    ).rows[0].karas_balance,
    940
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.bids")).rows[0].n,
    1
  );
  assert.equal(
    (
      await db.query(
        `select duration_minutes from public.auctions where not is_mystery`
      )
    ).rows[0].duration_minutes,
    1440
  );
  await db.exec(sql);
  assert.deepEqual(
    (
      await db.query(
        `select mystery_day::text as edition_day,ends_at::text deadline,duration_minutes duration,mystery_lr_chance::float8 chance,mystery_misses misses,card_snapshot,card_instance_id,status from public.auctions where is_mystery order by mystery_day`
      )
    ).rows,
    rows
  );
});
