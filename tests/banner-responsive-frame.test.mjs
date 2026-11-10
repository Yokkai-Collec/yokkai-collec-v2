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

test("panning and fit rotation use the same wide viewport as the displayed banner", () => {
  const aspect = 1.75;
  const viewport = 5;
  const frame = { x: 50, y: 50, zoom: 1.5, rotation: 0 };
  const geometry = exports.bannerGeometry(aspect, frame, viewport);
  const moved = exports.panBanner(frame, aspect, 0, 0.1, viewport);
  assert.ok(Math.abs(moved.y - (50 - 10 / geometry.overflowY)) < 1e-9);
  const fit = { ...frame, zoom: geometry.minZoom };
  const rotated = exports.rotateBanner(fit, aspect, viewport);
  const result = exports.bannerGeometry(aspect, rotated, viewport);
  assert.ok(result.overflowX < 1e-9 && result.overflowY < 1e-9);
});

test("profile cover proportions follow the uploaded image within a compact landscape range", () => {
  for (const aspect of [0.5, 1, 1070 / 602, 498 / 281, 3])
    assert.equal(exports.profileBannerAspect(aspect), 3);
  assert.equal(exports.profileBannerAspect(4), 4);
  assert.equal(exports.profileBannerAspect(12), 5);
  assert.equal(exports.profileBannerAspect(4, 90), 3);
  assert.equal(exports.profileBannerAspect(0.25, 270), 4);
  assert.equal(exports.profileBannerAspect(NaN), 3);
});
