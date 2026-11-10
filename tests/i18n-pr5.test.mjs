import { fixture } from "./helpers/pr5-render.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, createFormatter } from "next-intl";
import { gameMessages } from "./helpers/i18n.mjs";
const require = createRequire(import.meta.url);
const read = p => readFileSync(p, "utf8");
const catalogues = Object.fromEntries(
  ["en", "fr"].map(l => [l, JSON.parse(read(`messages/${l}.json`))])
);
const hash = s => createHash("sha256").update(s).digest("hex");
const golden = {
  parts: {
    "app/share/[id]/page.tsx":
      "1b834f77ba1890e2c4d14634fbfda356a418f7626ec64a6b2aa09a39af5cfe20",
    "components/premium-card-artwork-preview.tsx":
      "2749be2c5fa89936fb05eec6d9dfc38c9194f2efc0a9c0f6dccdd3f56b0ebe39",
    "components/premium-profile-embed.tsx":
      "52392e6cb5da014b9151cf9b4aa138b9fb71c56784b5325c248f3d5ada377576",
    "lib/data/achievements.ts":
      "0759b69a7f97835ad702753b079e7e9f6eb1b3e69d65d3ac93af45ca78d0c458",
    "lib/data/card-shares.ts":
      "41bd4ee0f80941ae2bf5de9109fd8f343e21f40e1182fe3773527031b2a7c313"
  },
  files: {
    "lib/server/card-share-image.tsx":
      "00eceb295bf107bb48509dfdbc2fd4447fc27e86f1910a8b4dd3a149f8948774",
    "app/(auth)/signup/opengraph-image.tsx":
      "9799f4153c1026d93cb3a81996ad08e1f1a49b8b71c2eda7e35c99eb0db4fe72",
    "app/(auth)/signup/twitter-image.tsx":
      "9799f4153c1026d93cb3a81996ad08e1f1a49b8b71c2eda7e35c99eb0db4fe72",
    "lib/server/card-share-image-route.ts":
      "8ab24245ef8ee751bbca1d7084c6b2b7bdeeea0df4a3b2dafe931a01a48699a4",
    "lib/server/image-cache.ts":
      "52e6da6d4324c4f8dfd09d53591e9031f76450be5d4455d029a91d3fde125fde",
    "app/opengraph-image.tsx":
      "060c07710c2c99d4d24ec51e0c29ff78610a05ebf6f47fb9ab14eee35b383786",
    "app/twitter-image.tsx":
      "1dd39b5f5dce640211474e59e48f0b4b1042f119c7232747d53e587b1bfa7067",
    "app/sitemap.ts":
      "2c92b755b2f98991ed7edfa0c4eae877a06410885a4c8bbfccaab0eb516e8929",
    "app/robots.ts":
      "a6fa476a50d5d07e5e136209e4b1a3d5c6cb44d36f8dd66c67109d2bb3b5fe4c",
    "lib/legal/privacy.ts":
      "aa24deca97101de55bf166def5197f8c131b8df810f6434ce59f3c2d721b08dc",
    "lib/premium/profile-example.json":
      "6b95d6f441dc84a7fd08b9bca1a667899979af1a4da241f47ff5b071124eda82"
  },
  englishHtml: {
    terms: "915fb129a2ec7855185124d8c75ac141d66bfa9e88f387364504742b6ae9ebb9",
    privacy: "1d1c326d87dde2527feb6870a1e81c1c51ed509e81964fe17a8e941acbe93e10", // Includes the one-time community gifts and their retention; exact HTML assertion retained.
    rules: "984e1a56cd9b0dbd51aeb7b8dc1b86943712230bebe49d4d43afe0115f1951f7",
    info: "3a7002eef8f2ed6df50e903ee49da122249f279aef77fc2d6ffcf199e879cc22",
    rarities: "90565ea6e0575e80508ab3eb11e26b056cef65d60659e906cf4f4de42c348b9d"
  }
};
function protectedParts(file, source) {
  const ast = ts.createSourceFile(
      file,
      source,
      99,
      true,
      file.endsWith("tsx") ? 4 : 3
    ),
    out = [],
    printer = ts.createPrinter({ removeComments: true });
  function visit(n) {
    if (
      ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) &&
        ["YokaiCard", "CardShell"].includes(
          (n.tagName ?? n.openingElement.tagName).getText(ast)
        )) ||
      (ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "rpc")
    )
      out.push(printer.printNode(ts.EmitHint.Unspecified, n, ast));
    ts.forEachChild(n, visit);
  }
  visit(ast);
  return hash(out.join("\n"));
}
test("PR5 preserves complete card JSX, RPC calls, images and reset/price rules", () => {
  for (const [file, expected] of Object.entries(golden.parts))
    assert.equal(protectedParts(file, read(file)), expected, file);
  for (const [file, expected] of Object.entries(golden.files))
    assert.equal(hash(readFileSync(file)), expected, file);
  const offer = read("lib/premium/offer.ts");
  assert.match(offer, /hour: 20/);
  assert.match(offer, /timeZone: "Europe\/Paris"/);
  const server = read("lib/billing/server.ts");
  assert.match(server, /locale: "en" \| "fr" = "en"/);
  assert.match(server, /mode: "subscription",\s+locale,/);
});
test("Auth email templates contain EN then FR and exactly one unchanged link and token", () => {
  for (const name of ["confirmation", "recovery"]) {
    const html = read(`public/auth-emails/${name}.html`);
    assert.equal((html.match(/<a\b/g) || []).length, 1);
    assert.equal((html.match(/\.TokenHash/g) || []).length, 1);
    assert.equal((html.match(/\.SiteURL/g) || []).length, 1);
    assert.ok(html.indexOf('lang="en"') < html.indexOf('lang="fr"'));
    assert.ok(
      html.includes(
        `href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${name === "confirmation" ? "signup" : "recovery"}"`
      )
    );
  }
});
test("Share metadata uses visitor locale with invariant URLs, IDs and images", async () => {
  const { page } = fixture("en");
  const en = await page("app/share/[id]/page.tsx").generateMetadata({
    params: Promise.resolve({ id: "a".repeat(32) })
  });
  const fr = await fixture("fr")
    .page("app/share/[id]/page.tsx")
    .generateMetadata({ params: Promise.resolve({ id: "a".repeat(32) }) });
  assert.equal(en.openGraph.locale, "en_US");
  assert.equal(fr.openGraph.locale, "fr_FR");
  for (const k of ["alternates", "robots"])
    assert.deepEqual(
      JSON.parse(JSON.stringify(en[k])),
      JSON.parse(JSON.stringify(fr[k]))
    );
  assert.equal(en.openGraph.url, fr.openGraph.url);
  assert.deepEqual(
    JSON.parse(JSON.stringify(en.openGraph.images)),
    JSON.parse(JSON.stringify(fr.openGraph.images))
  );
  assert.match(en.description, /SATORU GOJO/);
  assert.match(fr.description, /SATORU GOJO/);
  assert.match(fr.description, /Joueur \{FR\}/);
  assert.match(read("app/share/[id]/page.tsx"), /dynamic = "force-dynamic"/);
  assert.match(read("proxy.ts"), /private, no-store/);
});
test("PR5 complete ICU messages preserve data and cover plural/select branches", () => {
  for (const locale of ["en", "fr"]) {
    const t = createTranslator({ locale, messages: catalogues[locale] });
    for (const kind of [
      "regular_packs_opened",
      "decision_packs_completed",
      "unique_cards_collected",
      "first_lr_card",
      "shiny_cards_collected",
      "auctions_won",
      "trades_completed",
      "ssr_evolved_to_lr",
      "cards_collected_category_percent",
      "future"
    ])
      for (const count of [0, 1, 2, 1234])
        assert.ok(
          t("achievementUi.progressText", {
            current: "1",
            target: "1,234",
            kind,
            count,
            label: "Manga",
            hasLabel: "yes"
          })
        );
    for (const action of ["pause", "play"])
      assert.match(
        t("premiumUi.profilePlayback", { action, name: "Joueur {FR}" }),
        /Joueur \{FR\}/
      );
    assert.match(
      t("shareUi.deleteBody", { name: "SATORU GOJO" }),
      /SATORU GOJO/
    );
    assert.equal(
      gameMessages.gameErrorKey(
        new Error("The image is unavailable. Please try again in a moment.")
      ),
      "shareUi.imageUnavailable"
    );
    for (const key of [
      "locked",
      "alreadyClaimed",
      "authRequired",
      "unavailable"
    ])
      assert.equal(
        gameMessages.gameErrorKey({
          cause: { i18nKey: `achievementUi.${key}` }
        }),
        `achievementUi.${key}`
      );
  }
});
// Isolated real components: no network, auth, billing or database mutations.

