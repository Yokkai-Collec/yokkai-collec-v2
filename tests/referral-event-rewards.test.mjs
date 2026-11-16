import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("Referral rewards are 750/1600/4000/8000/five LR and already-paid tiers receive only the difference once", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const tiers = await db.query(
    "select threshold,karas,lr_cards from public.referral_event_tiers order by threshold"
  );
  assert.deepEqual(tiers.rows, [
    { threshold: 3, karas: 750, lr_cards: 0 },
    { threshold: 5, karas: 1600, lr_cards: 0 },
    { threshold: 10, karas: 4000, lr_cards: 0 },
    { threshold: 15, karas: 8000, lr_cards: 0 },
    { threshold: 20, karas: 0, lr_cards: 5 }
  ]);
  await db.exec(`
    insert into auth.users(id,raw_user_meta_data) values('20000000-0000-4000-8000-000000000099','{"pseudo":"RewardCorrection"}');
    update public.user_profiles set karas_balance=3100 where user_id='20000000-0000-4000-8000-000000000099';
    insert into public.referral_event_rewards(user_id,event_id,threshold,karas,lr_cards,recruiter_badge)
    select '20000000-0000-4000-8000-000000000099',e.id,t.threshold,t.karas,0,false
    from public.referral_events e cross join(values(3,750),(5,750),(10,1600))t(threshold,karas)
    where e.slug='recruiter-2026-11';
  `);
  const migration = readFileSync(
    "supabase/migrations/20261116210001_referral_event_reward_amounts.sql",
    "utf8"
  );
  await db.exec(migration);
  await db.exec(migration);
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id='20000000-0000-4000-8000-000000000099'"
      )
    ).rows[0].karas_balance,
    6350
  );
  assert.deepEqual(
    (
      await db.query(
        "select threshold,karas from public.referral_event_rewards order by threshold"
      )
    ).rows,
    [
      { threshold: 3, karas: 750 },
      { threshold: 5, karas: 1600 },
      { threshold: 10, karas: 4000 }
    ]
  );
});
