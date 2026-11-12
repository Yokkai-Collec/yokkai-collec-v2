import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export async function renderStatusPreview(locale) {
  const messages = JSON.parse(
    fs.readFileSync(`messages/${locale}.json`, "utf8")
  );
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
          target: ts.ScriptTarget.ES2022
        }
      }).outputText,
      {
        module: mod,
        exports: mod.exports,
        URLSearchParams,
        Intl,
        require(name) {
          if (name === "next-intl/server")
            return {
              getLocale: async () => locale,
              getTranslations: async namespace =>
                createTranslator({ locale, messages, namespace })
            };
          if (name === "next/link")
            return {
              __esModule: true,
              default: ({ children, ...props }) =>
                React.createElement("a", props, children)
            };
          if (name === "./actions")
            return {
              applyDeletedAccountSanctionAction: () => {
                throw Error("must not apply a real sanction");
              }
            };
          if (
            name === "./event-detail" ||
            name === "@/app/admin/security/event-detail"
          )
            return load("app/admin/security/event-detail.tsx");
          if (name === "@/app/admin/security/deleted-account-history")
            return load("app/admin/security/deleted-account-history.tsx");
          if (name === "./sanction-quarantine-conflicts")
            return load("app/admin/security/sanction-quarantine-conflicts.tsx");
          return require(name);
        }
      }
    );
    cache.set(file, mod.exports);
    return mod.exports;
  }
  async function resolve(node) {
    if (Array.isArray(node))
      return Promise.all(React.Children.toArray(node).map(resolve));
    if (!React.isValidElement(node)) return node;
    if (typeof node.type === "function")
      return resolve(await node.type(node.props));
    const children = await resolve(node.props.children);
    return React.cloneElement(
      node,
      {},
      ...(Array.isArray(children) ? children : [children])
    );
  }
  return renderToStaticMarkup(
    await resolve(
      await load(
        "app/design-system/admin-account-status-preview/page.tsx"
      ).default()
    )
  );
}

test("processed-source badges are red, self-deletion and bans stay distinct and only processed checkboxes are disabled in EN/FR", async () => {
  for (const locale of ["en", "fr"]) {
    const html = await renderStatusPreview(locale);
    const m = JSON.parse(
      fs.readFileSync(`messages/${locale}.json`, "utf8")
    ).adminSecurity;
    for (const key of [
      "sanctionApplied",
      "banned",
      "bannedBeforeDeletion",
      "deletedByPlayer",
      "deleted"
    ])
      assert.ok(html.includes(m.accountState[key]));
    assert.match(html, /border-red-400\/60 bg-red-500\/15[^>]*>[^<]+<\/span>/);
    assert.equal((html.match(/disabled=""/g) || []).length, 1);
    assert.equal((html.match(/name="source_account"/g) || []).length, 3);
    assert.ok(html.includes(m.deletedAccounts.alreadyProcessed));
    assert.ok(html.includes("BROLY"));
    assert.doesNotMatch(
      html,
      /begin_self_requested_account_deletion|network_identity|device_identity/
    );
  }
});

test("the self-deletion provenance is only requested after live identity, recent-auth and explicit username validation", () => {
  const action = fs.readFileSync("app/settings/actions.ts", "utf8");
  assert.ok(
    action.indexOf("hasRecentAuthentication") <
      action.indexOf("await deleteAccount(userId, undefined, true)")
  );
  assert.ok(
    action.indexOf("pseudo !== profile.data.user.name") <
      action.indexOf("await deleteAccount(userId, undefined, true)")
  );
  const server = fs.readFileSync("lib/server/account-deletion.ts", "utf8");
  assert.match(
    server,
    /if \(selfRequested\)[\s\S]*begin_self_requested_account_deletion/
  );
  assert.ok(
    server.indexOf("if (error) throw") <
      server.indexOf("return deleteAccountCore")
  );
});

test("the trusted wrapper stamps only confirmed self requests and stops before deletion if stamping fails", async () => {
  for (const fail of [false, true]) {
    const calls = [];
    const admin = {
      rpc: async (name, args) => {
        calls.push([name, args]);
        return { error: fail ? { message: "private provider error" } : null };
      }
    };
    const mod = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(
        fs.readFileSync("lib/server/account-deletion.ts", "utf8"),
        { compilerOptions: { module: ts.ModuleKind.CommonJS } }
      ).outputText,
      {
        exports: mod.exports,
        process: { env: {} },
        require(name) {
          if (name === "./account-deletion-core.mjs")
            return {
              deleteAccount: async id => {
                calls.push(["core", id]);
              }
            };
          if (
            [
              "server-only",
              "@supabase/supabase-js",
              "@/lib/auth/session",
              "@/utils/supabase/config"
            ].includes(name)
          )
            return {};
          throw Error(name);
        }
      }
    );
    if (fail) {
      await assert.rejects(
        mod.exports.deleteAccount("fixture-id", admin, true),
        /^Error: ACCOUNT_DELETION_START_FAILED$/
      );
      assert.equal(calls.length, 1);
    } else {
      await mod.exports.deleteAccount("fixture-id", admin, true);
      assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
        ["begin_self_requested_account_deletion", { p_user_id: "fixture-id" }],
        ["core", "fixture-id"]
      ]);
      calls.length = 0;
      await mod.exports.deleteAccount("technical-id", admin);
      assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
        ["core", "technical-id"]
      ]);
    }
  }
});
