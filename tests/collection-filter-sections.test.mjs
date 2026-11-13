import { createTranslator } from "next-intl";
import { intl, gameMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const KEY = "yokkai:filters-open:v1";

function load(file, mocks = {}, globals = {}) {
  const testModule = { exports: {} };
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
  vm.runInNewContext(js, {
    ...globals,
    module: testModule,
    exports: testModule.exports,
    require: name => {
      if (name === "next-intl") return mocks[name] ?? intl;
      if (name === "@/i18n/game-messages") return gameMessages;
      if (name in mocks) return mocks[name];
      if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`);
      return require(name);
    }
  });
  return testModule.exports;
}

const sections = load("lib/ui/filter-sections.ts");

// Client render of the hook: useSyncExternalStore reads the browser snapshot.
function loadHook(localStorage) {
  return load(
    "hooks/use-filter-sections-open.ts",
    {
      react: {
        useCallback: callback => callback,
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
      },
      "@/lib/ui/filter-sections": sections
    },
    { window: { localStorage } }
  ).useFilterSectionsOpen;
}
function storage(initial) {
  const values = new Map(initial === undefined ? [] : [[KEY, initial]]);
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

function loadFilters(open = {}, setSectionOpen = () => {}) {
  return load("components/collection-filters.tsx", {
    "@/hooks/use-filter-sections-open": {
      useFilterSectionsOpen: () => [open, setSectionOpen]
    },
    "@/lib/ui/filter-sections": sections
  });
}
function renderSection(open, props) {
  const { FilterSection } = loadFilters(open);
  return renderToStaticMarkup(
    React.createElement(FilterSection, props, "content")
  );
}

test("sans stockage, Rarity est ouverte et les autres sections fermées", () => {
  const filters = load("components/collection-filters.tsx", {
    "@/lib/ui/filter-sections": sections
  });
  const html = id =>
    renderToStaticMarkup(
      React.createElement(
        filters.FilterSection,
        { sectionId: id, title: id, count: 0 },
        "content"
      )
    );
  assert.match(html("rarity"), /<details class="yk-filter-section" open=""/);
  for (const id of ["category", "status", "folder"])
    assert.doesNotMatch(html(id), /open=""/);

  const [open] = loadHook(storage())();
  assert.equal(open.rarity, true);
  assert.equal(open.category ?? false, false);
});

test("l'état stocké est restauré et chaque bascule est mémorisée", () => {
  const store = storage(JSON.stringify({ rarity: false, folder: true }));
  const useFilterSectionsOpen = loadHook(store);
  const [open, setSectionOpen] = useFilterSectionsOpen();
  assert.equal(open.rarity, false);
  assert.equal(open.folder, true);
  assert.equal(open.category ?? false, false);

  setSectionOpen("category", true);
  assert.deepEqual(JSON.parse(store.values.get(KEY)), {
    rarity: false,
    "catalogue-category": true,
    folder: true,
    category: true
  });
  assert.equal(useFilterSectionsOpen()[0].category, true);
});

test("un JSON invalide ou un localStorage qui lève retombe sur le défaut", () => {
  for (const stored of ["{not json", "[true]", '"rarity"', "null"])
    assert.deepEqual(
      { ...sections.readFilterSectionsOpen(() => stored) },
      { rarity: true, "catalogue-category": true }
    );
  const blocked = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("SecurityError");
    }
  };
  const [open, setSectionOpen] = loadHook(blocked)();
  assert.deepEqual({ ...open }, { rarity: true, "catalogue-category": true });
  assert.doesNotThrow(() => setSectionOpen("category", true));
});

test("le compteur affiche le nombre actif, disparaît à 0 et Reset garde l'ouverture", () => {
  const active = renderSection(
    { category: true },
    { sectionId: "category", title: "Category", count: 2 }
  );
  assert.match(active, /Category<span class="yk-filter-count"> · 2<\/span>/);
  assert.match(active, /aria-label="Category, 2 active filters"/);
  assert.match(active, /aria-expanded="true"/);
  assert.match(active, /open=""/);
  assert.match(
    renderSection({}, { sectionId: "status", title: "Status", count: 1 }),
    /aria-label="Status, 1 active filter"[^>]*>.*· 1/
  );

  // Reset filters sets every count back to 0; the open state lives elsewhere and stays.
  const reset = renderSection(
    { category: true },
    { sectionId: "category", title: "Category", count: 0 }
  );
  assert.doesNotMatch(reset, /yk-filter-count|aria-label/);
  assert.match(reset, /aria-expanded="true"/);
  assert.match(reset, /open=""/);

  const collection = readFileSync("components/collection.tsx", "utf8");
  const resetBody = collection.slice(
    collection.indexOf("const resetFilters = () => {"),
    collection.indexOf("const filters = (")
  );
  assert.match(resetBody, /setRarity\(\[\]\)/);
  assert.doesNotMatch(resetBody, /SectionOpen|filters-open/);
  for (const [id, count] of [
    ["rarity", "rarity.length"],
    ["category", "category.length"],
    // Locked cards sit in Status: they count there, not in Folder.
    ["status", "Number\\(auctionOnly\\) \\+ Number\\(lockedOnly\\)"],
    ["folder", "folder \\? 1 : 0"]
  ])
    assert.match(
      collection,
      new RegExp(`count=\\{${count}\\}\\s+sectionId="${id}"`)
    );
});

test("une chip de rareté ajoute ou retire la rareté avec aria-pressed cohérent", () => {
  const { RarityChips } = loadFilters();
  const { toggleFilterValue } = load("lib/ui/card-search.ts");
  let selected = [];
  // Spread: arrays built inside the vm context have another Array prototype.
  const chips = () => [
    ...RarityChips({
      selected,
      count: r => (r === "SSR" ? 1 : 3),
      onToggle: r => {
        selected = toggleFilterValue(selected, r);
      }
    }).props.children
  ];

  assert.deepEqual(
    chips().map(chip => chip.props.children[0].props.children),
    ["LR", "SSR", "SR", "R", "C"]
  );
  assert.ok(chips().every(chip => chip.props["aria-pressed"] === false));
  assert.equal(chips()[1].props.children[1].props.children, 1);

  chips()[1].props.onClick();
  chips()[4].props.onClick();
  assert.deepEqual([...selected], ["SSR", "C"]);
  assert.deepEqual(
    chips().map(chip => chip.props["aria-pressed"]),
    [false, true, false, false, true]
  );

  chips()[1].props.onClick();
  assert.deepEqual([...selected], ["C"]);
  assert.equal(chips()[1].props["aria-pressed"], false);
});

test("sans sectionId ni count, la section prend son titre comme clé et n'affiche pas de compteur", () => {
  const filters = load("components/collection-filters.tsx", {
    "@/lib/ui/filter-sections": sections
  });
  const html = title =>
    renderToStaticMarkup(
      React.createElement(filters.FilterSection, { title }, "content")
    );
  assert.match(html("Rarity"), /open=""/);
  assert.doesNotMatch(html("Status"), /open=""|yk-filter-count|aria-label/);
  const chips = renderToStaticMarkup(
    React.createElement(filters.RarityChips, {
      selected: ["SR"],
      onToggle: () => {}
    })
  );
  assert.doesNotMatch(chips, /<strong>/);
  assert.match(chips, /aria-pressed="true"><span>SR<\/span>/);
});

test("market, catalogue et wishlists utilisent le même panneau et les mêmes boutons de rareté", () => {
  const community = readFileSync("components/community-views.tsx", "utf8");
  assert.match(community, /from "@\/components\/collection-filters"/);
  assert.doesNotMatch(community, /<details className="yk-filter-section"/);
  assert.doesNotMatch(community, /FilterIcon rarity=/);
  assert.equal(
    (
      community.match(
        /<CatalogueFilterSection title="Rarity"[^>]*>\s*<RarityChips/g
      ) ?? []
    ).length,
    3
  );
  // profile.tsx keeps a local section: its imports are mocked one by one in tests.
  const profile = readFileSync("components/profile.tsx", "utf8");
  assert.match(
    profile,
    /<details\s+className="yk-filter-section"\s+open=\{title === t\("collectionUi\.rarity"\)\}/
  );
  assert.doesNotMatch(profile, /RarityIcon rarity=/);
  assert.match(
    profile,
    /<WishlistFilterSection\s+title=\{t\("collectionUi\.rarity"\)\}[^>]*>\s*<div className="yk-rarity-chips">/
  );
  assert.match(
    profile,
    /className=\{`yk-rarity-chip \$\{wishlistRarityText\[item\]\}`\}/
  );
});

test("Locked cards est dans Status, Sort by est un groupe fixe, rareté multiple partout", () => {
  const collection = readFileSync("components/collection.tsx", "utf8");
  const status = collection.slice(
    collection.indexOf('title={tc("status")}'),
    collection.indexOf('title={tc("folder")}')
  );
  assert.match(status, /tc\("inAuctions"\)/);
  // Same behaviour as In auctions: its own toggle, cleared by Reset filters.
  assert.match(status, /aria-pressed=\{lockedOnly\}/);
  // #388: the collection filter moved to lib/ui/collection-filter.ts.
  assert.match(
    readFileSync("lib/ui/collection-filter.ts", "utf8"),
    /\(!lockedOnly \|\| !!c\.locked\)/
  );
  assert.match(collection, /setLockedOnly\(false\)/);
  assert.match(status, /tc\("lockedCards"\)/);
  assert.doesNotMatch(
    collection.slice(collection.indexOf('title={tc("folder")}')),
    /tc\("lockedCards"\)/
  );

  const filters = load("components/collection-filters.tsx", {
    "@/lib/ui/filter-sections": sections
  });
  const group = renderToStaticMarkup(
    React.createElement(filters.FilterGroup, { title: "Sort by" }, "options")
  );
  assert.match(group, /role="group" aria-label="Sort by"/);
  assert.doesNotMatch(group, /<details|<summary/);

  const community = readFileSync("components/community-views.tsx", "utf8");
  assert.doesNotMatch(community, /useState<Rarity \| "">/);
  const profile = readFileSync("components/profile.tsx", "utf8");
  assert.doesNotMatch(profile, /useState<Rarity \| "">/);
  assert.match(profile, /aria-pressed=\{rarity\.includes\(item\)\}/);
});

test("French filter titles keep their original technical keys and open state across locale changes", () => {
  const states = { rarity: true, category: false };
  const changes = [];
  for (const locale of ["fr", "en", "fr"]) {
    const messages = JSON.parse(
      readFileSync(`messages/${locale}.json`, "utf8")
    );
    const { FilterSection } = load("components/collection-filters.tsx", {
      "next-intl": {
        ...intl,
        useTranslations: namespace =>
          createTranslator({ locale, messages, namespace })
      },
      "@/hooks/use-filter-sections-open": {
        useFilterSectionsOpen: () => [
          states,
          (id, open) => {
            states[id] = open;
            changes.push([id, open]);
          }
        ]
      }
    });
    const rarity = FilterSection({
      title: "Rarity",
      count: 1,
      children: "content"
    });
    const markup = renderToStaticMarkup(rarity);
    assert.match(markup, /open=""/);
    assert.match(markup, locale === "fr" ? /Rareté/ : /Rarity/);
    assert.match(
      markup,
      locale === "fr" ? /Rareté, 1 filtre actif/ : /Rarity, 1 active filter/
    );
    const category = FilterSection({ title: "Category", children: "content" });
    category.props.onToggle({ currentTarget: { open: true } });
    assert.equal(changes.at(-1)[0], "category");
    assert.equal(states.rarity, true);
    assert.equal(states.category, true);
    assert.equal(states["rareté"], undefined);
    assert.equal(states["catégorie"], undefined);
  }
});
