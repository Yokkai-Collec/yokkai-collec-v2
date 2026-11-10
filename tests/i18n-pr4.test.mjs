import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createTranslator } from "next-intl";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { gameMessages, socialMessages } from "./helpers/i18n.mjs";

const catalogues = Object.fromEntries(
  ["en", "fr"].map(locale => [
    locale,
    JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
  ])
);
const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("lib/notification-item.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText,
  { exports, require: () => ({}) }
);

test("all notification codes resolve in EN/FR without translating player or card data", () => {
  const types = [
    "wall_post_reply",
    "private_message_received",
    "friend_request",
    "outbid",
    "trade_offer_received",
    "trade_counter_offer_received",
    "trade_offer_accepted",
    "trade_offer_declined",
    "trade_offer_cancelled",
    "auction_won",
    "auction_sold",
    "auction_chat_mention",
    "achievement_completed",
    "wishlist_card_on_auction",
    "future_type"
  ];
  const input = {
    id: "note",
    referenceId: "ref",
    createdAt: "2026-10-28T10:00:00Z",
    readAt: null,
    actorPseudo: "Joueur {FR}",
    cardName: "SATORU GOJO",
    karaAmount: 1234,
    achievementName: "Collector"
  };
  for (const locale of ["en", "fr"]) {
    const t = createTranslator({
      locale,
      messages: catalogues[locale],
      namespace: "topbar"
    });
    for (const type of types) {
      const item = exports.notificationItem(
        { ...input, type },
        t,
        "historical date"
      );
      assert.equal(item.time, "historical date");
      assert.equal(item.id, input.id);
      assert.equal(item.read, false);
      assert.ok(item.title && item.text);
      assert.ok(!item.text.includes("notifications."));
      if (
        type.startsWith("trade_") ||
        [
          "wall_post_reply",
          "private_message_received",
          "friend_request",
          "auction_chat_mention"
        ].includes(type)
      )
        assert.ok(item.text.includes(input.actorPseudo));
      if (
        [
          "outbid",
          "auction_won",
          "auction_sold",
          "auction_chat_mention",
          "wishlist_card_on_auction"
        ].includes(type)
      )
        assert.ok(item.text.includes(input.cardName));
      const missing = exports.notificationItem(
        {
          ...input,
          type,
          actorPseudo: null,
          cardName: null,
          achievementName: null
        },
        t
      );
      assert.ok(!missing.text.includes("null"));
    }
    assert.equal(
      exports.notificationItem({ ...input, type: "future_type" }, t).href,
      undefined
    );
  }
  assert.deepEqual(
    Object.keys(catalogues.en.topbar).filter(key =>
      key.startsWith("notification")
    ),
    Object.keys(catalogues.fr.topbar).filter(key =>
      key.startsWith("notification")
    )
  );
});

test("English notification output and destinations match the production baseline, including missing-data fallbacks", () => {
  const baseline = JSON.parse(
    readFileSync(
      new URL("./fixtures/i18n-pr4-notifications.json", import.meta.url),
      "utf8"
    )
  );
  const t = createTranslator({
    locale: "en",
    messages: catalogues.en,
    namespace: "topbar"
  });
  for (const { input, expected } of baseline.cases) {
    const actual = exports.notificationItem(input, t, "fixed");
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, input.type);
  }
});

const files = [
  "app/market/page.tsx",
  "app/market/[id]/page.tsx",
  "app/trades/page.tsx",
  "app/leaderboard/page.tsx",
  "app/social/page.tsx",
  "app/social/friends/page.tsx",
  "app/friends/page.tsx",
  "app/social/everyone/page.tsx",
  "app/social/leaderboard/page.tsx",
  "components/topbar.tsx",
  "components/leaderboards.tsx",
  "components/leaderboard-topbar.tsx",
  "components/collection-leaderboard.tsx",
  "components/referral-leaderboard.tsx",
  "components/community-views.tsx",
  "components/friends.tsx",
  "components/trades.tsx",
  "components/conversation-trade.tsx",
  "components/private-messages.tsx",
  "components/social-feed.tsx",
  "components/social-tabs.tsx"
];
const read = file => readFileSync(file, "utf8");
const messages = catalogues;
const valueAt = (object, key) =>
  key.split(".").reduce((value, part) => value?.[part], object);

test("social errors use stable descriptors and never match translated error prose", () => {
  const gameErrorKey = socialMessages.socialErrorKey;
  for (const [code, key] of [
    ["TRADE_OFFER_RATE_LIMITED", "socialUi.tradeRateLimit"],
    ["TRADE_PENDING_LIMIT", "socialUi.tradePendingLimit"],
    ["TRADE_PAIR_LIMIT", "socialUi.tradePairLimit"]
  ]) {
    assert.equal(gameErrorKey(code), key);
    assert.equal(
      gameErrorKey({ message: "opaque message", cause: { i18nKey: key } }),
      key
    );
    for (const locale of ["en", "fr"])
      assert.equal(typeof valueAt(catalogues[locale], key), "string");
  }
  const fallback = "socialUi.couldnTLoadTrades";
  for (const value of [
    "provider secret",
    catalogues.fr.socialUi.tradePendingLimit,
    { cause: { i18nKey: "untrusted.key" } }
  ])
    assert.equal(gameErrorKey(value, fallback), fallback);
});

