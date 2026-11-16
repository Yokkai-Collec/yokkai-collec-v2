import assert from "node:assert/strict";
import test from "node:test";
import { licenseName } from "./helpers/license-name.mjs";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import * as jsx from "react/jsx-runtime";
const flush = () => new Promise(setImmediate);
const compile = (file, mocks, globals = {}) => {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      require: n => {
        if (n === "@/lib/ui/license-name") return licenseName;
        if (n in mocks) return mocks[n];
        throw Error(n);
      },
      ...globals
    }
  );
  return exports;
};
function harness(locale = "en") {
  const states = [],
    refs = [],
    effects = [],
    queued = [];
  let si = 0,
    ri = 0,
    ei = 0;
  const hook = {
    ...React,
    useState: initial => {
      const i = si++;
      if (!(i in states))
        states[i] = typeof initial === "function" ? initial() : initial;
      return [
        states[i],
        v => (states[i] = typeof v === "function" ? v(states[i]) : v)
      ];
    },
    useRef: initial => (refs[ri++] ??= { current: initial }),
    useCallback: fn => fn,
    useEffect: (fn, deps) => {
      const i = ei++,
        old = effects[i];
      if (!old || deps?.some((v, j) => v !== old.deps[j]))
        queued.push(() => {
          old?.stop?.();
          effects[i] = { deps, stop: fn() };
        });
    }
  };
  const messages = JSON.parse(
    fs.readFileSync(`messages/${locale}.json`, "utf8")
  );
  const intl = {
    useTranslations: namespace =>
      createTranslator({ locale, messages, namespace }),
    useFormatter: () => ({ number: n => String(n) })
  };
  const pack = compile("lib/ui/pack-opening.ts", { "@/lib/ui/animations": {} });
  const ui = {
    Button: ({ children, variant, ...props }) =>
      React.createElement("button", props, children),
    Modal: () => null,
    SelectionBar: () => null,
    SelectionModeButton: () => null,
    StatusPill: () => null
  };
  const api = compile(
    "components/boosters.tsx",
    {
      "react/jsx-runtime": jsx,
      react: hook,
      "next-intl": intl,
      "@/i18n/game-messages": { gameErrorKey: x => x },
      "@/lib/ui/card-rarity-label": { cardRarityLabel: r => r },
      "next/link": { default: () => null },
      "next/dynamic": { default: () => () => null },
      "@/components/referral-reminder": { ReferralReminder: () => null },
      "@/components/ambient-glow": { AmbientGlow: () => null },
      "@/components/card-sharing": { CardShareButton: () => null },
      "@/components/ui": ui,
      "@/components/yokai-card": {
        CardBack: () => null,
        YokaiCard: ({ name }) =>
          React.createElement("span", { "data-art": name }, name)
      },
      "@/lib/ui/pack-opening": pack,
      "@/lib/ui/animations": {}
    },
    {
      process: { env: { NODE_ENV: "development" } },
      AbortController,
      window: { clearTimeout() {}, setTimeout: () => 1 },
      clearTimeout() {}
    }
  );
  return {
    render: props => {
      si = ri = ei = 0;
      return renderToStaticMarkup(api.BoosterReveal(props));
    },
    effects: () => {
      for (const fn of queued.splice(0)) fn();
    },
    stop: () => effects.forEach(e => e?.stop?.())
  };
}
const cards = Array.from({ length: 5 }, (_, i) => ({
  id: `c${i}`,
  instanceId: `copy${i}`,
  name: `Character ${i}`,
  category: "ANIME/MANGA",
  rarity: "C",
  image: "image",
  isNew: true
}));
const base = {
  cards,
  revealed: 5,
  previewOnly: true,
  onReveal() {},
  onReturn() {}
};
for (const locale of ["en", "fr"])
  test(`favorite stars render exact labels and accessible descriptions in ${locale}`, async () => {
    const h = harness(locale);
    let calls = 0;
    const props = {
      ...base,
      loadFavoriteCards: async ids => {
        calls++;
        assert.deepEqual(
          [...ids],
          cards.map(c => c.id)
        );
        return ["c1", "c4"];
      }
    };
    let html = h.render(props);
    assert(!html.includes("yk-drop-favorite"));
    h.effects();
    await flush();
    html = h.render(props);
    assert.equal((html.match(/yk-drop-favorite/g) || []).length, 2);
    assert.match(html, /aria-describedby="pack-favorite-copy1"/);
    assert.match(html, /id="pack-favorite-copy1"/);
    assert(
      html.includes(
        locale === "fr" ? "Collection favorite" : "Favorite collection"
      )
    );
    h.render({ ...props, cards: cards.map(c => ({ ...c })) });
    h.effects();
    await flush();
    assert.equal(calls, 1, "rerenders do not request every card again");
    h.stop();
  });
test("late or failed favorite reads cannot decorate another opening or change its rewards", async () => {
  const h = harness();
  const requests = [];
  let mutations = 0;
  const loadFavoriteCards = (ids, signal) =>
    new Promise((resolve, reject) =>
      requests.push({ ids, signal, resolve, reject })
    );
  const props = {
    ...base,
    loadFavoriteCards,
    onDiscard: async () => {
      mutations++;
    }
  };
  h.render(props);
  h.effects();
  assert.equal(requests.length, 1);
  const next = {
    ...props,
    cards: cards.map(c => ({ ...c, instanceId: `next-${c.instanceId}` }))
  };
  h.render(next);
  h.effects();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve(["c1"]);
  await flush();
  assert(!h.render(next).includes("yk-drop-favorite"));
  requests[1].reject(Error("offline"));
  await flush();
  const html = h.render(next);
  assert(!html.includes("yk-drop-favorite"));
  assert.equal((html.match(/data-art=/g) || []).length, 5);
  assert.equal(mutations, 0);
  h.stop();
});
test("favorite batch reader sends only distinct card IDs and rejects foreign projections", async () => {
  for (const stable of [true, false]) {
    let args, signal;
    const api = compile(
      "lib/data/pack-favorites.ts",
      {
        "@/lib/data/read-request": {
          readRequest: fn => fn(new AbortController().signal)
        },
        "@/utils/supabase/client": {
          createClient: () => ({
            rpc: (name, p) => {
              assert.equal(name, "get_pack_favorite_card_ids");
              args = p;
              return {
                abortSignal: s => {
                  signal = s;
                  return Promise.resolve({
                    data: ["a", "foreign"],
                    error: null
                  });
                }
              };
            }
          })
        }
      },
      {
        process: {
          env: { NEXT_PUBLIC_STABLE_BINDERS_ENABLED: String(stable) }
        },
        AbortSignal
      }
    );
    const caller = new AbortController();
    assert.deepEqual(
      [...(await api.getPackFavoriteCardIds(["a", "a", "b"], caller.signal))],
      ["a"]
    );
    assert.deepEqual([...args.p_card_ids], ["a", "b"]);
    assert.equal(args.p_stable, stable);
    assert(!("p_owner" in args));
    caller.abort();
    assert.equal(signal.aborted, true);
  }
});
