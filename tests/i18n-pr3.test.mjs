import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import ts from "typescript";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { gameMessages } from "./helpers/i18n.mjs";

const read = file => readFileSync(file, "utf8");
const messages = Object.fromEntries(
  ["en", "fr"].map(locale => [
    locale,
    JSON.parse(read(`messages/${locale}.json`))
  ])
);
const files = [
  "profile",
  "profile-completion",
  "profile-private",
  "friend-message-button",
  "auction-message-text",
  "profile-wall",
  "profile-sales",
  "profile-license-picker",
  "profile-style-fields",
  "banner-crop",
  "showcase-color-picker",
  "settings",
  "account-deletion-form",
  "data-export-form",
  "subscription-settings",
  "referral-panel",
  "referral-details",
  "wall-post-interactions",
  "player-moderation",
  "emoji-reaction-picker",
  "gif-picker",
  "friends",
  "community-views",
  "decorative-badge"
].map(name => `components/${name}.tsx`);
const valueAt = (object, key) =>
  key.split(".").reduce((value, part) => value?.[part], object);

test("profile/settings static translations resolve in both catalogues within their lexical namespace", () => {
  for (const file of files) {
    const ast = ts.createSourceFile(
      file,
      read(file),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    function visit(node, bindings = new Map()) {
      if (ts.isFunctionDeclaration(node) && node.body) {
        bindings = new Map(bindings);
        for (const statement of node.body.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            const init = declaration.initializer;
            if (
              init &&
              ts.isCallExpression(init) &&
              ["useTranslations", "getTranslations"].includes(
                init.expression.getText(ast)
              )
            ) {
              bindings.set(
                declaration.name.getText(ast),
                init.arguments[0]?.text ?? ""
              );
            }
          }
        }
      }
      if (ts.isCallExpression(node)) {
        const name = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.expression.getText(ast)
          : node.expression.getText(ast);
        if (bindings.has(name) && ts.isStringLiteral(node.arguments[0])) {
          const prefix = bindings.get(name);
          const key = (prefix ? `${prefix}.` : "") + node.arguments[0].text;
          for (const locale of ["en", "fr"])
            assert.equal(
              typeof valueAt(messages[locale], key),
              "string",
              `${locale}:${file}:${key}`
            );
        }
      }
      ts.forEachChild(node, child => visit(child, bindings));
    }
    visit(ast);
  }
});

test("profile error descriptors retain stable keys and unknown/provider errors use a safe translated fallback", () => {
  const { gameErrorKey } = gameMessages;
  const fallback = "profileUi.profileUnavailable";
  assert.equal(
    gameErrorKey("BIO_TOO_LONG", fallback),
    "profileUi.bioLengthLimit"
  );
  assert.equal(
    gameErrorKey("This profile couldn't be found.", fallback),
    "profileUi.thisProfileCouldntBeFound"
  );
  assert.equal(
    gameErrorKey(
      { cause: { i18nKey: "profileUi.thisProfileCouldntBeFound" } },
      fallback
    ),
    "profileUi.thisProfileCouldntBeFound"
  );
  for (const error of [
    "provider secret detail",
    "__proto__",
    { message: "internal SQL error" },
    { cause: { i18nKey: "untrusted.namespace" } }
  ]) {
    assert.equal(gameErrorKey(error, fallback), fallback);
  }
  assert.equal(valueAt(messages.en, fallback), "Profile unavailable.");
  assert.equal(valueAt(messages.fr, fallback), "Profil indisponible.");
});

