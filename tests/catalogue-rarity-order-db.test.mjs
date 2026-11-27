import assert from "node:assert/strict";
import test from "node:test";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";

test("catalogue rarity/name ordering is global, stable and shared by search, filters and pages", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  for (const rarity of ["C", "R", "SR", "SSR", "LR"])
    for (const [index, name] of ["Zelda", "Alice", "Alice"].entries())
      await db.query(
        "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$2,'FILM','Order Fixture',$3,'https://example.test/card.png','test')",
        [`${rarity}-${index}`, name, rarity]
      );
  const expected = (
    await db.query(
      "select id,nom,rarete_base from public.cards order by rarete_base desc,nom,id"
    )
  ).rows;
  for (const role of ["anon", "authenticated"]) {
    await db.exec("set role " + role);
    for (const fn of [
      "get_catalogue_cards_page",
      "get_binder_catalogue_page"
    ]) {
      const read = async (
        query = "",
        category = "",
        rarity = "",
        offset = 0,
        limit = 60,
        sort = "rarity"
      ) =>
        (
          await db.query(`select public.${fn}($1,$2,$3,$4,$5,$6) value`, [
            query,
            category,
            rarity,
            offset,
            limit,
            sort
          ])
        ).rows[0].value;
      const pages = [];
      for (let offset = 0; offset < 15; offset += 4) {
        const page = await read("", "", "", offset, 4);
        assert.equal(page.total, 15);
        pages.push(...page.items);
      }
      assert.deepEqual(
        pages.map(c => c.id),
        expected.map(c => c.id),
        fn +
          ": ordering must precede pagination, including equal-name UUID ties"
      );
      assert.equal(new Set(pages.map(c => c.id)).size, 15);
      const filtered = await read("Order Fixture", "FILM", '["LR","SR"]');
      assert.deepEqual(
        filtered.items.map(c => c.id),
        expected
          .filter(c => ["LR", "SR"].includes(c.rarete_base))
          .map(c => c.id)
      );
      assert.equal(filtered.total, 6);
      const alpha = await read("Alice");
      assert.deepEqual(
        alpha.items.map(c => c.rarity),
        ["LR", "LR", "SSR", "SSR", "SR", "SR", "R", "R", "C", "C"]
      );
      const defaultOrder = (
        await db.query(`select public.${fn}('','','',0,60) value`)
      ).rows[0].value;
      const names = (
        await db.query("select id from public.cards order by nom,id")
      ).rows;
      assert.deepEqual(
        defaultOrder.items.map(c => c.id),
        names.map(c => c.id),
        "Existing callers retain name ordering"
      );
      assert.deepEqual((await read("no matches")).items, []);
    }
    await db.exec("reset role");
  }
  assert.ok(
    (
      await db.query(
        "select indexdef from pg_indexes where indexname='cards_catalogue_rarity_name_idx'"
      )
    ).rows[0].indexdef.includes("rarete_base DESC, nom, id")
  );
});
