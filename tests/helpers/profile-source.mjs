import { readFileSync } from "node:fs";
import ts from "typescript";

// Inspect the real editor at its original position, so existing JSX and behavior
// checks cover the complete profile even though the editor is loaded on demand.
export function readProfileSource() {
  const profile = readFileSync(
    new URL("../../components/profile.tsx", import.meta.url),
    "utf8"
  );
  const editor = readFileSync(
    new URL("../../components/profile-editor.tsx", import.meta.url),
    "utf8"
  );
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
  const implementation = editorAst.statements.find(
    node => ts.isFunctionDeclaration(node) && node.name?.text === "Editor"
  );
  if (!boundary || !implementation)
    throw new Error("Profile editor boundary missing");
  return (
    profile.slice(0, boundary.getStart(profileAst)) +
    implementation.getText(editorAst).replace("export function", "function") +
    profile.slice(boundary.end)
  );
}
