import { licenseName } from "./helpers/license-name.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import fs from "node:fs";
import * as jsx from "react/jsx-runtime";
const compile = (path, mocks, globals = {}) => {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      require: name => {
        if (name === "@/lib/ui/license-name") return licenseName;
        if (name in mocks) return mocks[name];
        throw Error("Unexpected " + name);
      },
      ...globals
    }
  );
  return exports;
};
test("ranking reads combine caller cancellation and their existing deadline", async () => {
  const timeout = new AbortController(),
    caller = new AbortController();
  let signal;
  const api = compile(
    "lib/leaderboard/community.ts",
    {
      "@/lib/data/read-request": { readRequest: load => load(timeout.signal) },
      "@/utils/supabase/client": {
        createClient: () => ({
          rpc: () => ({
            abortSignal: value => {
              signal = value;
              return new Promise((_, reject) =>
                value.addEventListener("abort", () => reject(value.reason), {
                  once: true
                })
              );
            }
          })
        })
      }
    },
    { AbortSignal }
  );
  const pending = api.getCommunityRanking(
    "licenses",
    { offset: 0, query: "", friendsOnly: false },
    "source:exact",
    caller.signal
  );
  caller.abort();
  await assert.rejects(pending);
  assert.equal(signal.aborted, true);
});
test("pack progress reuses opening metadata but refreshes authoritative totals for every opening", async () => {
  let enrichment = 0,
    reads = 0;
  const api = compile("lib/data/binder-discovery.ts", {
    "@/lib/data/cards": {
      getPaniniAlbumCardsPage: async () => {
        reads++;
        return { items: [], binderTotal: 10, binderOwned: reads };
      }
    },
    "@/lib/data/binders": {
      stableBindersEnabled: () => true,
      withBinderMetadata: async cards => {
        enrichment++;
        return cards.map(card => ({
          ...card,
          binders: [{ key: "series:one", name: "One" }]
        }));
      }
    },
    "@/lib/ui/binder-discovery": {},
    "@/lib/ui/binder-identity": {
      binderIdentity: b => b.binderKey ?? b.license
    }
  });
  const card = {
    id: "new",
    image: "image",
    binders: [{ key: "series:one", name: "One" }]
  };
  assert.equal((await api.getPackBinderGains([card]))[0].owned, 1);
  assert.equal((await api.getPackBinderGains([card]))[0].owned, 2);
  assert.equal(enrichment, 0);
  assert.equal(reads, 2);
  await api.getPackBinderGains([{ id: "legacy", image: "image" }]);
  assert.equal(enrichment, 1);
});
test("bursts of Home invalidations keep one request in flight and one fresh follow-up", async () => {
  let effect, invalidate, cleanup;
  const pending = [],
    states = [];
  const api = compile("components/home-binders.tsx", {
    react: {
      useState: initial => [initial, value => states.push(value)],
      useEffect: fn => {
        effect = fn;
      }
    },
    "react/jsx-runtime": jsx,
    "next/link": { default: () => null },
    "next-intl": { useTranslations: () => key => key },
    "@/lib/data/binder-discovery": {},
    "@/lib/ui/binder-discovery": { binderHref: () => "/collection" },
    "@/lib/ui/binder-identity": {},
    "@/components/binder-cover": {},
    "@/styles/binder-discovery.css": {},
    "@/lib/data/player-state": {
      subscribePlayerSnapshotInvalidation: callback => {
        invalidate = callback;
        return () => {
          invalidate = () => {};
        };
      }
    }
  });
  api.HomeBinders({
    load: () => new Promise(resolve => pending.push(resolve))
  });
  cleanup = effect();
  for (let i = 0; i < 5; i++) invalidate(["collection"]);
  assert.equal(pending.length, 1);
  pending[0](["obsolete"]);
  await new Promise(setImmediate);
  assert.equal(pending.length, 2);
  assert(
    !states.some(value => Array.isArray(value) && value[0] === "obsolete")
  );
  pending[1](["fresh"]);
  await new Promise(setImmediate);
  assert(states.some(value => Array.isArray(value) && value[0] === "fresh"));
  cleanup();
  invalidate(["collection"]);
  assert.equal(pending.length, 2);
});
