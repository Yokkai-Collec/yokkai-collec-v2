import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const player = "e180de97-1832-4d2e-8a65-5b8ba1455a01";
const other = "e180de97-1832-4d2e-8a65-5b8ba1455a02";
const launch = "2026-11-09T19:00:00Z";
const tomorrow = "2026-11-10T19:00:00Z";

test("missions notify only when a Kara milestone can be claimed and clear independently", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const value = async (sql, params = []) =>
    (await db.query(sql, params)).rows[0]?.value;
  const as = async (user, sql, role = "authenticated", params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec(`set role ${role}`);
    try {
      return await value(sql, params);
    } finally {
      await db.exec("reset role");
    }
  };
  const notes = () => as(player, "select public.list_notifications(50) value");
  const feed = () =>
    as(player, "select public.list_notifications(1,true) value");
  const missionNotesFor = user =>
    value(
      `select coalesce(jsonb_agg(jsonb_build_object(
         'id', n.id, 'referenceId', n.reference_id, 'createdAt', n.created_at
       ) || public.progress_notification_details(n)), '[]') value
       from public.notifications n where n.user_id=$1 and n.type='mission_completed'`,
      [user]
    );
  const advance = (amount, stamp) =>
    db.query(
      "select public.advance_player_progress($1,'regular_packs_opened',$2,$3)",
      [player, amount, stamp]
    );

  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values
    ($1,'{"pseudo":"progress-player"}'), ($2,'{"pseudo":"other-player"}')`,
    [player, other]
  );
  await advance(4, launch);
  assert.equal((await notes()).length, 0);
  await advance(1, launch);
  assert.equal((await missionNotesFor(player)).length, 0);
  await advance(12, launch);
  await advance(1, launch);
  await advance(5, tomorrow);
  const missionNotes = await missionNotesFor(player);
  assert.deepEqual(
    missionNotes.map(n => [n.missionPoints, n.missionReward]),
    [[20, 15]]
  );
  assert.equal(new Set(missionNotes.map(n => n.referenceId)).size, 1);
  assert.ok(missionNotes.every(n => n.missionPeriod === "daily"));
  await db.query(
    "select public.advance_player_progress($1,'regular_packs_opened',250,$2)",
    [other, launch]
  );
  const otherMissionNotes = await missionNotesFor(other);
  assert.deepEqual(
    otherMissionNotes
      .map(n => [n.missionPeriod, n.missionPoints, n.missionReward])
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]),
    [
      ["daily", 20, 15],
      ["daily", 50, 25],
      ["weekly", 20, 50]
    ]
  );

  // The legacy and extended rules see the same pack stats.
  await db.query(
    "insert into public.user_achievement_stats(user_id,regular_packs_opened) values($1,100) on conflict(user_id) do update set regular_packs_opened=excluded.regular_packs_opened",
    [player]
  );
  await db.query(
    "select public.complete_achievements($1,array['regular_packs_opened'])",
    [player]
  );
  const legacy = (await notes()).filter(
    n => n.type === "achievement_completed"
  );
  assert.ok(legacy.length > 0);
  assert.equal(
    (await notes()).some(n => n.type === "catalogue_achievement_completed"),
    false
  );
  const latest = await feed();
  assert.equal(latest.items.length, 1);
  const all = await notes();
  const achievement = all.find(n => n.referenceId === "pack-opener-100");
  assert.ok(achievement);
  assert.equal(achievement.type, "catalogue_achievement_completed");
  assert.equal(achievement.achievementFamily, "pack-opener");
  assert.equal(
    all.filter(n => n.type === "achievement_completed").length,
    legacy.length
  );
  assert.equal(latest.progressUnread, all.length + missionNotes.length);
  assert.ok(all.every(n => n.type !== "mission_completed"));
  assert.equal((await feed()).progressUnread, latest.progressUnread);
  assert.equal(
    await value(
      `select count(*)::int value from public.user_progress_marks where user_id=$1 and metric='activity_days'`,
      [player]
    ),
    0
  );

  const delivered = await as(
    "",
    "select public.get_push_notification($1,$2) value",
    "service_role",
    [achievement.id, achievement.createdAt]
  );
  assert.equal(delivered.userId, player);
  assert.deepEqual(delivered.notification, achievement);

  assert.equal(
    await as(
      "",
      "select public.get_push_notification($1,$2) value",
      "service_role",
      [missionNotes[0].id, missionNotes[0].createdAt]
    ),
    null
  );
  await as(player, "select public.mark_notification_read() value");
  assert.equal((await feed()).progressUnread, 1);
  await as(
    player,
    "select public.claim_mission_milestone('daily',$1,20) value",
    "authenticated",
    [launch]
  );
  assert.equal((await feed()).progressUnread, 0);

  await db.query(
    "insert into public.notifications(user_id,type,reference_id) values($1,'friend_request',$2)",
    [player, other]
  );
  await as(player, "select public.mark_progress_notifications_read() value");
  const cleared = await feed();
  assert.equal(cleared.progressUnread, 0);
  const remaining = (await notes()).filter(n => !n.readAt);
  assert.deepEqual(
    remaining.map(n => n.type),
    ["friend_request"]
  );
  assert.ok(
    (await as(other, "select public.list_notifications(50,true) value"))
      .progressUnread >= 3
  );
});
