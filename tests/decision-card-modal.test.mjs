import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { intl } from "./helpers/i18n.mjs";

test("decision insights distinguish loading, no sales, zero owners and failure without blocking a choice", async () => {
  const require = createRequire(import.meta.url),
    states = [],
    effects = [],
    calls = [];
  let ownedCopies = 2;
  let index = 0,
    fail = false,
    chosen = 0;
  const load = async (...args) => {
    calls.push(args);
    if (fail) throw Error("offline");
    return { ownerCount: 0, marketValue: null, wishlisted: true };
  };
  const context = {
    exports: {},
    require: name => {
      if (name === "react")
        return {
          ...React,
          useState: initial => {
            const slot = index++;
            if (!(slot in states)) states[slot] = initial;
            return [
              states[slot],
              value => {
                states[slot] =
                  typeof value === "function" ? value(states[slot]) : value;
              }
            ];
          },
          useEffect: fn => effects.push(fn)
        };
      if (name === "next-intl") return intl;
      if (name === "@/lib/data/wishlist") return { getCardDiscovery: load };
      if (name === "@/components/yokai-card") return { YokaiCard: () => null };
      if (name === "@/components/ui")
        return {
          Modal: ({ children }) =>
            React.createElement("section", null, children),
          Button: ({ children, variant, ...props }) =>
            React.createElement("button", props, children),
          Karas: ({ amount }) =>
            React.createElement("span", null, `${amount} Karas`)
        };
      return require(name);
    }
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync("components/decision-card-modal.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX
        }
      }
    ).outputText,
    context
  );
  const render = () => {
    index = 0;
    return context.exports.DecisionCardModal({
      card: { id: "card", shiny: true, name: "Card", destructionValue: 12 },
      ownedCopies,
      keepReward: 48,
      onClose() {},
      onChoose() {
        chosen++;
      }
    });
  };
  const buttons = tree => {
    const found = [];
    const visit = node => {
      if (!node || typeof node !== "object") return;
      if (node.props?.onClick) found.push(node);
      React.Children.forEach(node.props?.children, visit);
    };
    visit(tree);
    return found;
  };
  const loading = render();
  assert.match(renderToStaticMarkup(loading), /Loading card insights/);
  assert.doesNotMatch(
    renderToStaticMarkup(loading),
    /No completed sales|0 players/
  );
  await effects.at(-1)();
  await Promise.resolve();
  assert.deepEqual(calls[0], ["card", 0, 1, true]);
  const html = renderToStaticMarkup(render());
  for (const text of [
    "0 players",
    "No completed sales",
    "2 copies",
    "12 Karas",
    "48 Karas",
    "In your wishlist"
  ])
    assert.ok(html.includes(text), text);
  ownedCopies = undefined;
  assert.match(renderToStaticMarkup(render()), /Unavailable/);
  assert.doesNotMatch(renderToStaticMarkup(render()), /Not in your collection/);
  ownedCopies = 2;
  states[0] = undefined;
  fail = true;
  render();
  await effects.at(-1)();
  await Promise.resolve();
  let tree = render();
  assert.match(renderToStaticMarkup(tree), /could not be loaded/);
  assert.doesNotMatch(
    renderToStaticMarkup(tree),
    /No completed sales|0 players/
  );
  const choose = buttons(tree).find(
    button => button.props.children === "Choose this card"
  );
  assert.equal(choose.props.disabled, false);
  choose.props.onClick();
  assert.equal(chosen, 1);
  buttons(tree)
    .find(button => button.props.children === "Try again")
    .props.onClick();
  fail = false;
  render();
  await effects.at(-1)();
  await Promise.resolve();
  assert.match(renderToStaticMarkup(render()), /0 players/);
});
