import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const id = n => `99100000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("leaderboard styles follow current paid and manual Pro access without changing ranks or exposing hidden profiles", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`insert into auth.users(id,raw_user_meta_data)
    select ('99100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      jsonb_build_object('pseudo','StyledRank'||lpad(n::text,2,'0')) from generate_series(1,12)n;`);
  const scope = "test:acct_rankstyles:price_rankstyles";
  await db.query("select public.billing_set_entitlement_scope($1,true)", [
    scope
  ]);
  await db.query(
    "insert into public.billing_accounts(user_id,scope,stripe_customer_id,active,status,period_end,verified_at) values($1,$2,'cus_rankstyles',true,'active',clock_timestamp()+interval '1 month',clock_timestamp())",
    [id(1), scope]
  );
  for (const n of [2, 3, 5, 6])
    await db.query(
      "insert into public.pro_access_grants(user_id,reason,expires_at) values($1,'Leaderboard fixture',clock_timestamp()+interval '1 day')",
      [id(n)]
    );
  const style = {
    font: "rounded",
    effect: "gradient",
    color: "#ff83bc",
    secondary: "#7ac9ff",
    badges: ["crystal", "flame", "moon"]
  };
  for (const n of [1, 2, 3, 5, 6])
    await db.query(
      "insert into public.profile_customizations(user_id,style) values($1,$2)",
      [id(n), JSON.stringify(style)]
    );
  await db.query(
    "update public.pro_access_grants set expires_at=clock_timestamp()-interval '1 second' where user_id=$1",
    [id(3)]
  );
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source) values('rank-style','Rank style','ANIME/MANGA','LR','https://example.test/card.png','test') returning id"
    )
  ).rows[0].id;
  for (let n = 1; n <= 6; n++) {
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'LR')",
      [id(n), card]
    );
    await db.query(
      "insert into public.referral_codes(user_id,code) values($1,$2)",
      [id(n), n.toString(16).padStart(12, "0")]
    );
    await db.query(
      "insert into public.referrals(code_id,referrer_id,referred_id,verified_at,rewarded_at) select id,$1,$2,now(),now() from public.referral_codes where user_id=$1",
      [id(n), id(n + 6)]
    );
  }
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [id(5)]
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($2,$1)",
    [id(1), id(6)]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [id(1), id(3)]
  );
  const read = async (endpoint, args = [0, 100, "", false]) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(1)
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          `select public.${endpoint}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`,
          args
        )
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  for (const [endpoint, args] of [
    ["get_collection_leaderboard", [0, 6]],
    ["get_collection_leaderboard", [0, 100, "", false]],
    ["get_referral_leaderboard", [0, 100, "", false]]
  ]) {
    const result = await read(endpoint, args);
    assert.deepEqual(
      result.entries.map(e => e.userId),
      [id(1), id(2), id(3), id(4)]
    );
    assert.deepEqual(
      result.entries.map(e => e.position),
      [1, 1, 1, 1]
    );
    assert.deepEqual(
      Object.keys(result.profileStyles).sort(),
      result.entries.map(e => e.userId).sort()
    );
    for (const n of [1, 2])
      assert.deepEqual(result.profileStyles[id(n)], {
        active: true,
        style,
        titleId: "collector"
      });
    for (const n of [3, 4])
      assert.deepEqual(result.profileStyles[id(n)], {
        active: false,
        style: {},
        titleId: "collector"
      });
    assert.equal(result.profileStyles[id(5)], undefined);
    assert.equal(result.profileStyles[id(6)], undefined);
    if (endpoint === "get_collection_leaderboard")
      assert.equal(result.mine.score, 5000);
    else assert.equal(result.mine.verifiedReferrals, 1);
  }
  for (const endpoint of [
    "get_collection_leaderboard",
    "get_referral_leaderboard"
  ]) {
    assert.deepEqual(
      Object.keys((await read(endpoint, [1, 1, "", false])).profileStyles),
      [id(2)]
    );
    assert.deepEqual(
      Object.keys(
        (await read(endpoint, [0, 100, "StyledRank03", false])).profileStyles
      ),
      [id(3)]
    );
    assert.deepEqual(
      Object.keys(
        (await read(endpoint, [0, 100, "", true])).profileStyles
      ).sort(),
      [id(1), id(3)]
    );
    assert.deepEqual(
      (await read(endpoint, [0, 100, "no match", false])).profileStyles,
      {}
    );
  }
  // Stripe expiry and manual revocation immediately remove styling, not points.
  await db.query(
    "update public.billing_accounts set period_end=clock_timestamp()-interval '1 second' where user_id=$1",
    [id(1)]
  );
  await db.query("delete from public.pro_access_grants where user_id=$1", [
    id(2)
  ]);
  for (const endpoint of [
    "get_collection_leaderboard",
    "get_referral_leaderboard"
  ]) {
    const result = await read(endpoint);
    for (const n of [1, 2])
      assert.deepEqual(result.profileStyles[id(n)], {
        active: false,
        style: {},
        titleId: "collector"
      });
    assert.deepEqual(
      result.entries.map(e => e.position),
      [1, 1, 1, 1]
    );
  }
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`);
    for (const endpoint of [
      "leaderboard_collection_without_styles",
      "leaderboard_referrals_without_styles"
    ])
      await assert.rejects(
        db.query(`select public.${endpoint}(0,100,'',false)`),
        /permission denied/
      );
    await db.exec("reset role");
  }
  await assert.rejects(
    db.query("select public.get_collection_leaderboard(0,100,'',false)"),
    /AUTH_REQUIRED/
  );
  await assert.rejects(
    db.query("select public.get_referral_leaderboard()"),
    /AUTH_REQUIRED/
  );
});
