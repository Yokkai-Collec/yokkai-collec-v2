import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { createRequire } from "node:module";
import { anticheatSanctionLabels } from "./helpers/anticheat-sanction-labels.mjs";
const require = createRequire(import.meta.url);
export function noticeHarness(
  locale = "en",
  { ack = true, type = "SMURF_ASSET_RECOVERY" } = {}
) {
  const receipt = {
    sanction_id: "ac680000-0000-4000-8000-000000000001",
    sanction_type: type,
    cards_removed: 11,
    kara_removed: 2200
  };
  const effects = [],
    calls = [],
    states = [],
    timers = [];
  let state = 0;
  const messages = JSON.parse(
    fs.readFileSync(`messages/${locale}.json`, "utf8")
  );
  const exports = {};
  const rpc = (name, args) => {
    calls.push([name, args]);
    return name === "get_my_pending_sanctions"
      ? {
          setHeader: (key, value) => {
            calls.push(["header", key, value]);
            return Promise.resolve({ data: [receipt], error: null });
          }
        }
      : Promise.resolve({ data: ack, error: null });
  };
  const document = {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("components/account-sanction-notice.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX
        }
      }
    ).outputText,
    {
      exports,
      document,
      setTimeout,
      setInterval: (fn, ms) => {
        timers.push({ fn, ms });
        return 7;
      },
      clearInterval: id => calls.push(["clearInterval", id]),
      require: name =>
        name === "react"
          ? {
              ...React,
              useEffect: fn => effects.push(fn),
              useId: () => "sanction-title",
              useRef: () => ({ current: null }),
              useState: initial => {
                const n = state++;
                return [
                  n === 0 ? [receipt] : initial,
                  value => states.push([n, value])
                ];
              }
            }
          : name === "next/navigation"
            ? { usePathname: () => "/market" }
            : name === "next-intl"
              ? {
                  useTranslations: namespace =>
                    createTranslator({ locale, messages, namespace })
                }
              : name === "@/utils/supabase/client"
                ? {
                    createClient: () => ({
                      rpc,
                      auth: {
                        getSession: async () => ({ data: { session: {} } }),
                        onAuthStateChange: () => ({
                          data: { subscription: { unsubscribe: () => {} } }
                        })
                      }
                    })
                  }
                : name === "@/lib/anticheat-sanction-labels"
                  ? anticheatSanctionLabels
                  : name.endsWith(".css")
                    ? {}
                    : require(name)
    }
  );
  const node = exports.AccountSanctionNotice();
  return {
    node,
    html: renderToStaticMarkup(node),
    effects,
    calls,
    states,
    timers
  };
}
test("recovery notice shows exact counts and the multi-account reason in both languages", () => {
  for (const locale of ["en", "fr"]) {
    const h = noticeHarness(locale);
    assert.match(h.html, /<dd>11<\/dd>/);
    assert.match(h.html, /<dd>2200<\/dd>/);
    assert.match(
      h.html,
      locale === "fr"
        ? /Sanction appliquée : récupération des actifs/
        : /Sanction applied: assets recovered/
    );
    assert.doesNotMatch(h.html, /referral|parrainage|50%/);
    assert.match(h.html, /aria-labelledby="sanction-title"/);
    let prevented = false;
    h.node.props.onCancel({
      preventDefault: () => {
        prevented = true;
      }
    });
    assert.equal(prevented, true);
  }
});
test("only a committed acknowledgement dismisses the receipt; failures remain visible", async () => {
  for (const ack of [false, true]) {
    const h = noticeHarness("en", { ack });
    const button = React.Children.toArray(h.node.props.children).find(
      n => n.type === "button"
    );
    button.props.onClick();
    await new Promise(setImmediate);
    assert.equal(h.calls[0][0], "acknowledge_my_sanction");
    assert.equal(
      h.states.some(([i]) => i === 0),
      ack
    );
    assert.equal(
      h.states.some(([i, value]) => i === 2 && value === true),
      !ack
    );
  }
});
test("visible pages poll with an explicit compatible client marker and clean up the timer", async () => {
  const h = noticeHarness();
  const cleanup = h.effects[0]();
  await new Promise(setImmediate);
  assert.equal(h.timers[0].ms, 30000);
  assert.deepEqual(
    h.calls.find(c => c[0] === "header"),
    ["header", "x-client-info", "yokkai-assets-notice-v1"]
  );
  cleanup();
  assert.ok(h.calls.some(c => c[0] === "clearInterval" && c[1] === 7));
});
