import { intl } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

function fixture(view = "packs") {
  let now = 0,
    id = 0,
    stateIndex = 0;
  const timers = new Map(),
    effects = [],
    cleanups = [],
    calls = [],
    updates = [],
    modules = new Map();
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    visibilityState: "visible"
  });
  const window = new EventTarget();
  window.setInterval = (callback, delay) => {
    const key = ++id;
    timers.set(key, { callback, delay, next: now + delay });
    return key;
  };
  window.clearInterval = key => timers.delete(key);
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  const react = {
    useState: initial => {
      const key = stateIndex++;
      let value = initial;
      return [
        initial,
        next => {
          value = typeof next === "function" ? next(value) : next;
          updates.push({ key, value });
        }
      ];
    },
    useRef: value => ({ current: value }),
    useCallback: callback => callback,
    useMemo: factory => factory(),
    useEffect: callback => effects.push(callback)
  };
  let notifications = [],
    release;
  const failedOnce = new Set();
  let blocked = false;
  let blockedNotifications = false;
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "player" } } }
      }),
      onAuthStateChange() {}
    },
    async rpc(name) {
      calls.push({ name, time: now });
      if (failedOnce.delete(name))
        return { data: null, error: { message: "initial request failed" } };
      if (name === "list_notifications" && blockedNotifications)
        await new Promise(() => {});
      if (name === "get_regular_pack_status" && blocked)
        await new Promise(resolve => {
          release = resolve;
        });
      const data =
        name === "get_game_info"
          ? {
              user: { id: "player", name: "Player" },
              categories: [],
              rarities: [],
              dropRates: [],
              shinyRate: 0,
              karasBalance: 100
            }
          : name === "get_regular_pack_status"
            ? { available: 0, maximum: 5, nextPackAt: 60_000, serverNow: now }
            : name === "get_decision_pack_status"
              ? {
                  available: false,
                  nextPackAt: 86_400_000,
                  serverNow: now,
                  pending: []
                }
              : name === "list_notifications"
                ? notifications
                : [];
      return { data, error: null };
    },
    from(name) {
      const query = {
        then(resolve) {
          calls.push({ name, time: now });
          return Promise.resolve(
            failedOnce.delete(name)
              ? { data: null, error: { message: "initial request failed" } }
              : { data: [], error: null }
          ).then(resolve);
        }
      };
      for (const method of [
        "select",
        "eq",
        "order",
        "limit",
        "gt",
        "in",
        "abortSignal"
      ])
        query[method] = () => query;
      return query;
    }
  };
  const originalRpc = client.rpc.bind(client);
  client.rpc = (...args) => {
    const promise = originalRpc(...args);
    promise.abortSignal = () => promise;
    return promise;
  };
  const stubs = {
    "@/components/boosters-load-priority": { releaseBoostersBackground() {} },
    react,
    "react/jsx-runtime": {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props })
    },
    "@/utils/supabase/client": { createClient: () => client },
    "@/hooks/use-sfx": { useSfx: () => ({ play() {} }) },
    "@/components/collection": {},
    "@/components/collection-loading": {},
    "@/components/boosters": {},
    "@/components/topbar": {},
    "@/lib/data/market": {}
  };
  function load(name) {
    if (name === "next-intl") return intl;
    if (stubs[name]) return stubs[name];
    if (!name.startsWith("@/")) return require(name);
    if (modules.has(name)) return modules.get(name);
    const base = new URL(`../${name.slice(2)}`, import.meta.url);
    const file = new URL(
      base.href + (existsSync(new URL(base.href + ".tsx")) ? ".tsx" : ".ts")
    );
    const exports = {};
    modules.set(name, exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText;
    vm.runInNewContext(code, {
      exports,
      require: load,
      window,
      document,
      Event,
      Set,
      Map,
      Promise,
      console,
      Date: class extends Date {
        static now() {
          return now;
        }
      },
      process: { env: { NODE_ENV: "production" } },
      clearInterval: window.clearInterval,
      setTimeout,
      clearTimeout,
      AbortController,
      BroadcastChannel: undefined
    });
    return exports;
  }
  const cards = load("@/lib/data/cards");
  load("@/components/game").Game({ view });
  const feed = load("@/hooks/use-notification-feed").useNotificationFeed();
  const flush = async () => {
    for (let i = 0; i < 120; i++) await Promise.resolve();
  };
  return {
    calls,
    updates,
    timers,
    feed,
    async mount() {
      for (const effect of effects) {
        const cleanup = effect();
        if (cleanup) cleanups.push(cleanup);
      }
      await flush();
    },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const pending = [...timers.entries()]
          .filter(([, timer]) => timer.next <= end)
          .sort((a, b) => a[1].next - b[1].next)[0];
        if (!pending) break;
        const [key, timer] = pending;
        now = timer.next;
        timer.next += timer.delay;
        if (timers.has(key)) timer.callback();
        await flush();
      }
      now = end;
      await flush();
    },
    async hidden(value) {
      document.hidden = value;
      document.visibilityState = value ? "hidden" : "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      await flush();
    },
    async invalidate(scopes) {
      cards.invalidatePlayerSnapshots(scopes);
      await flush();
    },
    async notification(type) {
      notifications = [{ id: "new-event", type }];
      await feed.refresh();
      await flush();
    },
    async refreshNotifications() {
      await feed.refresh();
      await flush();
    },
    blockNotifications(value = true) {
      blockedNotifications = value;
    },
    failFirstRequests(names) {
      for (const name of names) failedOnce.add(name);
    },
    blockPacks() {
      blocked = true;
    },
    async unblockPacks() {
      blocked = false;
      release?.();
      await flush();
    },
    unmount() {
      for (const cleanup of cleanups) cleanup();
    }
  };
}

