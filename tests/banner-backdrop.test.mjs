import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../lib/ui/banner-frame.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText,
  { exports }
);
test("blurred backdrop is needed only below full coverage for every image ratio and orientation", () => {
  for (const aspect of [0.5, 1, 1.78, 4, 10]) {
    for (const target of [3, 4.63, 5]) {
      for (const rotation of [0, 90, 180, 270]) {
        for (const zoom of [0.2, 0.81, 0.999, 1, 1.5, 4]) {
          const result = exports.bannerGeometry(
            aspect,
            { x: 0, y: 100, zoom, rotation },
            target
          );
          assert.equal(
            exports.bannerNeedsBackdrop({ x: 0, y: 100, zoom, rotation }),
            zoom < 1
          );
          assert(Number.isFinite(result.scale));
        }
      }
    }
  }
});
test("invalid zoom is normalized before determining backdrop visibility", () => {
  assert.equal(exports.bannerNeedsBackdrop({ x: 50, y: 50, zoom: NaN }), false);
});
