import test from "node:test";
import assert from "node:assert/strict";
import { licenseName } from "./helpers/license-name.mjs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { gameMessages } from "./helpers/i18n.mjs";

const require = createRequire(import.meta.url);
function elements(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
test("the deferred board editor preserves draft isolation, category labels, license selection and saving in EN/FR", async () => {
  for (const locale of ["en", "fr"]) {
    const messages = JSON.parse(
      readFileSync(`messages/${locale}.json`, "utf8")
    );
    let index = 0;
    const states = [];
    const LicensePicker = () => null;
    const Button = ({ children, ...props }) =>
      React.createElement("button", props, children);
    const exports = {};
    vm.runInNewContext(
      ts.transpileModule(
        readFileSync("components/profile-preferences-editor.tsx", "utf8"),
        { compilerOptions: { module: 1, target: 9, jsx: 4 } }
      ).outputText,
      {
        exports,
        require: name => {
          if (name === "@/lib/ui/license-name") return licenseName;
          if (name === "react")
            return {
              useState: initial => {
                const slot = index++;
                if (!(slot in states))
                  states[slot] =
                    typeof initial === "function" ? initial() : initial;
                return [
                  states[slot],
                  next => {
                    states[slot] =
                      typeof next === "function" ? next(states[slot]) : next;
                  }
                ];
              }
            };
          if (name === "next-intl")
            return {
              useTranslations: () => createTranslator({ locale, messages })
            };
          if (name === "@/i18n/game-messages") return gameMessages;
          if (name === "@/components/ui") return { Button };
          if (name === "@/components/profile-license-picker")
            return { ProfileLicensePicker: LicensePicker };
          return require(name);
        }
      }
    );
    const widgets = [{ category: "ANIME/MANGA", entries: ["One Piece"] }];
    const original = JSON.stringify(widgets);
    let saved;
    let delivered;
    const render = () => {
      index = 0;
      return exports.PreferencesEditor({
        widgets,
        categories: ["ANIME/MANGA", "SPORT"],
        labelCategory: category => `Label: ${category}`,
        loadLicenses: async () => {
          throw Error("Must not fetch on mount");
        },
        save: async value => {
          saved = JSON.parse(JSON.stringify(value));
          return value;
        },
        onSaved: value => {
          delivered = value;
        }
      });
    };
    let tree = render();
    assert.match(renderToStaticMarkup(tree), /Label: ANIME\/MANGA/);
    elements(tree)
      .find(
        node => node.type === "button" && node.props.children?.[2] === "SPORT"
      )
      ?.props.onClick();
    tree = render();
    const picker = elements(tree).find(
      node => node.type === LicensePicker && node.props.category === "SPORT"
    );
    assert.ok(picker, "new category exposes its license picker");
    picker.props.onToggle("Tennis", "Tennis");
    tree = render();
    assert.match(renderToStaticMarkup(tree), /Tennis/);
    await tree.props.onSubmit({ preventDefault() {} });
    assert.deepEqual(saved, [
      { category: "ANIME/MANGA", entries: ["One Piece"] },
      { category: "SPORT", entries: ["Tennis"], labels: { Tennis: "Tennis" } }
    ]);
    assert.ok(delivered);
    assert.equal(
      JSON.stringify(widgets),
      original,
      "parent widgets stay immutable until save"
    );
  }
});