test("Game and notifications make no requests while hidden, including invalidations", async () => {
  const f = fixture();
  await f.mount();
  await f.hidden(true);
  f.calls.length = 0;
  f.updates.length = 0;
  await f.advance(60_000);
  await f.invalidate(["balance", "collection"]);
  await f.refreshNotifications();
  assert.deepEqual(f.calls, []);
  assert.equal(f.timers.size, 0);
  assert.equal(f.updates.length, 0);
  await f.hidden(false);
  assert.ok(f.calls.some(call => call.name === "user_cards"));
  assert.ok(f.calls.some(call => call.name === "get_license_folders"));
  assert.ok(f.calls.some(call => call.name === "list_notifications"));
  f.unmount();
  assert.equal(f.timers.size, 0);
});

test("visible idle Game refreshes only needed status; the countdown stays local", async () => {
  for (const [view, expected] of [
    // Notifications poll once a minute as a Realtime fallback.
    ["packs", 6],
    ["collection", 4]
  ]) {
    const f = fixture(view);
    await f.mount();
    f.calls.length = 0;
    await f.advance(60_000);
    assert.equal(f.calls.length, expected, `${view}: requests per minute`);
    assert.ok(
      !f.calls.some(
        call =>
          call.name === "get_license_folders" || call.name === "user_cards"
      )
    );
    assert.equal(
      f.updates.filter(update => update.key === 12).at(-1).value,
      60_000
    );
    assert.ok(
      !f.updates.some(update => update.key === 7 || update.key === 8),
      "polling must not change the reveal"
    );
    f.unmount();
  }
});

test("new remote notifications invalidate only changed snapshots, once", async () => {
  const f = fixture();
  await f.mount();
  f.calls.length = 0;
  await f.notification("auction_won");
  assert.deepEqual(f.calls.map(call => call.name).sort(), [
    "get_game_info",
    "get_my_active_auction_cards",
    "list_notifications",
    "user_cards"
  ]);
  f.calls.length = 0;
  await f.refreshNotifications();
  assert.deepEqual(
    f.calls.map(call => call.name),
    ["list_notifications"]
  );
  f.calls.length = 0;
  await f.invalidate(["balance"]);
  assert.deepEqual(
    f.calls.map(call => call.name),
    ["get_game_info"]
  );
  f.unmount();
});

test("slow Game requests never stack interval refreshes", async () => {
  const f = fixture();
  f.blockPacks();
  await f.mount();
  await f.advance(60_000);
  assert.equal(
    f.calls.filter(call => call.name === "get_regular_pack_status").length,
    1
  );
  await f.unblockPacks();
  f.unmount();
});

test("notifications timeout releases inFlight and retry makes a fresh request", async () => {
  const f = fixture();
  f.blockNotifications();
  await f.mount();
  await new Promise(resolve => setTimeout(resolve, 15050));
  assert.ok(
    f.updates.some(
      update => update.value === "Couldn't load your notifications."
    )
  );
  f.blockNotifications(false);
  await f.refreshNotifications();
  assert.equal(
    f.calls.filter(call => call.name === "list_notifications").length,
    2
  );
  f.unmount();
});

test("failed initial reads retry at the next polling interval", async () => {
  const f = fixture("packs");
  const failed = [
    "get_regular_pack_status",
    "get_decision_pack_status",
    "user_cards",
    "get_license_folders"
  ];
  f.failFirstRequests(failed);
  await f.mount();
  const errors = () =>
    f.updates.filter(update => update.key === 13).at(-1).value;
  for (const key of ["regular", "decision", "collection", "folders"])
    assert.ok(errors()[key], `${key} must report its initial failure`);
  assert.ok(!f.updates.some(update => update.key === 1 && update.value));
  f.calls.length = 0;
  await f.advance(29_999);
  assert.equal(f.calls.length, 0);
  await f.advance(1);
  for (const name of failed)
    assert.equal(
      f.calls.filter(call => call.name === name).length,
      1,
      `${name} must retry once`
    );
  for (const key of ["regular", "decision", "collection", "folders"])
    assert.equal(errors()[key], "");
  assert.ok(f.updates.some(update => update.key === 1 && update.value));
  assert.equal(
    f.updates.filter(update => update.key === 14).at(-1).value,
    true
  );
  f.calls.length = 0;
  await f.advance(30_000);
  for (const name of failed)
    assert.equal(
      f.calls.filter(call => call.name === name).length,
      name.includes("pack_status") ? 1 : 0,
      `${name}: only normal pack polling may continue after a successful retry`
    );
  f.unmount();
});

test("collection starts without pack reads and retries failed card and folder reads", async () => {
  const f = fixture("collection");
  const failed = ["user_cards", "get_license_folders"];
  f.failFirstRequests(failed);
  await f.mount();
  const errors = () =>
    f.updates.filter(update => update.key === 13).at(-1).value;
  for (const key of ["collection", "folders"])
    assert.ok(errors()[key], `${key} must report its initial failure`);
  assert.ok(!f.calls.some(call => /pack_status/.test(call.name)));
  assert.ok(!f.updates.some(update => update.key === 14 && update.value));
  f.calls.length = 0;
  await f.advance(29_999);
  assert.equal(f.calls.length, 0);
  await f.advance(1);
  for (const name of failed)
    assert.equal(f.calls.filter(call => call.name === name).length, 1);
  for (const key of ["collection", "folders"]) assert.equal(errors()[key], "");
  assert.equal(
    f.updates.filter(update => update.key === 14).at(-1).value,
    true
  );
  assert.ok(!f.calls.some(call => /pack_status/.test(call.name)));
  f.calls.length = 0;
  await f.advance(30_000);
  for (const name of failed)
    assert.ok(!f.calls.some(call => call.name === name));
  f.unmount();
});
