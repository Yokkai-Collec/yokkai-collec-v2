import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("the title picker is restricted to the edit-profile dialog", () => {
  const source = readFileSync(
    new URL("../components/profile-editor.tsx", import.meta.url),
    "utf8"
  );
  const ast = ts.createSourceFile(
    "profile.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const pickers = [];
  function visit(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(ast) === "PlayerTitlePicker"
    )
      pickers.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(pickers.length, 1);
  const ancestors = [];
  for (let node = pickers[0].parent; node; node = node.parent)
    ancestors.push(node);
  assert.ok(
    ancestors.some(
      node =>
        ts.isBinaryExpression(node) &&
        /mode === "profile"/.test(node.getText(ast))
    )
  );
  assert.ok(
    ancestors.some(
      node =>
        ts.isBinaryExpression(node) &&
        /profile\.unlockedTitleIds/.test(node.getText(ast).replace(/\s+/g, " "))
    )
  );
  const topbar = readFileSync(
    new URL("../components/topbar.tsx", import.meta.url),
    "utf8"
  );
  assert.ok(!topbar.includes("PlayerTitlePicker"));
  const editor = readFileSync(
    new URL("../components/profile-editor.tsx", import.meta.url),
    "utf8"
  );
  assert.ok(
    editor.indexOf("<PlayerTitlePicker") > editor.indexOf('type="file"')
  );
  assert.ok(
    editor.indexOf("<PlayerTitlePicker") < editor.indexOf('t("profileUi.bio")')
  );
  assert.match(editor, /onChange=\{setTitleId\}/);
  const picker = readFileSync(
    new URL("../components/player-title.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(picker, /equipPlayerTitle|onSaved|await save/);
});
