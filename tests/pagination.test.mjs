import { intl, gameMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("lib/ui/pagination.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText,
  { exports }
);
const { pageSizeForCollectionHeight, resolvePage, changePage } = exports;

test("collection pages add whole six-card rows to reach the filter height", () => {
  assert.equal(pageSizeForCollectionHeight(700, 200, 6), 36);
  assert.equal(pageSizeForCollectionHeight(1_210, 200, 6), 42);
  assert.equal(pageSizeForCollectionHeight(1_600, 200, 6), 48);
  assert.equal(pageSizeForCollectionHeight(1_210, 200, 5), 40);
});

test("page entry accepts integers, clamps bounds and restores invalid entries", () => {
  for (const value of ["", "  ", "abc", "2.5", "1e2", "NaN", "Infinity", "50x"])
    assert.equal(resolvePage(value, 21, 78), 21, value);
  assert.equal(resolvePage("50", 21, 78), 50);
  assert.equal(resolvePage(" 50 ", 21, 78), 50);
  assert.equal(resolvePage("-3", 21, 78), 1);
  assert.equal(resolvePage("0", 21, 78), 1);
  assert.equal(resolvePage("1000", 21, 78), 78);
});

test("navigation clamps and never calls back for the same page", () => {
  const calls = [];
  const go = (value, current, total) =>
    changePage(value, current, total, n => calls.push(n));
  assert.equal(go("21", 21, 78), false);
  assert.equal(go("bad", 21, 78), false);
  assert.equal(go("0", 1, 78), false);
  assert.equal(go("79", 78, 78), false);
  assert.deepEqual(calls, []);
  assert.equal(go("50", 21, 78), true);
  assert.deepEqual(calls, [50]);
});

function renderPagination(page = 21, pageCount = 78) {
  const calls = [],
    scrolls = [],
    effects = [];
  const jsx = (type, props) => ({ type, props });
  const loaded = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("components/ui/pagination.tsx", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports: loaded.exports,
      require: name => {
        if (name === "next-intl") return intl;
        if (name === "@/i18n/game-messages") return gameMessages;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "@/lib/ui/pagination") return exports;
        if (name === "react")
          return {
            useId: () => "page-input",
            useRef: value => ({ current: value }),
            useState: initial => [initial, () => {}],
            useEffect: effect => effects.push(effect)
          };
        assert.fail(`Unexpected import ${name}`);
      },
      document: {
        getElementById: () => ({
          scrollIntoView: options => scrolls.push(options)
        })
      },
      window: { matchMedia: () => ({ matches: true }) }
    }
  );
  const tree = loaded.exports.Pagination({
    page,
    pageCount,
    onPageChange: n => calls.push(n),
    scrollTargetId: "cards"
  });
  const nodes = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    const children = node.props?.children;
    for (const child of [children].flat(Infinity)) walk(child);
  }
  walk(tree);
  return { tree, nodes, calls, scrolls };
}

test("controls disable both ends, hide a single page and show no page pills", () => {
  for (const [page, first, last] of [
    [1, true, false],
    [21, false, false],
    [78, false, true]
  ]) {
    const { nodes } = renderPagination(page);
    for (const [label, disabled] of [
      ["First page", first],
      ["Previous page", first],
      ["Next page", last],
      ["Last page", last]
    ])
      assert.equal(
        nodes.find(n => n.props?.["aria-label"] === label).props.disabled,
        disabled
      );
    const shortcuts = nodes.filter(
      n => n.type === "button" && /^Page \d/.test(n.props["aria-label"])
    );
    assert.equal(shortcuts.length, 0);
  }
  assert.equal(renderPagination(1, 1).tree, null);
});

test("the paginator shows the current page and the total in en-US", () => {
  const { nodes } = renderPagination(1234, 4308);
  const text = node =>
    [node?.props?.children]
      .flat(Infinity)
      .filter(c => typeof c !== "object")
      .join("");
  assert.ok(nodes.some(n => n.type === "span" && text(n) === "Page"));
  assert.equal(nodes.find(n => n.type === "input").props.value, "1234");
  assert.ok(nodes.some(n => n.type === "span" && text(n) === "of 4,308"));
  assert.equal(
    text(nodes.find(n => n.props?.["aria-live"])),
    "Page 1,234 of 4,308"
  );
});

test("Enter and blur issue one change, same-page validation issues none, reduced motion scrolls instantly", () => {
  const { nodes, calls, scrolls } = renderPagination();
  const input = nodes.find(n => n.type === "input").props;
  let selected = false;
  input.onFocus({ currentTarget: { select: () => (selected = true) } });
  assert.equal(selected, true);
  assert.equal(input.inputMode, "numeric");
  input.onBlur({ currentTarget: { value: "21" } });
  input.onBlur({ currentTarget: { value: "bad" } });
  assert.deepEqual(calls, []);
  input.onKeyDown({
    key: "Enter",
    preventDefault() {},
    currentTarget: { value: "50" }
  });
  input.onBlur({ currentTarget: { value: "50" } });
  assert.deepEqual(calls, [50]);
  assert.equal(scrolls[0].behavior, "instant");
});

test("arrow shortcuts work in the paginator and leave editing and modifier keys alone", () => {
  const { tree, calls } = renderPagination();
  let prevented = false;
  const event = {
    key: "ArrowRight",
    target: { closest: () => null },
    preventDefault() {
      prevented = true;
    }
  };
  tree.props.onKeyDown({ ...event, target: { closest: () => ({}) } });
  tree.props.onKeyDown({ ...event, ctrlKey: true });
  assert.deepEqual(calls, []);
  tree.props.onKeyDown(event);
  assert.deepEqual(calls, [22]);
  assert.equal(prevented, true);
  assert.equal(tree.props["aria-label"], "Pagination");
  assert.equal(
    renderPagination().nodes.find(n => n.props?.["aria-live"]).props[
      "aria-live"
    ],
    "polite"
  );
});
