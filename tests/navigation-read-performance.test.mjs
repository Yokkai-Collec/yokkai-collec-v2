import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import nextTesting from "next/experimental/testing/server.js";
import { anticheatSanctionLabels } from "./helpers/anticheat-sanction-labels.mjs";
function compile(file, mocks, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    }).outputText,
    {
      exports,
      require: n => {
        if (n in mocks) return mocks[n];
        throw Error(n);
      },
      ...globals
    }
  );
  return exports;
}
const flush = () => new Promise(setImmediate);
test("pseudo and balance share a request-local snapshot; another request or session never shares it", async () => {
  let reads = 0,
    user = "A",
    balance = 100;
  const reset = [];
  const clients = new Map();
  const client = () => {
    if (!clients.has(user)) {
      const identity = user;
      clients.set(user, {
        rpc: async () => {
          reads++;
          return {
            data: { user: { name: identity }, karasBalance: balance },
            error: null
          };
        }
      });
    }
    return clients.get(user);
  };
  const api = compile("lib/auth/session.ts", {
    "server-only": {},
    "next/headers": { cookies: async () => ({}) },
    "@/utils/supabase/server": { createClient: client },
    react: {
      cache: fn => {
        let entries = [];
        reset.push(() => {
          entries = [];
        });
        return (...args) => {
          const found = entries.find(
            e =>
              e.args.length === args.length &&
              e.args.every((v, i) => v === args[i])
          );
          if (found) return found.value;
          const value = fn(...args);
          entries.push({ args, value });
          return value;
        };
      }
    }
  });
  assert.deepEqual(
    await Promise.all([
      api.getCurrentPseudo("caller-id-is-not-identity"),
      api.getCurrentKarasBalance()
    ]),
    ["A", 100]
  );
  assert.equal(reads, 1);
  balance = 25;
  for (const clear of reset) clear();
  assert.equal(await api.getCurrentKarasBalance(), 25);
  assert.equal(reads, 2);
  user = "B";
  balance = 7;
  for (const clear of reset) clear();
  assert.equal(await api.getCurrentPseudo("A"), "B");
  assert.equal(await api.getCurrentKarasBalance(), 7);
  assert.equal(reads, 3);
});
test("public artwork uses bounded cache headers, never personalized routes or APIs", async () => {
  const config = compile(
    "next.config.ts",
    { "next-intl/plugin": () => config => config },
    { URL, process: { env: { NODE_ENV: "production" } } }
  ).default;
  const rules = await config.headers();
  const actualFiles = fs
    .readdirSync("public/assets", { withFileTypes: true })
    .filter(
      entry =>
        entry.isFile() && /\.(png|webp|svg|jpe?g|gif|ico)$/.test(entry.name)
    )
    .map(entry => "/assets/" + entry.name)
    .sort();
  assert.deepEqual(
    Array.from(rules)
      .filter(
        rule =>
          rule.source.startsWith("/assets/") &&
          rule.source !== "/assets/sfx/:path*"
      )
      .map(rule => rule.source)
      .sort(),
    actualFiles
  );
  for (const path of [
    "/assets/chrome-regular-booster-v1.png",
    "/assets/regular-opening-nebula.webp"
  ]) {
    const response = await nextTesting.unstable_getResponseFromNextConfig({
      url: "https://example.test" + path,
      nextConfig: config
    });
    assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
  for (const path of [
    "/assets/missing-artwork.png",
    "/assets/private",
    "/collection",
    "/profile/me",
    "/api/pro/benefits",
    "/api/pro/profile-style",
    "/api/profile-wall/media/private.webp"
  ]) {
    const response = await nextTesting.unstable_getResponseFromNextConfig({
      url: "https://example.test" + path,
      nextConfig: config
    });
    assert.equal(response.headers.get("cache-control"), null);
  }
});
test("presence does not restart its throttle for each normal route change and still sleeps in background", () => {
  let path = "/friends",
    effect,
    deps,
    calls = 0;
  const listeners = new Map();
  const document = {
    visibilityState: "visible",
    addEventListener: (n, f) => listeners.set(n, f),
    removeEventListener: n => listeners.delete(n)
  };
  const api = compile(
    "components/presence-heartbeat.tsx",
    {
      "@/components/boosters-load-priority": {
        useBoostersLoadPriority: () => 2
      },
      "next/navigation": { usePathname: () => path },
      react: {
        useEffect: (fn, next) => {
          if (!deps || next.some((v, i) => v !== deps[i])) {
            deps = next;
            effect = fn;
          }
        }
      },
      "@/lib/data/friends": {
        touchPresence: async () => {
          calls++;
        }
      }
    },
    { document, window: document, Date }
  );
  api.PresenceHeartbeat();
  const stop = effect();
  assert.equal(calls, 1);
  const first = effect;
  path = "/market";
  api.PresenceHeartbeat();
  assert.equal(effect, first);
  listeners.get("pointerdown")();
  assert.equal(calls, 1);
  document.visibilityState = "hidden";
  listeners.get("scroll")();
  assert.equal(calls, 1);
  stop();
  assert.equal(listeners.size, 0);
});
test("notice bursts never overlap and a changed account cannot receive a stale response", async () => {
  let effect,
    auth,
    interval,
    session = { user: { id: "A" } },
    reads = 0,
    inflight = 0,
    max = 0;
  const resolves = [],
    states = [],
    listeners = new Map();
  const document = {
    visibilityState: "visible",
    addEventListener: (n, f) => listeners.set(n, f),
    removeEventListener: n => listeners.delete(n)
  };
  const api = compile(
    "components/account-sanction-notice.tsx",
    {
      "@/lib/anticheat-sanction-labels": anticheatSanctionLabels,
      "react/jsx-runtime": jsx,
      react: {
        useEffect: fn => {
          effect ??= fn;
        },
        useId: () => "",
        useRef: () => ({ current: null }),
        useState: initial => [initial, value => states.push(value)]
      },
      "next-intl": { useTranslations: () => key => key },
      "@/styles/account-sanctions.css": {},
      "@/utils/supabase/client": {
        createClient: () => ({
          auth: {
            getSession: async () => ({ data: { session } }),
            onAuthStateChange: fn => {
              auth = fn;
              return { data: { subscription: { unsubscribe() {} } } };
            }
          },
          rpc: () => ({
            setHeader: () => {
              reads++;
              max = Math.max(max, ++inflight);
              return new Promise(resolve =>
                resolves.push(data => {
                  inflight--;
                  resolve({ data, error: null });
                })
              );
            }
          })
        })
      }
    },
    {
      document,
      setTimeout,
      setInterval: fn => {
        interval = fn;
        return 1;
      },
      clearInterval() {}
    }
  );
  api.AccountSanctionNotice();
  const stop = effect();
  await flush();
  assert.equal(reads, 1);
  for (let i = 0; i < 6; i++) interval();
  assert.equal(reads, 1);
  resolves.shift()([{ id: "first" }]);
  await flush();
  assert.equal(reads, 2);
  session = { user: { id: "B" } };
  auth("SIGNED_IN", session);
  await new Promise(resolve => setTimeout(resolve, 10));
  resolves.shift()([{ id: "stale-A" }]);
  await flush();
  assert.equal(reads, 3);
  assert(
    !states.some(s => Array.isArray(s) && s.some(x => x.id === "stale-A"))
  );
  resolves.shift()([{ id: "fresh-B" }]);
  await flush();
  assert(states.some(s => Array.isArray(s) && s.some(x => x.id === "fresh-B")));
  assert.equal(max, 1);
  document.visibilityState = "hidden";
  interval();
  await flush();
  assert.equal(reads, 3);
  stop();
});
