import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const id = n => "c6300000-0000-4000-8000-" + String(n).padStart(12, "0");
test("friends, searches and inbox project current paid and lifetime Pro cosmetics without changing permissions", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  for (let n = 1; n <= 4; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2)",
      [id(n), JSON.stringify({ pseudo: "CosmeticFriend" + n })]
    );
  const scope = "test:acct_socialstyle:price_socialstyle";
  await db.query("select public.billing_set_entitlement_scope($1,true)", [
    scope
  ]);
  await db.query(
    "insert into public.billing_accounts(user_id,scope,stripe_customer_id,active,status,period_end,verified_at)values($1,$2,'cus_socialstyle',true,'active',now()+interval '1 month',now())",
    [id(2), scope]
  );
  await db.query(
    "insert into public.pro_access_grants(user_id,reason)values($1,'Local test lifetime access')",
    [id(3)]
  );
  const style = {
    font: "gothic",
    effect: "neon",
    color: "#ffffff",
    secondary: "#ff52bf",
    badges: ["crystal"],
    avatarFrame: "bloodmoon"
  };
  for (const n of [2, 3])
    await db.query(
      "insert into public.profile_customizations(user_id,style)values($1,$2)",
      [id(n), JSON.stringify(style)]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted'),($1,$3,'accepted'),($1,$4,'pending')",
    [id(1), id(2), id(3), id(4)]
  );
  await db.query(
    "insert into public.private_messages(id,sender_id,recipient_id,body)values(gen_random_uuid(),$2,$1,'Paid'),(gen_random_uuid(),$3,$1,'Manual')",
    [id(1), id(2), id(3)]
  );
  const read = async (sql, role = "authenticated", viewer = id(1)) => {
    await db.exec("set role " + role);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      viewer
    ]);
    try {
      return (await db.query(sql)).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  const endpoints = [
    [
      "select public.get_friendships() value",
      r => [...r.friends, ...r.incoming, ...r.outgoing]
    ],
    [
      "select public.get_friendships_page(null,100) value",
      r => r.items.map(i => i.friend)
    ],
    ["select public.search_users('CosmeticFriend') value", r => r],
    [
      "select public.get_private_conversations() value",
      r => r.items.map(i => i.friend)
    ]
  ];
  for (const [sql, rows] of endpoints) {
    await assert.rejects(read(sql, "anon"), /permission denied/);
    await assert.rejects(read(sql, "authenticated", ""), /AUTH_REQUIRED/);
    const players = rows(await read(sql));
    for (const n of [2, 3])
      assert.deepEqual(players.find(p => p.id === id(n)).profileStyle, {
        active: true,
        style,
        titleId: "collector"
      });
    for (const p of players.filter(p => p.id === id(4)))
      assert.deepEqual(p.profileStyle, {
        active: false,
        style: {},
        titleId: "collector"
      });
  }
  await db.query(
    "update public.pro_access_grants set expires_at=now()-interval '1 second'where user_id=$1",
    [id(3)]
  );
  for (const [sql, rows] of endpoints)
    assert.deepEqual(
      rows(await read(sql)).find(p => p.id === id(3)).profileStyle,
      { active: false, style: {}, titleId: "collector" }
    );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id)values($1,$2)",
    [id(2), id(1)]
  );
  const inbox = await read("select public.get_private_conversations() value");
  assert(!inbox.items.some(i => i.friend.id === id(2)));
  assert.equal(
    (await read("select public.get_social_unread() value")).messageCount,
    1,
    "cosmetics never acknowledge unread messages"
  );
});
