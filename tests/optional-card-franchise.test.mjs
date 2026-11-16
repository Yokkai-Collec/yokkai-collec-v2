import { intlServer } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as importer from "../scripts/import-cards.mjs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const require = createRequire(import.meta.url);
import { load, row } from "./helpers/optional-card-franchise.mjs";

test("empty and whitespace import licenses become NULL, named licenses stay intact", () => {
  for (const franchise of ["", "  ", null])
    assert.equal(importer.validateCard({ ...row, franchise }).franchise, null);
  assert.equal(
    importer.validateCard({ ...row, franchise: " Series " }).franchise,
    "Series"
  );
});

test("cards and license labels render without empty badges or category fallback", () => {
  const { CardFranchise } = load("components/card-franchise.tsx");
  const { YokaiCard } = load("components/yokai-card.tsx", {
    "@/components/pro-access": { useOwnProfileStyle: () => ({}) }
  });
  for (const anime of [undefined, null, "", "  "]) {
    assert.equal(
      renderToStaticMarkup(
        CardFranchise({ card: { anime, category: "ARTIST" } })
      ),
      ""
    );
    const html = renderToStaticMarkup(
      YokaiCard({ name: "Hero", category: "ARTIST", rarity: "C", anime })
    );
    assert.doesNotMatch(html, /yk-card-anime|>null</);
  }
  assert.match(
    renderToStaticMarkup(
      CardFranchise({ card: { anime: "Series", category: "ARTIST" } })
    ),
    /Series/
  );
  for (const [anime, label] of [
    ["DRAGON BALL", "Dragon Ball"],
    ["DC Comics", "DC Comics"],
    ["NBA", "NBA"]
  ]) {
    assert.match(
      renderToStaticMarkup(
        CardFranchise({ card: { anime, category: "ARTIST" } })
      ),
      new RegExp(label)
    );
    assert.match(
      renderToStaticMarkup(
        YokaiCard({ name: "Hero", category: "ARTIST", rarity: "C", anime })
      ),
      new RegExp(label)
    );
  }
});

test("public share lookup and page metadata accept NULL without blank labels", async () => {
  const card = {
    cardName: "Hero",
    franchise: null,
    rarity: "C",
    shiny: false,
    catalogueImageUrl: row.image_url
  };
  const sharing = load("lib/server/card-sharing.ts", {
    "@supabase/supabase-js": {
      createClient: () => ({ rpc: async () => ({ data: card, error: null }) })
    },
    "@/utils/supabase/config": {
      getSupabaseConfig: () => ({ url: "https://example.test", key: "test" })
    }
  });
  assert.equal((await sharing.getSharedCard("a".repeat(32))).franchise, null);
  const page = load("app/share/[id]/page.tsx", {
    "next-intl/server": intlServer,
    "next/link": { default: "a", __esModule: true },
    "next/navigation": {
      notFound() {
        assert.fail("valid share");
      }
    },
    "@/lib/server/card-sharing": { ...sharing, isShareImageUrl: () => true },
    "@/components/yokai-card": load("components/yokai-card.tsx", {
      "@/components/pro-access": { useOwnProfileStyle: () => ({}) }
    }),
    "@/components/card-shell": { CardShell: ({ children }) => children },
    "@/components/site-footer": { SiteFooter: () => null },
    "@/lib/discord-invite": { getDiscordInviteUrl: () => null },
    "next/image": { __esModule: true, default: () => null }
  });
  const props = { params: Promise.resolve({ id: "a".repeat(32) }) };
  assert.doesNotMatch(
    (await page.generateMetadata(props)).description,
    /null|from ,/
  );
  const html = renderToStaticMarkup(await page.default(props));
  assert.doesNotMatch(html, />null<|mt-3 text-sm text-ink-2/);
});

test("live franchise refresh removes stale snapshot labels, including pack, market and trade cards", async () => {
  const player = load("lib/data/player-state.ts");
  const cards = load("lib/data/cards.ts", {
    "@/lib/data/read-request": {},
    "@/lib/ui/card-search": {},
    "@/lib/data/player-state": player,
    "@/utils/supabase/client": {
      createClient: () => ({
        auth: { onAuthStateChange() {} },
        from: () => ({
          select: () => ({
            in: async (_column, ids) => ({
              data: ids.map(id => ({ id, franchise: null })),
              error: null
            })
          })
        })
      })
    }
  });
  const result = await cards.withLiveCardFranchises([
    { id: "card", anime: "Stale Series" },
    { id: "live", anime: null, liveFranchise: true }
  ]);
  assert.ok(result.every(card => card.anime === undefined));
});

test("OG images render a license-free card in every format", async () => {
  const { renderSharedCardImage } = load("lib/server/card-share-image.tsx", {
    "next/og": require("next/og"),
    "@/lib/server/card-sharing": { isShareImageUrl: () => false }
  });
  for (const format of ["og", "story", "square"]) {
    const image = await renderSharedCardImage(
      {
        cardName: "Hero",
        franchise: null,
        rarity: "C",
        shiny: false,
        catalogueImageUrl: row.image_url
      },
      format
    );
    assert.deepEqual([...image.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});

test("migration preserves existing cards and clears stale links only on future empty writes", async t => {
  const { readdirSync } = await import("node:fs");
  const migration = "20261023233000_optional_card_franchise.sql";
  const migrations = readdirSync("supabase/migrations")
    .filter(name => name.endsWith(".sql") && name < migration)
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  await db.query(
    "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ('legacy','Existing','ARTIST','', 'C',$1,'test')",
    [row.image_url]
  );
  const before = (await db.query("select * from public.cards")).rows;
  const links = (await db.query("select * from public.card_franchises")).rows;
  await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  assert.deepEqual((await db.query("select * from public.cards")).rows, before);
  assert.deepEqual(
    (await db.query("select * from public.card_franchises")).rows,
    links
  );
  await db.exec(
    "update public.cards set franchise='  ' where source_id='legacy'"
  );
  assert.equal(
    (await db.query("select franchise from public.cards")).rows[0].franchise,
    null
  );
  assert.equal(
    (await db.query("select * from public.card_franchises")).rows.length,
    0
  );
});
