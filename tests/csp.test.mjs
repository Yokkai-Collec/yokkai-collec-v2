import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function headers(
  mode = "production",
  supabase = "https://database.example.test:8443/path"
) {
  const source = readFileSync(
    new URL("../next.config.ts", import.meta.url),
    "utf8"
  );
  const exports = {};
  const env = {
    NODE_ENV: mode,
    ...(supabase ? { NEXT_PUBLIC_SUPABASE_URL: supabase } : {})
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText,
    { exports, process: { env }, URL, require: createRequire(import.meta.url) }
  );
  return (await exports.default.headers())[0].headers;
}

test("CSP is Report-Only and covers Supabase, catalogue images and card sharing", async () => {
  const values = await headers();
  assert.ok(
    !values.some(
      header => header.key.toLowerCase() === "content-security-policy"
    )
  );
  const policy = values.find(
    header => header.key === "Content-Security-Policy-Report-Only"
  )?.value;
  assert.ok(policy, "a Report-Only policy must be sent");
  const directives = new Map(
    policy.split(";").map(part => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    })
  );
  assert.deepEqual(directives.get("connect-src"), [
    "'self'",
    "https://database.example.test:8443",
    "wss://database.example.test:8443",
    "https://api.giphy.com",
    "https://cloudflareinsights.com"
  ]);
  assert.deepEqual(directives.get("img-src"), [
    "'self'",
    "https:",
    "data:",
    "blob:"
  ]);
  assert.deepEqual(directives.get("script-src"), [
    "'self'",
    "'unsafe-inline'",
    "https://static.cloudflareinsights.com",
    "https://challenges.cloudflare.com"
  ]);
  assert.deepEqual(directives.get("style-src"), [
    "'self'",
    "'unsafe-inline'",
    "https://fonts.googleapis.com"
  ]);
  assert.deepEqual(directives.get("font-src"), [
    "'self'",
    "https://fonts.gstatic.com"
  ]);
  // Imgur only: custom card GIFs play as their MP4 (exact host, no wildcard).
  assert.deepEqual(directives.get("media-src"), [
    "'self'",
    "blob:",
    "https://i.imgur.com"
  ]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("base-uri"), ["'self'"]);
  assert.deepEqual(directives.get("form-action"), [
    "'self'",
    "https://discord.com",
    "https://x.com"
  ]);
  assert.deepEqual(directives.get("frame-src"), [
    "https://challenges.cloudflare.com"
  ]);
  assert.ok(!policy.includes("unsafe-eval") && !policy.includes("*"));
  assert.equal(
    values.find(header => header.key === "X-Frame-Options").value,
    "DENY"
  );
});

test("CSP permits development HMR only in development and handles a missing optional URL", async () => {
  const dev = (await headers("development", "http://127.0.0.1:54321")).find(
    header => header.key === "Content-Security-Policy-Report-Only"
  ).value;
  assert.match(dev, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  assert.match(
    dev,
    /connect-src 'self' http:\/\/127\.0\.0\.1:54321 ws:\/\/127\.0\.0\.1:54321 https:\/\/api\.giphy\.com https:\/\/cloudflareinsights\.com ws:/
  );
  const empty = (await headers("production", "")).find(
    header => header.key === "Content-Security-Policy-Report-Only"
  ).value;
  assert.match(empty, /connect-src 'self' https:\/\/api\.giphy\.com/);
  assert.ok(!empty.includes("undefined"));
});
