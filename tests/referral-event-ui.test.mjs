import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createTranslator } from "next-intl";
import { intl } from "./helpers/i18n.mjs";

const require = createRequire(import.meta.url);
const event = {
  id: "event",
  startsAt: "2026-11-14T19:00:00Z",
  endsAt: "2026-11-28T19:00:00Z",
  serverNow: "2026-11-15T19:00:00Z",
  validCount: 4,
  pending: ["Kitsune <secret>"],
  tiers: [
    { threshold: 3, karas: 400, awarded: true, badge: false },
    { threshold: 5, karas: 750, awarded: false, badge: false },
    { threshold: 10, karas: 1600, awarded: false, badge: false },
    { threshold: 20, karas: 4000, awarded: false, badge: true }
  ]
};
function load(file, state) {
  const exports = {};
  let index = 0;
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      require: name => {
        if (name === "react")
          return {
            ...React,
            useState: initial => [state ? state[index++] : initial, () => {}],
            useEffect: () => {}
          };
        if (name === "next-intl") return intl;
        if (name === "next/link")
          return {
            __esModule: true,
            default: props => React.createElement("a", props)
          };
        if (name.endsWith(".css")) return {};
        if (name === "@/utils/supabase/client")
          return {
            createClient: () => {
              throw Error("SSR must not query or award anything");
            }
          };
        return require(name);
      }
    }
  );
  return exports;
}

test("event page exposes server progress, cumulative tiers, escaped pending pseudos and a countdown", () => {
  const { ReferralEventPanel, ReferralEventHubCard } = load(
    "components/referral-event.tsx"
  );
  const html = renderToStaticMarkup(
    React.createElement(ReferralEventPanel, { initialEvent: event })
  );
  assert.match(html, /4<\/strong>/);
  assert.match(html, /value="4" max="5"|max="5" value="4"/);
  assert.equal((html.match(/data-reached="true"/g) ?? []).length, 1);
  assert.equal((html.match(/data-reached="false"/g) ?? []).length, 3);
  assert.match(html, /Kitsune &lt;secret&gt;/);
  assert.match(html, /Recruiter/);
  assert.match(html, /13d 0h 0m 0s/);
  assert.match(html, /1 more valid referral to unlock 750 Karas/);
  assert.match(readFileSync("app/layout.tsx", "utf8"), /"referralEvent"/);
  const card = renderToStaticMarkup(
    React.createElement(ReferralEventHubCard, {
      event,
      now: Date.parse(event.serverNow)
    })
  );
  assert.match(card, /href="\/referral-event"/);
  assert.match(card, /View Referral Event/);
  assert.match(card, /13d 0h 0m 0s/);
});

test("promotion is visible only during the event, with an accessible destination", () => {
  for (const [now, visible] of [
    [event.startsAt, true],
    [event.endsAt, false],
    ["2026-11-13T19:00:00Z", false]
  ]) {
    const { ReferralEventPromotion } = load("components/referral-event.tsx", [
      event,
      Date.parse(now),
      false
    ]);
    const html = renderToStaticMarkup(
      React.createElement(ReferralEventPromotion)
    );
    assert.equal(html.includes('href="/referral-event"'), visible);
  }
});

test("milestone notifications share translated EN/FR content for push and inbox", () => {
  const { notificationItem } = load("lib/notification-item.ts");
  for (const locale of ["en", "fr"]) {
    const messages = JSON.parse(
      readFileSync(`messages/${locale}.json`, "utf8")
    );
    const item = notificationItem(
      {
        id: "n",
        type: "referral_event_tier",
        referenceId: "receipt",
        createdAt: event.serverNow,
        readAt: null,
        referralReward: 750
      },
      createTranslator({ locale, messages, namespace: "topbar" })
    );
    assert.equal(item.href, "/referral-event");
    assert.match(item.text, /750 Karas/);
    assert.equal(item.kind, "mission");
  }
});
