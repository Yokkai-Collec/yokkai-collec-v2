import test from "node:test";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("Mystery history exposes only revealed editions, with stable pagination and authenticated access", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(readFileSync("tests/sql/mystery-auction-history.sql", "utf8"));
});
