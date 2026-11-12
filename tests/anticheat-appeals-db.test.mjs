import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("sanction appeals are owner scoped, append only and reviewed once", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const [player, outsider, admin] = [1, 2, 3].map(
    i => `ad550000-0000-4000-8000-00000000000${i}`
  );
  for (const [i, id] of [player, outsider, admin].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo: `AppealFixture${i}` })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  const receipt = (
    await db.query(
      `
    insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
      cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,published_at,status)
    values('phase3-appeal-fixture',$1,'AFFILIATE_ABUSE_WARNING','AFFILIATE_ABUSE','NONE','NONE',0,0,0,0,now(),now(),'APPLIED')
    returning id
  `,
      [player]
    )
  ).rows[0].id;
  async function asUser(user, sql, params = []) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec("set role authenticated");
    try {
      return (await db.query(sql, params)).rows[0].result;
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub','',false)"
      );
    }
  }
  const history = user =>
    asUser(user, "select public.get_my_anticheat_sanction_history() as result");
  const submit = user =>
    asUser(
      user,
      "select public.submit_my_anticheat_appeal('ACCOUNT',$1,'A verifiable test objection') as result",
      [receipt]
    );
  assert.deepEqual(await history(outsider), []);
  await assert.rejects(submit(outsider), /SANCTION_NOT_FOUND/);
  const appeal = await submit(player);
  assert.equal(await submit(player), appeal);
  assert.equal((await history(player))[0].appealStatus, "PENDING");
  const review = (user, outcome) =>
    asUser(
      user,
      "select public.admin_review_anticheat_appeal($1,$2,'Correction to be reviewed by moderation') as result",
      [appeal, outcome]
    );
  await assert.rejects(review(outsider, "UPHELD"), /ADMIN_REQUIRED/);
  assert.equal(
    await review(admin, "CORRECTION_REQUIRED"),
    "CORRECTION_REQUIRED"
  );
  assert.equal(
    await review(admin, "CORRECTION_REQUIRED"),
    "CORRECTION_REQUIRED"
  );
  await assert.rejects(review(admin, "UPHELD"), /APPEAL_ALREADY_REVIEWED/);
  assert.equal((await history(player))[0].appealStatus, "CORRECTION_REQUIRED");
  assert.equal((await history(player))[0].state, "APPLIED");
  const voidWarning = user =>
    asUser(
      user,
      "select public.admin_void_anticheat_warning($1,'Correct an unsupported warning') as result",
      [appeal]
    );
  await assert.rejects(voidWarning(outsider), /ADMIN_REQUIRED/);
  assert.equal(await voidWarning(admin), true);
  assert.equal(await voidWarning(admin), true);
  assert.equal((await history(player))[0].state, "ROLLED_BACK");
  assert.equal(
    (
      await db.query(
        "select count(*)::integer as count from public.anticheat_warning_corrections"
      )
    ).rows[0].count,
    1
  );
  await assert.rejects(
    db.query("delete from public.anticheat_sanction_appeals where id=$1", [
      appeal
    ]),
    /immutable|append.only/i
  );
});