test("legal pages retain source English content and render French without unresolved messages", async () => {
  for (const route of ["terms", "privacy", "rules", "info", "rarities"]) {
    const en = await fixture("en").render(`app/${route}/page.tsx`);
    assert.equal(hash(en), golden.englishHtml[route], route);
    const fr = await fixture("fr").render(`app/${route}/page.tsx`);
    assert.ok(fr.includes("<h1"));
    assert.doesNotMatch(fr, /legalUi\.|MISSING_MESSAGE|INVALID_MESSAGE/);
    if (route === "rarities") {
      assert.match(en, /Consuming any LR Shiny creates LR INFINITY Shiny/);
      assert.match(
        fr,
        /Consommer au moins une LR Shiny crée une LR INFINITY Shiny/
      );
      assert.doesNotMatch(en, /LR Shiny and already evolved cards cannot/);
    }
  }
});

test("Stripe adds only its locale argument to the existing billing service", () => {
  const restored = read("lib/billing/server.ts")
    .replace('locale: "en" | "fr" = "en"', "")
    .replace(/checkout\(userId: string,\s*\)/, "checkout(userId: string)")
    .replace(/\n\s+locale,/, "");
  assert.equal(
    hash(restored.replaceAll("\r\n", "\n")),
    "33edf4feb3f05be7663163f408a6af0250b9e9fc93555b2004d7c46da42cd073"
  );
});
test("Checkout derives locale on the server after Auth, input and quota validation", async () => {
  for (const locale of ["en", "fr", "unsupported"]) {
    const calls = [],
      mod = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(read("app/api/billing/checkout/route.ts"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }).outputText,
      {
        module: mod,
        exports: mod.exports,
        require(id) {
          if (id === "next-intl/server")
            return {
              getLocale: async () => {
                calls.push("locale");
                return locale;
              }
            };
          if (id === "@/lib/billing/http")
            return {
              billingUser: async () => {
                calls.push("auth");
                return { id: "player" };
              },
              emptyBillingInput: async () => {
                calls.push("input");
              },
              billingReply: value => value,
              billingFailure: e => {
                throw e;
              }
            };
          if (id === "@/lib/billing/rate-limit")
            return {
              consumeBillingRequest: async () => {
                calls.push("quota");
              }
            };
          if (id === "@/lib/billing/server")
            return {
              configuredBillingService: () => ({
                checkout: async (id, language) => {
                  calls.push([id, language]);
                  return "https://checkout.stripe.com/example";
                }
              })
            };
          throw Error(id);
        }
      }
    );
    const result = await mod.exports.POST({});
    assert.equal(result.url, "https://checkout.stripe.com/example");
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
      "auth",
      "input",
      "quota",
      "locale",
      ["player", locale === "fr" ? "fr" : "en"]
    ]);
  }
});

