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

test("fit-entire-image survives a change from crop-editor ratio to responsive banner ratio", () => {
  for (const aspect of [0.66, 1, 1.75, 2.3, 4, 10]) {
    for (const rotation of [0, 90, 180, 270]) {
      const frame = { x: 50, y: 50, zoom: 1, rotation };
      frame.zoom = exports.bannerGeometry(aspect, frame).minZoom;
      for (const target of [2.5, 3.4, 5.5, 8, 10]) {
        const adjusted = exports.responsiveBannerFrame(aspect, frame, target);
        const geometry = exports.bannerGeometry(aspect, adjusted, target);
        assert.ok(geometry.overflowX < 1e-9);
        assert.ok(geometry.overflowY < 1e-9);
        assert.ok(Math.abs(adjusted.zoom - geometry.minZoom) < 1e-9);
        assert.equal(adjusted.rotation, rotation);
      }
    }
  }
});

test("zoomed framing retains its selected position and magnification", () => {
  const frame = { x: 13, y: 82, zoom: 1.6, rotation: 90 };
  const adjusted = exports.responsiveBannerFrame(1.75, frame, 8);
  for (const key of Object.keys(frame)) assert.equal(adjusted[key], frame[key]);
});
