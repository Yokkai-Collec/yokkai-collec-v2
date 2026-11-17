import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("optimized risk snapshot preserves caps, dismissals, time boundaries and empty cases", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table anticheat_events(id bigint primary key, occurred_at timestamptz);
      create table anticheat_event_subjects(event_id bigint, user_id uuid, reason_codes text[]);
      create table anticheat_case_reviews(case_user_id uuid, decision text, created_at timestamptz);
    `);
    const original = readFileSync(
      new URL(
        "../supabase/migrations/20261102180000_anticheat_risk_model_v2.sql",
        import.meta.url
      ),
      "utf8"
    );
    await db.exec(
      original.slice(
        original.indexOf("create function public.anticheat_reason_weight"),
        original.indexOf("create function public.record_anticheat_event")
      )
    );
    const user = "ac400000-0000-4000-8000-000000000001";
    const asOf = "2026-11-17T12:00:00Z";
    await db.query(
      `insert into anticheat_events
      select n, $1::timestamptz + case when n=1 then interval '-31 days' when n=2 then interval '1 second' else interval '-1 day' end
      from generate_series(1,40) n`,
      [asOf]
    );
    await db.query(
      `insert into anticheat_event_subjects
      select n,$1,case when n%2=0 then array['ONE_WAY_TRADE_BENEFICIARY','TRADE_VALUE_IMBALANCE','UNKNOWN']
      else array['UNKNOWN'] end from generate_series(1,40) n`,
      [user]
    );
    const snapshots = async () => {
      const values = [];
      for (const id of [user, "ac400000-0000-4000-8000-000000000002"]) {
        for (const time of [asOf, "2026-12-20T12:00:00Z"]) {
          values.push(
            (
              await db.query(
                "select * from anticheat_effective_risk_snapshot($1,$2)",
                [id, time]
              )
            ).rows
          );
        }
      }
      return values;
    };
    const before = await snapshots();
    assert.equal(before[0][0].risk_score, 42);
    assert.equal(before[0][0].event_count, 19);
    await db.query(
      "insert into anticheat_case_reviews values($1,'dismissed',$2)",
      [user, asOf]
    );
    const dismissedBefore = await snapshots();
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/20261117180000_anticheat_risk_snapshot_performance.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    assert.deepEqual(await snapshots(), dismissedBefore);
    await db.exec("delete from anticheat_case_reviews");
    assert.deepEqual(await snapshots(), before);
    const definition = (
      await db.query(
        "select pg_get_functiondef('anticheat_effective_risk_snapshot(uuid,timestamptz)'::regprocedure) definition"
      )
    ).rows[0].definition;
    assert.match(definition, /scored_subjects as materialized/i);
    assert.match(definition, /offset 0/i);
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated','anticheat_effective_risk_snapshot(uuid,timestamptz)','execute') allowed"
        )
      ).rows[0].allowed,
      false
    );
  } finally {
    await db.close();
  }
});
