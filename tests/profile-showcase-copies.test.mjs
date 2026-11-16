import { licenseName } from "./helpers/license-name.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { intl } from "./helpers/i18n.mjs";

const source = readFileSync("components/profile-editor.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX
  }
}).outputText;
const sortExports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("lib/ui/collection-sort.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText,
  { exports: sortExports }
);
const walk = node =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : node && typeof node === "object"
      ? [node, ...walk(node.props?.children)]
      : [];
const card = (instanceId, changes = {}) => ({
  id: "vegito",
  instanceId,
  name: "VEGITO",
  category: "ANIME/MANGA",
  anime: "Dragon Ball",
  rarity: "LR",
  image: "/vegito.png",
  catalogueImage: "/vegito.png",
  customImageUrl: null,
  shiny: false,
  isEvolved: false,
  obtainedAt: "2026-11-01T00:00:00Z",
  ...changes
});

for (const count of [1, 10]) {
  test(`showcase selects a custom copy in place with ${count} occupied slots`, async () => {
    let cursor = 0;
    const state = [];
    const exports = {};
    const component = name => Object.assign(() => null, { displayName: name });
    const react = {
      memo: fn => fn,
      useState(initial) {
        const slot = cursor++;
        if (!(slot in state))
          state[slot] = typeof initial === "function" ? initial() : initial;
        return [
          state[slot],
          next => {
            state[slot] = typeof next === "function" ? next(state[slot]) : next;
          }
        ];
      },
      useMemo: fn => fn(),
      useRef: () => ({ current: null }),
      useEffect() {},
      useDeferredValue: value => value
    };
    vm.runInNewContext(compiled, {
      exports,
      require: name => {
        if (name === "@/lib/ui/license-name") return licenseName;
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return jsx;
        if (name === "next-intl") return intl;
        if (name === "next/dynamic")
          return { default: () => component("Dynamic") };
        if (name === "@/components/pro-access")
          return { useProAccess: () => true };
        if (name === "@/lib/ui/profile-style")
          return {
            DEFAULT_PROFILE_STYLE: {},
            normalizeProfileStyle: value => value
          };
        if (name === "@/lib/ui/collection-sort") return sortExports;
        if (name === "@/lib/ui/card-search")
          return {
            cardSearchTerms: value =>
              value.toLowerCase().split(/\s+/).filter(Boolean)
          };
        return new Proxy({}, { get: (_, key) => component(key) });
      }
    });
    const original = card("original");
    const custom = card("custom", {
      image: "/custom.png",
      customImageUrl: "/custom.png"
    });
    const featured = Array.from({ length: count - 1 }, (_, i) =>
      card("other-" + i, { id: "other-" + i, name: "OTHER " + i })
    );
    featured.splice(Math.floor(count / 2), 0, original);
    const collection = [
      original,
      card("duplicate"),
      custom,
      card("shiny", { shiny: true }),
      card("infinity", { isEvolved: true }),
      ...featured.filter(item => item !== original)
    ];
    let saved;
    const props = {
      mode: "showcase",
      profile: {
        id: "me",
        pseudo: "Player",
        bio: "",
        avatarUrl: null,
        featuredCards: featured
      },
      collection,
      initialBannerUrl: null,
      initialBannerFrame: null,
      framingAvailable: true,
      adapter: {
        saveAppearance: async (...args) => {
          saved = args;
          return props.profile;
        }
      },
      onSaved() {},
      onClose() {}
    };
    let tree;
    const render = () => {
      cursor = 0;
      tree = exports.Editor(props);
    };
    const picker = () =>
      walk(tree).find(
        node =>
          node.props?.className ===
          "yk-featured-picker yk-showcase-card-browser-grid"
      );
    const choices = () => picker().props.children;
    const selection = () =>
      walk(tree)
        .filter(node => node.props?.["data-showcase-slot"])
        .map(node => node.props["data-showcase-slot"]);
    render();
    const available = choices();
    assert.deepEqual(Array.from(available, node => node.key).sort(), [
      "custom",
      "infinity",
      "shiny"
    ]);
    const customButton = available.find(node => node.key === "custom");
    assert.match(customButton.props["aria-label"], /custom image/);
    const art = customButton.props.children[0];
    assert.equal(art.type(art.props).props.image, "/custom.png");
    customButton.props.onClick();
    render();
    assert.deepEqual(
      Array.from(selection()),
      featured.map(item => (item === original ? "custom" : item.instanceId))
    );
    assert.equal(
      choices().some(node => node.key === "custom"),
      false
    );
    assert.equal(
      choices().some(node => node.key === "original"),
      true
    );
    const actions = walk(tree).find(
      node =>
        node.props?.className ===
        "flex justify-end gap-3 yk-profile-edit-actions"
    );
    assert.equal(actions.props.children[1].props.disabled, false);
    actions.props.children[1].props.onClick();
    await Promise.resolve();
    assert.deepEqual(Array.from(saved[2]), Array.from(selection()));
  });
}
