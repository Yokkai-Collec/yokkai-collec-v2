import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
test("Mystery twice-daily cadence, fixed progressive odds and transactional reset", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());

  await db.exec(readFileSync("tests/sql/mystery-cadence.sql", "utf8"));
  const { rows } = await db.query(
    "select public.mystery_lr_probability(n,664.0/83229)::float8 p from generate_series(0,500)n order by n"
  );
  let survival = 1,
    expectedReveals = 0;
  for (const { p } of rows) {
    expectedReveals += survival;
    survival *= 1 - p;
  }
  assert.ok(
    expectedReveals / 2 > 12 && expectedReveals / 2 < 13,
    `Mean interval drifted: ${expectedReveals / 2} days`
  );
});
