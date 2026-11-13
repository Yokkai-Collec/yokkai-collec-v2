import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = name =>
  readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");

test("profile editing is loaded on demand and matches the reviewed editor body", () => {
  const profile = read("profile");
  const editor = read("profile-editor");
  const parse = (name, source) =>
    ts.createSourceFile(
      name,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
  const profileAst = parse("profile.tsx", profile);
  const editorAst = parse("profile-editor.tsx", editor);
  const boundary = profileAst.statements.find(
    node =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        declaration => declaration.name.getText(profileAst) === "Editor"
      )
  );
  assert.ok(boundary);
  assert.match(boundary.getText(profileAst), /dynamic\(/);
  assert.match(
    boundary.getText(profileAst),
    /import\("@\/components\/profile-editor"\)/
  );
  assert.match(profile, /<Editor/);
  assert.ok(
    !profileAst.statements
      .filter(ts.isImportDeclaration)
      .some(node => node.moduleSpecifier.text.includes("profile-editor")),
    "no eager editor import"
  );
  assert.ok(
    !profileAst.statements.some(
      node => ts.isFunctionDeclaration(node) && node.name?.text === "Editor"
    )
  );
  const implementation = editorAst.statements.find(
    node => ts.isFunctionDeclaration(node) && node.name?.text === "Editor"
  );
  assert.ok(implementation?.body);
  const body = ts
    .createPrinter({ removeComments: true })
    .printNode(ts.EmitHint.Unspecified, implementation.body, editorAst);
  // Reviewed editor body, including banners, uploads, filters, reordering,
  // limits, errors and save guards.
  assert.equal(
    createHash("sha256").update(body).digest("hex"),
    "12d4b47354d80610cd1f95c612493d92b4a514eb8736fd0159eb3a8f01dbf799"
  );
});
