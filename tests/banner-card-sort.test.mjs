import { readProfileSource } from "./helpers/profile-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../lib/ui/banner-card-sort.ts", import.meta.url),
      "utf8"
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText,
  { exports }
);
const { compareBannerCards } = exports;
const card = (id, rarity, name = id) => ({ id, rarity, name });

test("banner choices sort LR, SSR, SR, R, C before alphabetical order", () => {
  const cards = Object.freeze([
    card("common", "C", "A"),
    card("rare", "R", "B"),
    card("super-rare", "SR", "C"),
    card("ssr", "SSR", "D"),
    card("legendary", "LR", "Z")
  ]);
  assert.deepEqual(
    cards.toSorted(compareBannerCards).map(c => c.rarity),
    ["LR", "SSR", "SR", "R", "C"]
  );
  assert.equal(cards[0].rarity, "C", "sorting leaves the collection untouched");
});

test("banner choices use names within a rarity and IDs for identical names", () => {
  const cards = [
    card("z", "SSR", "Levi"),
    card("b", "SSR", "Ace"),
    card("a", "SSR", "Ace")
  ];
  assert.deepEqual(
    cards.toSorted(compareBannerCards).map(c => c.id),
    ["a", "b", "z"]
  );
  assert.equal(compareBannerCards(cards[0], cards[0]), 0);
});

test("the owned banner picker sorts searched choices before the result limit", () => {
  const source = readProfileSource();
  const start = source.indexOf("const ownedBannerChoices = useMemo(");
  const end = source.indexOf("const unique = useMemo(", start);
  const choices = source.slice(start, end);
  assert.match(
    readFileSync(
      new URL("../components/profile-editor.tsx", import.meta.url),
      "utf8"
    ),
    /import \{ compareBannerCards \} from "@\/lib\/ui\/banner-card-sort"/
  );
  assert.match(choices, /ownedBannerCards\s*\.filter/);
  assert.match(choices, /matchesCardSearch\(bannerQuery/);
  assert.match(choices, /\.toSorted\(compareBannerCards\)/);
  assert.doesNotMatch(choices, /\.slice\(/);
  assert.match(source, /ownedBannerChoices\.slice\(0, 36\)\.map/);
  const cards = [
    ...Array.from({ length: 36 }, (_, i) => card(`common-${i}`, "C")),
    card("last-in-collection", "LR")
  ];
  assert.equal(cards.toSorted(compareBannerCards).slice(0, 36)[0].rarity, "LR");
});
