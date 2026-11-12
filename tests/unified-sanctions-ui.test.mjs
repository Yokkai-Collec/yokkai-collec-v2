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
export async function renderSanctionPage(
  locale = "en",
  mode = "active",
  role = "smurf",
  options = {}
) {
  const id = "ac620000-0000-4000-8000-000000000001",
    other = "ac620000-0000-4000-8000-000000000002",
    copy = "ac620000-0000-4000-8000-000000000003";
  const recovery = {
    cards: 1,
    cardIds: [copy],
    blockedCards: 1,
    cardsNoLongerOnPrimary: 0,
    tradeKaras: 0,
    saleKaras: 0,
    saleCount: 0,
    karas: 0,
    ...options.recovery
  };
  const labels = {
    [copy]: { name: "BROLY", rarity: "LR", franchise: "Dragon Ball" }
  };
  const translations = JSON.parse(
    fs.readFileSync(`messages/${locale}.json`, "utf8")
  );
  const rpc = async (name, args) => {
    if (name === "admin_list_anticheat_events")
      assert.equal(args.p_event_type, "trade_accepted");
    if (name === "admin_preview_sanction" && mode === "active") {
      assert.equal(args.p_subject_user_id, role === "primary" ? other : id);
      assert.equal(args.p_primary_user_id, role === "primary" ? id : other);
    }
    return {
      error: null,
      data: {
        admin_list_anticheat_cases: {
          cases: [
            {
              userId: id,
              pseudo: "Example player",
              email: "fixture@example.invalid",
              score: 88,
              severity: "critical",
              status: "open",
              eventCount: 20,
              reasonCodes: ["SHARED_NETWORK_IDENTITY"],
              lastFlaggedAt: "2026-11-02T12:00:00Z",
              economicLinkedAccounts: 2,
              networkLinkedAccounts: 1
            }
          ],
          total: 1,
          summary: { open: 1, critical: 1, events24h: 3, flagged24h: 1 }
        },
        admin_list_anticheat_events: {
          events: [
            {
              id: 1,
              type: "trade_accepted",
              occurredAt: "2026-11-02T12:00:00Z",
              actor: { id, pseudo: "Example player" },
              counterparty: { id: other, pseudo: "Primary collector" },
              cardCount: 1,
              amount: 70,
              subjects: [],
              metadata: {},
              detail: {
                kind: "trade",
                source: "captured",
                available: true,
                fromName: "Example player",
                toName: "Primary collector",
                offeredCards: [
                  {
                    instanceId: copy,
                    name: "BROLY",
                    rarity: "LR",
                    franchise: "Dragon Ball"
                  }
                ],
                requestedCards: [],
                offeredCount: 1,
                requestedCount: 0,
                offeredKaras: 70,
                requestedKaras: 5
              }
            }
          ],
          total: 1
        },
        admin_list_anticheat_connections: {
          [id]: {
            count: 1,
            accounts: [
              {
                userId: other,
                pseudo: "Related collector",
                lastSharedAt: "2026-11-02T12:00:00Z",
                sharedBrowser: false,
                acceptedTrades: 2,
                deleted: false
              }
            ]
          }
        },
        admin_list_deleted_accounts: {
          accounts: [
            {
              userId: other,
              pseudo: "Deleted collector",
              email: "deleted@example.invalid",
              deletedAt: "2026-11-02T12:00:00Z",
              identityExpiresAt: "2027-01-31T12:00:00Z",
              identitySource: "deletion_snapshot",
              transfers: 2,
              availableTransfers: 2
            }
          ],
          total: 1,
          deletedTotal: 10,
          pageSize: 30
        },
        admin_preview_deleted_account_sanction: {
          primary: { userId: id, pseudo: "Example player", karasBalance: 100 },
          selectedAccountIds: [other],
          accounts: [
            {
              userId: other,
              pseudo: "Deleted collector",
              email: "deleted@example.invalid"
            }
          ],
          eligible: true,
          selectionValid: true,
          previewToken: "fixture",
          recovery: {
            cards: 1,
            cardIds: [copy],
            transferKaras: 0,
            saleKaras: 0,
            karas: 0,
            lockedCards: 1,
            unavailableCards: 0,
            transfers: 2
          },
          history: {
            transfers: [
              {
                kind: "trade",
                asset_id: copy,
                from_user_id: other,
                to_user_id: id,
                offered_karas: 0,
                requested_karas: 0,
                offered_names: ["BROLY"],
                requested_names: [],
                occurred_at: "2026-11-02T12:00:00Z"
              }
            ],
            cardLabels: labels,
            sales: []
          }
        },
        admin_list_smurf_sanction_candidates: [
          {
            userId: other,
            pseudo: "Primary collector",
            acceptedTrades: 1,
            lastTradeAt: "2026-11-02T12:00:00Z",
            sharedNetwork: false,
            sharedDevice: false
          }
        ],
        admin_list_anticheat_related_accounts: {
          subject: {
            userId: id,
            pseudo: "Example player",
            removed: false,
            deleted: false,
            banned: false,
            sanctionApplied: false
          },
          accounts: [
            {
              userId: other,
              pseudo: "Primary collector",
              email: "active@example.invalid",
              removed: false,
              archived: false,
              accountState: {
                deleted: false,
                banned: false,
                sanctionApplied: false
              },
              acceptedTrades: 2,
              soldAuctions: 0,
              availableTransfers: 2,
              cardsToSubject: 3,
              cardsFromSubject: 1,
              karasToSubject: 150,
              karasFromSubject: 10,
              sharedNetwork: true,
              sharedBrowser: false
            },
            {
              userId: copy,
              pseudo: "Deleted collector",
              email: "deleted@example.invalid",
              removed: true,
              archived: true,
              accountState: {
                deleted: true,
                banned: false,
                deletionOrigin: "unknown",
                sanctionApplied: false
              },
              acceptedTrades: 1,
              soldAuctions: 0,
              availableTransfers: 1,
              cardsToSubject: 1,
              cardsFromSubject: 0,
              karasToSubject: 5,
              karasFromSubject: 0,
              sharedNetwork: false,
              sharedBrowser: false
            }
          ],
          total: 2,
          relatedTotal: 2,
          pageSize: 30,
          counts: { active: 1, banned: 0, deleted: 1 }
        },
        admin_preview_sanction:
          mode === "active"
            ? {
                smurf: { userId: id, pseudo: "Example player", banned: false },
                primary: {
                  userId: other,
                  pseudo: "Primary collector",
                  karasBalance: 100
                },
                evidence: {
                  sharedNetwork: false,
                  sharedDevice: false,
                  acceptedTrades: 1
                },
                recovery,
                eligible: !options.receipt,
                alreadyApplied: Boolean(options.receipt),
                cardLabels: labels,
                receipt: options.receipt
                  ? {
                      id,
                      appliedAt: "2026-11-02T12:00:00Z",
                      note: "Recorded decision",
                      recovery,
                      history: { trades: [], sales: [] }
                    }
                  : null,
                history: {
                  trades: [
                    {
                      id,
                      fromUser: id,
                      toUser: other,
                      acceptedAt: "2026-11-02T12:00:00Z",
                      offeredCards: [copy],
                      requestedCards: [],
                      offeredKaras: 0,
                      requestedKaras: 0
                    }
                  ],
                  sales: []
                }
              }
            : {
                primary: {
                  userId: id,
                  pseudo: "Example player",
                  karasBalance: 100
                },
                candidates: [
                  {
                    id,
                    acceptedAt: "2026-11-02T12:00:00Z",
                    incomingCards: 1,
                    outgoingCards: 0,
                    incomingKaras: 0,
                    outgoingKaras: 0,
                    incomingNames: ["BROLY"],
                    outgoingNames: []
                  }
                ],
                candidateCount: 1,
                selectedTradeIds: [id],
                selectionValid: true,
                eligible: true,
                recovery,
                cardLabels: labels,
                receipts: []
              }
      }[name]
    };
  };
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
        require(module) {
          if (module === "next-intl/server")
            return {
              getLocale: async () => locale,
              getTranslations: async namespace =>
                createTranslator({ locale, messages: translations, namespace })
            };
          if (module === "next-intl")
            return {
              useTranslations: namespace =>
                createTranslator({ locale, messages: translations, namespace })
            };
          if (module === "next/link")
            return {
              __esModule: true,
              default: ({ children, ...props }) =>
                React.createElement("a", props, children)
            };
          if (module === "next/headers") return { cookies: async () => ({}) };
          if (module === "@/lib/auth/admin")
            return { requireAdminPage: async () => ({ id: other }) };
          if (module === "@/lib/auth/session")
            return {
              getCurrentPseudo: async () => "Admin",
              getCurrentKarasBalance: async () => 100
            };
          if (module === "@/utils/supabase/server")
            return { createClient: () => ({ rpc }) };
          if (module === "./actions")
            return new Proxy(
              {},
              {
                get: () => () => {
                  throw Error("fixture must not submit");
                }
              }
            );
          if (module === "./deleted-smurf-recovery")
            return load("app/admin/security/deleted-smurf-recovery.tsx");
          if (module === "./event-detail")
            return load("app/admin/security/event-detail.tsx");
          if (module === "./deleted-account-history")
            return load("app/admin/security/deleted-account-history.tsx");
          if (module === "./related-account-picker")
            return load("app/admin/security/related-account-picker.tsx");
          if (module === "./sanction-appeals")
            return load("app/admin/security/sanction-appeals.tsx");
          if (module === "./appeal-token-form")
            return load("app/admin/security/appeal-token-form.tsx");
          if (module === "./farm-asset-preview")
            return load("app/admin/security/farm-asset-preview.tsx");
          if (module === "./sanction-quarantine-conflicts")
            return load("app/admin/security/sanction-quarantine-conflicts.tsx");
          if (module === "@/components/topbar")
            return { Topbar: () => React.createElement("div", null, "Yokkai") };
          if (module === "@/components/account-menu")
            return { AccountMenu: () => null };
          if (module === "../admin-navigation")
            return { AdminNavigation: () => null };
          if (module === "@/components/ui/url-pagination")
            return { UrlPagination: () => null };
          return require(module);
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
    if (
      typeof node.type === "function" &&
      node.type.constructor.name === "AsyncFunction"
    ) {
      const resolved = await resolve(await node.type(node.props));
      return React.isValidElement(resolved)
        ? React.cloneElement(resolved, { key: node.key })
        : resolved;
    }
    return React.cloneElement(node, {}, await resolve(node.props.children));
  }
  const page = await load("app/admin/security/page.tsx").default({
    searchParams: Promise.resolve({
      sanction: id,
      primary: other,
      mode,
      role: role === "missing" ? undefined : role,
      source_account: mode === "deleted" ? other : undefined,
      source: id
    })
  });
  return renderToStaticMarkup(await resolve(page));
}
test("unified sanction page shows one case action, named cards and named network counterparts in both locales", async () => {
  for (const locale of ["en", "fr"])
    for (const mode of ["active", "deleted"]) {
      const html = await renderSanctionPage(locale, mode);
      assert.doesNotMatch(
        html,
        /MISSING_MESSAGE|INVALID_MESSAGE|adminSecurity\./
      );
      assert.match(html, /Related collector/);
      assert.match(html, /active@example.invalid/);
      assert.match(html, /deleted@example.invalid/);
      assert.doesNotMatch(html, /<select\b[^>]*name="primary"/);
      const labels = JSON.parse(
        fs.readFileSync(`messages/${locale}.json`, "utf8")
      ).adminSecurity;
      assert.ok(!html.includes(`>${labels.activeSmurfMode}</`));
      assert.ok(!html.includes(`>${labels.deletedSmurfMode}</`));
      assert.match(html, /BROLY/);
      assert.doesNotMatch(html, />ac620000-0000-4000-8000-000000000003</);
      assert.match(
        html,
        locale === "fr"
          ? /Navigateur commun non confirmé/
          : /Shared browser not confirmed/
      );
      assert.match(html, /name="confirmation"/);
      assert.match(html, /name="anticheat-event"/);
      assert.match(html, /70 Karas/);
      assert.match(html, /5 Karas/);
      if (mode === "deleted") {
        assert.match(html, /deleted@example.invalid/);
        assert.match(html, /name="source_account"/);
      }
      assert.doesNotMatch(html, /<button[^>]*disabled=""/);
    }
});

