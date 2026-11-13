import { readProfileSource } from "./helpers/profile-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadHelper(path) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    { exports }
  );
  return exports;
}

const { matchesCardSearch } = loadHelper("../lib/ui/card-search.ts");
const { compareBannerCards } = loadHelper("../lib/ui/banner-card-sort.ts");
const source = readProfileSource();
const ast = ts.createSourceFile(
  "profile.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const editor = ast.statements.find(
  node => ts.isFunctionDeclaration(node) && node.name?.text === "Editor"
);
assert.ok(editor?.body, "test the real profile editor");
const choices = editor.body.statements.find(
  node =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      declaration => declaration.name.getText(ast) === "ownedBannerChoices"
    )
);
assert.ok(choices, "execute the actual banner-choice useMemo, not a copy");
const choiceScript = new vm.Script(
  ts.transpileModule(
    `${choices.getText(ast)}\nexports.choices = ownedBannerChoices;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText
);

function card(id, name, anime, rarity = "SSR") {
  return Object.freeze({ id, name, anime, rarity, category: "ANIME/MANGA" });
}

const cards = Object.freeze([
  card("loki-marvel", "LOKI", "Marvel"),
  card("luffy", "MONKEY D. LUFFY", "One Piece"),
  card("loki-one", "LOKI", "One Piece", "LR"),
  card("naruto", "NARUTO UZUMAKI", "Naruto", "LR")
]);

function bannerChoices(query, collection = cards) {
  const exports = {};
  choiceScript.runInNewContext({
    exports,
    useMemo: compute => compute(),
    mode: "profile",
    ownedBannerCards: collection,
    bannerQuery: query,
    matchesCardSearch,
    compareBannerCards
  });
  return Array.from(exports.choices);
}

function ids(query, collection) {
  return bannerChoices(query, collection).map(result => result.id);
}

test("banner search combines character and franchise terms in either order", () => {
  assert.deepEqual(ids("LOKI ONE"), ["loki-one"]);
  assert.deepEqual(ids("ONE LOKI"), ["loki-one"]);
});

test("banner search combines first name, last name and franchise", () => {
  assert.deepEqual(ids("MONKEY LUFFY ONE PIECE"), ["luffy"]);
  assert.deepEqual(ids("PIECE LUFFY MONKEY ONE"), ["luffy"]);
});

test("banner search ignores case and repeated whitespace across fields", () => {
  assert.deepEqual(ids("  lOkI\t oNe  \n"), ["loki-one"]);
  assert.deepEqual(ids(" monkey   lUfFy\tONE PIECE "), ["luffy"]);
});

test("banner search still accepts a character name or a franchise alone", () => {
  assert.deepEqual(ids("LOKI"), ["loki-one", "loki-marvel"]);
  assert.deepEqual(ids("One Piece"), ["loki-one", "luffy"]);
  assert.deepEqual(ids("Marvel"), ["loki-marvel"]);
});

test("every banner search term must match the same owned card", () => {
  assert.deepEqual(ids("LOKI NARUTO"), []);
  assert.deepEqual(ids("MONKEY LUFFY MARVEL"), []);
  assert.deepEqual(ids("LOKI ONE unknown"), []);
});

test("banner search includes matching owned cards beyond the first 36 results", () => {
  const collection = Object.freeze([
    ...Array.from({ length: 40 }, (_, index) =>
      card(`other-${index}`, `OTHER CHARACTER ${index}`, "Naruto", "C")
    ),
    card("late-loki", "LOKI", "One Piece", "LR")
  ]);
  assert.deepEqual(ids("LOKI ONE", collection), ["late-loki"]);
  assert.match(source, /ownedBannerChoices\.slice\(0, 36\)\.map/);
});

test("combined banner search preserves rarity and alphabetical ordering without mutation", () => {
  const collection = Object.freeze([
    card("common", "LOKI A", "One Piece", "C"),
    card("ssr-z", "LOKI Z", "One Piece", "SSR"),
    card("rare", "LOKI A", "One Piece", "R"),
    card("lr-z", "LOKI Z", "One Piece", "LR"),
    card("super-rare", "LOKI A", "One Piece", "SR"),
    card("ssr-a", "LOKI A", "One Piece", "SSR"),
    card("lr-a", "LOKI A", "One Piece", "LR")
  ]);
  assert.deepEqual(ids("LOKI ONE", collection), [
    "lr-a",
    "lr-z",
    "ssr-a",
    "ssr-z",
    "super-rare",
    "rare",
    "common"
  ]);
  assert.equal(collection[0].id, "common");
});
