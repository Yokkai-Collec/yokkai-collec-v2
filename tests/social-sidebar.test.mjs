import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);

test("Social bar hides on downward scroll, returns upward, ignores jitter and cleans up", () => {
  let effect,
    scroll,
    hidden = false,
    removed = false;
  const fakeWindow = {
    scrollY: 0,
    addEventListener(name, callback, options) {
      assert.equal(name, "scroll");
      assert.equal(options.passive, true);
      scroll = callback;
    },
    removeEventListener(name, callback) {
      assert.equal(name, "scroll");
      assert.equal(callback, scroll);
      removed = true;
    }
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync("components/social-sidebar.tsx", "utf8"), {
      compilerOptions: { module: 1, jsx: 4 }
    }).outputText,
    {
      exports,
      window: fakeWindow,
      require: name =>
        name === "react"
          ? {
              useState: () => [
                hidden,
                value => {
                  hidden = value;
                }
              ],
              useEffect: callback => {
                effect = callback;
              }
            }
          : require(name)
    }
  );
  exports.SocialSidebar({ children: null });
  const cleanup = effect();
  const move = y => {
    fakeWindow.scrollY = y;
    scroll();
    return hidden;
  };
  assert.equal(move(80), false);
  assert.equal(move(200), true);
  assert.equal(move(197), true);
  assert.equal(move(190), false);
  assert.equal(move(215), true);
  assert.equal(move(0), false);
  assert.equal(move(-10), false);
  cleanup();
  assert.equal(removed, true);
});
