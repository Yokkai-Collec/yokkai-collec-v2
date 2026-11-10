import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("LR evolution consumes only three identical owned copies and preserves variant identity", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const alice = "76000000-0000-4000-8000-000000000001",
    bob = "76000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [alice, "EvolutionAlice"],
    [bob, "EvolutionBob"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  const card = async (source, rarity) =>
    (
      await db.query(
        "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA','Test',$2,'https://example.test/card.png','test') returning id",
        [source, rarity]
      )
    ).rows[0].id;
  const lr = await card("lr-one", "LR"),
    other = await card("lr-two", "LR"),
    ssr = await card("ssr-one", "SSR");
  const copies = async (
    count,
    {
      owner = alice,
      cardId = lr,
      rarity = "LR",
      shiny = false,
      evolved = false,
      locked = false
    } = {}
  ) =>
    (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved,is_locked) select $1,$2,$3,$4,$5,$6 from generate_series(1,$7) returning id",
        [owner, cardId, rarity, shiny, evolved, locked, count]
      )
    ).rows.map(r => r.id);
  const normal = await copies(15),
    shiny = await copies(1, { shiny: true }),
    evolved = await copies(1, { evolved: true }),
    wrongCard = await copies(1, { cardId: other }),
    foreign = await copies(1, { owner: bob }),
    locked = await copies(1, { locked: true }),
    ssrs = await copies(3, { cardId: ssr, rarity: "SSR" });
  const auction = await copies(1);
  await db.query(
    "insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at) values($1,$2,10,10,60,now()+interval '1 hour')",
    [auction[0], alice]
  );
  const login = async (user, role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user || ""
    ]);
    await db.exec("set role " + role);
  };
  const evolve = ids =>
    db.query("select public.evolve_lr_card($1::uuid[]) value", [ids]);
  const snapshot = async () =>
    JSON.stringify(
      (
        await db.query(
          "select id,user_id,card_id,rarity,is_shiny,is_evolved,is_locked from public.user_cards order by id"
        )
      ).rows
    );
  const before = await snapshot();
  await login(null);
  await assert.rejects(evolve(normal.slice(0, 3)), /AUTH_REQUIRED/);
  await login(alice, "anon");
  await assert.rejects(evolve(normal.slice(0, 3)), /permission denied/);
  await login(alice);
  for (const bad of [
    null,
    [],
    normal.slice(0, 2),
    normal.slice(0, 4),
    normal.slice(0, 5),
    [...normal.slice(0, 2), normal[0]],
    [...normal.slice(0, 2), null]
  ])
    await assert.rejects(evolve(bad), /THREE_DISTINCT_LR_COPIES_REQUIRED/);
  for (const bad of [evolved, wrongCard, foreign]) {
    await assert.rejects(
      evolve([...normal.slice(0, 2), bad[0]]),
      /INVALID_LR_COPIES/
    );
    await assert.rejects(
      evolve([bad[0], ...normal.slice(0, 2)]),
      /INVALID_LR_COPIES/
    );
  }
  await assert.rejects(evolve(ssrs), /INVALID_LR_COPIES/);
  await assert.rejects(
    evolve([...normal.slice(0, 2), locked[0]]),
    /CARD_LOCKED/
  );
  await assert.rejects(
    evolve([...normal.slice(0, 2), auction[0]]),
    /CARD_FROZEN/
  );
  await db.exec("reset role");
  assert.equal(
    await snapshot(),
    before,
    "Every rejected selection is atomic and leaves all copies intact"
  );
  await login(alice);
  const result = (await evolve(normal.slice(0, 3))).rows[0].value;
  assert.equal(result.rarity, "LR");
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.user_cards where id=any($1::uuid[])",
        [normal.slice(3)]
      )
    ).rows[0].n,
    12,
    "Only the three selected copies are consumed"
  );
  await login(alice);
  assert.equal(result.shiny, false);
  assert.equal(result.isEvolved, true);
  assert.equal(result.isFirstOwner, false);
  assert.equal(result.customImageUrl, null);
  assert.equal(result.folderId, null);
  await assert.rejects(evolve(normal.slice(0, 3)), /INVALID_LR_COPIES/);
  await assert.rejects(
    evolve([result.instanceId, ...normal.slice(3, 5)]),
    /INVALID_LR_COPIES/
  );
  const normalShare = (
    await db.query("select public.create_card_share($1,false) id", [normal[3]])
  ).rows[0].id;
  const evolvedShare = (
    await db.query("select public.create_card_share($1,false) id", [
      result.instanceId
    ])
  ).rows[0].id;
  const shinyShare = (
    await db.query("select public.create_card_share($1,false) id", [shiny[0]])
  ).rows[0].id;
  assert.equal(
    new Set([normalShare, evolvedShare, shinyShare]).size,
    3,
    "Sharing cannot confuse normal, Evolved and Shiny LR"
  );
  const publicShare = (
    await db.query("select public.get_shared_card($1) value", [evolvedShare])
  ).rows[0].value;
  assert.equal(publicShare.isEvolved, true);
  assert.equal(publicShare.shiny, false);
  assert.equal(publicShare.category, "ANIME/MANGA");
  const a = (
    await db.query("select public.create_auction($1,10,60) id", [
      result.instanceId
    ])
  ).rows[0].id;
  const detail = (await db.query("select public.get_auction($1) value", [a]))
    .rows[0].value;
  assert.equal(detail.card.isEvolved, true);
  assert.equal(detail.card.shiny, false);
  const page = (
    await db.query("select public.list_auctions_page(null,100) value")
  ).rows[0].value;
  assert.equal(page.items.find(x => x.id === a).card.isEvolved, true);
  const profile = (
    await db.query(
      "select public.get_profile_active_auctions($1,null,20) value",
      [alice]
    )
  ).rows[0].value;
  assert.equal(profile.items.find(x => x.id === a).card.isEvolved, true);
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select count(*)::integer count from public.user_cards where id=any($1::uuid[])",
        [normal.slice(0, 3)]
      )
    ).rows[0].count,
    0
  );
  assert.equal(
    (
      await db.query(
        "select is_shiny,is_evolved from public.user_cards where id=$1",
        [shiny[0]]
      )
    ).rows[0].is_shiny,
    true
  );
  // Both LR Infinity variants are legal; other evolved rarities remain guarded.
  await db.query("update public.user_cards set is_shiny=true where id=$1", [
    evolved[0]
  ]);
  await assert.rejects(
    db.query("update public.user_cards set rarity='SR' where id=$1", [
      evolved[0]
    ]),
    /user_cards_evolved_variant_check/
  );
  for (const shinyCount of [1, 2, 3]) {
    const ids = [
      ...(await copies(3 - shinyCount)),
      ...(await copies(shinyCount, { shiny: true }))
    ];
    // A Shiny in any position transfers its variant, independent of the art source.
    for (const ordered of [ids, [...ids].reverse()]) {
      await db.exec("begin");
      await login(alice);
      const mixed = (await evolve(ordered)).rows[0].value;
      assert.equal(mixed.shiny, true);
      assert.equal(mixed.isEvolved, true);
      await db.exec("reset role");
      const stored = (
        await db.query(
          "select is_shiny,is_evolved from public.user_cards where id=$1",
          [mixed.instanceId]
        )
      ).rows[0];
      assert.equal(stored.is_shiny, true);
      assert.equal(stored.is_evolved, true);
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from public.user_cards where id=any($1::uuid[])",
            [ids]
          )
        ).rows[0].n,
        0
      );
      await db.exec("rollback");
    }
  }
  // A failure after consumption must roll back the three deletions as well.
  await db.exec(
    "create function public.reject_test_evolution() returns trigger language plpgsql as $$begin if new.is_evolved and new.rarity='LR' then raise exception 'TEST_INSERT_FAILURE'; end if; return new; end$$; create trigger reject_test_evolution before insert on public.user_cards for each row execute function public.reject_test_evolution()"
  );
  const stable = await snapshot();
  await login(alice);
  await assert.rejects(evolve(normal.slice(3, 6)), /TEST_INSERT_FAILURE/);
  await db.exec("reset role");
  assert.equal(await snapshot(), stable);
});
