import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

export const licenseName = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../../lib/ui/license-name.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  ).outputText,
  { exports: licenseName }
);
