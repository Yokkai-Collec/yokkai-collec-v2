import { englishMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const css =
  read("styles/boosters-showcase.css") + read("styles/ambient-glow.css");

test("desktop pack sizing adapts to viewport height without hiding content or locking scrolling", () => {
  const root = postcss.parse(css);
  const desktop = root.nodes.find(
    node =>
      node.type === "atrule" &&
      node.params === "(min-width: 701px) and (max-height: 1200px)"
  );
  assert.ok(
    desktop,
    "compact layout applies only to shorter desktop viewports"
  );
  const declarations = [];
  desktop.walkDecls(declaration => declarations.push(declaration));
  assert.ok(
    declarations.some(
      ({ prop, value }) => prop === "height" && value.includes("100svh")
    )
  );
  assert.ok(
    declarations.some(
      ({ prop, value }) => prop === "min-height" && value === "44px"
    ),
    "opening buttons stay at least 44px tall"
  );
  for (const { prop, value } of declarations) {
    assert.notEqual(prop, "zoom");
    assert.ok(!(prop === "transform" && value.includes("scale")));
    assert.ok(
      !["hidden", "clip"].includes(value),
      "no clipping to fake fitting"
    );
    assert.ok(
      !(prop === "display" && value === "none"),
      "no hidden details or buttons"
    );
    assert.ok(
      !(prop === "height" && value === "100svh"),
      "no fixed-height page that traps overflow"
    );
  }
  desktop.walkRules(rule => {
    assert.doesNotMatch(
      rule.selector,
      /yk-reveal|yk-opening|yk-card|^body|^html/
    );
  });
});

test("browser fixture includes the same pack header, main and footer as the real page", () => {
  const page = read("app/design-system/boosters-preview/page.tsx");
  const game = read("components/game.tsx");
  for (const marker of [
    "yk-game-main",
    "yk-pack-page-heading",
    "<Topbar",
    "<SiteFooter"
  ]) {
    assert.ok(page.includes(marker));
    assert.ok(game.includes(marker));
  }
  for (const [key, expected] of [
    ["yourNextGreatPull", "Your next great pull."],
    [
      "yourCollectionIsSavedToYourAccount",
      "Your collection is saved to your account"
    ]
  ]) {
    const translatedText = `tg("${key}")`;
    assert.ok(page.includes(translatedText));
    assert.ok(game.includes(translatedText));
    assert.equal(englishMessages.gameUi[key], expected);
  }
  assert.match(page, /yk-boosters-page/);
  assert.match(page, /showPackChoices/);
  assert.match(page, /min-h-dvh/);
  assert.match(page, /flex-1/);
});

test("pack lighting stays decorative and buttons follow a reserved info line", () => {
  const root = postcss.parse(css);
  const declaration = (selector, prop) =>
    root.nodes
      .find(node => node.selector === selector)
      ?.nodes.find(node => node.prop === prop)?.value;
  const boosters =
    read("components/boosters.tsx") + read("components/ambient-glow.tsx");
  for (const name of ["ambient", "aura", "floor"]) {
    assert.ok(
      boosters.includes(`className="yk-pack-${name}" aria-hidden="true"`)
    );
    assert.equal(declaration(`.yk-pack-${name}`, "pointer-events"), "none");
    assert.match(
      declaration(`.yk-pack-${name}`, "background"),
      /radial-gradient/
    );
    assert.match(declaration(`.yk-pack-${name}`, "filter"), /blur/);
  }
  assert.equal(
    declaration(
      ".yk-pack-grid .yk-pack-panel .yk-pack-body > .yk-button",
      "margin-top"
    ),
    "0"
  );
  assert.equal(
    declaration(".yk-pack-grid .yk-pack-panel .yk-pack-status", "min-height"),
    "72px"
  );
  assert.match(
    declaration(".yk-decision-panel .yk-pack-floor", "background"),
    /var\(--color-accent-gold\)/
  );
});

test("a retry alert in either desktop panel keeps both actions bottom-aligned", () => {
  const root = postcss.parse(css);
  const desktop = root.nodes.find(
    node => node.type === "atrule" && node.params === "(min-width: 701px)"
  );
  assert.ok(desktop);
  const selector = '.yk-pack-grid:has(.yk-pack-body > [role="alert"])';
  const value = (suffix, prop) =>
    desktop.nodes
      .find(node => node.selector === `${selector} ${suffix}`)
      ?.nodes.find(node => node.prop === prop)?.value;
  assert.equal(value(".yk-pack-body", "flex"), "1");
  assert.equal(value(".yk-pack-body > .yk-button", "margin-top"), "auto");
});

test("large tall screens expand the Packs selection without changing laptop breakpoints", () => {
  const root = postcss.parse(css);
  const large = root.nodes.find(
    node =>
      node.type === "atrule" &&
      node.params === "(min-width: 2000px) and (min-height: 1201px)"
  );
  assert.ok(large);
  const value = (selector, prop) =>
    large.nodes
      .find(node => node.selector === selector)
      ?.nodes.find(node => node.prop === prop)?.value;
  assert.equal(
    value(".yk-game-main:has(.yk-pack-grid)", "max-width"),
    "min(80vw, 2400px)"
  );
  assert.equal(value(".yk-pack-grid", "max-width"), "min(70vw, 2000px)");
  assert.match(
    value(".yk-pack-grid .yk-pack-panel .yk-pack-art-stage", "height"),
    /clamp\([^)]+52dvh/
  );
  large.walkRules(rule =>
    assert.doesNotMatch(rule.selector, /footer|topbar|yk-reveal|yk-opening/)
  );
  large.walkDecls(({ prop }) =>
    assert.ok(!["zoom", "transform", "overflow"].includes(prop))
  );
});
