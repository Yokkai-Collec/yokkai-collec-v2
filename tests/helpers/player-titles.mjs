import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { intl } from "./i18n.mjs";

const require = createRequire(import.meta.url);
function load(name) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL(`../../components/${name}.tsx`, import.meta.url),
        "utf8"
      ),
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
      require: name =>
        name === "next-intl"
          ? intl
          : name === "@/components/unread-badge"
            ? load("unread-badge")
            : name === "@/lib/data/profile"
              ? {
                  markPlayerTitlesSeen: async () => {
                    throw new Error(
                      "Use an explicit title acknowledgement adapter in isolated tests"
                    );
                  }
                }
              : require(name)
    }
  );
  return exports;
}
export const playerTitles = load("player-title");
