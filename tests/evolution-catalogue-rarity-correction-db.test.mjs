import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("all earlier normal rarities can evolve after LR or SSR catalogue reclassification, but existing INFINITY copies remain excluded", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const player = "79000000-0000-4000-8000-000000000002";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
    [player, JSON.stringify({ pseudo: "AllRarityCorrections" })]
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  for (const target of ["SSR", "LR"]) {
    for (const origin of ["C", "R", "SR", "SSR", "LR"].filter(
      rarity => rarity !== target
    )) {
      const card = (
        await db.query(
          "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA','Test',$2,'https://example.test/correction.png','test') returning id",
          [`correction-${origin}-${target}`, origin]
        )
      ).rows[0].id;
      const required = target === "SSR" ? 5 : 3;
      const copies = (
        await db.query(
          "insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved) select $1,$2,$3,false,false from generate_series(1,$4) returning id",
          [player, card, origin, required]
        )
      ).rows.map(row => row.id);
      await db.query("update public.cards set rarete_base=$1 where id=$2", [
        target,
        card
      ]);
      assert.deepEqual(
        (
          await db.query(
            "select distinct rarity from public.user_cards where id=any($1::uuid[])",
            [copies]
          )
        ).rows,
        [{ rarity: origin }]
      );
      const oldInfinity = (
        await db.query(
          "insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved) values($1,$2,'LR',false,true) returning id",
          [player, card]
        )
      ).rows[0].id;
      await db.exec("set role authenticated");
      const evolve = ids =>
        db.query(
          `select public.evolve_${target.toLowerCase()}_card($1::uuid[]) as value`,
          [ids]
        );
      await assert.rejects(
        evolve([oldInfinity, ...copies.slice(1)]),
        target === "SSR" ? /SSR_CARD_NOT_OWNED/ : /INVALID_LR_COPIES/
      );
      await assert.rejects(
        evolve([...copies.slice(0, -1), oldInfinity]),
        target === "SSR" ? /INVALID_SSR_COPIES/ : /INVALID_LR_COPIES/
      );
      const result = (await evolve(copies)).rows[0].value;
      assert.equal(result.id, card);
      assert.equal(result.rarity, target);
      assert.equal(result.isEvolved, true);
      assert.equal(result.shiny, target === "SSR");
      await db.exec("reset role");
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from public.user_cards where id=any($1::uuid[])",
            [copies]
          )
        ).rows[0].count,
        0
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from public.user_cards where id=$1",
            [oldInfinity]
          )
        ).rows[0].count,
        1
      );
    }
  }
});

test("LR evolution follows a corrected catalogue rarity without rewriting acquisition history or weakening variant guards", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const player = "79000000-0000-4000-8000-000000000001";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
    [player, JSON.stringify({ pseudo: "RarityCorrectionPlayer" })]
  );
  const makeCard = async source =>
    (
      await db.query(
        "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA','Test','SR','https://example.test/rarity.png','test') returning id",
        [source]
      )
    ).rows[0].id;
  const promoted = await makeCard("promoted-lr");
  const unchanged = await makeCard("still-sr");
  const copies = async (cardId, rarity, shiny = false, evolved = false) =>
    (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved) select $1,$2,$3,$4,$5 from generate_series(1,3) returning id",
        [player, cardId, rarity, shiny, evolved]
      )
    ).rows.map(row => row.id);
  const oldCopies = await copies(promoted, "SR");
  const fakeLrCopies = await copies(unchanged, "LR");
  const shiny = await copies(promoted, "LR", true);
  const infinity = await copies(promoted, "LR", false, true);
  await db.query("update public.cards set rarete_base='LR' where id=$1", [
    promoted
  ]);
  assert.deepEqual(
    (
      await db.query(
        "select distinct rarity from public.user_cards where id=any($1::uuid[])",
        [oldCopies]
      )
    ).rows.map(row => row.rarity),
    ["SR"]
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  await db.exec("set role authenticated");
  const evolve = ids =>
    db.query("select public.evolve_lr_card($1::uuid[]) as value", [ids]);
  await assert.rejects(evolve(fakeLrCopies), /INVALID_LR_COPIES/);
  // Shiny LR now participate after a catalogue correction too; rollback keeps
  // the acquisition-history and normal-evolution assertions below unchanged.
  await db.exec("begin");
  const mixed = (await evolve([oldCopies[0], oldCopies[1], shiny[0]])).rows[0]
    .value;
  assert.equal(mixed.shiny, true);
  assert.equal(mixed.isEvolved, true);
  await db.exec("rollback");
  await assert.rejects(
    evolve([oldCopies[0], oldCopies[1], infinity[0]]),
    /INVALID_LR_COPIES/
  );
  const result = (await evolve(oldCopies)).rows[0].value;
  assert.equal(result.id, promoted);
  assert.equal(result.rarity, "LR");
  assert.equal(result.isEvolved, true);
  assert.equal(result.shiny, false);
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.user_cards where id=any($1::uuid[])",
        [oldCopies]
      )
    ).rows[0].count,
    0
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.user_cards where id=any($1::uuid[])",
        [[...fakeLrCopies, ...shiny, ...infinity]]
      )
    ).rows[0].count,
    9
  );
  assert.deepEqual(
    (
      await db.query(
        "select rarity,is_evolved,is_shiny from public.user_cards where id=$1",
        [result.instanceId]
      )
    ).rows[0],
    { rarity: "LR", is_evolved: true, is_shiny: false }
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('anon','public.evolve_lr_card(uuid[])','EXECUTE') as allowed"
      )
    ).rows[0].allowed,
    false
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.evolve_lr_card(uuid[])','EXECUTE') as allowed"
      )
    ).rows[0].allowed,
    true
  );
});