test("Both share dialogs render their French notices without a provider or data mutation", () => {
  const f = fixture(
    "fr",
    file =>
      read(file) +
      (file === "components/card-sharing.tsx"
        ? "\nexport {ShareList, ShareSheet};"
        : "")
  );
  const dialogs = f.page("components/card-sharing.tsx");
  for (const [component, props] of [
    [dialogs.ShareList, {}],
    [dialogs.ShareSheet, { instanceId: "unchanged", name: "SATORU GOJO" }]
  ]) {
    const html = renderToStaticMarkup(React.createElement(component, props));
    assert.match(html, /Les aperçus déjà publiés/);
    assert.doesNotMatch(
      html,
      /Previews already|Show my username|Loading…|shareUi\./
    );
  }
});

test("PR5 static catalogue calls resolve in both locales in their lexical scope", () => {
  for (const file of [
    "app/achievements/page.tsx",
    "app/info/page.tsx",
    "app/premium/page.tsx",
    "app/privacy/page.tsx",
    "app/rarities/page.tsx",
    "app/rules/page.tsx",
    "app/share/[id]/page.tsx",
    "app/share/[id]/not-found.tsx",
    "app/terms/page.tsx",
    "components/achievements.tsx",
    "components/auth-decision-preview.tsx",
    "components/card-sharing.tsx",
    "components/premium-offer.tsx",
    "components/premium-checkout.tsx",
    "components/premium-banner-preview.tsx",
    "components/premium-card-artwork-preview.tsx",
    "components/premium-profile-embed.tsx",
    "components/public-info-page.tsx",
    "components/lr-card-reveal.tsx"
  ]) {
    const ast = ts.createSourceFile(file, read(file), 99, true, 4);
    function visit(node, bindings = new Map()) {
      if (ts.isBlock(node) || ts.isSourceFile(node)) {
        bindings = new Map(bindings);
        for (const statement of node.statements ?? []) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const d of statement.declarationList.declarations) {
            let init = d.initializer;
            if (init && ts.isAwaitExpression(init)) init = init.expression;
            if (
              init &&
              ts.isCallExpression(init) &&
              ["useTranslations", "getTranslations"].includes(
                init.expression.getText(ast)
              )
            ) {
              const n = init.arguments[0];
              bindings.set(
                d.name.getText(ast),
                n && ts.isStringLiteral(n) ? n.text : ""
              );
            }
          }
        }
      }
      if (ts.isCallExpression(node)) {
        const callee =
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "rich"
            ? node.expression.expression
            : node.expression;
        const namespace = bindings.get(callee.getText(ast)),
          key = node.arguments[0];
        if (namespace !== undefined && key && ts.isStringLiteral(key))
          for (const locale of ["en", "fr"])
            assert.equal(
              typeof (namespace ? namespace + "." + key.text : key.text)
                .split(".")
                .reduce((o, k) => o?.[k], catalogues[locale]),
              "string",
              locale + ":" + file + ":" + key.text
            );
      }
      ts.forEachChild(node, n => visit(n, bindings));
    }
    visit(ast);
  }
});

