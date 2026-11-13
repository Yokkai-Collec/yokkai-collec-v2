import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";

test("the events hub lists the real event, filters its status, and keeps results separate from the next edition", () => {
  const source = ts.transpileModule(
    readFileSync("components/events-hub.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  for (const locale of ["en", "fr"]) {
    const messages = JSON.parse(
      readFileSync(`messages/${locale}.json`, "utf8")
    );
    let filter = "all";
    let state = { failed: false };
    let referral = { event: null, now: 1 };
    const exports = {};
    vm.runInNewContext(source, {
      exports,
      require: name => {
        if (name === "react/jsx-runtime") return jsx;
        if (name === "react") return { useState: () => [filter, () => {}] };
        if (name === "next-intl")
          return {
            useTranslations: namespace =>
              createTranslator({ locale, messages, namespace })
          };
        if (name === "next/link") return { default: "a" };
        if (name.endsWith("/referral-event"))
          return {
            useReferralEvent: () => referral,
            ReferralEventHubCard: () =>
              jsx.jsx("li", {
                className: "yk-event-card",
                children: jsx.jsx("a", {
                  href: "/referral-event",
                  children: "Referral Event"
                })
              })
          };
        if (name.endsWith("/mystery-auction"))
          return {
            useMysteryAuctionEvent: () => state,
            MysteryCardBack: () => jsx.jsx("div", { "data-mystery-back": true })
          };
        if (name.endsWith("/yokai-card"))
          return {
            YokaiCard: card =>
              jsx.jsx("img", { alt: card.name, src: card.image })
          };
        if (name.endsWith("/ui"))
          return {
            Karas: ({ amount }) => jsx.jsx("span", { children: amount })
          };
        if (name.endsWith("/pack-countdown"))
          return { packCountdown: () => "01:00:00" };
        if (name.endsWith(".css")) return {};
        throw Error(name);
      }
    });
    const render = () => renderToStaticMarkup(jsx.jsx(exports.EventsHub, {}));
    assert.match(render(), /yk-event-card/); // Known event remains discoverable before its migration is deployed.
    assert.doesNotMatch(render(), /<img/);
    const auction = {
      id: "auction",
      status: "active",
      amount: 70,
      endsAt: "2099-01-07T20:00:00Z",
      card: null,
      winner: "Player",
      history: []
    };
    state = {
      event: { auction, nextStartsAt: "2099-01-14T19:00:00Z" },
      now: 1,
      failed: false
    };
    filter = "live";
    assert.match(render(), /href="\/market\/auction"/);
    assert.match(render(), /Player/);
    filter = "upcoming";
    assert.doesNotMatch(render(), /yk-event-card/);
    state.event.auction = {
      ...auction,
      status: "sold",
      card: { name: "Untranslated Card", image: "/card.png" }
    };
    assert.match(render(), /yk-event-card/);
    assert.match(render(), /Untranslated Card/);
    assert.match(render(), />50<\/span>/); // Upcoming edition starts at 50, independently of the last winning bid.
    filter = "live";
    assert.doesNotMatch(render(), /yk-event-card/);
    referral = {
      event: {
        startsAt: "2099-01-01T00:00:00Z",
        endsAt: "2099-01-15T00:00:00Z"
      },
      now: Date.parse("2099-01-02T00:00:00Z")
    };
    assert.match(render(), /href="\/referral-event"/);
    filter = "all";
    assert.equal((render().match(/class="yk-event-card"/g) ?? []).length, 2);
    filter = "upcoming";
    assert.doesNotMatch(render(), /href="\/referral-event"/);
  }
});
