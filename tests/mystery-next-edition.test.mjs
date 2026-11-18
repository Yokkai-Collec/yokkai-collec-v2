import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
function compile(file) {
  return ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
}
const countdown = {};
vm.runInNewContext(compile("lib/ui/pack-countdown.ts"), { exports: countdown });
function page(
  locale,
  state,
  finished,
  runtime = { ref: { current: false }, routes: [] }
) {
  const effects = [];
  let reads = 0;
  const exports = {};
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  vm.runInNewContext(compile("components/mystery-auction.tsx"), {
    exports,
    require: name => {
      if (name === "react/jsx-runtime") return jsx;
      if (name === "react")
        return {
          useState: () => [state[reads++], () => {}],
          useRef: () => runtime.ref,
          useEffect: fn => effects.push(fn)
        };
      if (name === "next-intl")
        return {
          useTranslations: namespace =>
            createTranslator({ locale, messages, namespace })
        };
      if (name === "next/navigation")
        return {
          useRouter: () => ({ replace: (...args) => runtime.routes.push(args) })
        };
      if (name === "next/link") return { default: "a" };
      if (name.endsWith("/market")) return {};
      if (name.endsWith("/yokai-card")) return { YokaiCard: () => null };
      if (name.endsWith("/ui")) return { Karas: () => null };
      if (name.endsWith("/card-shell"))
        return { CardShell: ({ children }) => children };
      if (name.endsWith("/event-scene"))
        return {
          MysteryCardBack: () => null,
          EventCardShowcase: ({ children }) => children
        };
      if (name.endsWith("/pack-countdown")) return countdown;
      if (name.endsWith(".css")) return {};
      throw Error(name);
    }
  });
  return {
    html: renderToStaticMarkup(
      jsx.jsx(exports.MysteryEventHeader, { finished, auctionId: "old" })
    ),
    reads,
    follow: () => effects.at(-1)?.()
  };
}
test("Next-edition timer appears only after reveal, counts down server time, without an extra button when the next edition opens", () => {
  const now = Date.parse("2026-11-18T10:15:00Z");
  for (const locale of ["en", "fr"]) {
    const event = {
      nextStartsAt: "2026-11-18T11:00:00Z",
      auction: { id: "old", status: "sold" }
    };
    const during = page(locale, [event, now, false], false);
    assert.doesNotMatch(during.html, /yk-mystery-next/);
    assert.equal(during.reads, 0);
    const after = page(locale, [event, now, false], true);
    assert.match(after.html, /yk-mystery-next/);
    assert.match(after.html, /00:45:00/);
    assert.match(after.html, /role="timer"/);
    assert.match(
      page(locale, [event, now + 1000, false], true).html,
      /00:44:59/
    );
    assert.match(
      page(locale, [event, Date.parse(event.nextStartsAt) + 1000, false], true)
        .html,
      /00:00:00/
    );
    assert.match(page(locale, [undefined, undefined, false], true).html, /—/);
    const live = {
      ...event,
      auction: {
        id: "new-edition",
        status: "active",
        endsAt: "2026-11-18T18:00:00Z"
      }
    };
    assert.doesNotMatch(
      page(locale, [live, now, false], true).html,
      /yk-mystery-next|href="\/market\/new-edition"/
    );
    const overdue = {
      ...live,
      auction: { ...live.auction, endsAt: "2026-11-18T10:00:00Z" }
    };
    assert.doesNotMatch(
      page(locale, [overdue, now, false], true).html,
      /href="\/market\/new-edition"/
    );
  }
});

test("An open reveal page follows the new edition automatically; archives stay on their own result", () => {
  const now = Date.parse("2026-11-18T10:15:00Z");
  const old = {
    nextStartsAt: "2026-11-18T11:00:00Z",
    auction: { id: "old", status: "sold" }
  };
  const live = {
    ...old,
    auction: { id: "new", status: "active", endsAt: "2026-11-18T18:00:00Z" }
  };
  const waiting = { ref: { current: false }, routes: [] };
  page("en", [old, now, false], true, waiting).follow();
  page("en", [live, now, false], true, waiting).follow();
  assert.equal(waiting.routes.length, 1);
  assert.equal(waiting.routes[0][0], "/market/new");
  const archive = { ref: { current: false }, routes: [] };
  page("en", [live, now, false], true, archive).follow();
  assert.equal(archive.routes.length, 0);
});
