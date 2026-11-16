import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";

test("67-for-41 trade batches achievements and preserves transfers, balances and evolved counts", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const [id, pseudo] of [
    [alice, "LargeAlice"],
    [bob, "LargeBob"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.exec(`
    update public.user_profiles set karas_balance=10000;
    insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
    select md5('large-'||g)::uuid,'large-'||g,'Card '||g,'Large','Large',
      case when g in (1,68) then 'LR' else 'C' end::public.card_rarity,'https://example.test/card.png','test'
    from generate_series(1,108) g;
    insert into public.user_cards(id,user_id,card_id,rarity,is_evolved)
    select md5('copy-'||g)::uuid,case when g<=67 then '${alice}' else '${bob}' end::uuid,
      md5('large-'||g)::uuid,case when g in (1,68) then 'LR' else 'C' end::public.card_rarity,g in (1,68)
    from generate_series(1,108) g;
    insert into public.friendships(user_id,friend_id,status) values ('${alice}','${bob}','accepted');
    create table public.large_trade_evaluations(user_id uuid, types text[]);
  `);
  const definition = (
    await db.query(
      "select pg_get_functiondef('public.complete_achievements(uuid,text[])'::regprocedure) as def"
    )
  ).rows[0].def;
  await db.exec(
    definition.replace(
      /\bbegin\b/i,
      "begin insert into public.large_trade_evaluations values(p_user_id,p_condition_types);"
    )
  );
  const authenticate = user =>
    db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await authenticate(alice);
  const offer = (
    await db.query(
      `select public.create_trade_offer($1,
    array(select id from public.user_cards where user_id=$2),0,
    array(select id from public.user_cards where user_id=$1),750) as id`,
      [bob, alice]
    )
  ).rows[0].id;
  await authenticate(bob);
  assert.equal(
    (
      await db.query(
        "select public.respond_trade_offer($1,'accept') as accepted",
        [offer]
      )
    ).rows[0].accepted,
    true
  );
  assert.deepEqual(
    (
      await db.query(
        `select user_id,karas_balance from public.user_profiles order by user_id`
      )
    ).rows,
    [
      { user_id: alice, karas_balance: 10750 },
      { user_id: bob, karas_balance: 9250 }
    ]
  );
  assert.deepEqual(
    (
      await db.query(
        `select user_id,count(*)::int as cards from public.user_cards group by user_id order by user_id`
      )
    ).rows,
    [
      { user_id: alice, cards: 41 },
      { user_id: bob, cards: 67 }
    ]
  );
  assert.deepEqual(
    (
      await db.query(
        `select user_id,ssr_evolved_to_lr,trades_completed from public.user_achievement_stats order by user_id`
      )
    ).rows,
    [
      { user_id: alice, ssr_evolved_to_lr: 2, trades_completed: 1 },
      { user_id: bob, ssr_evolved_to_lr: 2, trades_completed: 1 }
    ]
  );
  assert.equal(
    (
      await db.query("select status from public.trade_offers where id=$1", [
        offer
      ])
    ).rows[0].status,
    "accepted"
  );
  assert.deepEqual(
    (
      await db.query(`select user_id,count(*)::int as evaluations from public.large_trade_evaluations
    where 'unique_cards_collected'=any(types) group by user_id order by user_id`)
    ).rows,
    [
      { user_id: alice, evaluations: 1 },
      { user_id: bob, evaluations: 1 }
    ]
  );
  await db.exec(
    "truncate public.large_trade_evaluations; update public.user_cards set user_id=user_id; update public.user_cards set folder_id=null; update public.user_cards set user_id=user_id where false;"
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.large_trade_evaluations"
      )
    ).rows[0].count,
    0
  );
});
