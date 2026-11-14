import { intl, gameMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real event handlers and loading effects with deterministic hooks,
// fake debounce timers and in-memory loaders (never a live Supabase request).
function collection(readOnly = false) {
  let index = 0,
    tree,
    dirty = true,
    nextTimer = 0;
  const slots = [],
    effects = [],
    timers = new Map(),
    calls = [];
  const useState = initial => {
    const key = index++;
    if (!Object.hasOwn(slots, key))
      slots[key] = typeof initial === "function" ? initial() : initial;
    return [
      slots[key],
      next => {
        const value = typeof next === "function" ? next(slots[key]) : next;
        if (!Object.is(value, slots[key])) {
          slots[key] = value;
          dirty = true;
        }
      }
    ];
  };
  const useEffect = (callback, deps) => {
    const key = index++,
      previous = slots[key];
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      slots[key] = { deps };
      effects.push(() => {
        previous?.cleanup?.();
        slots[key].cleanup = callback();
      });
    }
  };
  const modules = new Map();
  const jsx = (type, props) => ({ type, props });
  const require = name => {
    if (name.endsWith(".css")) return {};
    if (name === "next-intl") return intl;
    if (name === "@/i18n/game-messages") return gameMessages;
    if (name === "react")
      return {
        useState,
        useEffect,
        useMemo: callback => callback(),
        useRef: initial => useState(() => ({ current: initial }))[0]
      };
    if (name === "react/jsx-runtime")
      return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "next/navigation")
      return {
        usePathname: () => (readOnly ? "/profile/other" : "/collection")
      };
    if (name === "@/hooks/use-collection-sort")
      return { useCollectionSort: () => useState("rarity") };
    if (name === "@/components/pro-access")
      return { useProAccess: () => false, ProFeatureNotice: "pro-notice" };
    if (name.startsWith("@/lib/ui/")) {
      if (!modules.has(name)) modules.set(name, load(`${name.slice(2)}.ts`));
      return modules.get(name);
    }
    if (name === "@/lib/data/wishlist")
      return { getCardDiscovery: () => assert.fail("No live data") };
    if (name === "next/link") return { default: "a" };
    if (name.startsWith("@/components/"))
      return new Proxy({}, { get: (_target, key) => key });
    assert.fail(`Unexpected import: ${name}`);
  };
  const load = file => {
    const context = {
      exports: {},
      require,
      URLSearchParams,
      window: {
        location: { search: "" },
        matchMedia: () => ({
          matches: false,
          addEventListener() {},
          removeEventListener() {}
        }),
        requestAnimationFrame: callback => context.window.setTimeout(callback),
        cancelAnimationFrame: id => context.window.clearTimeout(id),
        addEventListener() {},
        removeEventListener() {},
        history: { pushState() {} },
        setTimeout(callback) {
          const id = ++nextTimer;
          timers.set(id, callback);
          return id;
        },
        clearTimeout(id) {
          timers.delete(id);
        }
      },
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      }
    };
    vm.runInNewContext(
      ts.transpileModule(
        readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            jsx: ts.JsxEmit.ReactJSX
          }
        }
      ).outputText,
      context
    );
    return context.exports;
  };
  const { CollectionView } = load("components/collection.tsx");
  const props = {
    cards: [],
    categories: ["ANIME/MANGA"],
    readOnly,
    onSetPaniniAlbumFavorite: async () => {},
    loadPaniniAlbums: async options => {
      calls.push({ kind: "albums", ...options });
      return {
        items: [
          {
            license: "Black Butler",
            total: 10,
            owned: 0,
            percent: 0,
            favorite: true
          }
        ],
        total: 150
      };
    },
    loadPaniniAlbumCards: async options => {
      calls.push({ kind: "cards", ...options });
      return { items: [], total: 0 };
    }
  };
  const nodes = root =>
    root && typeof root === "object"
      ? [root, ...[root.props?.children].flat(Infinity).flatMap(nodes)]
      : [];
  const flush = async () => {
    for (let turns = 0; turns < 20; turns++) {
      if (dirty) {
        dirty = false;
        index = 0;
        tree = CollectionView(props);
        while (effects.length) effects.shift()();
      }
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty && !timers.size) return;
    }
    assert.fail("Collection did not settle");
  };
  const find = predicate => {
    const node = nodes(tree).find(predicate);
    assert.ok(node, "Expected element exists");
    return node;
  };
  const byClass = name => find(node => node.props?.className === name);
  const search = className =>
    nodes(byClass(className)).find(node => node.type === "input");
  return {
    calls,
    flush,
    byClass,
    find,
    search,
    async click(className) {
      byClass(className).props.onClick();
      await flush();
    },
    async query(className, value) {
      search(className).props.onChange({ target: { value } });
      await flush();
    }
  };
}

for (const readOnly of [false, true]) {
  test(`retour aux classeurs ${readOnly ? "d'un autre joueur" : "personnels"} : recherche, page et favoris conservés`, async () => {
    const c = collection(readOnly);
    await c.flush();
    await c.click("yk-panini-mode");
    await c.query("yk-panini-album-filters", "black butler");
    // The category and favorites filters must survive the round trip too.
    c.find(
      node =>
        node.type === "button" &&
        node.props?.children?.some?.(
          child => child?.props?.children === "ANIME/MANGA"
        )
    ).props.onClick();
    await c.flush();
    if (!readOnly) await c.click("yk-panini-owned-toggle");
    c.find(node => node.type === "Pagination").props.onPageChange(3);
    await c.flush();
    const before = c.calls.at(-1);
    assert.equal(before.query, "black butler");
    assert.equal(before.page, 3);
    await c.click("yk-panini-album-open");
    assert.equal(c.search("yk-panini-controls").props.value, "");
    assert.equal(c.calls.at(-1).query, "");
    await c.query("yk-panini-controls", "sebastian");
    assert.equal(c.calls.at(-1).license, "Black Butler");
    assert.equal(c.calls.at(-1).query, "sebastian");
    await c.click("yk-panini-back");
    assert.equal(
      c.search("yk-panini-album-filters").props.value,
      "black butler"
    );
    assert.deepEqual(c.calls.at(-1), before);
    // A subsequent search replaces the snapshot, including an empty query.
    for (const query of ["Butler", ""]) {
      await c.query("yk-panini-album-filters", query);
      await c.click("yk-panini-album-open");
      assert.equal(c.calls.at(-1).query, "");
      await c.click("yk-panini-back");
      assert.equal(c.search("yk-panini-album-filters").props.value, query);
      assert.equal(c.calls.at(-1).query, query);
      assert.equal(c.calls.at(-1).page, 1);
    }
  });
}
