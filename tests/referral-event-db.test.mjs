import test from "node:test";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("referral event SQL: eligibility, grace, idempotency, base rewards and permissions", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    readFileSync(new URL("./sql/referral-event.sql", import.meta.url), "utf8")
  );
});
