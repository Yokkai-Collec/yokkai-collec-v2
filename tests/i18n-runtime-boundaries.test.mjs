import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// The compatibility version avoids the unpatched watcher dependency. Its
// remaining advisories require middleware or catalog precompilation, neither
// of which is part of this application's cookie-based locale integration.
test("i18n runtime never enables the middleware or catalog precompilation paths", () => {
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        assert.doesNotMatch(
          readFileSync(file, "utf8"),
          /["']next-intl\/middleware["']/,
          file
        );
      }
    }
  }
  for (const directory of ["app", "components", "i18n", "lib", "utils"])
    scan(directory);
  assert.doesNotMatch(
    readFileSync("proxy.ts", "utf8"),
    /["']next-intl\/middleware["']/
  );
  assert.doesNotMatch(readFileSync("next.config.ts", "utf8"), /\bprecompile\b/);
});
