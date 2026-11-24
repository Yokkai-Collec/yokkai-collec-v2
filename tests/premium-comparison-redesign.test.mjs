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
function renderOffer() {
  const loaded = { exports: {} };
  const rulesModule = { exports: {} };
  const compile = file =>
    ts.transpileModule(readFileSync(resolve(root, file), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    }).outputText;
  vm.runInNewContext(compile("lib/premium/offer.ts"), {
    module: rulesModule,
    exports: rulesModule.exports,
    require
  });
  const marker = text =>
    function PreviewMarker() {
      return React.createElement("div", null, text);
    };
  vm.runInNewContext(compile("components/premium-offer.tsx"), {
    module: loaded,
    exports: loaded.exports,
    require: id => {
      if (id === "next-intl") return intl;
      if (id === "@/lib/premium/offer") return rulesModule.exports;
      if (id === "@/components/premium-banner-preview")
        return { PremiumBannerPreview: marker("Animated banner preview") };
      if (id === "@/components/premium-card-artwork-preview")
        return {
          PremiumCardArtworkPreview: marker("Custom card artwork preview")
        };
      if (id === "@/components/premium-checkout")
        return { PremiumCheckout: marker("Existing membership checkout") };
      return require(id);
    }
  });
  return renderToStaticMarkup(
    React.createElement(loaded.exports.PremiumOffer, {
      signedIn: false,
      billing: null
    })
  );
}

test("Premium leads with more cards, then both visual previews before the comparison", () => {
  const html = renderOffer();
  assert.match(html, /<h1>More style\.<br\/><em>More cards\.<\/em><\/h1>/);
  assert.match(html, /Save twice as many Regular Packs/);
  assert.match(html, /<strong>2×<\/strong>/);
  assert.match(html, /<strong>2<\/strong><span>every day<\/span>/);
  assert.match(html, /Existing membership checkout/);
  assert.match(
    html,
    /Regular Pack reserve<\/th><td>5 packs<\/td><td>10 packs<\/td>/
  );
  assert.doesNotMatch(html, /twice as often|as often|Every 10 min/);
  assert.ok(html.indexOf("Animated banner preview") > html.indexOf("</h1>"));
  assert.ok(
    html.indexOf("Custom card artwork preview") >
      html.indexOf("Animated banner preview")
  );
  assert.ok(
    html.indexOf('id="plan-comparison"') >
      html.indexOf("Custom card artwork preview")
  );
  assert.match(html, /href="#plan-comparison"/);
  assert.doesNotMatch(
    html,
    /Everything in Pro|yk-pro-feature-grid|More possibilities/
  );
});

test("Basic and Pro compare real pack quotas and accessible inclusion marks", () => {
  const html = renderOffer();
  assert.match(
    html,
    /<caption class="sr-only">Basic and Pro membership comparison<\/caption>/
  );
  assert.match(html, /<tbody aria-label="More cards">/);
  assert.match(
    html,
    /<th scope="row">Regular Pack<\/th><td>Every 5 min<\/td><td>Every 5 min<\/td>/
  );
  assert.match(
    html,
    /<th scope="row">Decision Pack<\/th><td>1 per day<\/td><td>2 per day<\/td>/
  );
  assert.match(
    html,
    /<th scope="row">Active auctions<\/th><td>5<\/td><td>10<\/td>/
  );
  assert.match(
    html,
    /<th scope="row">Showcase characters<\/th><td>5<\/td><td>10<\/td>/
  );
  const cosmetics = html.match(
    /<tbody aria-label="Make it yours">([\s\S]*?)<\/tbody>/
  )?.[1];
  assert.ok(cosmetics);
  assert.equal((cosmetics.match(/>Not included<\/span>/g) || []).length, 7);
  assert.equal((cosmetics.match(/>Included<\/span>/g) || []).length, 7);
  assert.match(cosmetics, /Custom card artwork &amp; GIFs/);
  assert.match(cosmetics, /Custom &amp; animated banners/);
  assert.match(html, /Rarity odds per card stay the same for everyone/);
  assert.match(html, /Both Pro packs are available at once/);
  assert.match(html, /Unused packs do not carry over/);
  assert.doesNotMatch(
    html,
    /Your own site background|Additional achievements and Karas/
  );
});

test("pack highlights use official booster artwork and a quota-derived hourly pace", () => {
  const html = renderOffer();
  assert.match(html, /data-pack-kind="regular"/);
  assert.match(html, /chrome-regular-booster-v1\.png/);
  assert.match(html, /alt="Regular Pack"/);
  assert.match(html, /data-pack-kind="decision"/);
  assert.match(html, /chrome-decision-booster-v1\.png/);
  assert.match(html, /alt="Decision Pack"/);
  assert.match(html, /1 pack every 5 minutes for everyone\./);
  assert.match(
    html,
    /Up to <b>12 packs per hour<\/b> for everyone when opened regularly\./
  );
  const css = readFileSync(resolve(root, "styles/premium.css"), "utf8");
  assert.match(
    css,
    /\[data-pack-kind="decision"\] strong::after\s*\{\s*content: "×";/
  );
});

test("comparison keeps responsive plan columns and uses more than color to convey inclusion", () => {
  const css = readFileSync(resolve(root, "styles/premium.css"), "utf8");
  assert.match(css, /\.yk-pro-comparison table\s*\{[^}]*table-layout: fixed;/);
  assert.match(css, /\.yk-pro-comparison-frame\s*\{[^}]*border-radius: 16px;/);
  assert.match(css, /\.yk-pro-plan-availability\.is-included\s*\{/);
  const html = renderOffer();
  assert.match(html, /d="m5 12 4 4L19 6"/);
  assert.match(html, /d="M7 12h10"/);
  assert.match(html, /<span class="sr-only">Not included<\/span>/);
});

test("landing hero keeps a single subscription card in the left column and frameless packs on the right", () => {
  const html = renderOffer();
  const hero = html.match(
    /<section class="yk-premium-hero yk-pro-offer-hero">([\s\S]*?)<\/section>/
  )?.[1];
  assert.ok(hero);
  assert.match(hero, /class="yk-premium-hero-actions"/);
  assert.match(hero, /Existing membership checkout/);
  assert.match(hero, /href="#plan-comparison"/);
  assert.match(hero, /aria-label="Preview of Pro pack benefits"/);
  assert.match(hero, /data-pack-kind="regular"/);
  assert.match(hero, /data-pack-kind="decision"/);
  assert.equal((html.match(/Existing membership checkout/g) || []).length, 1);
  assert.ok(
    hero.indexOf("Existing membership checkout") <
      hero.indexOf('class="yk-pro-hero-showcase"')
  );
  assert.doesNotMatch(html, /yk-pro-showcase-chrome|yk-pro-membership-section/);
  const css = readFileSync(resolve(root, "styles/premium.css"), "utf8");
  for (const selector of [
    /\.yk-pro-hero-showcase\s*\{([^}]+)\}/,
    /\.yk-pro-card-gains > div\s*\{([^}]+)\}/
  ]) {
    const frame = css.match(selector)?.[1];
    assert.ok(frame);
    assert.match(frame, /border:\s*0;/);
    assert.match(frame, /background:\s*transparent;/);
  }
  const page = css.match(/\.yk-premium-page\s*\{([^}]+)\}/)?.[1];
  assert.ok(page);
  assert.match(
    page,
    /radial-gradient\(ellipse at 73% 19%, #20283950, transparent 42%\), #080b10;/
  );
  assert.doesNotMatch(page, /repeating-linear-gradient|background-size/);
});
