import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

// Volatile functions players may execute without the ban guard. Each entry
// must stay read-only for the caller; anything granting state needs the guard.
const unguardedReads = {
  "get_auction_chat(uuid)": "chat read",
  "get_decision_pack_status()":
    "status read; timing sync grants nothing without opening",
  "get_friend_wall_feed(timestamp with time zone,uuid,integer)": "feed read",
  "get_home_wall_feed(timestamp with time zone,uuid,integer)": "feed read",
  "get_profile(text)": "profile read, also used by Storage policies",
  "get_profile_wall(uuid,timestamp with time zone,uuid,integer)": "wall read",
  "get_public_wall_feed(timestamp with time zone,uuid,integer)": "feed read",
  "get_recent_big_pulls(integer)": "home feed read",
  "get_regular_pack_status()":
    "status read; timing sync grants nothing without opening"
};
// Tables players may still write directly; only admins (who cannot be banned).
const adminOnlyTables = [
  "admin_audit_logs",
  "card_categories",
  "card_franchises",
  "cards"
];
const guardFirst =
  /^\s*(<<\w+>>\s*)?(declare\b[\s\S]*?)?\bbegin\s+perform\s+public\.assert_player_not_banned\(\)\s*;/i;
const sqlGuardFirst = /^\s*select\s+public\.assert_player_not_banned\(\)\s*;/i;

const player = "37400000-0000-4000-8000-000000000001";
const banned = "37400000-0000-4000-8000-000000000002";
const other = "37400000-0000-4000-8000-000000000003";

test("every mutation reachable by authenticated starts with the ban guard", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const { rows } = await db.query(`
    select p.oid::regprocedure::text as signature, l.lanname as language, p.prosrc as source
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.provolatile='v' and p.prorettype<>'trigger'::regtype
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
    order by 1`);
  t.diagnostic(`${rows.length} volatile player functions`);
  const unguarded = rows
    .filter(({ language, source }) =>
      language === "sql"
        ? !sqlGuardFirst.test(source)
        : !guardFirst.test(source)
    )
    .map(row => row.signature)
    .filter(signature => !unguardedReads[signature]);
  assert.deepEqual(
    unguarded,
    [],
    "Call public.assert_player_not_banned() first, or justify a read in unguardedReads"
  );
  for (const signature of Object.keys(unguardedReads))
    assert.ok(
      rows.some(row => row.signature === signature),
      `Stale unguardedReads entry: ${signature}`
    );

  const writable = await db.query(`
    select c.relname as name,
      exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname
        and p.permissive='RESTRICTIVE' and concat(p.qual,p.with_check) like '%assert_player_not_banned%') as guarded
    from pg_class c
    where c.relnamespace='public'::regnamespace and c.relkind in ('r','v','p')
      and (has_table_privilege('authenticated',c.oid,'INSERT') or has_table_privilege('authenticated',c.oid,'UPDATE')
        or has_table_privilege('authenticated',c.oid,'DELETE'))
    order by 1`);
  assert.deepEqual(
    writable.rows
      .filter(row => !row.guarded && !adminOnlyTables.includes(row.name))
      .map(row => row.name),
    [],
    "Directly writable player tables need a restrictive ban policy"
  );
});

test("a banned token gets ACCOUNT_BANNED; an active player is unaffected", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  // Supabase columns/grants outside the replay's minimal stubs.
  await db.exec(`alter table auth.users add column banned_until timestamptz;
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    -- Open test bucket: only the restrictive ban policy can refuse its uploads.
    create policy ban_test_insert on storage.objects for insert to authenticated with check(bucket_id='ban-test');`);
  for (const [id, pseudo] of [
    [player, "ActivePlayer"],
    [banned, "BannedPlayer"],
    [other, "OtherPlayer"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,email_confirmed_at) values($1,$2::jsonb,now())",
      [id, JSON.stringify({ pseudo })]
    );
  await db.exec(`
    insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values ('ban-a','Ban A','ANIME/MANGA','Ban album','C','https://example.test/a.png','ban-test');`);
  const card = (
    await db.query("select id from public.cards where source_id='ban-a'")
  ).rows[0].id;
  // Ban after signup, as admin_set_user_ban does; the old JWT stays valid.
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    banned
  ]);
  await db.exec("set role authenticated");
  const as = id =>
    db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  const zero = "00000000-0000-4000-8000-000000000000";
  const calls = [
    ["select public.open_regular_pack()"],
    ["select public.open_regular_packs(1)"],
    ["select public.open_decision_pack()"],
    ["select public.discard_collection_cards(array[$1::uuid])", [zero]],
    [
      "select public.create_trade_offer($1,array[]::uuid[],10,array[]::uuid[],0,null)",
      [other]
    ],
    ["select public.create_auction($1,10,24)", [zero]],
    ["select public.place_bid($1,10)", [zero]],
    ["select public.send_private_message($1,'hi',gen_random_uuid())", [other]],
    [
      "select public.publish_profile_wall_post(gen_random_uuid(),'hi',null,null)"
    ],
    ["select public.send_friend_request($1)", [other]],
    ["select public.claim_achievement('first_pack')"],
    ["select public.toggle_wishlist($1)", [card]],
    ["select public.create_folder('Banned folder')"],
    ["select public.set_collection_cover_framed('invalid',null,null)"],
    ["select public.update_profile('bio',null,array[]::uuid[],null)"],
    ["select public.report_user($1,'spam')", [other]],
    [
      "insert into storage.objects(bucket_id,name,owner_id) values('ban-test',$1,$1)",
      [banned]
    ],
    [
      "insert into public.panini_album_favorites(user_id,license) values($1,'Ban album')",
      [banned]
    ]
  ];
  await as(banned);
  for (const [sql, params] of calls)
    await assert.rejects(
      db.query(sql, params),
      { message: "ACCOUNT_BANNED" },
      sql
    );

  await as(player);
  assert.equal(
    (await db.query("select public.toggle_wishlist($1) as value", [card])).rows
      .length,
    1
  );
  await db.query("select public.create_folder('Active folder')");
  await db.query("select public.touch_presence()");
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values($1,'Ban album')",
    [player]
  );
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values('ban-test',$1,$1)",
    [player]
  );
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.wishlists where user_id=$1",
        [player]
      )
    ).rows[0].count,
    1
  );
});
