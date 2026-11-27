import test from "node:test";
import assert from "node:assert/strict";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";
const id = n => "ad930000-0000-4000-8000-" + String(n).padStart(12, "0");
test("ranking navigation is alphabetic before paging; observed history remains private and respects the original visibility", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  for (let n = 1; n <= 5; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id(n), JSON.stringify({ pseudo: "RankHistory" + n })]
    );
  await db.exec(`update public.user_profiles set is_public=false where user_id='${id(3)}';
 insert into public.profile_likes(owner_id,user_id) values('${id(1)}','${id(2)}'),('${id(2)}','${id(1)}'),('${id(2)}','${id(4)}'),('${id(3)}','${id(4)}');
 insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url) values
 ('manual','ranking-z','Z card','Zeta','ANIME/MANGA','C','https://example.test/z.png'),
 ('manual','ranking-a','A card','Alpha','ANIME/MANGA','C','https://example.test/a.png'),
 ('manual','ranking-b','B card','Beta','ANIME/MANGA','C','https://example.test/b.png'),
 ('manual','ranking-ac','A comic','Alpha','COMICS','C','https://example.test/ac.png');`);
  const read = async (sql, args = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(1)
    ]);
    await db.exec("set role authenticated");
    try {
      return (await db.query(sql, args)).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  const choices = (
    offset = 0,
    limit = 72,
    category = "ANIME/MANGA",
    prefix = ""
  ) =>
    read(
      "select public.get_ranking_license_choices('',$1,$2,true,$3,$4) value",
      [category, prefix, offset, limit]
    );
  const first = await choices(0, 1),
    second = await choices(1, 1);
  assert.equal(first.items[0].license, "Alpha");
  assert.equal(second.items[0].license, "Beta");
  assert.equal(first.total, 3);
  assert.equal((await choices(0, 500)).items.length, 3);
  assert.equal(
    (await choices(0, 72, "ANIME/MANGA", "z")).items[0].license,
    "Zeta"
  );
  assert.notEqual(
    (await choices(0, 72, "COMICS")).items[0].binderKey,
    first.items[0].binderKey
  );
  const likes = () =>
    read("select public.get_profile_likes_leaderboard() value");
  let result = await likes();
  assert.equal(result.mine.position, 2);
  assert.equal(result.history[id(1)].delta, null);
  assert.equal(result.history[id(3)], undefined);
  await db.query(
    `insert into public.leaderboard_rank_observations values($1,'likes',(now() at time zone 'UTC')::date-7,5),($1,'likes',(now() at time zone 'UTC')::date-1,3)`,
    [id(1)]
  );
  result = await likes();
  assert.equal(result.history[id(1)].delta, 3);
  assert.equal(result.history[id(1)].observations.length, 3);
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [id(2), id(1)]
  );
  result = await likes();
  assert.equal(result.history[id(2)], undefined);
  assert(!result.entries.some(e => e.userId === id(2)));
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [id(1)]
  );
  result = await likes();
  assert.equal(result.mine.position, null);
  assert.equal(result.history[id(1)], undefined);
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
      assert.equal(
        (
          await db.query(
            "select has_table_privilege($1,'public.leaderboard_rank_observations',$2) allowed",
            [role, privilege]
          )
        ).rows[0].allowed,
        false
      );
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.with_leaderboard_history(jsonb,text)','EXECUTE') allowed",
          [role]
        )
      ).rows[0].allowed,
      false
    );
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.get_ranking_license_choices(text,text,text,boolean,integer,integer)','EXECUTE') allowed",
          [role]
        )
      ).rows[0].allowed,
      role === "authenticated"
    );
  }
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(
    () => db.query("select public.get_ranking_license_choices()"),
    /AUTH_REQUIRED/
  );
});
