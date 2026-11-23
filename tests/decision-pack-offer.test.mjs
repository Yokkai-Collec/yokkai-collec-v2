import assert from "node:assert/strict";
import { intl } from "./helpers/i18n.mjs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
function loader() {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const loaded = { exports: {} };
    cache.set(file, loaded.exports);
    vm.runInNewContext(
      ts.transpileModule(readFileSync(resolve(root, file), "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true
        }
      }).outputText,
      {
        module: loaded,
        exports: loaded.exports,
        require(id) {
          if (id === "server-only") return {};
          if (id === "next-intl") return intl;
          if (id === "@supabase/supabase-js")
            return {
              createClient() {
                throw Error("No database access is expected in this test");
              }
            };
          if (id === "@/lib/auth/session" || id === "@/utils/supabase/config")
            return {};
          if (id.startsWith("@/components/premium-"))
            return {
              PremiumBannerPreview: () => null,
              PremiumCardArtworkPreview: () => null,
              PremiumCheckout: () => null
            };
          if (id.startsWith("@/")) return load(id.slice(2) + ".ts");
          return require(id);
        }
      }
    );
    return loaded.exports;
  }
  return load;
}

test("Pro benefits and sales rules describe a shared Paris daily quota instead of rolling cooldowns", () => {
  const load = loader();
  const { benefits } = load("lib/pro/server.ts");
  const { PROPOSED_PLAN_RULES: rules, DECISION_PACK_RESET: reset } = load(
    "lib/premium/offer.ts"
  );
  assert.equal(reset.hour, 20);
  assert.equal(reset.timeZone, "Europe/Paris");
  for (const [plan, active, daily] of [
    ["basic", false, 1],
    ["pro", true, 2]
  ]) {
    const actual = benefits(active);
    assert.equal(actual.active, active);
    assert.equal(actual.decisionPacksPerDay, daily);
    assert.equal(rules[plan].decisionPacksPerDay, daily);
    assert.equal(actual.decisionPackResetHour, reset.hour);
    assert.equal(actual.decisionPackResetTimeZone, reset.timeZone);
    assert.equal(actual.regularPackMinutes, 5);
    assert.equal(rules[plan].regularPackMinutes, 5);
    assert.equal(actual.regularPackReserve, active ? 10 : 5);
    assert.equal(rules[plan].regularPackReserve, active ? 10 : 5);
    assert.equal(actual.maxActiveAuctions, active ? 10 : 5);
    assert.equal(actual.maxShowcaseCards, active ? 10 : 5);
    assert.equal("decisionPackHours" in actual, false);
    assert.equal("decisionPackHours" in rules[plan], false);
  }
});

test("the public Pro offer explains both daily packs, the shared reset and unchanged odds", () => {
  const { PremiumOffer } = loader()("components/premium-offer.tsx");
  const html = renderToStaticMarkup(
    React.createElement(PremiumOffer, { signedIn: false, billing: null })
  );
  assert.match(
    html,
    /<th scope="row">Decision Pack<\/th><td>1 per day<\/td><td>2 per day<\/td>/
  );
  assert.match(html, /Decision Packs reset together at the same time each day/);
  assert.doesNotMatch(html, /Paris time|8:00 PM/);
  assert.match(html, /Both Pro packs are available at once/);
  assert.match(html, /Unused packs do not carry over/);
  assert.match(html, /Rarity odds per card stay the same for everyone/);
  assert.doesNotMatch(html, /every 12 hours|every 24 hours|Every (?:12|24) h/i);
});
