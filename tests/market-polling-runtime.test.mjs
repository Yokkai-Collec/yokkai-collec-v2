import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("market Load more retains its prefix size on polling and ignores a stale filter response", async () => {
  const source = readFileSync(
    new URL("../components/market-listings.tsx", import.meta.url),
    "utf8"
  );
  const ast = ts.createSourceFile(
    "market-listings.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const component = ast.statements.find(
    node =>
      ts.isFunctionDeclaration(node) && node.name?.text === "MarketListings"
  );
  assert.ok(component);
  const slots = [],
    pendingEffects = [],
    timers = new Map(),
    calls = [];
  let index = 0,
    dirty = false,
    timerId = 0,
    tree;
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  const useState = initial => {
    const key = index++;
    if (!slots[key])
      slots[key] = {
        value: typeof initial === "function" ? initial() : initial
      };
    return [
      slots[key].value,
      next => {
        const value =
          typeof next === "function" ? next(slots[key].value) : next;
        if (!Object.is(value, slots[key].value)) {
          slots[key].value = value;
          dirty = true;
        }
      }
    ];
  };
  const useRef = value => {
    const key = index++;
    return (slots[key] ??= { current: value });
  };
  const useCallback = (callback, deps) => {
    const key = index++;
    if (!same(slots[key]?.deps, deps)) slots[key] = { value: callback, deps };
    return slots[key].value;
  };
  const useMemo = (factory, deps) => {
    const key = index++;
    if (!same(slots[key]?.deps, deps)) slots[key] = { value: factory(), deps };
    return slots[key].value;
  };
  const useEffect = (callback, deps) => {
    const key = index++;
    if (!same(slots[key]?.deps, deps)) {
      const previous = slots[key];
      slots[key] = { deps };
      pendingEffects.push(() => {
        previous?.cleanup?.();
        slots[key].cleanup = callback();
      });
    }
  };
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    hidden: false
  });
  const window = {
    setInterval(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    clearTimeout() {},
    scrollTo() {
      assert.fail("polling must preserve scroll position");
    }
  };
  // The real PERF-01 helper, bound to the same fake window and document.
  const polling = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../lib/ui/visible-polling.ts", import.meta.url),
        "utf8"
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } }
    ).outputText,
    { exports: polling.exports, window, document }
  );
  const Marker = () => null;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(
    ts.transpileModule(component.getText(ast), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      require: () => ({ jsx, jsxs: jsx }),
      useState,
      useRef,
      useCallback,
      useMemo,
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
      createMarketReturnStore: () => ({
        subscribe: () => () => {},
        getSnapshot: () => null,
        getServerSnapshot: () => undefined
      }),
      readMarketReturnContent: () => null,
      useEffect,
      startVisiblePolling: polling.exports.startVisiblePolling,
      window,
      document,
      JSON,
      Date,
      Math,
      Error,
      console,
      process: { env: { NODE_ENV: "test" } },
      MARKET_PAGE_SIZE: 100,
      MARKET_MAX_ITEMS: 1000,
      browseAuctions(query, limit) {
        let resolve;
        const promise = new Promise(done => {
          resolve = done;
        });
        calls.push({ query, limit, resolve });
        return promise;
      },
      subscribePlayerSnapshotInvalidation: () => () => {},
      auctionReconciliationScopes: () => [],
      invalidatePlayerSnapshots() {}
    }
  );
  function render() {
    index = 0;
    dirty = false;
    tree = exports.default({
      view: Marker,
      viewerId: "viewer",
      onError: setError,
      buildAuctionLists: items => ({ active: items })
    });
    while (pendingEffects.length) pendingEffects.shift()();
  }
  function setError(error) {
    assert.equal(error, "");
  }
  async function flush() {
    for (let n = 0; n < 30; n++) {
      await Promise.resolve();
      if (dirty) render();
    }
  }
  function market(node = tree) {
    if (node?.type === Marker && node.props.onLoadMore) return node.props;
    const children = node?.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) {
      if (child && typeof child === "object") {
        const found = market(child);
        if (found) return found;
      }
    }
  }
  const page = id => ({
    items: [{ id, status: "active" }],
    hasMore: true,
    counts: { activeSales: 0 }
  });
  render();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].limit, 100);
  calls[0].resolve(page("first"));
  await flush();
  market().onLoadMore();
  await flush();
  assert.equal(calls[1].limit, 200);
  calls[1].resolve(page("more"));
  await flush();
  const poll = [...timers.values()].find(timer => timer.delay === 30_000);
  assert.ok(poll);
  poll.callback();
  await flush();
  assert.equal(calls[2].limit, 200);
  market().onQueryChange({
    query: "luffy",
    rarity: "",
    category: "",
    sort: "popular",
    section: "active"
  });
  await flush();
  assert.equal(calls[3].limit, 100);
  assert.equal(calls[3].query.query, "luffy");
  calls[3].resolve(page("new-filter"));
  await flush();
  calls[2].resolve(page("stale-old-filter"));
  await flush();
  assert.deepEqual(
    market().marketPage.items.map(item => item.id),
    ["new-filter"]
  );
  assert.equal(market().marketLimit, 100);
  for (const slot of slots) slot?.cleanup?.();
});
