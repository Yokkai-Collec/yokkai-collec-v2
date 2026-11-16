import assert from "node:assert/strict";
import test from "node:test";
import { licenseName } from "./helpers/license-name.mjs";

test("license display uses word initials and preserves acronyms, accents and punctuation", () => {
  for (const [input, expected] of [
    ["HARRY POTTER", "Harry Potter"],
    ["dragon BALL", "Dragon Ball"],
    ["Attack on Titan", "Attack On Titan"],
    ["DC Comics", "DC Comics"],
    ["nba", "NBA"],
    ["KPOP", "KPOP"],
    ["k-pop", "K-POP"],
    ["BTS", "BTS"],
    ["blackpink", "Blackpink"],
    ["AC/DC", "AC/DC"],
    ["FINAL FANTASY VII", "Final Fantasy VII"],
    ["POKÉMON", "Pokémon"],
    ["ÉCOLE DES HÉROS", "École Des Héros"],
    ["ASSASSIN'S CREED", "Assassin's Creed"],
    [
      "Re:ZERO -STARTING LIFE IN ANOTHER WORLD-",
      "Re:Zero -Starting Life In Another World-"
    ],
    ["86 EIGHTY-SIX", "86 Eighty-Six"],
    ["20th CENTURY BOYS", "20th Century Boys"],
    ["ドラゴンボール", "ドラゴンボール"],
    [" Dragon  Ball ", " Dragon  Ball "],
    ["", ""],
    [undefined, ""],
    [null, ""]
  ]) {
    assert.equal(licenseName.formatLicenseName(input), expected);
    assert.equal(licenseName.formatLicenseName(expected), expected);
  }
});
