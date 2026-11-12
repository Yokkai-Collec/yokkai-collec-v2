import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const context = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../../lib/anticheat-sanction-labels.ts", import.meta.url),
      "utf8"
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText,
  context
);
export const anticheatSanctionLabels = context.exports;
