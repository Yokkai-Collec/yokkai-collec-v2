import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator } from "next-intl";

const require = createRequire(import.meta.url);
const componentFile = "app/admin/security/deleted-smurf-recovery.tsx";
export async function renderRecoveryFixture(locale = "en") {
  const messages = JSON.parse(
    fs.readFileSync(`messages/${locale}.json`, "utf8")
  );
  const mod = { exports: {} };
  function load(file, target) {
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
        module: target,
        exports: target.exports,
        require(id) {
          if (id === "next-intl/server")
            return {
              getLocale: async () => locale,
              getTranslations: async namespace =>
                createTranslator({ locale, messages, namespace })
            };
          if (id === "next/link")
            return {
              __esModule: true,
              default: ({ children, ...props }) =>
                React.createElement("a", props, children)
            };
          if (id === "./actions")
            return {
              applyDeletedSmurfRecoveryAction: () => {
                throw Error("fixture must not submit a sanction");
              }
            };
          if (id === "./sanction-quarantine-conflicts") {
            const conflicts = { exports: {} };
            load(
              "app/admin/security/sanction-quarantine-conflicts.tsx",
              conflicts
            );
            return conflicts.exports;
          }
          return require(id);
        }
      }
    );
  }
  load(componentFile, mod);
  const id = "ac510000-0000-4000-8000-000000000001";
  const recovery = {
    cards: 2,
    blockedCards: 0,
    cardsNoLongerOnPrimary: 1,
    tradeKaras: 320,
    saleKaras: 200,
    saleCount: 1,
    karas: 520
  };
  const stream = await renderToReadableStream(
    await mod.exports.DeletedSmurfRecovery({
      data: {
        primary: {
          userId: id,
          pseudo: "Historical player with a very long name",
          karasBalance: 1000
        },
        candidates: [
          {
            id,
            acceptedAt: "2026-11-02T12:00:00Z",
            incomingCards: 3,
            outgoingCards: 0,
            incomingKaras: 350,
            outgoingKaras: 30
          }
        ],
        candidateCount: 1,
        selectedTradeIds: [id],
        selectionValid: true,
        eligible: true,
        recovery,
        receipts: [
          {
            id,
            appliedAt: "2026-11-02T12:30:00Z",
            note: "Independently verified historical evidence.",
            evidenceReference: "Case HIST-42 and verified source archive.",
            recovery,
            history: {
              trades: [{ id }],
              sales: [{ id, cardInstanceId: id, karas: 200 }]
            }
          }
        ]
      },
      applied: false
    })
  );
  return new Response(stream).text();
}

test("historical recovery renders real English and French messages with explicit evidence and confirmation", async () => {
  for (const locale of ["en", "fr"]) {
    const html = await renderRecoveryFixture(locale);
    assert.doesNotMatch(
      html,
      /MISSING_MESSAGE|INVALID_MESSAGE|adminSecurity\./
    );
    assert.match(html, /name="evidence_reference"/);
    assert.match(html, /name="confirmation"/);
    assert.match(html, /name="primary_user_id"/);
    assert.match(html, /minLength="10"/);
    assert.match(html, /maxLength="2000"/);
    assert.match(html, /required=""/);
    assert.match(html, /HIST-42/);
    assert.match(html, /520/);
    assert.match(
      html,
      locale === "fr" ? /preuves indépendantes/ : /independent evidence/
    );
  }
});
