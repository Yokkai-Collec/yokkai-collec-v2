import test from "node:test";
import assert from "node:assert/strict";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";

const id = n => `ab920000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("unified global ranks use distinct cards to break completed-license ties while keeping old modes and privacy intact", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  await db.exec(`insert into auth.users(id,raw_user_meta_data) select ('ab920000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,jsonb_build_object('pseudo','Unified'||n) from generate_series(1,8)n;
 alter table auth.users add column if not exists banned_until timestamptz;
 update public.anime_series_settings set enabled=true,license_grouping_enabled=true;
 insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url)
 select 'manual','unified-'||n,'Unified Card '||n,case when n=1 then 'Unified Solo' when n<4 then 'Unified Pair' else 'Unified Trio' end,'ANIME/MANGA','LR','https://example.test/card.png' from generate_series(1,6)n;
 insert into public.user_cards(user_id,card_id,rarity)
 select ('ab920000-0000-4000-8000-'||lpad(u::text,12,'0'))::uuid,c.id,c.rarete_base from generate_series(1,8)u cross join public.cards c where
 (u=1 and c.source_id in('unified-1','unified-2','unified-4')) or
 (u in(2,3) and c.source_id in('unified-1','unified-2','unified-4','unified-5')) or
 (u=4 and c.source_id='unified-2') or u>=5;
 insert into public.user_cards(user_id,card_id,rarity,is_evolved) select '${id(1)}',id,rarete_base,true from public.cards where source_id='unified-1';
 update public.user_profiles set is_public=false where user_id='${id(5)}';
 update auth.users set banned_until=now()+interval '1 day' where id='${id(6)}';
 insert into public.user_blocks(blocker_id,blocked_id) values('${id(7)}','${id(1)}');
 insert into public.account_deletion_log(user_id) values('${id(8)}');
 insert into public.friendships(user_id,friend_id,status) values('${id(1)}','${id(2)}','accepted');`);
  const read = async (
    scope = "global:overall",
    viewer = 1,
    query = "",
    friends = false,
    offset = 0,
    limit = 20
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
  const overall = await read();
  assert.equal(overall.metric, "overall");
  assert.deepEqual(overall.catalogue, { totalCards: 6, totalLicenses: 3 });
  assert.deepEqual(
    overall.entries.map(e => [
      e.userId,
      e.completedLicenses,
      e.distinctCards,
      e.position
    ]),
    [
      [id(2), 1, 4, 2],
      [id(3), 1, 4, 2],
      [id(1), 1, 3, 4],
      [id(4), 0, 1, 5]
    ]
  );
  assert.deepEqual(overall.mine, {
    value: 1,
    isPublic: true,
    completedLicenses: 1,
    distinctCards: 3,
    position: 4
  });
  assert.equal(
    (await read("global:completed")).mine.position,
    2,
    "Old completed-only ranking still shares all license ties"
  );
  assert.equal(
    (await read("global:cards")).mine.value,
    3,
    "Old distinct-card metric stays compatible"
  );
  assert.equal((await read("global:overall:legacy")).mine.position, 4);
  assert.deepEqual(
    (await read("global:overall", 1, "", true)).entries.map(e => e.userId),
    [id(2), id(1)]
  );
  assert.deepEqual(
    (await read("global:overall", 1, "Unified1")).entries.map(e => e.position),
    [4]
  );
  assert.deepEqual(
    (await read("global:overall", 1, "", false, 1, 2)).entries,
    overall.entries.slice(1, 3)
  );
  for (const pseudo of [
    "Unified5",
    "Unified6",
    "Unified7",
    "Unified8",
    "%",
    "_"
  ])
    assert.equal((await read("global:overall", 1, pseudo)).total, 0, pseudo);
  const privateView = await read("global:overall", 5);
  assert.equal(privateView.mine.position, null);
  assert.equal(privateView.mine.completedLicenses, 3);
  assert(!privateView.entries.some(e => e.userId === id(5)));
  await assert.rejects(read("global:overall", 6), /ACCOUNT_BANNED/);
  await assert.rejects(read("global:overall", 8), /PROFILE_MISSING/);
  await assert.rejects(
    db.query("select public.get_license_leaderboard('global:overall')"),
    /AUTH_REQUIRED/
  );
  for (const role of ["anon", "service_role"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query("select public.get_license_leaderboard('global:overall')"),
      /permission denied/
    );
    await db.exec("reset role");
  }
});
