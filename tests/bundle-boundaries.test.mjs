import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
// Follow value imports only: a type import does not put code in a browser chunk.
function eagerFiles(entry, seen = new Set()) {
  const file = path.resolve(root, entry);
  if (seen.has(file)) return seen;
  seen.add(file);
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly)
      continue;
    const bindings = node.importClause?.namedBindings;
    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      !node.importClause.name &&
      bindings.elements.every(item => item.isTypeOnly)
    )
      continue;
    const specifier = node.moduleSpecifier.text;
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) continue;
    const base = specifier.startsWith("@/")
      ? path.join(root, specifier.slice(2))
      : path.resolve(path.dirname(file), specifier);
    const dependency = [
      base,
      `${base}.tsx`,
      `${base}.ts`,
      `${base}/index.tsx`
    ].find(
      candidate => /\.[cm]?[jt]sx?$/.test(candidate) && existsSync(candidate)
    );
    if (dependency) eagerFiles(dependency, seen);
  }
  return seen;
}

test("PERF-08: community screens do not eagerly load the profile experience", () => {
  assert.ok(
    !eagerFiles("components/community-views.tsx").has(
      path.resolve(root, "components/profile.tsx")
    )
  );
});

test("community screens only load the market listings controller when needed", () => {
  assert.ok(
    !eagerFiles("components/community-views.tsx").has(
      path.resolve(root, "components/market-listings.tsx")
    )
  );
});

test("auction stages and outcomes are loaded only when needed", () => {
  const files = eagerFiles("components/community-views.tsx");
  for (const file of [
    "components/auction-outcome.tsx",
    "components/mystery-auction-stage.tsx"
  ])
    assert.ok(!files.has(path.resolve(root, file)), file);
});

test("PERF-08: packs do not eagerly load the collection browser", () => {
  assert.ok(
    !eagerFiles("components/game.tsx").has(
      path.resolve(root, "components/collection.tsx")
    )
  );
  assert.ok(
    !eagerFiles("components/boosters.tsx").has(
      path.resolve(root, "components/collection.tsx")
    )
  );
});
