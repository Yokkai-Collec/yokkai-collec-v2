import { readProfileSource } from "./helpers/profile-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { englishMessages } from "./helpers/i18n.mjs";

const source = readProfileSource();
const tree = ts.createSourceFile(
  "profile.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const editor = tree.statements.find(
  node => ts.isFunctionDeclaration(node) && node.name?.text === "Editor"
);
const styleEditor = tree.statements.find(
  node =>
    ts.isFunctionDeclaration(node) && node.name?.text === "ProfileStyleEditor"
);
const guards = new Map();
function inspect(node) {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
    ts.isBinaryExpression(node.left)
  ) {
    const condition = node.left;
    if (
      condition.left.getText(tree) === "mode" &&
      ts.isStringLiteral(condition.right)
    )
      guards.set(condition.right.text, node.right.getText(tree));
  }
  ts.forEachChild(node, inspect);
}
inspect(editor);

test("the profile editor contains personal fields and banners, never the showcase picker", () => {
  const profile = guards.get("profile");
  assert.ok(profile);
  assert.match(profile, /<textarea/);
  assert.match(profile, /yk-profile-banner-editor/);
  assert.match(profile, /type="file"/);
  assert.doesNotMatch(
    profile,
    /yk-featured-picker|featured-query|featuredChoices|ProfileStyleFields/
  );
});

test("profile styling has its own owner action and isolated editor", () => {
  assert.ok(styleEditor);
  const style = styleEditor.getText(tree);
  assert.match(source, /setEditingMode\("style"\)/);
  assert.match(source, /t\("profileUi.profileStyle"\)/);
  assert.equal(englishMessages.profileUi.profileStyle, "Profile style");
  assert.match(style, /<ProfileStyleFields/);
  assert.doesNotMatch(
    style,
    /saveProfileAppearance|uploadAvatar|uploadBanner|yk-featured-picker/
  );
});

test("Basic players can change the style draft but cannot save or publish it", () => {
  assert.ok(styleEditor);
  const style = styleEditor.getText(tree);
  assert.match(style, /if \(!pro \|\| busy\) return/);
  assert.match(style, /disabled=\{busy \|\| !pro\}/);
  assert.match(style, /t\("profileUi.proRequired"\)/);
  assert.equal(englishMessages.profileUi.proRequired, "Pro required");
  assert.match(style, /t\("profileUi.stylePreviewNotice"\)/);
  assert.match(englishMessages.profileUi.stylePreviewNotice, /Preview is free/);
  assert.match(style, /module\.persistProfileStyle\(style\)/);
  const save = readFileSync(
    new URL("../lib/data/showcase-style.ts", import.meta.url),
    "utf8"
  );
  assert.match(save, /fetch\("\/api\/pro\/profile-style"/);
  assert.match(save, /method: "POST"/);
  assert.match(save, /JSON\.stringify\(\{ style \}\)/);
});

test("the showcase editor contains a bounded, paginated card picker", () => {
  const showcase = guards.get("showcase");
  assert.ok(showcase);
  assert.match(showcase, /yk-featured-picker/);
  assert.match(
    showcase,
    /featuredChoices\s*\.slice\(\s*\(activePage - 1\) \* pageSize,\s*activePage \* pageSize\s*\)\s*\.map/
  );
  assert.match(showcase, /FEATURED_CARD_LIMIT/);
  assert.doesNotMatch(
    showcase,
    /<textarea|type="file"|yk-profile-banner-editor|BannerCrop/
  );
  assert.match(
    source,
    /key=\{editingMode\}/,
    "changing editors resets unsaved drafts"
  );
});

test("the profile bio cannot be resized and keeps its text scrollable and bounded", () => {
  const profile = guards.get("profile");
  const bio = profile.match(/<textarea\b[\s\S]*?\/>/)?.[0];
  assert.ok(bio);
  assert.match(bio, /resize-none/);
  assert.match(bio, /overflow-y-auto/);
  assert.doesNotMatch(bio, /\bresize-y\b|\bresize-x\b/);
  assert.match(bio, /maxLength=\{300\}/);
});

test("the owner-only showcase header uses the same secondary button as profile editing", () => {
  const showcase = source.slice(
    source.indexOf('className="yk-profile-surface yk-profile-showcase"'),
    source.indexOf("<Featured cards={profile.featuredCards}")
  );
  assert.match(showcase, /isMe\s*\?/);
  assert.match(showcase, /<Button\s+variant="secondary"/);
  assert.match(showcase, /setEditingMode\("showcase"\)/);
  assert.match(showcase, /t\("profileUi.editShowcase"\)/);
  assert.equal(englishMessages.profileUi.editShowcase, "Edit showcase");
  assert.match(showcase, /t\("profileUi.theirShowcase"\)/);
  assert.equal(englishMessages.profileUi.theirShowcase, "Their showcase");
});
