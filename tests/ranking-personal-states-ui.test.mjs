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
function render(
  locale,
  delta,
  inCard = true,
  withHistory = true,
  initialState
) {
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
      initialState,
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
test("Own initial rank states stay neutral and explicit in EN/FR", () => {
  for (const locale of ["en", "fr"]) {
    for (const [state, direction] of [
      ["pending", "new"],
      ["unranked", "unranked"],
      ["private", "private"]
    ]) {
      const html = render(locale, null, true, false, state);
      assert.match(html, new RegExp('data-direction="' + direction + '"'));
      assert.doesNotMatch(html, /↑|↓|yk-ranking-personal-history/);
    }
    assert.match(
      render(locale, null, false, true, "pending"),
      /data-direction="new"/
    );
    assert.match(
      render(locale, 3, true, true, "pending"),
      /data-direction="up"/
    );
  }
});