test("Premium English HTML only changes the approved fixed-time footnote", async () => {
  assert.equal(
    hash(await fixture("en").render("app/premium/page.tsx")),
    "77251a8df31a675bf5b5a14949822a27767bbf77f7bb1e7f14aa773447cae19c"
  );
});
test("Achievement notifications reuse the SQL-ID catalogue and preserve unknown names", () => {
  const mod = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(read("lib/notification-item.ts"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    { module: mod, exports: mod.exports, require: () => ({}) }
  );
  const notification = {
    id: "n",
    type: "achievement_completed",
    referenceId: "premier-rituel",
    achievementName: "First Ritual",
    createdAt: "2026-10-30T12:00:00Z",
    readAt: null
  };
  const topbar = createTranslator({
      locale: "fr",
      messages: catalogues.fr,
      namespace: "topbar"
    }),
    achievements = createTranslator({
      locale: "fr",
      messages: catalogues.fr,
      namespace: "achievementUi"
    });
  assert.match(
    mod.exports.notificationItem(
      notification,
      topbar,
      "same instant",
      achievements
    ).text,
    /Premier rituel/
  );
  assert.match(
    mod.exports.notificationItem(
      {
        ...notification,
        referenceId: "future",
        achievementName: "Future title"
      },
      topbar,
      "same instant",
      achievements
    ).text,
    /Future title/
  );
  assert.match(
    mod.exports.notificationItem(notification, topbar, "same instant").text,
    /First Ritual/
  );
});
