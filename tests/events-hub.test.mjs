import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";

function transpileComponent(path) {
  return ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
}

test("the events hub lists the real event, filters its status, and keeps results separate from the next edition", () => {
  const source = transpileComponent("components/events-hub.tsx");
  const blackMarketSource = transpileComponent("components/black-market.tsx");
  for (const locale of ["en", "fr"]) {
    const messages = JSON.parse(
      readFileSync(`messages/${locale}.json`, "utf8")
    );
    let filter = "all";
    let state = { failed: false };
    let referral = { event: null, now: 1 };
    let blackMarket = { event: undefined, now: 1 };
    let sunset = { event: null, now: 1 };
    const exports = {};
    const blackMarketExports = {};
    const dependencies = {
      require: name => {
        if (name === "react/jsx-runtime") return jsx;
        if (name === "react") return { useState: () => [filter, () => {}] };
        if (name === "next-intl")
          return {
            useTranslations: namespace =>
              createTranslator({ locale, messages, namespace })
          };
        if (name === "next/link") return { default: "a" };
        if (name === "next/image") return { default: () => null };
        if (name === "next/dynamic") return { default: () => () => null };
        if (name === "@/utils/supabase/client") return {};
        if (name.endsWith("/event-banner"))
          return {
            EventBannerFrame: ({ href, label, children }) =>
              jsx.jsx(href ? "a" : "div", {
                href,
                "aria-label": label,
                children
              }),
            EventBannerArt: ({ children }) =>
              children ?? jsx.jsx("div", { "data-event-art": true }),
            EventBannerCountdown: () =>
              jsx.jsx("span", { children: "01:00:00" }),
            EventBannerClockIcon: () => null,
            EventBannerArrow: () => null,
            EventsEmptyArt: () => null
          };
        if (name.endsWith("/event-scene"))
          return { EventCardShowcase: ({ children }) => children };
        if (name.endsWith("/black-market"))
          return {
            ...blackMarketExports,
            useBlackMarketEvent: () => blackMarket
          };
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
        if (name.endsWith("/gta-sunset-event"))
          return {
            useGtaSunsetEvent: () => sunset,
            GtaSunsetHubCard: () =>
              jsx.jsx("li", {
                className: "yk-event-card",
                children: jsx.jsx("a", {
                  href: "/boosters#gta-sunset",
                  children: messages.gtaSunset.title
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
    };
    vm.runInNewContext(blackMarketSource, {
      ...dependencies,
      exports: blackMarketExports
    });
    vm.runInNewContext(source, { ...dependencies, exports });
    const render = () => renderToStaticMarkup(jsx.jsx(exports.EventsHub, {}));
    const home = () =>
      renderToStaticMarkup(jsx.jsx(exports.EventsHub, { home: true }));
    assert.equal(home(), ""); // Home promotes live events only.
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
    assert.match(home(), /href="\/market\/auction"/);
    assert.doesNotMatch(
      home(),
      /yk-events-header|yk-events-toolbar|yk-events-coming-soon/
    );
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
    assert.match(home(), /href="\/referral-event"/);
    assert.doesNotMatch(home(), /href="\/market\/auction"/);
    filter = "all";
    assert.equal((render().match(/class="yk-event-card"/g) ?? []).length, 2);
    assert.match(render(), /class="yk-title mt-3"/);
    assert.match(render(), /aria-pressed="true"[^>]*>[^<]+<span>2<\/span>/);
    assert.equal(
      (render().match(/<span>1<\/span><\/button>/g) ?? []).length,
      2
    );
    filter = "upcoming";
    assert.doesNotMatch(render(), /href="\/referral-event"/);
    state.event.auction = auction;
    assert.match(home(), /yk-home-events-strip/);
    assert.match(home(), /href="\/market\/auction"/);
    assert.match(home(), /href="\/referral-event"/);
    assert.doesNotMatch(home(), /yk-event-card|yk-event-description/);
    blackMarket = {
      event: {
        auctions: [{ endsAt: "2099-01-07T20:00:00Z" }],
        idleStatus: "closed"
      },
      now: 1
    };
    filter = "all";
    assert.match(render(), /href="\/black-market"/);
    assert.match(home(), /href="\/black-market"/);
    assert.match(render(), /aria-pressed="true"[^>]*>[^<]+<span>3<\/span>/);
    filter = "upcoming";
    assert.doesNotMatch(render(), /href="\/black-market"/);
    filter = "live";
    assert.match(render(), /href="\/black-market"/);
    blackMarket.event.auctions = [];
    assert.doesNotMatch(home(), /href="\/black-market"/);
    assert.doesNotMatch(render(), /href="\/black-market"/);
    blackMarket.event.idleStatus = "upcoming";
    filter = "all";
    assert.match(render(), /href="\/black-market"/);
    filter = "upcoming";
    assert.match(render(), /href="\/black-market"/);
    blackMarket.event.startsAt = "2099-01-07T12:00:00Z";
    assert.match(render(), /href="\/black-market"/);
    assert.match(render(), /01:00:00/);
    assert.doesNotMatch(home(), /href="\/black-market"/);
    blackMarket.event = null;
    assert.match(render(), /href="\/black-market"/);
    assert.match(render(), /aria-pressed="true"[^>]*>[^<]+<span>1<\/span>/);
    assert.match(
      render(),
      new RegExp(
        `data-status="upcoming">${messages.blackMarket.comingSoon}</span>`
      )
    );
    assert.match(render(), new RegExp(`${messages.blackMarket.soon}</span>`));
    assert.doesNotMatch(home(), /href="\/black-market"/);
    filter = "live";
    assert.doesNotMatch(render(), /href="\/black-market"/);
    blackMarket.event = { auctions: [], idleStatus: "closed" };
    filter = "upcoming";
    assert.doesNotMatch(render(), /href="\/black-market"/);
    assert.match(render(), /aria-pressed="true"[^>]*>[^<]+<span>0<\/span>/);
    blackMarket.event.startsAt = "2099-01-07T12:00:00Z";
    assert.match(render(), /href="\/black-market"/);
    blackMarket.event.startsAt = null;
    filter = "all";
    assert.match(render(), /href="\/black-market"/);
    assert.match(
      render(),
      new RegExp(`data-status="closed">${messages.blackMarket.closed}</span>`)
    );
    assert.match(render(), new RegExp(`${messages.blackMarket.noDate}</span>`));
    sunset = { event: {}, now: 1, status: "live" };
    assert.match(render(), /href="\/boosters#gta-sunset"/);
    filter = "live";
    assert.match(render(), /href="\/boosters#gta-sunset"/);
    filter = "upcoming";
    assert.doesNotMatch(render(), /href="\/boosters#gta-sunset"/);
    sunset.status = "upcoming";
    assert.match(render(), /href="\/boosters#gta-sunset"/);
  }
});
