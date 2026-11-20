import test from "node:test";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("black market waits 14 days, recovers only banned SSR/LR, and settles existing copies", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    readFileSync(new URL("./sql/black-market.sql", import.meta.url), "utf8")
  );
});
