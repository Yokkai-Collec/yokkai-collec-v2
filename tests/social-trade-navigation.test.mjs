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
test("legacy Trades links preserve targeted offers or cards in Social Friends", async () => {
  const { default: page } = load("app/trades/page.tsx", name => {
    assert.equal(name, "next/navigation");
    return {
      redirect: href => {
        throw Error(href);
      }
    };
  });
  for (const params of [
    {},
    {
      ami: "friend+é",
      carte: "card & variant",
      offre: "offer/id",
      tag: ["one", "two"],
      tab: "other"
    }
  ]) {
    const destination = await page({
      searchParams: Promise.resolve(params)
    }).catch(e => e.message);
    const url = new URL(destination, "https://example.invalid");
    assert.equal(url.pathname, "/friends");
    assert.equal(url.searchParams.get("tab"), "trades");
    if (params.ami) {
      assert.equal(url.searchParams.get("ami"), params.ami);
      assert.equal(url.searchParams.get("carte"), params.carte);
      assert.equal(url.searchParams.get("offre"), params.offre);
      assert.deepEqual(url.searchParams.getAll("tag"), params.tag);
    }
  }
});
test("Friends opens a selected friend's exchange in Social and returns to the friends list", () => {
  let params = new URLSearchParams();
  const navigations = [];
  const { FriendsView, TradesView } = load(
    "components/community-views.tsx",
    name => {
      if (name === "next/navigation")
        return {
          useSearchParams: () => params,
          useRouter: () => ({
            push: (...args) => navigations.push(args),
            replace: (...args) => navigations.push(args)
          })
        };
      if (name === "react" || name === "react/jsx-runtime")
        return require(name);
      if (name === "next/dynamic") return { default: () => () => null };
      if (name === "@/components/friends") return { FriendsPanel: () => null };
      return {};
    }
  );
  const friends = FriendsView();
  assert.equal(friends.props.tradeSection.active, false);
  assert.equal(friends.props.tradeSection.content.type, TradesView);
  friends.props.tradeSection.open("friend+é");
  const target = new URL(navigations.at(-1)[0], "https://example.invalid");
  assert.equal(target.pathname, "/social");
  assert.equal(target.searchParams.get("tab"), "trades");
  assert.equal(target.searchParams.get("ami"), "friend+é");
  assert.equal(navigations.at(-1)[1].scroll, false);
  params = target.searchParams;
  const exchange = FriendsView();
  assert.equal(exchange.props.tradeSection.active, true);
  exchange.props.tradeSection.close();
  assert.equal(navigations.at(-1)[0], "/social");
  const before = navigations.length;
  friends.props.tradeSection.open();
  assert.equal(navigations.length, before, "a trade must target a friend");
  const history = new URL("/social?tab=trades", "https://example.invalid");
  assert.equal(history.searchParams.get("tab"), "trades");
  assert.equal(history.searchParams.has("ami"), false);
  params = history.searchParams;
  assert.equal(
    FriendsView().props.tradeSection.active,
    false,
    "the removed standalone tab does not open an empty trade page"
  );
});
