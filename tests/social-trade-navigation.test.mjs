import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    { exports, URLSearchParams, require: name => mocks(name) }
  );
  return exports;
}
test("Trades opens its own page and preserves targeted offers and cards", () => {
  const CommunityPage = () => null;
  const { default: page } = load("app/trades/page.tsx", name => {
    if (name === "@/components/community-page") return { CommunityPage };
    if (name === "react/jsx-runtime") return require(name);
    return {};
  });
  assert.equal(page().type, CommunityPage);
  assert.equal(page().props.screen, "trades");
  for (const values of [
    {},
    { ami: "friend+é", carte: "card & variant", offre: "offer/id" }
  ]) {
    const params = new URLSearchParams(values);
    const TradesPanel = () => null;
    const { TradesView } = load("components/community-views.tsx", name => {
      if (name === "next/navigation") return { useSearchParams: () => params };
      if (name === "next/dynamic") return { default: () => () => null };
      if (name === "@/components/trades") return { TradesPanel };
      if (name === "react" || name === "react/jsx-runtime")
        return require(name);
      return {};
    });
    const panel = TradesView().props.children;
    assert.equal(panel.type, TradesPanel);
    assert.equal(panel.props.initialFriendId, values.ami);
    assert.equal(panel.props.fixedFriendId, undefined);
    assert.equal(panel.props.initialRequestedCardId, values.carte);
    assert.equal(panel.props.initialOfferId, values.offre);
  }
});

test("Friends Trade action navigates to Trades with the selected friend and no popup", () => {
  const navigations = [];
  const { FriendsView } = load("components/community-views.tsx", name => {
    if (name === "next/navigation")
      return {
        useSearchParams: () => new URLSearchParams(),
        useRouter: () => ({ push: (...args) => navigations.push(args) })
      };
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "next/dynamic") return { default: () => () => null };
    if (name === "@/components/friends") return { FriendsPanel: () => null };
    return {};
  });
  const friends = FriendsView();
  assert.equal(friends.props.tradeSection, undefined);
  friends.props.onTrade("friend+é");
  const target = new URL(navigations.at(-1)[0], "https://example.invalid");
  assert.equal(target.pathname, "/trades");
  assert.equal(target.searchParams.get("ami"), "friend+é");
  assert.equal(target.searchParams.has("tab"), false);
  const before = navigations.length;
  friends.props.onTrade();
  assert.equal(navigations.length, before, "a trade must target a friend");
});
