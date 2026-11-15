import { normalizeWhitespace } from "./helpers/normalize-whitespace.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { readRpcPages } from "../lib/data/rpc-pages.mjs";

function marketApi() {
  const context = {
    exports: {},
    Map,
    Set,
    require: name => {
      if (name === "@/lib/data/rpc-pages.mjs") return { readRpcPages };
      if (name === "@/utils/supabase/client")
        return { createClient: () => ({}) };
      if (name === "@/lib/data/cards")
        return {
          invalidatePlayerSnapshots() {},
          withLiveCardFranchises: async cards => cards
        };
      assert.fail("Import inattendu: " + name);
    }
  };
  const source = ts.transpileModule(
    readFileSync(new URL("../lib/data/market.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }
  ).outputText;
  vm.runInNewContext(source, context);
  return context.exports;
}
const auction = (
  id,
  { sellerId = "seller", buyerId = "buyer", status = "active" } = {}
) => ({ id, sellerId, buyerId, status });

test("règlement : vendeur, gagnant et ancien meneur produisent des portées dédupliquées", () => {
  const { auctionReconciliationScopes } = marketApi();
  const previous = [
    auction("sale", { sellerId: "viewer", buyerId: "other" }),
    auction("win", { sellerId: "other", buyerId: "viewer" }),
    auction("refund", { sellerId: "other", buyerId: "viewer" })
  ];
  const next = [
    auction("sale", { sellerId: "viewer", buyerId: "other", status: "sold" }),
    auction("win", { sellerId: "other", buyerId: "viewer", status: "sold" }),
    auction("refund", { sellerId: "other", buyerId: "other" })
  ];
  assert.deepEqual(
    Array.from(auctionReconciliationScopes(previous, next, "viewer")).sort(),
    ["balance", "collection"]
  );
  assert.deepEqual(
    Array.from(auctionReconciliationScopes(next, next, "viewer")),
    []
  );
});

test("un ancien meneur remboursé reste détecté si l'enchère disparaît entre deux cycles", () => {
  const { auctionReconciliationScopes } = marketApi();
  assert.deepEqual(
    Array.from(
      auctionReconciliationScopes(
        [auction("gone", { buyerId: "viewer" })],
        [],
        "viewer"
      )
    ),
    ["balance"]
  );
});

test("le polling Marché : liste à 30 s, enchère ouverte à 3 s, onglet caché en pause, anti-snipe conservé", () => {
  const listSource = readFileSync(
    new URL("../components/market-listings.tsx", import.meta.url),
    "utf8"
  );
  const source = readFileSync(
    new URL("../components/community-views.tsx", import.meta.url),
    "utf8"
  );
  // #388: list at 30 s; the open auction stays at 3 s; both pause when hidden.
  assert.match(
    normalizeWhitespace(listSource),
    normalizeWhitespace(/startVisiblePolling\(\(\)=>void refresh\(\),30_000\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /startVisiblePolling\(\(\)=>\{if\(skipFirst\)skipFirst=false;else void refresh\(\);\},3000\)/
    )
  );
  assert.match(
    normalizeWhitespace(listSource),
    normalizeWhitespace(
      /auctionReconciliationScopes\(marketRef\.current\?\?\[\],next,viewerId\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /auctionReconciliationScopes\(auctionRef\.current\?\[auctionRef\.current\]:\[\],\[next\],viewerRef\.current\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /Date\.parse\(next\.endsAt\)>Date\.parse\(previous\.endsAt\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/animation\.market\.extensionNotice/)
  );
});