test("a case opened as primary sends the chosen counterpart as the smurf to ban", async () => {
  const html = await renderSanctionPage("en", "active", "primary");
  assert.match(html, /Smurf account to ban/);
  assert.match(html, /name="role" value="primary"/);
});

test("old links require explicit roles and zero-recovery receipts show their exact outcome", async () => {
  for (const locale of ["en", "fr"]) {
    const legacy = await renderSanctionPage(locale, "active", "missing");
    assert.match(legacy, /role="alert"/);
    assert.match(legacy, /name="role" value=""/);
    assert.match(
      legacy.match(/<input[^>]*name="confirmation"[^>]*>/)[0],
      /disabled=""/
    );
    assert.match(legacy, /role=primary/);
    const receipt = await renderSanctionPage(locale, "active", "smurf", {
      receipt: true,
      recovery: { cards: 0, karas: 0 }
    });
    assert.match(
      receipt,
      locale === "fr"
        ? /aucun retrait de carte ou de Karas/
        : /recovered no cards or Karas/
    );
    assert.match(
      receipt,
      locale === "fr"
        ? /Example player n’est pas banni/
        : /Example player is not banned/
    );
    assert.match(
      receipt,
      locale === "fr" ? /0 carte.*0 Karas/ : /0 cards.*0 Karas/
    );
    assert.match(
      receipt,
      locale === "fr"
        ? /Retrait enregistré dans ce reçu/
        : /Withdrawal recorded in this receipt/
    );
    assert.match(
      receipt,
      locale === "fr" ? /Bannir le smurf uniquement/ : /Ban the smurf only/
    );
  }
});
