import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the anti-cheat ledger is private, append-only and observation-only", async () => {
  const migration = await read(
    "supabase/migrations/20261101020000_anticheat_observability.sql"
  );
  assert.match(migration, /create table public\.anticheat_events/);
  assert.match(migration, /create table public\.anticheat_event_subjects/);
  assert.match(migration, /create table public\.anticheat_cases/);
  assert.match(
    migration,
    /revoke all on public\.anticheat_events,public\.anticheat_event_subjects,public\.anticheat_cases[\s\S]+from public,anon,authenticated,service_role/
  );
  assert.equal(
    (
      migration.match(
        /execute function public\.prevent_anticheat_ledger_mutation\(\)/g
      ) ?? []
    ).length,
    2
  );
  assert.doesNotMatch(
    migration,
    /update auth\.users set banned_until|delete from auth\.sessions|admin_set_user_ban/
  );
});

test("economic events are scored with explicit reasons and a bounded historical seed", async () => {
  const migration = await read(
    "supabase/migrations/20261101020000_anticheat_observability.sql"
  );
  for (const trigger of [
    "capture_trade_anticheat_event",
    "capture_auction_anticheat_event",
    "capture_bid_anticheat_event",
    "capture_referral_anticheat_event",
    "capture_registration_anticheat_event"
  ]) {
    assert.match(migration, new RegExp(`create trigger ${trigger}`));
  }
  for (const reason of [
    "ONE_WAY_TRADE_BENEFICIARY",
    "TRADE_VALUE_IMBALANCE",
    "LARGE_KARA_TRANSFER",
    "REPEATED_TRADE_PAIR",
    "EXTREME_AUCTION_BID",
    "REPEATED_AUCTION_SETTLEMENT_PAIR",
    "REFERRAL_REWARD_BURST",
    "NEW_ACCOUNT_ECONOMIC_ACTIVITY"
  ]) {
    assert.match(migration, new RegExp(`'${reason}'`));
  }
  assert.match(migration, /interval '90 days'/);
  assert.match(migration, /interval '30 days'/);
  assert.match(migration, /'historical',true/);
});

test("only admin-guarded DTO functions expose cases and events", async () => {
  const migration = await read(
    "supabase/migrations/20261101020000_anticheat_observability.sql"
  );
  for (const rpc of [
    "admin_list_anticheat_cases",
    "admin_list_anticheat_events"
  ]) {
    assert.match(migration, new RegExp(`create function public\\.${rpc}`));
    assert.match(
      migration,
      new RegExp(
        `create function public\\.${rpc}[\\s\\S]+?if not public\\.is_current_user_admin\\(\\)[\\s\\S]+?grant execute on function public\\.${rpc}`
      )
    );
  }
});

test("the responsive admin dashboard reads only the bounded DTOs", async () => {
  const [page, navigation, en, fr] = await Promise.all([
    read("app/admin/security/page.tsx"),
    read("app/admin/admin-navigation.tsx"),
    read("messages/en.json"),
    read("messages/fr.json")
  ]);
  assert.match(navigation, /\/admin\/security/);
  assert.match(page, /admin_list_anticheat_cases/);
  assert.match(page, /admin_list_anticheat_events/);
  assert.match(page, /admin_list_anticheat_quarantines/);
  assert.match(page, /anticheat-quarantines/);
  assert.match(page, /requireAdminPage\(\)/);
  assert.match(page, /grid-cols-2[\s\S]+lg:grid-cols-4/);
  assert.match(page, /sm:flex-row/);
  assert.doesNotMatch(page, /from\(["']anticheat_/);
  assert.match(en, /"adminSecurity"/);
  assert.match(fr, /"adminSecurity"/);
  assert.match(en, /"quarantines"/);
  assert.match(fr, /"quarantines"/);
});
