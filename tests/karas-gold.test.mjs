import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { intl, intlServer } from "./helpers/i18n.mjs";
import postcss from "postcss";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const read = file => readFileSync(path.join(root, file), "utf8");
const modules = new Map();
function load(file) {
  if (file.endsWith(".json")) return JSON.parse(read(file));
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(read(file), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    }).outputText,
    {
      exports,
      URL,
      process: { env: { NODE_ENV: "test" } },
      require: name => {
        if (name === "next-intl") return intl;
        if (name === "next-intl/server") return intlServer;
        if (name === "@/components/locale-controls")
          return { LocaleSelector: () => null };
        if (name === "@/i18n/server")
          return { syncProfileLocale: async () => {} };
        if (name.endsWith(".css")) return {};
        if (name === "@/components/ui") return load("components/ui/index.tsx");
        if (name.startsWith("@/")) {
          const stem = name.slice(2);
          const file = [stem, `${stem}.tsx`, `${stem}.ts`].find(candidate =>
            existsSync(path.join(root, candidate))
          );
          assert.ok(file, name);
          return load(file);
        }
        return require(name);
      }
    }
  );
  return exports;
}
const render = (component, props) =>
  renderToStaticMarkup(React.createElement(component, props));

test("existing gold balance and auction surfaces retain their markup and accessible labels", () => {
  const topbar = read("components/topbar.tsx");
  const market = read("components/community-views.tsx");
  assert.match(topbar, /<Karas amount=\{karas\} className="yk-karas-gold"/);
  assert.equal((topbar.match(/yk-karas-gold/g) ?? []).length, 1);
  assert.equal((market.match(/yk-karas-gold/g) ?? []).length, 3);
  assert.match(
    market,
    /<Karas[\s\S]*?amount=\{auction\.amount\}[\s\S]*?className="yk-auction-price yk-karas-gold"/
  );
  assert.match(market, /className="yk-bid-quick yk-karas-gold"/);
  assert.match(
    market,
    /<Karas amount=\{auction\.balance\} className="yk-karas-gold"/
  );
  assert.match(
    market,
    /<span className="text-karas tabular-nums">\s*\{formatKaras\(h\.amount\)\}/
  );
  assert.match(
    market,
    /<Karas amount=\{a\.amount\} className="yk-market-price"/
  );
  const { Karas } = load("components/ui/index.tsx");
  assert.doesNotMatch(render(Karas, { amount: 5339 }), /yk-karas-gold/);
  const gold = render(Karas, { amount: 5339, className: "yk-karas-gold" });
  assert.match(gold, /yk-karas-gold/);
  assert.match(gold, /aria-label="5,339 Karas"/);
  assert.match(gold, />5,339<\/span>/);
  assert.match(
    render(Karas, { amount: null, className: "yk-karas-gold" }),
    /Karas balance unavailable/
  );
});

test("all shared currency text and gems use gold while preserving button and badge frames", () => {
  const sheet = postcss.parse(read("styles/ui.css"));
  const rules = [];
  sheet.walkRules(rule => {
    if (rule.selector.includes("yk-karas-gold")) rules.push(rule);
  });
  assert.equal(rules.length, 2);
  const text = rules.find(rule => !rule.selector.includes(".yk-karas-gem"));
  assert.ok(text.selectors.includes(".yk-karas"));
  assert.ok(text.selectors.includes(".text-karas"));
  assert.ok(text.selector.includes(".yk-bid-quick.yk-karas-gold"));
  assert.ok(text.selector.includes(".yk-auction-history .text-karas"));
  assert.deepEqual(
    text.nodes.map(node => node.prop),
    ["color"]
  );
  assert.equal(text.nodes[0].value, "var(--color-karas-readable-gold)");
  const gem = rules.find(rule => rule.selector.includes(".yk-karas-gem"));
  assert.ok(gem.selectors.includes(".yk-karas-gem"));
  assert.deepEqual(
    gem.nodes.map(node => node.prop),
    ["background", "box-shadow"]
  );
  assert.match(gem.nodes[0].value, /#f2ca72/);
  assert.doesNotMatch(
    read("styles/market.css"),
    /karas-readable-gold|yk-karas-gold/
  );
});

function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
test("the warm gold has at least 7:1 contrast against every surrounding midnight-blue surface", () => {
  const gold = read("styles/ui.css").match(
    /--color-karas-readable-gold:\s*(#[a-f\d]{6})/i
  )?.[1];
  assert.ok(gold);
  for (const background of [
    "#04070f",
    "#060913",
    "#0d1728",
    "#080f1c",
    "#101b2e",
    "#0a1120"
  ]) {
    const contrast = (luminance(gold) + 0.05) / (luminance(background) + 0.05);
    assert.ok(
      contrast >= 7,
      `${gold} on ${background}: ${contrast.toFixed(2)}:1`
    );
  }
});

test("auction rendering keeps prices and bid history gold while labels, dates and countdown stay unchanged", () => {
  const { AuctionView } = load("components/community-views.tsx");
  const html = render(AuctionView, {
    auction: {
      id: "preview",
      card: {
        id: "card",
        name: "Satoru Gojo",
        rarity: "SSR",
        category: "ANIME/MANGA",
        image: "/assets/premium-examples/gojo-original.png"
      },
      amount: 430,
      nextBid: 440,
      minimumBid: 440,
      remaining: "04:43:47",
      remainingSeconds: 17027,
      seller: "Kitsune",
      bids: 3,
      balance: 5339,
      history: [
        { id: "one", name: "You", amount: 430, time: "02:04 AM", mine: true },
        { id: "two", name: "Naylik", amount: 420, time: "02:01 AM" }
      ]
    },
    onBid: async () => assert.fail("Rendering must not place bids")
  });
  assert.equal((html.match(/yk-karas-gold/g) ?? []).length, 3);
  assert.match(html, /class="text-karas tabular-nums">430 Karas/);
  assert.match(html, /class="text-karas tabular-nums">420 Karas/);
  assert.match(html, /\+10 Karas<span>· 440 Karas<\/span>/);
  assert.match(html, /aria-label="5,339 Karas"/);
  assert.match(html, /<time class="text-ink-3 tabular-nums">02:04 AM<\/time>/);
  assert.match(
    html,
    /class="yk-auction-countdown[^"]*" aria-live="off">04:43:47<\/p>/
  );
});
