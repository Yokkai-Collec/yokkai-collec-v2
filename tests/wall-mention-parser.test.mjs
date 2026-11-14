import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../lib/ui/wall-mentions.ts", import.meta.url),
  "utf8"
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
});
const exports = {};
new Function("exports", outputText)(exports);
const { wallMentionParts, wallMentionAtCursor } = exports;

test("wall mentions load without RegExp lookbehind", () => {
  assert.doesNotMatch(source, /\(\?<([=!])/);
});

test("wall mentions preserve punctuation and ignore embedded handles", () => {
  const text = "@Aary,(@<Léo Z.>) ✨@栗花\nmail@host.test /𐐀@player";
  const parts = wallMentionParts(text);
  assert.equal(parts.map(part => part.text).join(""), text);
  assert.deepEqual(
    parts.flatMap(part => part.pseudo ?? []),
    ["Aary", "Léo Z.", "栗花"]
  );
});

test("wall suggestions recognize an active mention and replace its suffix", () => {
  assert.deepEqual(wallMentionAtCursor("Bonjour @Émile !", 11), {
    query: "Ém",
    start: 8,
    end: 14
  });
  const longPseudo = "𐐀".repeat(30);
  assert.equal(wallMentionAtCursor("@" + longPseudo, 61)?.query, longPseudo);
  for (const value of [
    "texte ordinaire",
    "mail@host",
    "𐐀@player",
    "@aa\ntexte",
    "@a" + longPseudo
  ]) {
    assert.equal(wallMentionAtCursor(value, value.length), null);
  }
});
