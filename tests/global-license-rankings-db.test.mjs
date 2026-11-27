import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";

const id = n => `ab910000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = name =>
  "source:" +
  createHash("sha256")
    .update("ANIME/MANGA\x1f" + name)
    .digest("hex");
test("global license and distinct-card rankings cover the whole catalogue without multiplying copies, memberships or private data", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  await db.exec(`insert into auth.users(id,raw_user_meta_data)
    select ('ab910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,jsonb_build_object('pseudo','GlobalRank'||lpad(n::text,3,'0')) from generate_series(1,10)n;
    alter table auth.users add column if not exists banned_until timestamptz;
    update public.anime_series_settings set enabled=true,license_grouping_enabled=true;
    insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url)
    select 'manual','global-'||n,'Global Card '||n,
      case when n in(1,2,9) then 'Global A' when n=3 then 'Global B' when n=4 then 'Global C' else 'Global D' end,
      case when n=9 then 'VIDEO GAMES' else 'ANIME/MANGA' end,'LR','https://example.test/card.png' from generate_series(1,9)n;
    insert into public.card_franchises(card_id,franchise,position) select id,'Global Secondary',2 from public.cards where source_id='global-3';
    insert into public.user_cards(user_id,card_id,rarity)
      select ('ab910000-0000-4000-8000-'||lpad(u::text,12,'0'))::uuid,c.id,c.rarete_base
      from generate_series(1,9)u cross join public.cards c where
      (u in(1,3) and c.source_id in('global-1','global-2','global-3','global-4')) or
      (u=2 and c.source_id in('global-1','global-2','global-5','global-6','global-7')) or
      u in(4,5,6,7) or (u=8 and c.source_id='global-3') or(u=9 and c.source_id='global-5');
    insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved)
      select '${id(1)}'::uuid,id,rarete_base,true,false from public.cards where source_id='global-1'
      union all select '${id(1)}'::uuid,id,rarete_base,false,true from public.cards where source_id='global-1';
    update public.user_profiles set is_public=false where user_id='${id(4)}';
    update auth.users set banned_until=now()+interval '1 day' where id='${id(5)}';
    insert into public.account_deletion_log(user_id) values('${id(6)}');
    insert into public.user_blocks(blocker_id,blocked_id) values('${id(7)}','${id(1)}');
    insert into public.friendships(user_id,friend_id,status) values('${id(8)}','${id(1)}','accepted'),('${id(1)}','${id(9)}','pending');`);
  const read = async (
    scope = "global:completed",
    { viewer = 1, query = "", friends = false, offset = 0, limit = 20 } = {}
  ) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(viewer)
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          "select public.get_license_leaderboard($1,$2,$3,$4,$5) value",
          [scope, offset, limit, query, friends]
        )
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const completed = await read();
  assert.deepEqual(completed.catalogue, { totalCards: 9, totalLicenses: 6 });
  assert.equal(completed.metric, "completed");
  assert.equal(completed.binder, null);
  assert.deepEqual(
    completed.entries.map(e => [e.userId, e.value, e.position]),
    [
      [id(1), 4, 2],
      [id(3), 4, 2],
      [id(8), 2, 4],
      [id(2), 1, 5],
      [id(9), 0, 6]
    ]
  );
  assert.deepEqual(completed.mine, {
    value: 4,
    completedLicenses: 4,
    distinctCards: 4,
    isPublic: true,
    position: 2
  });
  assert.equal(completed.rankedPlayers, 6);
  assert.deepEqual(
    Object.keys(completed.profileStyles).sort(),
    completed.entries.map(e => e.userId).sort()
  );
  assert.deepEqual(
    Object.keys(completed.entries[0]).sort(),
    [
      "userId",
      "pseudo",
      "avatarUrl",
      "position",
      "value",
      "isFriend",
      "completedLicenses",
      "distinctCards"
    ].sort()
  );
  const cards = await read("global:cards");
  assert.equal(cards.metric, "cards");
  assert.deepEqual(
    cards.entries.map(e => [e.userId, e.value, e.position]),
    [
      [id(2), 5, 2],
      [id(1), 4, 3],
      [id(3), 4, 3],
      [id(8), 1, 5],
      [id(9), 1, 5]
    ]
  );
  assert.equal(
    cards.mine.value,
    4,
    "Copies, Infinity and Shiny do not multiply distinct card identities"
  );
  assert.deepEqual(
    (await read("global:completed", { friends: true })).entries.map(
      e => e.userId
    ),
    [id(1), id(8)]
  );
  assert.equal(
    (await read("global:completed", { friends: true, query: "GlobalRank009" }))
      .entries.length,
    0
  );
  for (const scope of ["global:completed", "global:cards"]) {
    for (const query of [
      "GlobalRank004",
      "GlobalRank005",
      "GlobalRank006",
      "GlobalRank007",
      "%",
      "_",
      "' OR true --"
    ])
      assert.equal((await read(scope, { query })).total, 0, scope + query);
    assert.equal(
      (await read(scope, { query: " gLoBaLrAnK008 " })).entries[0].userId,
      id(8)
    );
    assert.deepEqual(
      (await read(scope, { offset: 1, limit: 2 })).entries,
      (scope === "global:cards" ? cards : completed).entries.slice(1, 3)
    );
    assert.equal((await read(scope, { offset: -3, limit: 900 })).limit, 100);
    assert.equal((await read(scope, { offset: -3, limit: 900 })).offset, 0);
    assert.equal((await read(scope, { viewer: 10 })).mine.value, 0);
    const privateView = await read(scope, { viewer: 4 });
    assert.equal(privateView.mine.position, null);
    assert.equal(privateView.mine.isPublic, false);
    assert.equal(privateView.mine.completedLicenses, 6);
    assert.equal(privateView.mine.distinctCards, 9);
    assert(!privateView.entries.some(e => e.userId === id(4)));
    await assert.rejects(read(scope, { viewer: 5 }), /ACCOUNT_BANNED/);
    await assert.rejects(read(scope, { viewer: 6 }), /PROFILE_MISSING/);
  }
  const legacy = await read("global:completed:legacy");
  assert.deepEqual(legacy.catalogue, { totalCards: 9, totalLicenses: 5 });
  assert.equal(
    legacy.mine.completedLicenses,
    3,
    "Legacy homonymous categories retain the same combined licence as legacy albums"
  );
  assert.equal((await read("global:cards:legacy")).mine.value, 4);
  const individual = await read(key("Global A"));
  assert.equal(individual.binder.total, 2);
  assert.equal(individual.mine.value, 2);
  await db.query(
    "delete from public.user_cards where user_id=$1 and card_id in(select id from public.cards where source_id='global-3')",
    [id(1)]
  );
  const lost = await read();
  assert.equal(lost.mine.completedLicenses, 2);
  assert.equal(lost.mine.distinctCards, 3);
  const group = id(200);
  await db.query(
    "insert into public.catalogue_binder_groups(id,display_name,enabled) values($1,'Merged Global B',true)",
    [group]
  );
  await db.query(
    "insert into public.catalogue_binder_group_merges(old_key,group_id) values($1,$3),($2,$3)",
    [key("Global B"), key("Global Secondary"), group]
  );
  const merged = await read();
  assert.equal(merged.catalogue.totalLicenses, 5);
  assert.equal(
    merged.entries.find(e => e.userId === id(3)).completedLicenses,
    3,
    "Merged licenses with shared cards count once"
  );
  await db.exec(
    "delete from public.user_cards where card_id in(select id from public.cards where source_id='global-9'); delete from public.cards where source_id='global-9'"
  );
  assert.deepEqual(
    (await read()).catalogue,
    { totalCards: 8, totalLicenses: 4 },
    "Live catalogue counts shrink and empty licenses are not completed"
  );
  for (const scope of ["global:completed", "global:cards"]) {
    await assert.rejects(
      db.query("select public.get_license_leaderboard($1)", [scope]),
      /AUTH_REQUIRED/
    );
    for (const role of ["anon", "service_role"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        db.query("select public.get_license_leaderboard($1)", [scope]),
        /permission denied/
      );
      await db.exec("reset role");
    }
  }
});