test("stored DM and trade error keys survive a rerender and a locale change", () => {
  const gameErrorKey = socialMessages.socialErrorKey;
  for (const [message, key] of [
    [
      "Couldn't load messages. Please try again.",
      "privateMessages.errors.load"
    ],
    [
      "Couldn't send the message. Your draft has been kept.",
      "privateMessages.errors.send"
    ],
    ["This offer is no longer available.", "socialTrades.unavailableOffer"],
    [
      "The trade was updated, but the latest offers could not be refreshed. Reopen the trade to retry.",
      "socialTrades.refreshFailed"
    ]
  ]) {
    const stored = gameErrorKey(message);
    assert.equal(stored, key);
    assert.equal(gameErrorKey(stored), key);
    if (key.startsWith("privateMessages."))
      assert.equal(gameMessages.gameErrorKey(stored), key);
    for (const locale of ["en", "fr"]) {
      const t = createTranslator({
        locale,
        messages: catalogues[locale],
        onError: error => {
          throw error;
        }
      });
      assert.equal(t(gameErrorKey(stored)), t(key));
    }
  }
});

test("social ICU counts and interpolated player names resolve in both languages", () => {
  for (const locale of ["en", "fr"]) {
    const t = createTranslator({
      locale,
      messages: catalogues[locale],
      onError: error => {
        throw error;
      }
    });
    for (const count of [0, 1, 2, 1234]) {
      for (const key of [
        "selectedCopies",
        "specificCopies",
        "selectionRemoved",
        "originalRemoved",
        "countedReferrals",
        "variants",
        "copies",
        "duplicatePoints",
        "seenMinutes",
        "seenHours",
        "seenDays"
      ])
        assert.ok(t(`socialUi.${key}`, { count }).length);
      for (const key of ["collectionResults", "referralResults"])
        for (const scope of ["search", "friends", "top"])
          assert.ok(
            t(`socialUi.${key}`, { count, scope, query: "Kitsune {FR}" }).length
          );
      for (const state of ["browse", "all", "mine", "won", "sales", "unsold"])
        assert.ok(t("socialUi.auctionCount", { count, state }).length);
    }
    assert.ok(
      t("socialUi.friendSelection", { count: 2, name: "SATORU GOJO" }).includes(
        "SATORU GOJO"
      )
    );
    assert.ok(
      t("socialUi.messageTo", { name: "Kitsune {FR}" }).includes("Kitsune {FR}")
    );
  }
});

// Golden signatures from master bd752ede: whole card JSX and RPC calls with
// their complete argument expressions. Presentation text cannot alter either.
// Walid approved unifying the trade picker with CollectionView: its duplicate
// mobile card was removed. Pin the shared collection's exact card markup too.
// The validated Shiny fusion adds variant-aware previews to the shared card markup.
const golden = {
  "components/community-views.tsx":
    "15f0f4c8b6b53eef826b53565d42f41acbb3386659d53b2ab723212762303880",
  "components/trades.tsx":
    "7d40dec00e9e3094ee74a289d6a384f83309d229059713774318c8f9f2680e3e",
  "components/collection.tsx":
    "008152e1baf0575c5c2cf57ff5441aa2a4c7b77b6f9cbc93af77ac3be0a3c82d",
  "components/conversation-trade.tsx":
    "2a52f8358cd939dafe6bc0fce9429c43005751db37fd7bd64baa550ab593a549",
  "lib/data/market.ts":
    "0fc671b345532490ede7e4b3223eeff82422892d01b051927e17edadb58d273a",
  "lib/data/trades.ts":
    "d3089872fdbf7f509b59add46232f5caeba89aaa4dcbd9aeb104ce304378779d",
  "lib/data/friends.ts":
    "d964ae06d7dcaa994cf3f9d3dc2548edd9018b275d61975da7b34c18613d743a",
  "lib/data/friend-feed.ts":
    "88167eb1c43d4f763a0ca68751c840b625aeb7bf19bb9a5659e6a07cad4778de",
  "lib/data/private-messages.ts":
    "583a5e429020c34343cdb634846b6d47f25b2ff83b8aed34f6af44a0b8fc0b81",
  "lib/data/moderation.ts":
    "d964ae06d7dcaa994cf3f9d3dc2548edd9018b275d61975da7b34c18613d743a"
};
test("PR4 retains exact card markup, RPC names and RPC arguments", () => {
  const printer = ts.createPrinter({ removeComments: true });
  for (const [file, expected] of Object.entries(golden)) {
    const ast = ts.createSourceFile(
      file,
      read(file),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const parts = [];
    function visit(node) {
      if (
        ((ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) &&
          ["YokaiCard", "CardShell"].includes(
            (node.tagName ?? node.openingElement.tagName).getText(ast)
          )) ||
        (ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "rpc")
      )
        parts.push(printer.printNode(ts.EmitHint.Unspecified, node, ast));
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.equal(
      createHash("sha256").update(parts.join("\n")).digest("hex"),
      expected,
      file
    );
  }
});
test("Social transpiled-source gzip growth stays below 5 KiB including its domain error registry", () => {
  // Production master 4fb38da; the new domain registry is included, not hidden
  // outside the original profile/settings guard's fixed historical file list.
  const sourceFiles = [
    "components/collection-leaderboard.tsx",
    "components/community-views.tsx",
    "components/conversation-trade.tsx",
    "components/friends.tsx",
    "components/leaderboard-stats.tsx",
    "components/leaderboard-topbar.tsx",
    "components/leaderboards.tsx",
    "components/notification-refresh-proof.tsx",
    "components/phase-eight-preview.tsx",
    "components/private-messages-preview.tsx",
    "components/private-messages.tsx",
    "components/referral-leaderboard.tsx",
    "components/social-feed.tsx",
    "components/social-tabs.tsx",
    "components/topbar.tsx",
    "components/trades.tsx",
    "i18n/game-messages.ts",
    "lib/data/trades.ts",
    "i18n/social-messages.ts"
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
  assert.ok(gzipSync(output).length - 65700 < 5 * 1024);
});

test("PR4 static translations resolve in both catalogues within their lexical namespace", () => {
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
