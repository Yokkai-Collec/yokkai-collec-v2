import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const player = "7d000000-0000-4000-8000-000000000001";
const other = "7d000000-0000-4000-8000-000000000002";

test("Regular Pack LR pity is authoritative, per player and per pack", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());

  for (const [id, pseudo] of [
    [player, "PityPlayer"],
    [other, "PityOther"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  for (const rarity of ["C", "R", "SR", "SSR", "LR", "event-LR"]) {
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source,event_only) values($1,$1,'ANIME/MANGA','Pity',$2,'https://example.test/card.png','test',$3)",
      [
        "pity-" + rarity,
        rarity === "event-LR" ? "LR" : rarity,
        rarity === "event-LR"
      ]
    );
  }

  // Control only rarity rolls in this disposable database. The actual reward
  // selection, stored copies, counters and inventory changes still run normally.
  const [{ definition }] = (
    await db.query(
      "select pg_get_functiondef('public.open_regular_pack()'::regprocedure) definition"
    )
  ).rows;
  assert.match(definition, /roll:=random\(\);/);
  await db.exec(
    definition.replace(
      "roll:=random();",
      "roll:=(string_to_array(current_setting('test.pity_rolls'), ',')::double precision[])[position];"
    )
  );

  async function rpc(sql, parameters = [], user = player) {
    await db.exec("set role authenticated");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user
      ]);
      return (await db.query(sql, parameters)).rows[0]?.value;
    } finally {
      await db.exec("reset role");
    }
  }
  const status = user =>
    rpc("select public.get_regular_pack_status() value", [], user);
  const open = () => rpc("select public.open_regular_pack() value");
  const openBatch = count =>
    rpc("select public.open_regular_packs($1) value", [count]);
  const streak = async () => (await status()).lrPity.opened;
  const commonRolls = "0.1,0.1,0.1,0.1,0.1";
  const rarityRolls = rolls =>
    db.query("select set_config('test.pity_rolls',$1,false)", [rolls]);
  const names = pack => pack.map(card => card.name);
  async function preparePacks(opened, bonus = 0) {
    await db.query(
      "update public.user_profiles set next_regular_pack_at=clock_timestamp()-interval '2 hours',bonus_regular_packs=$2 where user_id=$1",
      [player, bonus]
    );
    await db.query(
      "insert into public.regular_pack_lr_pity values($1,$2) on conflict (user_id) do update set packs_without_lr=excluded.packs_without_lr",
      [player, opened]
    );
    await rarityRolls(commonRolls);
  }

  await t.test(
    "existing players start at zero and cannot modify or read the private counter directly",
    async () => {
      assert.deepEqual((await status()).lrPity, { opened: 0, target: 500 });
      await assert.rejects(
        rpc("select * from public.regular_pack_lr_pity"),
        /permission denied/
      );
      await assert.rejects(
        rpc("insert into public.regular_pack_lr_pity values ($1,499)", [
          player
        ]),
        /permission denied/
      );
    }
  );

  await t.test(
    "only the 500th consecutive miss upgrades a card from the normal LR pool",
    async () => {
      await preparePacks(498);
      assert.deepEqual(names(await open()), Array(5).fill("PITY-C"));
      assert.equal(await streak(), 499);
      const pack = await open();
      assert.deepEqual(names(pack), [
        "PITY-C",
        "PITY-C",
        "PITY-C",
        "PITY-C",
        "PITY-LR"
      ]);
      assert.equal(await streak(), 0);
      const { rows } = await db.query(
        "select rarity from public.user_cards where id=$1 and user_id=$2",
        [pack[4].instanceId, player]
      );
      assert.deepEqual(rows, [{ rarity: "LR" }]);
      assert.equal((await status(other)).lrPity.opened, 0);
    }
  );

  await t.test(
    "natural LR drops reset the streak and leave all five slots unchanged",
    async () => {
      for (const [opened, rolls, expected] of [
        [
          120,
          "0.9999,0.1,0.1,0.1,0.1",
          ["PITY-LR", "PITY-C", "PITY-C", "PITY-C", "PITY-C"]
        ],
        [
          499,
          "0.9999,0.1,0.1,0.1,0.1",
          ["PITY-LR", "PITY-C", "PITY-C", "PITY-C", "PITY-C"]
        ],
        [
          499,
          "0.1,0.1,0.1,0.1,0.9999",
          ["PITY-C", "PITY-C", "PITY-C", "PITY-C", "PITY-LR"]
        ]
      ]) {
        await preparePacks(opened);
        await rarityRolls(rolls);
        assert.deepEqual(names(await open()), expected);
        assert.equal(await streak(), 0);
      }
    }
  );

  await t.test(
    "each pack in a batch progresses independently across the threshold",
    async () => {
      for (const count of [5, 10]) {
        await preparePacks(497, count - 5);
        const cards = await openBatch(count);
        assert.equal(cards.length, count * 5);
        assert.deepEqual(
          cards.flatMap((card, index) => (card.rarity === "LR" ? [index] : [])),
          [14]
        );
        assert.equal(await streak(), count - 3);
      }
    }
  );

  await t.test("Decision openings leave the Regular streak alone", async () => {
    await preparePacks(499);
    const cards = await rpc("select public.open_decision_pack() value");
    assert.equal(cards.length, 5);
    assert.equal(await streak(), 499);
  });

  await t.test(
    "a failed batch rolls back even the guaranteed drop and its reset",
    async () => {
      await preparePacks(499);
      await db.exec(`
      create function public.pity_test_reject_second_pack() returns trigger
      language plpgsql as $test$
      begin
        if (select packs_without_lr from public.regular_pack_lr_pity where user_id=new.opened_by)=0 then
          raise exception 'PITY_TEST_SECOND_PACK_FAILED';
        end if;
        return new;
      end;
      $test$;
      create trigger pity_test_reject_second_pack before insert on public.regular_pack_openings
      for each row execute function public.pity_test_reject_second_pack();
    `);
      const countOwned = async () =>
        (
          await db.query(
            "select count(*)::int as total from public.user_cards where user_id=$1",
            [player]
          )
        ).rows[0].total;
      const before = await status();
      const cardCount = await countOwned();
      await assert.rejects(openBatch(5), /PITY_TEST_SECOND_PACK_FAILED/);
      const after = await status();
      assert.equal(after.available, before.available);
      assert.equal(after.lrPity.opened, 499);
      assert.equal(await countOwned(), cardCount);
    }
  );
});
