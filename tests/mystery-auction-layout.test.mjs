import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import postcss from "postcss";

test("Mystery layout and price have one owner regardless of stylesheet loading order", () => {
  const base = postcss.parse(
    readFileSync("styles/mystery-auction.css", "utf8")
  );
  const detail = postcss.parse(readFileSync("styles/event-detail.css", "utf8"));
  for (const [selector, properties] of [
    [".yk-mystery-detail .yk-auction-main", ["flex", "flex-basis"]],
    [".yk-mystery-detail .yk-auction-art", ["flex", "margin", "margin-inline"]],
    [".yk-mystery-detail .yk-auction-price", ["font-size"]],
    [
      ".yk-mystery-detail .yk-auction-panel",
      ["padding", "border", "background", "box-shadow"]
    ]
  ]) {
    base.walkRules(selector, rule => {
      if (rule.parent.type !== "root") return;
      rule.walkDecls(decl =>
        assert.ok(
          !properties.includes(decl.prop),
          `${selector}: conflicting ${decl.prop}`
        )
      );
    });
  }
  const main = detail.nodes.find(
    rule => rule.selector === ".yk-mystery-detail .yk-auction-main"
  );
  assert.ok(
    main.nodes.some(decl => decl.prop === "flex" && decl.value === "1 1 100%")
  );
});
