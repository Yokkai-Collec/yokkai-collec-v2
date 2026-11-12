import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("two recent referrals on one IP trigger sanctions regardless of browser or sponsor IP", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`
    alter table auth.users add column banned_until timestamptz, add column updated_at timestamptz;
    create table auth.sessions(user_id uuid);
    update public.anticheat_runtime_flags set enabled=true where flag='discord_alerts_v2';
  `);
  let nextId = 0;
  const ip = code => `v1:${code.repeat(64)}`;
  const makeUser = async pseudo => {
    const id = `ac520000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;
    await db.query(
      "insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values($1,now(),$2)",
      [id, JSON.stringify({ pseudo })]
    );
    await db.query("insert into auth.sessions values($1)", [id]);
    return id;
  };
  const observe = (user, hash) =>
    db.query("select public.record_anticheat_network_observation($1,$2)", [
      user,
      ip(hash)
    ]);
  const makeSponsor = async (pseudo, code) => {
    const user = await makeUser(pseudo);
    const { rows } = await db.query(
      "insert into public.referral_codes(user_id,code) values($1,$2) returning id",
      [user, code.repeat(12)]
    );
    return { user, code: rows[0].id };
  };
  const invite = async (sponsor, pseudo, hash) => {
    const user = await makeUser(pseudo);
    const { rows } = await db.query(
      "insert into public.referrals(code_id,referrer_id,referred_id) values($1,$2,$3) returning id",
      [sponsor.code, sponsor.user, user]
    );
    if (hash) await observe(user, hash);
    return { user, referral: rows[0].id };
  };
  const verify = child =>
    db.query("select public.complete_referral_after_verification($1,now())", [
      child.user
    ]);
  const worker = async () =>
    (await db.query("select public.run_anticheat_referral_farms() as total"))
      .rows[0].total;
  const bonus = async user =>
    (
      await db.query(
        "select bonus_regular_packs from public.user_profiles where user_id=$1",
        [user]
      )
    ).rows[0].bonus_regular_packs;
  const restriction = async user =>
    (
      await db.query(
        "select case when banned_until='infinity' then 'ban' when banned_until>now() then 'suspension' else 'none' end as state from auth.users where id=$1",
        [user]
      )
    ).rows[0].state;

  const sponsor = await makeSponsor("ReferralSponsor", "a");
  const unrelated = await makeSponsor("OtherSponsor", "b");
  await observe(sponsor.user, "f");
  const first = await invite(sponsor, "SharedFirst", "a");
  await verify(first);
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='referral_farm_sanctions'"
  );
  const separate = await invite(sponsor, "DifferentIP", "b");
  await verify(separate);
  const other = await invite(unrelated, "OtherChild", "a");
  await verify(other);
  assert.equal(await worker(), 0);
  assert.equal(await bonus(sponsor.user), 10);
  assert.equal(await bonus(unrelated.user), 5);

  await observe(sponsor.user, "a");
  const second = await invite(sponsor, "SharedSecond", "a");
  await db.query("select public.record_anticheat_device_observation($1,$2)", [
    first.user,
    ip("c")
  ]);
  await db.query("select public.record_anticheat_device_observation($1,$2)", [
    second.user,
    ip("d")
  ]);
  await verify(second);
  assert.equal(await bonus(sponsor.user), 10);
  assert.equal(await bonus(second.user), 0);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.anticheat_referral_reward_holds where referral_id=$1",
        [second.referral]
      )
    ).rows[0].count,
    1
  );
  // Simulate consumption of two attributable packs before the second signup.
  await db.query(
    "update public.referral_pack_reward_lots set remaining_packs=3 where referral_id=$1 and beneficiary_role='referrer'",
    [first.referral]
  );
  await db.query(
    "update public.user_profiles set bonus_regular_packs=8 where user_id=$1",
    [sponsor.user]
  );
  assert.equal(await worker(), 2);
  assert.equal(await bonus(sponsor.user), 5);
  assert.equal(await bonus(first.user), 0);
  assert.equal(await bonus(second.user), 0);
  assert.equal(await bonus(separate.user), 5);
  assert.equal(await bonus(other.user), 5);
  assert.equal(await restriction(first.user), "ban");
  assert.equal(await restriction(second.user), "ban");
  assert.equal(await restriction(sponsor.user), "none");
  assert.equal(await restriction(separate.user), "none");
  assert.equal(await restriction(other.user), "none");
  await verify(second);
  await observe(second.user, "a");
  assert.equal(await worker(), 0);
  assert.equal(await bonus(sponsor.user), 5);
  const { rows: alerts } = await db.query(
    `
    select o.payload from public.anticheat_discord_outbox o
    join public.anticheat_events e on e.id=o.event_id
    where e.event_type='referral_network_enforcement' and e.actor_user_id=$1
  `,
    [sponsor.user]
  );
  assert.equal(alerts.length, 1);
  const embed = alerts[0].payload.embeds[0];
  assert.match(embed.title, /IP commune/);
  assert.match(
    embed.fields.find(field => field.name.startsWith("Filleuls")).value,
    /SharedFirst.*SharedSecond/
  );
  assert.match(
    embed.fields.find(field => field.name === "Packs bonus").value,
    /5 bloqués.*3 packs non ouverts retirés/
  );
  assert.ok(!JSON.stringify(alerts).includes(ip("a")));
  assert.equal(
    (
      await db.query(
        `
    select count(*)::int as count from public.anticheat_discord_outbox o
    join public.anticheat_events e on e.id=o.event_id
    where e.event_type='anticheat_operational_alert' and e.actor_user_id=any($1::uuid[])
  `,
        [[sponsor.user, first.user, second.user]]
      )
    ).rows[0].count,
    3
  );

  for (let repeat = 1; repeat <= 3; repeat++) {
    const child = await invite(sponsor, `RepeatChild${repeat}`, "a");
    await verify(child);
    assert.equal(await worker(), 1);
    assert.equal(await restriction(child.user), "ban");
    assert.equal(
      await restriction(sponsor.user),
      repeat === 3 ? "suspension" : "none"
    );
  }
  assert.equal(
    (
      await db.query(
        "select extract(epoch from ends_at-applied_at)::int as seconds from public.anticheat_farm_suspensions where user_id=$1",
        [sponsor.user]
      )
    ).rows[0].seconds,
    172800
  );

  // Verification can happen before either browser has sent the IP observation.
  const late = await invite(unrelated, "LateObservation");
  await verify(late);
  assert.equal(await bonus(unrelated.user), 10);
  assert.equal(await worker(), 0);
  await observe(late.user, "a");
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=true where flag='automatic_decisions_paused'"
  );
  assert.equal(await worker(), 0);
  assert.equal(await restriction(other.user), "none");
  await db.exec(
    "update public.anticheat_runtime_flags set enabled=false where flag='automatic_decisions_paused'"
  );
  assert.equal(await worker(), 2);
  assert.equal(await bonus(unrelated.user), 0);
  assert.equal(await restriction(other.user), "ban");
  assert.equal(await restriction(late.user), "ban");
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.anticheat_farm_warnings where user_id=$1",
        [unrelated.user]
      )
    ).rows[0].count,
    0
  );
});
