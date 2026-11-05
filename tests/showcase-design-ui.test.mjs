import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    {
      exports,
      URL,
      require: id => load(id.slice(2) + ".ts")
    }
  );
  return exports;
}
const style = load("lib/ui/profile-style.ts");
test("unsafe showcase values cannot become scene selectors or unbounded captions", () => {
  const safe = style.normalizeProfileStyle({
    ...style.DEFAULT_PROFILE_STYLE,
    showcaseScene: "url(bad)",
    showcaseLayout: "unknown",
    showcaseIntensity: 101,
    showcaseTitle: "\n" + "x".repeat(80),
    showcaseDescription: "\t" + "y".repeat(200)
  });
  assert.equal(safe.showcaseScene, undefined);
  assert.equal(safe.showcaseLayout, undefined);
  assert.equal(safe.showcaseIntensity, undefined);
  assert.equal(safe.showcaseTitle, "x".repeat(60));
  assert.equal(safe.showcaseDescription, "y".repeat(160));
});
test("resetting name cosmetics preserves the complete independent showcase design", () => {
  const design = {
    showcaseScene: "stars",
    showcaseLayout: "spotlight",
    showcaseIntensity: 35,
    showcaseColor: "#123456",
    showcaseTitle: "Treasures",
    showcaseDescription: "My selection"
  };
  const reset = style.resetProfileAppearance({
    ...style.DEFAULT_PROFILE_STYLE,
    effect: "neon",
    color: "#ff0000",
    ...design
  });
  for (const [key, value] of Object.entries(design))
    assert.equal(reset[key], value);
  assert.equal(reset.color, style.DEFAULT_PROFILE_STYLE.color);
  assert.equal(reset.effect, style.DEFAULT_PROFILE_STYLE.effect);
});
test("the live preview keeps selection order so the centerpiece matches the saved first card", () => {
  const a = { instanceId: "a" },
    b = { instanceId: "b" },
    c = { instanceId: "c" };
  const selected = style.showcaseSelection(
    [a, b, c],
    new Set(["c", "a", "missing"])
  );
  assert.equal(selected.length, 2);
  assert.equal(selected[0], c);
  assert.equal(selected[1], a);
});
