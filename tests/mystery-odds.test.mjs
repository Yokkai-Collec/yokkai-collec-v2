import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, createFormatter } from "next-intl";

test("Mystery displays frozen server LR odds and streak in EN/FR, retaining legacy editions", () => {
  for (const locale of ["en", "fr"]) {
    const exports = {};
    const messages = JSON.parse(
      readFileSync(`messages/${locale}.json`, "utf8")
    );
    vm.runInNewContext(
      ts.transpileModule(
        readFileSync("components/mystery-auction-stage.tsx", "utf8"),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.ReactJSX
          }
        }
      ).outputText,
      {
        exports,
        require: name => {
          if (name === "react/jsx-runtime") return jsx;
          if (name === "next-intl")
            return {
              useTranslations: namespace =>
                createTranslator({ locale, messages, namespace }),
              useFormatter: () => createFormatter({ locale })
            };
          if (name.endsWith("/yokai-card")) return { YokaiCard: () => null };
          if (name.endsWith("/mystery-auction"))
            return {
              MysteryEventHeader: () => null,
              MysteryCardBack: () => null,
              EventCardShowcase: ({ children }) => children
            };
          throw Error(name);
        }
      }
    );
    const render = props =>
      renderToStaticMarkup(
        jsx.jsx(exports.MysteryAuctionStage, {
          card: {},
          hidden: true,
          ...props
        })
      );
    const html = render({ chance: 0.3, misses: 36 });
    assert.match(html, /<meter[^>]*value="0.3"/);
    assert.match(html, /30/);
    assert.match(html, /36/);
    assert.match(html, /80/);
    assert.doesNotMatch(render({}), /<meter/);
    const finished = render({ chance: 0.8, misses: 44, finished: true });
    assert.match(finished, /value="0.8"/);
    assert.ok(
      finished.includes(
        createTranslator({ locale, messages, namespace: "mysteryAuction" })(
          "lrChanceAtDraw"
        )
      )
    );
  }
});
