import {
  englishMessages,
  intl,
  intlServer,
  loadLocaleModule
} from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { NextRequest, NextResponse } from "next/server.js";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = path =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function load(path, imports = {}, globals = {}) {
  const loaded = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(read(path), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      module: loaded,
      exports: loaded.exports,
      URL,
      Headers,
      Response,
      process: { env: {} },
      ...globals,
      require(name) {
        if (name in imports) return imports[name];
        if (name === "next-intl") return intl;
        if (name === "next-intl/server") return intlServer;
        if (name === "@/i18n/locale")
          return loadLocaleModule(globals.process?.env ?? {});
        if (name.startsWith("@/messages/"))
          return { default: JSON.parse(read(name.replace("@/", ""))) };
        if (name === "react/jsx-runtime") return require(name);
        throw new Error(`Unexpected import: ${name}`);
      }
    }
  );
  return loaded.exports;
}

async function renderPrivacy(constants = load("lib/legal/privacy.ts")) {
  const h = React.createElement;
  const page = load("app/privacy/page.tsx", {
    "next/link": {
      default: ({ href, ...props }) => h("a", { href, ...props })
    },
    "@/lib/discord-invite": { getDiscordInviteUrl: () => null },
    "@/lib/legal/privacy": constants,
    "@/components/public-info-page": {
      PublicInfoPage: ({ title, intro, children }) =>
        h("main", null, h("h1", null, title), h("p", null, intro), children),
      InfoSection: ({ number, title, children }) =>
        h(
          "section",
          null,
          h("span", null, number),
          h("h2", null, title),
          children
        )
    }
  });
  return { page, html: renderToStaticMarkup(await page.default()) };
}

test("the privacy page renders one h1, every required section, and English metadata", async () => {
  const { page, html } = await renderPrivacy();
  const metadata = await page.generateMetadata();
  assert.equal(metadata.title, "Privacy Policy");
  assert.match(metadata.description, /personal data/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /<h1>Privacy Policy<\/h1>/);
  const sections = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map(m => m[1]);
  assert.deepEqual(sections, [
    "Who we are and how to contact us",
    "What data we collect",
    "Why we use it and legal basis",
    "What other players can see",
    "Payments",
    "Third-party services and international transfers",
    "Cookies and local storage",
    "How long we keep data",
    "Account deletion",
    "Your rights",
    "Children",
    "Security",
    "Changes to this policy"
  ]);
  assert.match(
    html,
    /Last updated: <time dateTime="2026-11-09">November 9, 2026<\/time>/
  );
  assert.match(html, /href="https:\/\/stripe\.com\/privacy"/);
  assert.match(html, /never see or store your card number/);
  assert.match(html, /CNIL in France or the CNDP in Morocco/);
  assert.match(html, /href="\/terms"/);
  assert.doesNotMatch(html, /Walid|Joueur|supprim|données|compte/i);
});

test("contact email, controller, and minimum age come from the shared constants", async () => {
  const defaults = load("lib/legal/privacy.ts");
  assert.equal(defaults.PRIVACY_CONTACT_EMAIL, "yokkaicollec@gmail.com");
  assert.equal(defaults.PRIVACY_MINIMUM_AGE, 16);
  assert.equal(defaults.PRIVACY_CONTROLLER, "Yokkai Collec'");
  const { html } = await renderPrivacy({
    ...defaults,
    PRIVACY_CONTACT_EMAIL: "privacy@example.test",
    PRIVACY_CONTROLLER: "Example Controller",
    PRIVACY_MINIMUM_AGE: 21
  });
  assert.match(html, /href="mailto:privacy@example\.test"/);
  assert.match(html, /Example Controller is the data controller/);
  assert.match(html, /not intended for children under 21/);
  assert.doesNotMatch(html, /yokkaicollec@gmail\.com|under 16|least 16/);
  const source = read("app/privacy/page.tsx");
  assert.doesNotMatch(source, /yokkaicollec@gmail\.com|\b16\b/);
});

test("retention durations without a validated value stay unstated", () => {
  const source = read("lib/legal/privacy.ts");
  for (const name of [
    "BILLING_RECORD_RETENTION",
    "DELETION_LOG_RETENTION",
    "AUTH_LOG_RETENTION"
  ])
    assert.match(source, new RegExp(`${name}: string \\| null = null`));
  assert.match(source, /TODO\(walid\)/);
});

test("/privacy answers a visitor without a session instead of redirecting", async () => {
  assert.doesNotMatch(
    read("app/privacy/page.tsx"),
    /getCurrentUser|requireAuth|redirect\(|createClient/
  );
  const { updateSession } = load("utils/supabase/proxy.ts", {
    "next/server": { NextResponse },
    "@/utils/supabase/auth-fetch": { serverAuthFetch: () => fetch },
    "@/utils/supabase/config": {
      getSupabaseConfig: () => ({ url: "https://example.test", key: "k" })
    },
    "@supabase/ssr": {
      createServerClient: () => ({
        auth: { getClaims: async () => ({ data: null, error: null }) }
      })
    }
  });
  const { proxy } = load(
    "proxy.ts",
    {
      "next/server": { NextResponse },
      "@/utils/supabase/proxy": { updateSession }
    },
    { process: { env: { NODE_ENV: "production" } } }
  );
  const response = await proxy(new NextRequest("http://localhost/privacy"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
});

test("privacy is linked from the footer, signup, checkout, settings, terms, and sitemap", () => {
  assert.match(
    read("components/site-footer.tsx"),
    /<Link href="\/privacy">\{t\("privacyPolicy"\)\}<\/Link>/
  );
  assert.equal(englishMessages.siteFooter.privacyPolicy, "Privacy Policy");
  const auth = read("components/auth-form.tsx").replace(/\s+/g, " ");
  assert.match(auth, /t\("privacyAgreement"\)\}\{" "\} <Link href="\/privacy"/);
  assert.equal(
    englishMessages.authForm.privacyAgreement,
    "By creating an account, you agree to our"
  );
  assert.match(auth, /aria-label=\{t\("privacyPolicyOpensInANewTab"\)\}/);
  assert.equal(
    englishMessages.authForm.privacyPolicyOpensInANewTab,
    "Privacy Policy (opens in a new tab)"
  );
  assert.equal(englishMessages.authForm.privacyPolicy, "Privacy Policy");
  for (const file of [
    "components/premium-checkout.tsx",
    "components/subscription-settings.tsx",
    "app/terms/page.tsx"
  ])
    assert.match(read(file), /<Link href="\/privacy"/, file);
  assert.match(read("app/sitemap.ts"), /"\/privacy"/);
});
