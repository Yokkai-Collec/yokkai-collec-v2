import { replayMigrations } from "../../scripts/replay-migrations.mjs";

export async function replayCatalogueFixtures() {
  const { db } = await replayMigrations();
  try {
    // A migration can publish the live Blackout roster during replay. These
    // catalogue tests seed their own cards and need the same baseline all year.
    await db.exec(`
      delete from public.cards
      where source = 'manual' and event_only and source_id like 'blackout-%'
    `);
    return { db };
  } catch (error) {
    await db.close();
    throw error;
  }
}
