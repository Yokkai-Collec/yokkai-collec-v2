import test from "node:test";
import assert from "node:assert/strict";
import { licenseName } from "./helpers/license-name.mjs";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
function render(locale, delta, inCard = true, withHistory = true) {
  const messages = JSON.parse(
    fs.readFileSync("messages/" + locale + ".json", "utf8")
  );
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("components/ranking-progress.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    {
      exports,
      require: name => {
        if (name === "@/lib/ui/license-name") return licenseName;
        if (name === "react") return React;
        if (name === "react/jsx-runtime") return jsx;
        if (name === "next-intl")
          return {
            useTranslations: namespace =>
              createTranslator({ locale, messages, namespace }),
            useFormatter: () => ({
              dateTime: (value, options) =>
                new Intl.DateTimeFormat(locale, options).format(value)
            })
          };
        if (name === "next/link")
          return { default: props => jsx.jsx("a", props) };
        if (
          [
            "@/lib/data/cards",
            "@/lib/ui/binder-discovery",
            "@/lib/leaderboard/progress"
          ].includes(name)
        )
          return {};
        throw Error(name);
      }
    }
  );
  return renderToStaticMarkup(
    jsx.jsx(exports.RankingTrend, {
      inCard,
      compact: !inCard,
      history: withHistory
        ? {
            delta,
            since: delta === null ? null : "2026-10-30",
            observations:
              delta === null
                ? [{ day: "2026-10-31", position: 1 }]
                : [
                    { day: "2026-10-30", position: 4 },
                    { day: "2026-10-31", position: 1 }
                  ]
          }
        : undefined
    })
  );
}
test("Personal rank movement retains its signed direction, exact count and accessible history in EN/FR", () => {
  for (const locale of ["en", "fr"]) {
    const up = render(locale, 3);
    assert.match(up, /data-direction="up"/);
    assert.match(up, /↑/);
    assert.match(up, /3/);
    assert.match(up, /<summary aria-label=/);
    assert.match(up, /yk-ranking-personal-history/);
    const down = render(locale, -2);
    assert.match(down, /data-direction="down"/);
    assert.match(down, /↓/);
    assert.match(down, /2/);
    const same = render(locale, 0);
    assert.match(same, /data-direction="same"/);
    assert.doesNotMatch(same, /↑|↓/);
    const initial = render(locale, null);
    assert.match(initial, /data-direction="new"/);
    assert.doesNotMatch(initial, /↑|↓|yk-ranking-personal-history/);
    assert.equal(render(locale, null, true, false), "");
  }
});
test("Compact row movement still shows the count and never invents a change without a baseline", () => {
  assert.match(render("en", 5, false), /data-direction="up"/);
  assert.match(render("en", 5, false), /5/);
  assert.equal(render("en", null, false), "");
});
