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

test("restoration waits for grid height and uses the opened auction as an anchor", () => {
  const f = fixture();
  let finished = 0;
  const root = {
    querySelectorAll: () => [
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
