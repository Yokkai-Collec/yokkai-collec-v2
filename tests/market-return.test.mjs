import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(
  readFileSync(new URL("../lib/ui/market-return.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }
).outputText;
const saved = () => ({
  section: "mine",
  mineTab: "won",
  query: "Kingdom",
  rarity: ["LR"],
  category: "ANIME/MANGA",
  sort: "desc",
  limit: 300,
  scrollY: 2400,
  anchorId: "auction-150",
  anchorTop: 170,
  savedAt: Date.now()
});

function fixture({ blocked = false, stored = null } = {}) {
  let value = stored;
  let frameId = 0;
  let timeoutId = 0;
  const timers = new Map();
  let resize;
  const frames = new Map();
  const listeners = new Map();
  const scrolls = [];
  const window = {
    scrollY: 0,
    innerHeight: 800,
    sessionStorage: {
      getItem() {
        if (blocked) throw Error("blocked");
        return value;
      },
      setItem(_, next) {
        if (blocked) throw Error("blocked");
        value = next;
      }
    },
    requestAnimationFrame(fn) {
      frames.set(++frameId, fn);
      return frameId;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout(fn, delay) {
      timers.set(++timeoutId, { fn, delay });
      return timeoutId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener(event, fn) {
      listeners.set(event, fn);
    },
    removeEventListener(event) {
      listeners.delete(event);
    },
    scrollTo(options) {
      scrolls.push(options.top);
      window.scrollY = options.top;
    }
  };
  const document = { documentElement: { scrollHeight: 1000 } };
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    window,
    document,
    ResizeObserver: class {
      constructor(fn) {
        resize = fn;
      }
      observe() {}
      disconnect() {
        resize = undefined;
      }
    }
  });
  return {
    exports,
    window,
    document,
    listeners,
    scrolls,
    tick() {
      const current = [...frames.values()];
      frames.clear();
      current.forEach(fn => fn());
    },
    resize() {
      resize?.();
    },
    timeout() {
      for (const [id, timer] of [...timers]) {
        if (timer.delay === 3000) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    settle() {
      for (const [id, timer] of [...timers]) {
        if (timer.delay === 120) {
          timers.delete(id);
          timer.fn();
        }
      }
    }
  };
}

test("auction return preserves filters, history tab and loaded prefix; storage failures are harmless", () => {
  for (const blocked of [false, true]) {
    const f = fixture({ blocked });
    const state = saved();
    f.exports.rememberMarketReturn(state);
    assert.deepEqual(
      JSON.parse(JSON.stringify(f.exports.readMarketReturn())),
      state
    );
    const query = f.exports.marketReturnQuery(state);
    assert.equal(query.section, "won");
    assert.equal(query.sort, "end");
    assert.equal(query.query, "Kingdom");
    assert.equal(query.rarity[0], "LR");
    assert.equal(f.exports.readMarketReturn().limit, 300);
  }
  const f = fixture({ stored: JSON.stringify(saved()) });
  assert.equal(f.exports.readMarketReturn().anchorId, "auction-150");
});

test("navigation snapshots change on return, not while leaving a still-visible cached list", () => {
  const f = fixture();
  const store = f.exports.createMarketReturnStore();
  assert.equal(store.getServerSnapshot(), undefined);
  assert.equal(store.getSnapshot(), null);
  let notified = 0;
  const unsubscribe = store.subscribe(() => notified++);
  const state = saved();
  f.exports.rememberMarketReturn(state);
  assert.equal(
    store.getSnapshot(),
    null,
    "departure cannot start restoration in the outgoing page"
  );
  unsubscribe();
  const stop = store.subscribe(() => notified++);
  assert.equal(store.getSnapshot().anchorId, state.anchorId);
  const second = { ...state, anchorId: "auction-170", scrollY: 3200 };
  f.exports.rememberMarketReturn(second);
  assert.equal(store.getSnapshot().anchorId, state.anchorId);
  stop();
  store.subscribe(() => notified++);
  assert.equal(store.getSnapshot().anchorId, second.anchorId);
  assert.equal(store.getSnapshot().scrollY, 3200);
  assert.equal(notified, 3);
});

test("expired and invalid stored navigation is ignored", () => {
  for (const patch of [
    { savedAt: Date.now() - 31 * 60_000 },
    { savedAt: Date.now() + 60000 },
    { limit: 999999 },
    { limit: 0 },
    { scrollY: -1 },
    { rarity: ["INVALID"] },
    { section: "invalid" },
    { mineTab: "invalid" },
    { sort: "invalid" }
  ]) {
    assert.equal(
      fixture({
        stored: JSON.stringify({ ...saved(), ...patch })
      }).exports.readMarketReturn(),
      null
    );
  }
  assert.equal(
    fixture({ stored: "broken json" }).exports.readMarketReturn(),
    null
  );
});

test("instant return content is memory-only, bound to the authenticated viewer and exact departure", () => {
  const f = fixture();
  const state = saved();
  const content = {
    viewerId: "player-a",
    items: [{ id: state.anchorId }],
    page: { items: [], hasMore: false }
  };
  f.exports.rememberMarketReturn(state, content);
  assert.equal(f.exports.readMarketReturnContent(state, "player-a"), content);
  assert.equal(f.exports.readMarketReturnContent(state, "player-b"), null);
  assert.equal(f.exports.readMarketReturnContent(state), null);
  assert.equal(
    f.exports.readMarketReturnContent(
      { ...state, savedAt: state.savedAt - 1 },
      "player-a"
    ),
    null
  );
  const reloaded = fixture({ stored: JSON.stringify(state) });
  assert.equal(
    reloaded.exports.readMarketReturnContent(state, "player-a"),
    null
  );
});

test("restoration waits for grid height and uses the opened auction as an anchor", () => {
  const f = fixture();
  let finished = 0;
  const root = {
    querySelectorAll: () =>
      f.document.documentElement.scrollHeight < 6000
        ? []
        : [
            {
              dataset: { marketAuction: "auction-150" },
              getBoundingClientRect: () => ({ top: 2570 - f.window.scrollY })
            }
          ]
  };
  f.exports.restoreMarketScroll(saved(), root, () => finished++);
  f.tick();
  f.tick();
  assert.deepEqual(f.scrolls, [], "do not clamp to the short loading page");
  f.document.documentElement.scrollHeight = 6000;
  f.resize();
  f.tick();
  assert.deepEqual(f.scrolls, [2400]);
  // A late native Back restoration must not override the restored grid.
  f.window.scrollY = 50;
  f.settle();
  f.tick();
  f.settle();
  assert.equal(f.window.scrollY, 2400);
  assert.equal(finished, 1);
  assert.equal(f.listeners.size, 0);
});

test("return skips the page entrance scale before measuring and restoring the anchor", () => {
  const f = fixture();
  f.document.documentElement.scrollHeight = 6000;
  const transition = { style: { animation: "page-enter" } };
  const value = { ...saved(), anchorTop: 170 };
  const root = {
    closest: () => transition,
    querySelectorAll: () => [
      {
        dataset: { marketAuction: value.anchorId },
        getBoundingClientRect: () => ({
          top:
            (transition.style.animation === "none" ? 2570 : 2640) -
            f.window.scrollY
        })
      }
    ]
  };
  f.exports.restoreMarketScroll(value, root, () => {});
  assert.equal(f.window.scrollY, 2400);
  assert.equal(transition.style.animation, "none");
  f.settle();
});

test("a bottom-row hover offset clamps immediately instead of leaving the page at the top", () => {
  const f = fixture();
  f.document.documentElement.scrollHeight = 2147;
  const value = { ...saved(), scrollY: 1347, anchorTop: 378.6 };
  const root = {
    querySelectorAll: () => [
      {
        dataset: { marketAuction: value.anchorId },
        getBoundingClientRect: () => ({ top: 1728.8 - f.window.scrollY })
      }
    ]
  };
  f.exports.restoreMarketScroll(value, root, () => {});
  assert.deepEqual(
    f.scrolls,
    [1347],
    "hover shift must not defer restoration to the timeout"
  );
  f.settle();
  assert.equal(f.listeners.size, 0);
});

test("a removed auction falls back to its saved scroll; scrolling cancels pending restoration", () => {
  const f = fixture();
  f.document.documentElement.scrollHeight = 6000;
  f.exports.restoreMarketScroll(
    saved(),
    { querySelectorAll: () => [] },
    () => {}
  );
  f.tick();
  f.tick();
  f.settle();
  assert.deepEqual(f.scrolls, [2400]);
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    const cancelled = fixture();
    let finished = 0;
    cancelled.exports.restoreMarketScroll(
      saved(),
      { querySelectorAll: () => [] },
      () => finished++
    );
    cancelled.listeners.get(event)();
    cancelled.document.documentElement.scrollHeight = 6000;
    cancelled.resize();
    cancelled.tick();
    cancelled.timeout();
    assert.deepEqual(cancelled.scrolls, []);
    assert.equal(finished, 1);
    assert.equal(cancelled.listeners.size, 0);
  }
});
