import test from "node:test";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("mystery auction SQL contract: secret, escrow, burn, reveal and no-bid settlement", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    readFileSync(new URL("./sql/mystery-auction.sql", import.meta.url), "utf8")
  );
});
