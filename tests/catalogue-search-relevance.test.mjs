import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";

function load(path, require, env = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    { exports, require, process: { env }, console, BroadcastChannel: undefined }
  );
  return exports;
}

test("catalogue text queries avoid album aliases with stable binders enabled, retain metadata, filters and exact totals", async () => {
  const { cardSearchTerms } = load("lib/ui/card-search.ts", () => ({}));
  for (const enabled of [false, true]) {
    const calls = [],
      metadata = [];
    let fail = false;
    const cards = [
      { id: "kingdom", name: "RI SHIN", anime: "KINGDOM", rarity: "LR" },
      {
        id: "link",
        name: "LINK",
        anime: "The Legend of Zelda: Breath of the Wild",
        rarity: "LR"
      }
    ];
    const api = load(
      "lib/data/cards.ts",
      name => {
        if (name === "@/lib/data/read-request") return {};
        if (name === "@/lib/ui/card-search") return { cardSearchTerms };
        if (name === "@/lib/data/player-state")
          return {
            createPlayerSnapshotCache: () => ({}),
            subscribePlayerSnapshotInvalidation: () => {},
            PLAYER_SNAPSHOT_TTL: {}
          };
        if (name === "@/utils/supabase/client")
          return {
            createClient: () => ({
              auth: { onAuthStateChange: () => {} },
              rpc: async (name, args) => {
                calls.push({ name, args });
                return {
                  data: {
                    items:
                      name === "get_binder_catalogue_page"
                        ? [
                            ...cards,
                            {
                              id: "roger",
                              name: "GOL D. ROGER",
                              anime: "One Piece"
                            }
                          ]
                        : cards,
                    total: name === "get_binder_catalogue_page" ? 2399 : 663
                  },
                  error: fail ? { code: "42501" } : null
                };
              }
            })
          };
        if (name === "@/lib/data/binders")
          return {
            withBinderMetadata: async items => {
              metadata.push(items.map(c => c.id));
              return items.map(c => ({ ...c, binders: [{ key: "kept" }] }));
            }
          };
        throw Error(name);
      },
      { NEXT_PUBLIC_STABLE_BINDERS_ENABLED: String(enabled) }
    );
    const result = await api.getCataloguePage({
      query: "  KINGDOM  ",
      category: ["ANIME/MANGA", "VIDEO GAMES"],
      rarity: ["LR", "SSR"],
      page: 2,
      pageSize: 24
    });
    assert.equal(calls[0].name, "get_catalogue_cards_page");
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), {
      p_query: "kingdom",
      p_category: '["ANIME/MANGA","VIDEO GAMES"]',
      p_rarity: '["LR","SSR"]',
      p_offset: 24,
      p_limit: 24,
      p_sort: "rarity"
    });
    assert.equal(result.total, 663);
    assert.deepEqual(
      Array.from(result.cards, c => c.id),
      ["kingdom", "link"]
    );
    assert.equal(metadata.length, enabled ? 1 : 0);
    if (enabled) {
      assert.equal(result.cards[0].binders[0].key, "kept");
      await api.getCataloguePage({ query: "  , % ( )  " });
      assert.equal(calls.at(-1).name, "get_binder_catalogue_page");
    }
    fail = true;
    await assert.rejects(api.getCataloguePage({ query: "kingdom" }));
  }
});

test("kingdom regression distinguishes attached secondary licenses from Naruto/One Piece album aliases, for anonymous and signed-in readers", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());
  const naruto = "f8200000-0000-4000-8000-000000000001",
    piece = "f8200000-0000-4000-8000-000000000002";
  await db.query(
    "insert into public.anime_series_binders values($1,99801,'Naruto'),($2,99802,'One Piece')",
    [naruto, piece]
  );
  await db.query(
    "insert into public.anime_license_binders values($1,'Naruto'),($2,'One Piece')",
    [naruto, piece]
  );
  await db.query(
    "insert into public.anime_license_source_rules values('Naruto',$1),('One Piece',$2)",
    [naruto, piece]
  );
  await db.query(
    "insert into public.anime_license_aliases values($1,'Naruto the Movie: Guardians of the Crescent Moon Kingdom'),($2,'One Piece: Chopper Kingdom of Strange Animal Island')",
    [naruto, piece]
  );
  await db.exec(`update public.anime_series_settings set enabled=true,license_grouping_enabled=true;
 insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url)values
 ('test','kingdom-shin','RI SHIN','ANIME/MANGA','KINGDOM','LR','https://example.test/shin.png'),
 ('test','kingdom-itachi','ITACHI UCHIHA','ANIME/MANGA','Naruto','LR','https://example.test/itachi.png'),
 ('test','kingdom-roger','GOL D. ROGER','ANIME/MANGA','One Piece','LR','https://example.test/roger.png'),
 ('test','kingdom-link','LINK','VIDEO GAMES','Breath of the Wild','SSR','https://example.test/link.png'),
 ('test','kingdom-name','KINGDOM KEEPER','FILM','Other','C','https://example.test/name.png');
 insert into public.card_franchises(card_id,franchise,position)select id,'Tears of the Kingdom',1 from public.cards where source_id='kingdom-link';`);
  for (const role of ["anon", "authenticated"]) {
    await db.exec("set role " + role);
    const broad = (
      await db.query(
        "select public.get_binder_catalogue_page('kingdom','','',0,60,'rarity') value"
      )
    ).rows[0].value;
    assert.equal(
      broad.total,
      5,
      "fixture reproduces the expanded album-alias results"
    );
    const read = async (category = "", rarity = "", offset = 0, limit = 60) =>
      (
        await db.query(
          "select public.get_catalogue_cards_page('kingdom',$1,$2,$3,$4,'rarity') value",
          [category, rarity, offset, limit]
        )
      ).rows[0].value;
    const strict = await read();
    assert.equal(strict.total, 3);
    assert.deepEqual(
      strict.items.map(c => c.name),
      ["RI SHIN", "LINK", "KINGDOM KEEPER"]
    );
    assert.equal(
      strict.items.find(c => c.name === "LINK").anime,
      "Breath of the Wild"
    );
    const page = await read("", "", 1, 1);
    assert.equal(page.total, 3);
    assert.equal(page.items[0].name, "LINK");
    const filtered = await read("ANIME/MANGA", "LR");
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].name, "RI SHIN");
    await db.exec("reset role");
  }
});
