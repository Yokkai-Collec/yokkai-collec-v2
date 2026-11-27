import assert from "node:assert/strict";
import test from "node:test";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";

test("profile license choices are category-scoped, paginated and validated against the catalogue", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  const owner = "73000000-0000-4000-8000-000000000001";
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"LicensePicker"}\')',
    [owner]
  );
  for (let i = 0; i < 80; i++)
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ($1,'Anime','ANIME/MANGA',$2,'C','https://example.test/card.png','test')",
      [`picker-${i}`, `Anime ${String(i).padStart(2, "0")}`]
    );
  await db.exec(
    "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ('picker-game','Game','VIDEO GAMES','Devil May Cry','C','https://example.test/card.png','test')"
  );
  const id = (
    await db.query("select id from public.cards where source_id='picker-0'")
  ).rows[0].id;
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position) values ($1,'Secondary anime',1)",
    [id]
  );
  const longLicense = "A real catalogue title " + "x".repeat(110);
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position) values ($1,$2,2)",
    [id, longLicense]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);
  const choices = async (category, query = "", offset = 0, limit = 72) =>
    (
      await db.query(
        "select public.get_profile_widget_licenses($1,$2,$3,$4) value",
        [category, query, offset, limit]
      )
    ).rows[0].value;
  const first = await choices("ANIME/MANGA");
  const second = await choices("ANIME/MANGA", "", 72);
  assert.equal(first.total, 82);
  assert.equal(first.items.length, 72);
  assert.equal(second.items.length, 10);
  assert.equal(new Set([...first.items, ...second.items]).size, 82);
  assert.ok(!first.items.includes("Devil May Cry"));
  assert.deepEqual(await choices("ANIME/MANGA", "SECONDARY"), {
    items: ["Secondary anime"],
    total: 1
  });
  assert.deepEqual(await choices("VIDEO GAMES"), {
    items: ["Devil May Cry"],
    total: 1
  });
  assert.deepEqual(await choices("UNKNOWN"), { items: [], total: 0 });
  assert.equal((await choices("ANIME/MANGA", "", 0, 10000)).items.length, 72);
  const save = value =>
    db.query("select public.update_profile_widgets($1::jsonb) value", [
      JSON.stringify(value)
    ]);
  const valid = [
    {
      category: "ANIME/MANGA",
      entries: ["Secondary anime", longLicense, "Anime 00"]
    }
  ];
  assert.deepEqual(
    (await save(valid)).rows[0].value,
    valid,
    "secondary and full-length existing license names can be selected"
  );
  for (const entries of [
    ["Invented"],
    ["Devil May Cry"],
    ["Anime 00", "Anime 00"],
    ["Anime 00 "]
  ])
    await assert.rejects(
      save([{ category: "ANIME/MANGA", entries }]),
      /WIDGETS_INVALID/
    );
  await db.exec("reset role");
  await db.query(
    "delete from public.card_franchises where card_id=$1 and franchise='Secondary anime'",
    [id]
  );
  await db.exec("set role authenticated");
  assert.deepEqual(await choices("ANIME/MANGA", "Secondary"), {
    items: [],
    total: 0
  });
  await assert.rejects(
    save(valid),
    /WIDGETS_INVALID/,
    "a removed licence cannot be selected from stale results"
  );
  await db.exec("set role anon");
  await assert.rejects(choices("ANIME/MANGA"), /permission denied/);
});