test("profile counts use complete ICU phrases and keep player/card data verbatim", () => {
  const en = createTranslator({
    locale: "en",
    messages: messages.en,
    namespace: "profileUi"
  });
  const fr = createTranslator({
    locale: "fr",
    messages: messages.fr,
    namespace: "profileUi"
  });
  assert.equal(
    en("viewCatalogCard", { name: "SATORU GOJO" }),
    "View SATORU GOJO in the catalog"
  );
  assert.equal(
    fr("viewCatalogCard", { name: "SATORU GOJO" }),
    "Voir SATORU GOJO dans le catalogue"
  );
  assert.equal(en("wishlistFor", { name: "Toba" }), "Toba’s wishlist");
  assert.equal(
    fr("wishlistFor", { name: "Toba" }),
    "Liste de souhaits de Toba"
  );
  assert.equal(en("bidCount", { count: 1 }), "1 bid");
  assert.equal(en("bidCount", { count: 2 }), "2 bids");
  assert.equal(fr("bidCount", { count: 2 }), "2 offres");
  assert.equal(
    en("viewCollectionCount", { known: "yes", count: 1, name: "Alice" }),
    "View 1 card from Alice"
  );
  assert.equal(
    en("viewCollectionCount", { known: "yes", count: 2, name: "Alice" }),
    "View 2 cards from Alice"
  );
  assert.equal(
    en("viewCollectionCount", { known: "no", count: 0, name: "Alice" }),
    "View — cards from Alice"
  );
  assert.equal(
    fr("viewCollectionCount", { known: "no", count: 0, name: "Alice" }),
    "Voir — cartes de Alice"
  );
  for (const [namespace, key, expected] of [
    ["collectionUi", "rarity", "Rarity"],
    ["collectionUi", "category", "Category"],
    ["collectionUi", "resetFilters", "Reset filters"],
    ["profileUi", "viewCollection", "View collection →"],
    ["profileUi", "viewWishlist", "View wishlist →"],
    ["profileUi", "private", "Private"],
    ["profileUi", "poweredByGiphy", "Powered by GIPHY"],
    ["profileUi", "loadMore", "Load more"],
    ["profileUi", "sendThisGif", "Send this GIF"],
    ["profileUi", "collectorLabel", "COLLECTOR"]
  ])
    assert.equal(messages.en[namespace][key], expected);
});

// Golden signatures are generated from origin/master before PR 3. They cover
// complete card JSX and every data RPC call, rather than only their tag names.
const golden = {
  "components/profile.tsx":
    "c8dae929d6c31def8428224366fb2a676131fc559bff049871b185a8f44ba89a",
  "components/profile-sales.tsx":
    "d4802b94528dcf8295ab4c9b894711105fdf5244371df3ca7617e643fbb1a406",
  "components/community-views.tsx":
    "41141cd0932aa96e1d88ce7731a13b51ab4ee62d6dc6eefe77c5923fc61658a4",
  "components/profile-style-fields.tsx":
    "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "lib/data/profile.ts":
    "1e0334218636422cdd53bc6ac6cb4df06c1efc9bdf4fb53ea59c7efc1008507a",
  "lib/data/profile-wall.ts":
    "66f9cd5f7123ceb7b9c1921dcc92fe2b51d4ec2fba80ca0f3adf661aa9222acb",
  "lib/data/profile-market.ts":
    "4ff31b2d569b92334e4289a8e430ff8e7419538a96db921496251ad102f469ee"
};
test("card JSX, styles, animations and RPC arguments remain byte-equivalent after parsing", () => {
  for (const [file, expected] of Object.entries(golden)) {
    const source = read(file);
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const nodes = [];
    function visit(node) {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) &&
        ["YokaiCard", "CardShell"].includes(
          (node.tagName ?? node.openingElement.tagName).getText(ast)
        )
      )
        nodes.push(node.getText(ast).replace(/\s/g, ""));
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "rpc"
      )
        nodes.push(node.getText(ast).replace(/\s/g, ""));
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.equal(
      createHash("sha256").update(JSON.stringify(nodes)).digest("hex"),
      expected,
      file
    );
  }
});

test("profile/settings transpiled-source gzip estimate stays below 5.25 KiB excluding catalogues", () => {
  const sourceFiles = [
    "components/account-deletion-form.tsx",
    "components/banner-crop.tsx",
    "components/community-views.tsx",
    "components/data-export-form.tsx",
    "components/decorative-badge.tsx",
    "components/emoji-reaction-picker.tsx",
    "components/friends.tsx",
    "components/gif-picker.tsx",
    "components/player-moderation.tsx",
    "components/profile-license-picker.tsx",
    "components/profile-sales.tsx",
    "components/profile-style-fields.tsx",
    "components/profile-wall.tsx",
    "components/profile.tsx",
    "components/referral-details.tsx",
    "components/referral-panel.tsx",
    "components/settings.tsx",
    "components/showcase-color-picker.tsx",
    "components/subscription-settings.tsx",
    "components/wall-post-interactions.tsx",
    "i18n/game-messages.ts",
    "lib/data/profile-market.ts",
    "lib/data/profile-wall.ts",
    "lib/data/profile.ts"
  ];
  const output = sourceFiles
    .map(
      file =>
        ts.transpileModule(read(file), {
          compilerOptions: {
            target: ts.ScriptTarget.Latest,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            removeComments: true
          }
        }).outputText
    )
    .join("\n");
  assert.ok(gzipSync(output).length - 65549 < 5.25 * 1024);
});
