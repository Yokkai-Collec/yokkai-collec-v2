import assert from "node:assert/strict";
import { licenseName } from "./helpers/license-name.mjs";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsx, jsxs } from "react/jsx-runtime";
import { createTranslator } from "next-intl";

const cardId = "20000000-0000-4000-8000-000000000001";

test("reported-card labels are delivered to client components in both locales", () => {
  const layout = readFileSync(
    new URL("../app/layout.tsx", import.meta.url),
    "utf8"
  );
  assert.match(layout, /"adminReportedCard"/);
  assert.match(layout, /NextIntlClientProvider messages=\{clientMessages\}/);
  for (const locale of ["en", "fr"]) {
    const labels = catalog(locale).adminReportedCard;
    assert.deepEqual(Object.keys(labels).sort(), [
      "back",
      "help",
      "manage",
      "manageNamed",
      "missing",
      "title"
    ]);
    assert.match(labels.manageNamed, /\{name\}/);
  }
});
const card = {
  id: cardId,
  nom: "Same name",
  categorie: "ANIME/MANGA",
  franchise: "Test",
  rarete_base: "SR",
  image_url: "https://example.test/image.png",
  card_franchises: [
    { franchise: "Second", position: 1 },
    { franchise: "Test", position: 0 }
  ]
};
const catalog = locale =>
  JSON.parse(
    readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")
  );
const translator = locale =>
  createTranslator({
    locale,
    messages: catalog(locale),
    namespace: "adminReportedCard"
  });
function load(file, modules) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    {
      exports,
      require(name) {
        if (name === "@/lib/ui/license-name") return licenseName;
        if (name === "react/jsx-runtime") return { jsx, jsxs };
        assert(Object.hasOwn(modules, name), name);
        return modules[name];
      },
      Error,
      Promise
    }
  );
  return exports;
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function pageFixture({ allowed = true, existing = card, locale = "en" } = {}) {
  const calls = [];
  const marker = () => null;
  const client = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(fields) {
          calls.push(["select", fields]);
          return {
            eq(key, value) {
              calls.push(["eq", key, value]);
              return {
                maybeSingle: async () => ({ data: existing, error: null })
              };
            }
          };
        }
      };
    },
    rpc: async () => ({ data: ["ANIME/MANGA"], error: null })
  };
  const page = load("app/admin/cards/[id]/page.tsx", {
    "next/link": marker,
    "next/headers": { cookies: async () => ({}) },
    "next/navigation": {
      notFound() {
        throw new Error("NOT_FOUND");
      }
    },
    "next-intl/server": { getTranslations: async () => translator(locale) },
    "@/lib/auth/admin": {
      requireAdminPage: async () => {
        calls.push(["auth"]);
        if (!allowed) throw new Error("FORBIDDEN");
        return { id: "admin" };
      }
    },
    "@/lib/auth/session": {
      getCurrentPseudo: async () => "Admin",
      getCurrentKarasBalance: async () => 12
    },
    "@/utils/supabase/server": { createClient: () => client },
    "@/components/account-menu": { AccountMenu: marker },
    "@/components/topbar": { Topbar: marker },
    "../../admin-navigation": { AdminNavigation: marker },
    "../admin-card-manager": { CardRow: marker }
  });
  return { page, calls };
}

test("reported card page authenticates before reading and selects only the exact card UUID", async () => {
  const { page, calls } = pageFixture();
  const tree = await page.default({ params: Promise.resolve({ id: cardId }) });
  assert.deepEqual(calls[0], ["auth"]);
  assert.deepEqual(
    calls.find(c => c[0] === "eq"),
    ["eq", "id", cardId]
  );
  assert.equal(calls.filter(c => c[0] === "from").length, 1);
  const editor = nodes(tree).find(n => n.props?.card);
  assert.equal(editor.props.card.id, cardId);
  assert.deepEqual(Array.from(editor.props.card.franchises), [
    "Test",
    "Second"
  ]);
  assert(nodes(tree).some(n => n.props?.href === "/admin/reports"));
});

test("unauthorized and malformed routes never query catalogue cards", async () => {
  const denied = pageFixture({ allowed: false });
  await assert.rejects(
    denied.page.default({ params: Promise.resolve({ id: cardId }) }),
    /FORBIDDEN/
  );
  assert.equal(
    denied.calls.some(c => c[0] === "from"),
    false
  );
  for (const id of ["Same name", "../../cards", "", cardId + "x"]) {
    const fixture = pageFixture();
    await assert.rejects(
      fixture.page.default({ params: Promise.resolve({ id }) }),
      /NOT_FOUND/
    );
    assert.equal(
      fixture.calls.some(c => c[0] === "from"),
      false
    );
  }
});

test("deleted card has a localized empty state and no editor or delete action", async () => {
  for (const locale of ["en", "fr"]) {
    const { page } = pageFixture({ existing: null, locale });
    const tree = await page.default({
      params: Promise.resolve({ id: cardId })
    });
    assert.equal(
      nodes(tree).some(n => n.props?.card),
      false
    );
    assert.equal(
      nodes(tree).find(n => n.props?.role === "status").props.children,
      translator(locale)("missing")
    );
    assert.equal(
      (await page.generateMetadata()).title,
      translator(locale)("title")
    );
  }
});

test("report management links resolve the card rather than its name or reporter", () => {
  for (const locale of ["en", "fr"]) {
    const { CardReportList } = load("app/admin/reports/card-report-list.tsx", {
      "next/link": () => null,
      react: { useActionState: () => [{ message: "" }, () => {}, false] },
      "next-intl": { useTranslations: () => translator(locale) },
      "./actions": { setCardReportStatusAction: () => {} }
    });
    const tree = CardReportList({
      reports: [
        {
          id: "report",
          cardId,
          cardName: "Same name",
          reporterId: "different-player",
          reason: "image_issue",
          status: "pending"
        }
      ],
      playerHrefBase: "/admin/reports?player="
    });
    const link = nodes(tree).find(
      n => n.props?.href === `/admin/cards/${cardId}`
    );
    assert.ok(link);
    assert.equal(link.props.children, translator(locale)("manage"));
    assert.equal(
      link.props["aria-label"],
      translator(locale)("manageNamed", { name: "Same name" })
    );
  }
});
