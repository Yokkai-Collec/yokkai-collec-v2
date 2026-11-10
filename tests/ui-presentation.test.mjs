import { normalizeWhitespace } from "./helpers/normalize-whitespace.mjs";
import { homePresentation } from "./helpers/home-presentation.mjs";
import { assertPngAsset, imageAsset } from "./helpers/visual-assets.mjs";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { englishMessages, intl, intlServer } from "./helpers/i18n.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

test("les échanges réutilisent les cartes standard sans écraser leurs textes internes", () => {
  const source = readFileSync(path.join(root, "components/trades.tsx"), "utf8");
  const css = readFileSync(path.join(root, "styles/community.css"), "utf8");
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /function OfferCards[\s\S]*?return <ReviewCards cards=\{cards\}\/>/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /<YokaiCard \{\.\.\.card\} image=\{card\.customImageUrl\?\?card\.image\}/
    )
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-trade-review-cards>div>div>span\s*\{/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-trade-review-cards\s+span\s*\{/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(source),
    normalizeWhitespace(/className="yk-offer-cards"/)
  );
});

test("la wishlist d'un ami se filtre par recherche, rareté et catégorie", () => {
  const source = readFileSync(
    path.join(root, "components/profile.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/function FriendWishlist/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /matchesCardSearch\(query,\[card\.name,card\.category,card\.anime\]\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /\(!rarity\.length\|\|rarity\.includes\(card\.rarity\)\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/card\.category===category/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/title=\{t\("collectionUi.rarity"\)\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/title=\{t\("collectionUi.category"\)\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/t\("collectionUi.resetFilters"\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/<FriendWishlist cards=\{wishlist\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/shown\.map\(card=>\(?<Link[^>]+><CardShell><YokaiCard/)
  );
});
const modules = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename);
  const exports = {};
  modules.set(filename, exports);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    }
  }).outputText;
  vm.runInNewContext(
    code,
    {
      exports,
      URL,
      process: { env: { NODE_ENV: "test" } },
      require: name => {
        if (name.startsWith("@/messages/trade-limits/"))
          return {
            __esModule: true,
            default: JSON.parse(
              readFileSync(path.join(root, name.slice(2)), "utf8")
            )
          };
        if (name === "@/messages/en.json")
          return { __esModule: true, default: englishMessages };
        if (name === "next-intl") return intl;
        if (name === "next-intl/server") return intlServer;
        if (name === "@/i18n/server")
          return { syncProfileLocale: async () => {} };
        if (name === "@/components/locale-controls")
          return { LocaleSelector: () => null };
        if (name.endsWith(".css")) return {};
        if (name === "@/lib/data/cards")
          return {
            getAllCards() {
              assert.fail("Presentational server render must not load the API");
            },
            getUserCollection() {
              assert.fail("Presentational server render must not load the API");
            }
          };
        if (name === "@/components/ui") return load("components/ui/index.tsx");
        if (name.startsWith("@/")) {
          const modulePath = name.slice(2);
          const relative = (
            modulePath.endsWith(".mjs")
              ? [modulePath]
              : ["tsx", "ts"].map(extension => `${modulePath}.${extension}`)
          ).find(candidate => existsSync(path.join(root, candidate)));
          if (!relative) throw new Error(`Module local introuvable : ${name}`);
          return load(relative);
        }
        return require(name);
      }
    },
    { filename }
  );
  return exports;
}
const render = (component, props) =>
  renderToStaticMarkup(React.createElement(component, props));

test("revealed cards show the requested duplicate and wishlist captions without leaking pending cards", () => {
  const { BoosterReveal } = load("components/boosters.tsx");
  const make = (instanceId, extra) => ({
    ...card,
    name: instanceId,
    instanceId,
    rarity: "SR",
    ...extra
  });
  const cards = [
    make("duplicate", { isNew: false, copies: 2 }),
    make("wishlist", { isNew: true, copies: 1, wishlisted: true }),
    make("both", { isNew: false, copies: 3, wishlisted: true }),
    make("normal", { isNew: true, copies: 1 }),
    make("pending", { isNew: false, copies: 2, wishlisted: true })
  ];
  const props = { cards, revealed: 4, onReveal() {}, onReturn() {} };
  const html = render(BoosterReveal, props);
  assert.equal((html.match(/>Duplicate</g) ?? []).length, 2);
  assert.equal((html.match(/>In your wishlist</g) ?? []).length, 2);
  assert.equal((html.match(/class="yk-drop-card-icons"/g) ?? []).length, 3);
  assert.match(
    html,
    /yk-card-category-accessory"><span class="yk-drop-card-icons"/
  );
  assert.match(html, /yk-drop-wishlist"><span>♥<\/span>/);
  assert.match(html, /yk-drop-badges-labels/);
  assert.match(
    html,
    /yk-drop-duplicate"><svg class="yk-duplicate-icon"[^>]*aria-hidden="true"[^>]*focusable="false"/
  );
  assert.match(html, /aria-label="[^"]*on your wishlist/);
  assert.match(html, /aria-label="[^"]*, duplicate/);
  const unknown = render(BoosterReveal, {
    ...props,
    cards: [make("unknown", {})],
    revealed: 1
  });
  assert.doesNotMatch(unknown, /yk-drop-badges/);
  const overview = render(BoosterReveal, {
    ...props,
    cards: Array.from({ length: 25 }, (_, index) =>
      make(`overview-${index}`, {
        isNew: false,
        copies: 2,
        wishlisted: index === 0
      })
    ),
    packCount: 5,
    revealed: 25
  });
  assert.match(overview, /yk-drop-badges-labels/);
  assert.equal((overview.match(/>Duplicate</g) ?? []).length, 25);
  assert.equal((overview.match(/>In your wishlist</g) ?? []).length, 1);
  assert.equal(
    (overview.match(/class="yk-drop-card-icons"/g) ?? []).length,
    25
  );
  assert.match(
    overview,
    /yk-drop-duplicate"><svg class="yk-duplicate-icon"[^>]*aria-hidden="true"[^>]*focusable="false"/
  );
});

test("collection distinguishes pending, failed, successful empty and stale refresh states", () => {
  const { CollectionView } = load("components/collection.tsx");
  const pending = render(CollectionView, {
    cards: [],
    categories: [],
    loading: true
  });
  assert.match(pending, /Loading your cards/);
  assert.match(pending, /aria-busy="true"/);
  assert.doesNotMatch(pending, /Your collection is empty|Open my first pack/);
  const failed = render(CollectionView, {
    cards: [],
    categories: [],
    loading: true,
    loadError: "Network unavailable",
    onRetryLoad() {}
  });
  assert.match(failed, /Your cards couldn’t load/);
  assert.match(failed, /Try again/);
  assert.doesNotMatch(failed, /Your collection is empty|Loading your cards/);
  const empty = render(CollectionView, {
    cards: [],
    categories: [],
    loading: false
  });
  assert.match(empty, /Your collection is empty/);
  const stale = render(CollectionView, {
    cards: [{ ...card, instanceId: "copy", obtainedAt: "2026-10-25" }],
    categories: [],
    loading: true,
    loadError: "Network unavailable",
    onRetryLoad() {}
  });
  assert.match(stale, /Your last loaded collection is still shown/);
  assert.match(stale, /Owned card groups/);
  assert.doesNotMatch(stale, /Your collection is empty|Loading your cards/);
});

test("les actions compactes de détail gardent leurs libellés accessibles sans texte visible", () => {
  const { CardShareButton } = load("components/card-sharing.tsx");
  const { CardReportButton } = load("components/card-report-button.tsx");
  const share = render(CardShareButton, {
    instanceId: "card-1",
    name: "Aiolia",
    iconOnly: true
  });
  const report = render(CardReportButton, {
    cardId: "card-1",
    cardName: "Aiolia",
    iconOnly: true
  });
  assert.match(share, /aria-label="Share Aiolia"/);
  assert.match(share, /<svg aria-hidden="true"/);
  assert.doesNotMatch(share, />Share</);
  assert.match(report, /aria-label="Report Aiolia"/);
  assert.match(report, /aria-hidden="true"[^>]*>⚑<\/span>/);
  assert.doesNotMatch(report, />[^<]*Report this card/);
  assert.match(
    render(CardShareButton, { instanceId: "card-1", name: "Aiolia" }),
    />Share<\/button>/
  );
});

test("les routes consommatrices de MarketView ont exactement un h1 sans saut de niveau", async () => {
  for (const route of [
    "market-preview",
    "market-search-preview",
    "market-popularity-preview",
    "auction-participation-preview",
    "multi-term-search-preview"
  ]) {
    const page = load(`app/design-system/${route}/page.tsx`).default;
    const element = await page({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);
    const levels = [...html.matchAll(/<h([1-6])(?:\s|>)/g)].map(match =>
      Number(match[1])
    );
    assert.equal(levels.filter(level => level === 1).length, 1, route);
    let previous = 0;
    for (const level of levels) {
      assert.ok(level <= previous + 1, `${route}: h${previous} -> h${level}`);
      previous = level;
    }
  }
  const { MarketView } = load("components/community-views.tsx");
  const exports = {};
  const code = ts.transpileModule(
    readFileSync(path.join(root, "app/market/page.tsx"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    require: name =>
      name === "next-intl/server"
        ? intlServer
        : name === "@/components/community-page"
          ? { CommunityPage: props => React.createElement(MarketView, props) }
          : name === "@/components/market-heading"
            ? load("components/market-heading.tsx")
            : require(name)
  });
  const html = renderToStaticMarkup(await exports.default());
  assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1);
  assert.match(
    readFileSync(
      path.join(root, "components/multi-term-search-proof.tsx"),
      "utf8"
    ),
    /<h2[^>]*>Marché<\/h2>/
  );
});

test("deleted avatars and auction participants render safely without profile links", () => {
  const { Avatar } = load("components/ui/index.tsx");
  assert.match(render(Avatar, { name: null }), /aria-label="Deleted player"/);
  const { AuctionView, presentAuction } = load(
    "components/community-views.tsx"
  );
  const auction = presentAuction(
    {
      id: "deleted",
      card,
      amount: 10,
      endsAt: "2026-10-10T00:00:00Z",
      status: "sold",
      seller: null,
      sellerId: null,
      buyerId: null,
      bids: 1,
      watched: false,
      balance: 100,
      winner: "Joueur supprimé",
      history: [
        {
          id: "bid",
          name: "Joueur supprimé",
          amount: 10,
          createdAt: "2026-10-09T00:00:00Z",
          mine: false
        }
      ]
    },
    "viewer"
  );
  const html = render(AuctionView, { auction });
  assert.match(html, /Joueur supprimé/);
  assert.doesNotMatch(html, /\/profile\/(?:Joueur|undefined|null)/);
});

test("offscreen avatars defer loading and decode asynchronously without losing their alt text", () => {
  const { Avatar } = load("components/ui/index.tsx");
  const html = render(Avatar, {
    name: "Player",
    image: "https://example.test/avatar.png",
    size: 32
  });
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);
  assert.match(html, /alt="Player"/);
  assert.match(html, /width="32"/);
  assert.match(html, /height="32"/);
});

test("route and root layout errors offer retry without exposing internal details", () => {
  for (const relative of ["app/error.tsx", "app/global-error.tsx"]) {
    assert.ok(
      existsSync(path.join(root, relative)),
      `${relative} doit prendre en charge les erreurs`
    );
    assert.match(
      readFileSync(path.join(root, relative), "utf8"),
      /^["']use client["']/
    );
    const ErrorPage = load(relative).default;
    let retries = 0;
    const props = {
      error: new Error("PRIVATE_DATABASE_DETAILS"),
      retry: () => {
        retries++;
      }
    };
    const html = render(ErrorPage, props);
    assert.match(html, /Unable to load this page/);
    assert.match(html, /Try again/);
    assert.doesNotMatch(html, /PRIVATE_DATABASE_DETAILS/);
    if (relative.includes("global-error")) {
      assert.match(html, /<html lang="en"/);
      assert.match(html, /<body/);
    }
    const buttons = [];
    function visit(node) {
      if (!React.isValidElement(node)) return;
      if (typeof node.type === "function") return visit(node.type(node.props));
      if (node.type === "button") buttons.push(node);
      React.Children.forEach(node.props.children, visit);
    }
    visit(ErrorPage(props));
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].props.type, "button");
    buttons[0].props.onClick();
    assert.equal(
      retries,
      1,
      "Le bouton doit relancer la récupération du segment"
    );
  }
});
const card = {
  id: "card-a",
  instanceId: "copy-a",
  name: "Carte de test",
  category: "Test",
  rarity: "SSR",
  image: "/test-image.png",
  obtainedAt: "2026-09-24T10:00:00Z"
};

test("les titres H1 utilisent la police locale livrée, Inter après sa migration", () => {
  const layout = readFileSync(path.join(root, "app/layout.tsx"), "utf8");
  const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
  const inter = existsSync(
    path.join(root, "app/fonts/inter/InterVariable.ttf")
  );
  assert.match(
    normalizeWhitespace(layout),
    normalizeWhitespace(
      inter
        ? /localFont\(\{[\s\S]*InterVariable\.ttf[\s\S]*weight: "100 900"[\s\S]*variable: "--font-inter"/
        : /localFont\(\{[\s\S]*HYWenHei-85W\.ttf[\s\S]*variable: "--font-hy-wen-hei"/
    )
  );
  assert.match(
    normalizeWhitespace(layout),
    normalizeWhitespace(
      inter ? /\$\{inter\.variable\}/ : /\$\{hyWenHei\.variable\}/
    )
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      inter
        ? /--font-heading: var\(--font-inter\), system-ui, sans-serif/
        : /--font-heading: var\(--font-hy-wen-hei\), Arial, sans-serif/
    )
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /h1 \{ font-family: var\(--font-heading\) !important; \}/
    )
  );
  assert.ok(
    existsSync(
      path.join(
        root,
        inter
          ? "app/fonts/inter/InterVariable.ttf"
          : "app/fonts/hywenhei-85w/HYWenHei-85W.ttf"
      )
    )
  );
});

test("la page d’accueil utilise le même logo que la navigation", () => {
  const presentation = homePresentation();
  const landing = presentation.header;
  const css = presentation.css;
  assert.equal(
    imageAsset(landing, presentation.brandImageClass),
    imageAsset(
      readFileSync(path.join(root, "components/topbar.tsx"), "utf8"),
      "yk-brand-image"
    )
  );
  assert.match(
    normalizeWhitespace(landing),
    normalizeWhitespace(
      new RegExp(`className="${presentation.brandImageClass}"`)
    )
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      presentation.shared
        ? /\.yk-auth-brand \{ display: flex; width: 112px;/
        : /\.yk-landing-brand \{ display: inline-flex; width: 112px;/
    )
  );
});

test("les pages d’authentification utilisent le même logo que la navigation", () => {
  const layout = readFileSync(path.join(root, "app/(auth)/layout.tsx"), "utf8");
  const css = readFileSync(path.join(root, "styles/auth.css"), "utf8");
  assert.equal(
    imageAsset(layout, "yk-auth-brand-image"),
    imageAsset(
      readFileSync(path.join(root, "components/topbar.tsx"), "utf8"),
      "yk-brand-image"
    )
  );
  assert.match(layout, /className="yk-auth-brand-image"/);
  assert.doesNotMatch(layout, /className="yk-auth-logo"/);
  assert.match(css, /\.yk-auth-brand-image\s*\{/);
});

test("la police locale livrée pilote l'affichage sans changer les noms sur les cartes", () => {
  const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
  const ui = readFileSync(path.join(root, "styles/ui.css"), "utf8");
  const cards = readFileSync(path.join(root, "styles/cards.css"), "utf8");
  const display = existsSync(
    path.join(root, "app/fonts/inter/InterVariable.ttf")
  )
    ? /--font-display: var\(--font-inter\), system-ui, sans-serif/
    : /--font-display: var\(--font-hy-wen-hei\), Arial, sans-serif/;
  assert.match(css, display);
  assert.match(ui, display);
  assert.match(ui, /--font-card-name: var\(--font-cinzel\), Georgia, serif/);
  assert.match(
    cards,
    /\.yk-card-name \{[^}]*font-family: var\(--font-card-name\)/
  );
});

test("les nouveaux visuels distinguent le booster régulier du Decision Pack", () => {
  const boosters = readFileSync(
    path.join(root, "components/boosters.tsx"),
    "utf8"
  );
  const cards = readFileSync(path.join(root, "styles/cards.css"), "utf8");
  const styles = readFileSync(path.join(root, "styles/boosters.css"), "utf8");
  const regular = imageAsset(boosters, "yk-pack-image");
  const decision = imageAsset(boosters, "yk-pack-image yk-decision-image");
  assert.notEqual(regular, decision);
  assert.ok(
    boosters.includes(`src="${regular}" alt="Yokkai Collec’ Regular Pack`)
  );
  assert.ok(boosters.includes(`src="${decision}" alt="Decision Pack`));
  assert.doesNotMatch(boosters, /yk-pack-tear/);
  assert.doesNotMatch(
    normalizeWhitespace(styles),
    normalizeWhitespace(/\.yk-decision-image \{[^}]*hue-rotate/)
  );
  assert.match(
    normalizeWhitespace(styles),
    normalizeWhitespace(
      /\.yk-decision-panel \.yk-pack-art-stage \{[^}]*var\(--color-karas\)/
    )
  );
  const backRule = cards.match(/\.yk-card-back\s*\{[^}]*\}/)?.[0];
  assert.ok(backRule);
  const back = assertPngAsset(backRule.match(/url\(["']([^"']+)["']\)/)?.[1]);
  assert.notEqual(back, regular);
  assert.notEqual(back, decision);
  assert.match(
    normalizeWhitespace(cards),
    normalizeWhitespace(
      /\.yk-card-back \{[^}]*background: (?:#050507|transparent) url\(["']\/assets\/[a-zA-Z0-9_-]+\.png["']\) center \/ cover no-repeat;/
    )
  );
  assert.match(backRule, /width:\s*100%;/);
  assert.match(backRule, /aspect-ratio:\s*5\s*\/\s*7;/);
  assert.match(backRule, /border-radius:\s*12px;/);
  for (const asset of [back, regular, decision])
    assert.ok(
      existsSync(path.join(root, "public", asset.slice(1))),
      `${asset} doit être présent`
    );
});

test("le verrou synchrone empêche deux ouvertures dans le même tick", async () => {
  const { runPackOpeningOnce } = load("lib/ui/pack-opening.ts");
  const lock = { current: false };
  let calls = 0;
  let release;
  const pending = new Promise(resolve => {
    release = resolve;
  });
  const openBooster = async () => {
    calls += 1;
    await pending;
  };
  const first = runPackOpeningOnce(lock, openBooster);
  const second = runPackOpeningOnce(lock, openBooster);
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  calls = 0;
  await Promise.all([openBooster(), openBooster()]);
  assert.equal(calls, 2, "contre-preuve sans verrou");
});

test("le verrou d'ouverture est libéré après une erreur serveur", async () => {
  const { runPackOpeningOnce } = load("lib/ui/pack-opening.ts");
  const lock = { current: false };
  await assert.rejects(
    runPackOpeningOnce(lock, async () => {
      throw new Error("session expirée");
    }),
    /session expirée/
  );
  assert.equal(lock.current, false);
  let retried = false;
  await runPackOpeningOnce(lock, async () => {
    retried = true;
  });
  assert.equal(retried, true);
});

test("opening waits for both the response and the single final animation", async () => {
  const { runFinalBoosterOpening } = load("lib/ui/pack-opening.ts");
  for (const responseFirst of [true, false]) {
    let respond,
      finish,
      complete = false;
    const response = new Promise(resolve => {
      respond = resolve;
    });
    const finished = new Promise(resolve => {
      finish = resolve;
    });
    const opening = runFinalBoosterOpening({
      open: () => response,
      finished,
      onResponse() {},
      preload: async () => {}
    }).then(() => {
      complete = true;
    });
    (responseFirst ? () => respond([card]) : finish)();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(complete, false);
    (responseFirst ? finish : () => respond([card]))();
    await opening;
    assert.equal(complete, true);
  }
  const source = readFileSync(
    path.join(root, "components/boosters.tsx"),
    "utf8"
  );
  assert.match(source, /if \(openingLock\.current\) return;/);
  assert.match(source, /element\.inert = true/);
  assert.match(source, /type: "yokkai-booster-next-step"/);
  assert.doesNotMatch(
    source,
    /runPackOpeningSequence|requestSeal|accelerateSeal/
  );
});

test("Shiny reste une surcouche SSR/LR et ne s'applique pas aux autres raretés", () => {
  const { YokaiCard } = load("components/yokai-card.tsx");
  for (const rarity of ["C", "R", "SR"]) {
    const html = render(YokaiCard, { ...card, rarity, shiny: true });
    assert.doesNotMatch(html, /yk-shiny-frame/);
  }
  for (const rarity of ["SSR", "LR"]) {
    const html = render(YokaiCard, {
      ...card,
      rarity,
      shiny: true,
      animated: false
    });
    assert.match(html, new RegExp(`yk-rarity-${rarity}`));
    assert.match(html, /yk-shiny-frame/);
    if (rarity === "SSR") {
      assert.match(html, /yk-evolved/);
      assert.doesNotMatch(html, /yk-shiny(?: |")/);
    } else {
      assert.match(html, /yk-shiny(?: |")/);
      assert.doesNotMatch(html, /yk-evolved/);
    }
    assert.match(
      html,
      new RegExp(
        `aria-label="[^"]*, ${rarity === "SSR" ? "SSR INFINITY" : "LR Shiny"},`
      )
    );
    assert.doesNotMatch(html, /SSR Shiny/);
    assert.match(
      html,
      new RegExp(
        `yk-shiny-badge[^>]*>${rarity === "SSR" ? '<svg[^>]*class="yk-evolved-symbol"[^>]*>' : "✦</span>"}`
      )
    );
    assert.doesNotMatch(html, /yk-animated|yk-sparkle/);
    assert.match(html, /test-image\.png/);
  }
});

test("la carte affiche la franchise dans son cadre sans répéter la catégorie générique", () => {
  const { YokaiCard } = load("components/yokai-card.tsx");
  const withFranchise = render(YokaiCard, {
    ...card,
    anime: "Black Clover",
    animated: false
  });
  assert.match(withFranchise, /yk-card-anime[^>]*[^]*Black Clover/);
  const withoutFranchise = render(YokaiCard, {
    ...card,
    category: "Anime\/Manga",
    anime: undefined,
    animated: false
  });
  assert.doesNotMatch(withoutFranchise, /yk-card-anime/);
});

test("un solde absent reste inconnu, un solde connu utilise en-US", () => {
  const { Karas } = load("components/ui/index.tsx");
  assert.match(render(Karas, {}), /Karas balance unavailable/);
  assert.match(render(Karas, {}), /—/);
  assert.match(render(Karas, { amount: 1240 }), /1,240/);
});

test("les modales imbriquées libèrent le scroll et la confirmation remplace le détail", () => {
  const modal = readFileSync(
    path.join(root, "components/ui/index.tsx"),
    "utf8"
  );
  const collection = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(/modalLockCount = Math\.max\(0, modalLockCount - 1\)/)
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(
      /if \(modalLockCount === 0\) document\.body\.style\.overflow = bodyOverflowBeforeModal/
    )
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(
      /onClose=\{\(\) => \{ if \(open && !ref\.current\?\.open\) onClose\(\); \}\}/
    )
  );
  assert.doesNotMatch(
    normalizeWhitespace(modal),
    normalizeWhitespace(/onClose=\{\(\) => \{ if \(open\) onClose\(\); \}\}/)
  );
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(
      /open=\{!!selected&&!discardConfirm&&!auctionOpen&&!evolveConfirm\}/
    )
  );
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(/open=\{auctionOpen&&!!selected\}/)
  );
});

test("la destruction multiple est active et transmet tous les exemplaires sélectionnés", () => {
  const collection = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  const controls = readFileSync(
    path.join(root, "components/ui/index.tsx"),
    "utf8"
  );
  const styles = readFileSync(path.join(root, "styles/collection.css"), "utf8");
  const game = readFileSync(path.join(root, "components/game.tsx"), "utf8");
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(
      /onDiscardMany\(selectedCards\.map\(card => card\.instanceId\)\)/
    )
  );
  assert.match(
    normalizeWhitespace(controls),
    normalizeWhitespace(/busy\?tu\("destroying"\):tu\("destroySelected"\)/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(collection),
    normalizeWhitespace(/Destruction coming soon/)
  );
  assert.ok(
    collection.indexOf("<SelectionBar") >
      collection.indexOf("className={`yk-card-grid yk-collection-grid")
  );
  assert.match(
    normalizeWhitespace(
      styles.match(/\.yk-selection-bar \{[^}]+\}/)?.[0] ?? ""
    ),
    normalizeWhitespace(/position:\s*sticky/)
  );
  assert.match(
    normalizeWhitespace(
      styles.match(/\.yk-selection-bar \{[^}]+\}/)?.[0] ?? ""
    ),
    normalizeWhitespace(/bottom:\s*var\(--layout-gutter-compact\)/)
  );
  assert.match(
    normalizeWhitespace(game),
    normalizeWhitespace(/onDiscardMany=\{discardCollectionCards\}/)
  );
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(
      /presentation\[card\.instanceId\]\?\.destructionValue\?\?DESTRUCTION_KARAS\[card\.rarity\]/
    )
  );
  assert.doesNotMatch(
    normalizeWhitespace(collection),
    normalizeWhitespace(/const valueKnown = selectedCards/)
  );
});

test("la collection d'un ami montre ses images personnalisées sans proposer d'édition", () => {
  const { CollectionView } = load("components/collection.tsx");
  const html = render(CollectionView, {
    cards: [
      {
        ...card,
        image: "https://i.imgur.com/private.png",
        catalogueImage: "/catalogue.png"
      }
    ],
    categories: ["Test"],
    readOnly: true
  });
  assert.match(html, /Carte de test/);
  assert.match(html, /private\.png/);
  assert.doesNotMatch(html, /Sélection multiple|Destroy selected|Edit profile/);
});

test("le compteur de cartes ouvre toute collection autorisée en lecture seule", () => {
  const profile = readFileSync(
    path.join(root, "components/profile.tsx"),
    "utf8"
  );
  const communityCss = readFileSync(
    path.join(root, "styles/community.css"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(/!isMe&&profile\.canViewCollection\?\(?<button/)
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(/if\(!profile\|\|!profile\.canViewCollection\)return/)
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(
      /profile\.canViewCollection\?profile\.cardCount:t\("profileUi.private"\)/
    )
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(
      /profile\.canViewCollection\?profile\.distinctCardCount:t\("profileUi.private"\)/
    )
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(/getFriendCollection\(friendId\)/)
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(
      /<CollectionView cards=\{friendCards\} categories=\{categories\} loadPaniniAlbums=\{loadFriendPaniniAlbums\} loadPaniniAlbumCards=\{loadFriendPaniniAlbumCards\} readOnly\/>/
    )
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(/t\("profileUi.viewCollection"\)/)
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(/className="yk-friend-collection-modal"/)
  );
  assert.match(
    normalizeWhitespace(communityCss),
    normalizeWhitespace(
      /\.yk-modal\.yk-friend-collection-modal \{ width: min\(1400px,calc\(100% - 32px\)\); \}/
    )
  );
});

test("le compteur wishlist d'un ami ouvre toute sa wishlist et chaque carte reste cliquable", () => {
  const profile = readFileSync(
    path.join(root, "components/profile.tsx"),
    "utf8"
  );
  if (profile.includes("data-profile-wishlist")) {
    assert.match(
      normalizeWhitespace(profile),
      normalizeWhitespace(
        /<button[^>]+onClick=\{\(\)=>setWishlistOpen\(true\)\}[^>]+data-profile-wishlist/
      )
    );
    assert.match(
      normalizeWhitespace(profile),
      normalizeWhitespace(/disabled=\{!profile\.canViewCollection\}/)
    );
    assert.match(profile, /aria-haspopup="dialog"/);
  } else {
    assert.match(
      normalizeWhitespace(profile),
      normalizeWhitespace(
        /profile\.friendshipStatus==="accepted"\?\(?<button[^>]+onClick=\{\(\)=>setWishlistOpen\(true\)\}/
      )
    );
  }
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(/t\("profileUi.wishlistFor",\{name:profile.pseudo\}\)/)
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(
      /shown\.map\(card=>\(?<Link href=\{`\/catalog\?carte=\$\{card\.id\}`\}/
    )
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(/t\("profileUi.viewWishlist"\)/)
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(
      /aria-label=\{t\("profileUi.viewCatalogCard",\{name:card.name\}\)\}/
    )
  );
});

test("l’aperçu wishlist du profil garde des cartes compactes", () => {
  const profile = readFileSync(
    path.join(root, "components/profile.tsx"),
    "utf8"
  );
  const community = readFileSync(
    path.join(root, "styles/community.css"),
    "utf8"
  );
  if (profile.includes("data-profile-wishlist")) {
    assert.doesNotMatch(profile, /tab !== "wishlist"/);
    assert.doesNotMatch(profile, /\["wishlist", "Wishlist"\]/);
    assert.match(profile, /className="yk-card-grid yk-wishlist-grid"/);
  } else {
    assert.match(
      normalizeWhitespace(profile),
      normalizeWhitespace(
        /className="yk-card-grid yk-profile-wishlist-preview mt-5"/
      )
    );
  }
  assert.match(
    normalizeWhitespace(community),
    normalizeWhitespace(
      /\.yk-profile-wishlist-preview \{ --card-grid-columns-xl: 5; --card-grid-columns-lg: 4; --card-grid-columns-md: 3; --card-grid-columns-sm: 2; \}/
    )
  );
});

test("une carte d'ami ouvre une proposition d'échange présélectionnée et extensible", () => {
  const collection = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  const trades = readFileSync(path.join(root, "components/trades.tsx"), "utf8");
  const community = readFileSync(
    path.join(root, "components/community-views.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(/\/trades\?ami=.*&carte=/)
  );
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(/tc\("offerATrade"\)/)
  );
  assert.match(
    normalizeWhitespace(community),
    normalizeWhitespace(/initialRequestedCardId=\{searchParams\.get\("carte"\)/)
  );
  assert.match(
    normalizeWhitespace(trades),
    normalizeWhitespace(/setRequested\(new Set\(\[initialRequestedCardId\]\)\)/)
  );
  assert.match(
    normalizeWhitespace(trades),
    normalizeWhitespace(
      /selectGroupQuantity\(selected,group\.cards,quantity[+-]1\)/
    )
  );
});

test("le catalogue reprend la sidebar sans notion de possession ni action de masse", () => {
  const source = readFileSync(
    path.join(root, "components/community-views.tsx"),
    "utf8"
  );
  const layout = readFileSync(path.join(root, "app/layout.tsx"), "utf8");
  const styles = readFileSync(path.join(root, "styles/community.css"), "utf8");
  const catalogue = source.slice(
    source.indexOf("export function SearchView"),
    source.indexOf("export function TradesView")
  );
  const detail = source.slice(
    source.indexOf("function CatalogueCardModal"),
    source.indexOf("function CatalogueFilterIcon")
  );
  assert.match(
    normalizeWhitespace(catalogue),
    normalizeWhitespace(/yk-collection-sidebar/)
  );
  assert.match(
    normalizeWhitespace(catalogue),
    normalizeWhitespace(/CatalogueFilterSection title="Rarity"/)
  );
  assert.match(
    normalizeWhitespace(catalogue),
    normalizeWhitespace(/CatalogueFilterSection title="Category"/)
  );
  assert.match(
    normalizeWhitespace(catalogue),
    normalizeWhitespace(/<CardShell><YokaiCard/)
  );
  assert.match(
    normalizeWhitespace(catalogue),
    normalizeWhitespace(/CARD_PAGE_SIZES\.map/)
  );
  assert.match(
    normalizeWhitespace(catalogue),
    normalizeWhitespace(
      /loadPage\(\{query,category,rarity,page,pageSize\}\)[^]*?\[query,category,rarity,page,pageSize,loadPage\]/
    )
  );
  assert.match(
    normalizeWhitespace(catalogue),
    normalizeWhitespace(/<CatalogueCardModal selected=\{selected\}/)
  );
  assert.match(
    normalizeWhitespace(detail),
    normalizeWhitespace(/tv\("currentOwners"\)/)
  );
  assert.match(
    normalizeWhitespace(detail),
    normalizeWhitespace(
      /CardOwnerList title=\{tv\("friends"\)\} owners=\{friendOwners\}/
    )
  );
  assert.match(
    normalizeWhitespace(detail),
    normalizeWhitespace(
      /CardOwnerList title=\{tv\("otherPlayers"\)\} owners=\{otherOwners\}/
    )
  );
  assert.match(
    normalizeWhitespace(detail),
    normalizeWhitespace(/className="yk-catalogue-owner-columns"/)
  );
  assert.match(
    normalizeWhitespace(styles),
    normalizeWhitespace(
      /\.yk-catalogue-owner-columns \{[^}]*grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/
    )
  );
  assert.match(
    normalizeWhitespace(styles),
    normalizeWhitespace(
      /\.yk-modal\.yk-catalogue-detail-modal \{[^}]*width: min\(72rem,calc\(100% - 48px\)\);[^}]*min-height: min\(46rem,calc\(100dvh - 48px\)\);[^}]*--collection-detail-art-width: 20rem;/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/title=\{owner\.pseudo\}/)
  );
  assert.match(
    normalizeWhitespace(styles),
    normalizeWhitespace(
      /\.yk-catalogue-owner-name \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/
    )
  );
  assert.match(
    normalizeWhitespace(styles),
    normalizeWhitespace(
      /\.yk-catalogue-owners ul \{[^}]*max-height: 220px;[^}]*overflow-y: auto;/
    )
  );
  assert.match(
    normalizeWhitespace(detail),
    normalizeWhitespace(/tv\("addToMyWishlist"\)/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(catalogue),
    normalizeWhitespace(/Folder|Sélection multiple|Obtained on|possédée/)
  );
  assert.match(
    normalizeWhitespace(layout),
    normalizeWhitespace(/styles\/community\.css/)
  );
  assert.match(
    normalizeWhitespace(layout),
    normalizeWhitespace(/styles\/collection\.css/)
  );
  assert.match(
    normalizeWhitespace(catalogue),
    normalizeWhitespace(/className="yk-card-grid yk-catalogue-grid"/)
  );
  assert.match(
    normalizeWhitespace(styles),
    normalizeWhitespace(/\.yk-catalogue-card \{[^}]*width: 100%/)
  );
});

test("une carte de la wishlist ouvre le détail partagé du catalogue et ses possesseurs", () => {
  const source = readFileSync(
    path.join(root, "components/community-views.tsx"),
    "utf8"
  );
  const wishlist = source.slice(
    source.indexOf("export function WishlistView"),
    source.indexOf("const remaining")
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/function CatalogueCardModal/)
  );
  assert.match(
    normalizeWhitespace(wishlist),
    normalizeWhitespace(
      /aria-label=\{tv\("viewCard", \{ name: card\.name, rarity: card\.rarity \}\)\}/
    )
  );
  assert.match(
    normalizeWhitespace(wishlist),
    normalizeWhitespace(/aria-haspopup="dialog"/)
  );
  assert.match(
    normalizeWhitespace(wishlist),
    normalizeWhitespace(/<CatalogueCardModal selected=\{selected\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/tv\("currentOwners"\)/)
  );
});

test("la wishlist reprend le tri et les effets statiques du catalogue", () => {
  const source = readFileSync(
    path.join(root, "components/community-views.tsx"),
    "utf8"
  );
  const wishlist = source.slice(
    source.indexOf("export function WishlistView"),
    source.indexOf("const remaining")
  );
  assert.match(wishlist, /id="wishlist-filters"/);
  // Sort by is an always-visible group above the folding sections.
  assert.match(wishlist, /<FilterGroup title=\{tv\("sortBy"\)\}>/);
  assert.ok(
    wishlist.indexOf('<FilterGroup title={tv("sortBy")}>') <
      wishlist.indexOf('CatalogueFilterSection title="Rarity"')
  );
  assert.match(wishlist, /CatalogueFilterSection title="Rarity"/);
  assert.match(wishlist, /CatalogueFilterSection title="Category"/);
  assert.match(
    normalizeWhitespace(wishlist),
    normalizeWhitespace(/<YokaiCard \{\.\.\.card\} animated=\{false\}/)
  );
});

test("le bouton de retrait de la wishlist utilise le style danger rouge", () => {
  const source = readFileSync(
    path.join(root, "components/community-views.tsx"),
    "utf8"
  );
  const wishlist = source.slice(
    source.indexOf("export function WishlistView"),
    source.indexOf("const remaining")
  );
  assert.match(
    normalizeWhitespace(wishlist),
    normalizeWhitespace(/<Button variant="danger"/)
  );
  assert.match(
    normalizeWhitespace(wishlist),
    normalizeWhitespace(/>\{tv\("remove"\)\}<\/Button>/)
  );
});

test("le chat d’enchère est visible mais réservé au vendeur et aux utilisateurs ayant misé", () => {
  const source = readFileSync(
    path.join(root, "components/community-views.tsx"),
    "utf8"
  );
  const market = readFileSync(path.join(root, "lib/data/market.ts"), "utf8");
  const css = readFileSync(path.join(root, "styles/market.css"), "utf8");
  const gifPicker = readFileSync(
    path.join(root, "components/gif-picker.tsx"),
    "utf8"
  );
  const tokens = readFileSync(path.join(root, "tailwind.config.ts"), "utf8");
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/function AuctionChatPanel/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/t\("profileUi.auctionChatParticipantsHint"\)/)
  );
  assert.equal(
    englishMessages.profileUi.auctionChatParticipantsHint,
    "The seller and bidders can post."
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/chat\?\.canPost&&!finished/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/adapter\.get\(auctionId\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/adapter\.send\(auctionId,message,gif\?\.url\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/maxLength=\{500\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/event\.key==="Enter"&&!event\.shiftKey/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/event\.preventDefault\(\);void send\(\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/chat\?\.participants\.filter/)
  );
  assert.match(
    normalizeWhitespace(market),
    normalizeWhitespace(
      /CHAT_PARTICIPANTS_ONLY:"Only the seller and bidders can join the chat\."/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/auction-mention-options/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /t\("profileUi.chatComposerHint",\{count:draft.length\}\)/
    )
  );
  assert.match(englishMessages.profileUi.chatComposerHint, /@ to mention/);
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /<GifPicker disabled=\{busy\|\|retrySeconds>0\} onSelect=\{gif=>void send\(gif\)\}/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/item\.gifUrl\?\(?<img className="yk-auction-chat-gif"/)
  );
  assert.match(
    normalizeWhitespace(gifPicker),
    normalizeWhitespace(/api\.giphy\.com\/v1\/gifs/)
  );
  assert.match(
    normalizeWhitespace(gifPicker),
    normalizeWhitespace(/t\("profileUi.poweredByGiphy"\)/)
  );
  assert.match(
    normalizeWhitespace(gifPicker),
    normalizeWhitespace(/PAGE_SIZE=18/)
  );
  assert.match(
    normalizeWhitespace(gifPicker),
    normalizeWhitespace(/t\("profileUi.loadMore"\)/)
  );
  assert.match(
    normalizeWhitespace(gifPicker),
    normalizeWhitespace(/t\("profileUi.sendThisGif"\)/)
  );
  assert.match(
    normalizeWhitespace(gifPicker),
    normalizeWhitespace(/GIF_CATEGORIES/)
  );
  assert.match(normalizeWhitespace(gifPicker), normalizeWhitespace(/Trending/));
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/event\.key==="ArrowDown"\|\|event\.key==="ArrowUp"/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/event\.key==="Enter"\|\|event\.key==="Tab"/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /selectMention\(mentionOptions\[mentionIndexRef\.current\]\.pseudo\)/
    )
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/button\[aria-selected="true"\]/)
  );
  assert.match(
    normalizeWhitespace(market),
    normalizeWhitespace(/get_auction_chat/)
  );
  assert.match(
    normalizeWhitespace(market),
    normalizeWhitespace(/send_auction_chat_message/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/grid-template-areas: "art main" "history main"/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-auction-page \{[^}]*left: -8rem/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /#main-content:has\(\.yk-auction-page\) \{[^}]*max-width: 72rem/
    )
  );
  assert.match(
    normalizeWhitespace(tokens),
    normalizeWhitespace(/\[["']--market-art-width["'], ["']19rem["']\]/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /\.yk-auction-main \{[^}]*grid-template-columns: minmax\(0,1fr\) 24rem/
    )
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /\.yk-auction-main \{[^}]*grid-template-areas: "header \." "panel chat"/
    )
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-auction-header \{ grid-area: header/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-auction-panel \{ grid-area: panel/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-auction-chat \{ grid-area: chat/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-auction-chat-form textarea \{[^}]*resize: none/)
  );
});

test("le panneau d’enchère ne grandit pas avec la hauteur du chat", () => {
  const market = readFileSync(path.join(root, "styles/market.css"), "utf8");
  assert.match(market, /\.yk-auction-panel \{[^}]*align-self: start;/);
});

test("mobile : vitrine du profil en carrousel tactile et page Amis sans débordement", () => {
  const profile = readFileSync(
    path.join(root, "components/profile.tsx"),
    "utf8"
  );
  const community = readFileSync(
    path.join(root, "styles/community.css"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(/className="yk-card-grid yk-featured-stage"/)
  );
  assert.match(
    normalizeWhitespace(community),
    normalizeWhitespace(/\.yk-profile-columns > section \{ min-width: 0; \}/)
  );
  assert.match(
    normalizeWhitespace(community),
    normalizeWhitespace(
      /\.yk-featured-stage \{ --card-grid-columns-xl: 5; --card-grid-columns-lg: 5; --card-grid-columns-md: 5;/
    )
  );
  assert.match(
    normalizeWhitespace(community),
    normalizeWhitespace(
      /@media \(max-width: 700px\) \{[^]*?\.yk-featured-stage \{[^}]*display: flex;[^}]*overflow-x: auto;[^}]*scroll-snap-type: x mandatory;/
    )
  );
  assert.match(
    normalizeWhitespace(community),
    normalizeWhitespace(
      /@media \(max-width: 700px\) \{[^]*?\.yk-featured-stage > div \{[^}]*flex: 0 0 min\(72vw,13rem\);[^}]*scroll-snap-align: center;/
    )
  );
  // Grid children must be allowed to shrink, otherwise the non-wrapping tabs widen the page.
  assert.match(
    normalizeWhitespace(community),
    normalizeWhitespace(/\.yk-social-stack > \* \{ min-width: 0; \}/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(community),
    normalizeWhitespace(
      /\.yk-social-person \.yk-friend-action,[^{]*\{ width: 100%; margin-left/
    )
  );
  const friends = readFileSync(
    path.join(root, "components/friends.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(friends),
    normalizeWhitespace(
      /const liveFriendsPanel: FriendsPanelAdapter = \{ friendships: getFriendships, search: searchUsers, respond: respondFriendRequest, remove: removeFriend \}/
    )
  );
  assert.match(
    normalizeWhitespace(friends),
    normalizeWhitespace(
      /tab === "friends" \?\(? <Button variant="danger" onClick=\{\(\) => setRemoval\(person\)\}>\{f\("remove"\)\}<\/Button>/
    )
  );
  assert.doesNotMatch(
    normalizeWhitespace(friends),
    normalizeWhitespace(/<StatusPill tone="success">Friend<\/StatusPill>/)
  );
  assert.match(
    normalizeWhitespace(friends),
    normalizeWhitespace(/title=\{f\("removeTitle"\)\}/)
  );
});

test("la liste d’amis affiche la présence et actualise la dernière activité", () => {
  const friends = readFileSync(
    path.join(root, "components/friends.tsx"),
    "utf8"
  );
  const heartbeat = readFileSync(
    path.join(root, "components/presence-heartbeat.tsx"),
    "utf8"
  );
  const layout = readFileSync(path.join(root, "app/layout.tsx"), "utf8");
  assert.match(
    normalizeWhitespace(layout),
    normalizeWhitespace(/<PresenceHeartbeat\/>/)
  );
  assert.match(
    normalizeWhitespace(heartbeat),
    normalizeWhitespace(/touchPresence\(\)/)
  );
  assert.match(
    normalizeWhitespace(heartbeat),
    normalizeWhitespace(/PRESENCE_THROTTLE_MS = 30_000/)
  );
  for (const event of [
    "pointerdown",
    "pointermove",
    "keydown",
    "scroll",
    "touchstart"
  ])
    assert.match(heartbeat, new RegExp(event));
  assert.doesNotMatch(
    normalizeWhitespace(heartbeat),
    normalizeWhitespace(/setInterval/)
  );
  assert.match(
    normalizeWhitespace(friends),
    normalizeWhitespace(/showPresence=\{tab==="friends"\}/)
  );
  assert.match(
    normalizeWhitespace(friends),
    normalizeWhitespace(/window\.setInterval\(\(\)=>void refresh\(\),30_000\)/)
  );
  const { friendPresenceLabel } = load("components/friends.tsx");
  const now = Date.parse("2026-10-08T12:00:00Z");
  assert.equal(
    friendPresenceLabel(
      { isOnline: true, lastSeenAt: "2026-10-08T10:00:00Z" },
      now
    ),
    "Online"
  );
  assert.equal(
    friendPresenceLabel(
      { isOnline: false, lastSeenAt: "2026-10-08T11:55:00Z" },
      now
    ),
    "Last seen 5 minutes ago"
  );
  assert.equal(
    friendPresenceLabel(
      { isOnline: false, lastSeenAt: "2026-10-08T09:00:00Z" },
      now
    ),
    "Last seen 3 hours ago"
  );
  assert.equal(
    friendPresenceLabel({ isOnline: false, lastSeenAt: null }, now),
    "Not seen online yet"
  );
});

test("le sélecteur de cartes mises en avant recherche et remonte la sélection", () => {
  const source = readFileSync(
    path.join(root, "components/profile.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/const FEATURED_CARD_LIMIT=5/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/next\.size<FEATURED_CARD_LIMIT/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/id="featured-query"/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/matchesCardSearch\(featuredQuery/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /Number\(selected\.has\(b\.instanceId\)\)-Number\(selected\.has\(a\.instanceId\)\)/
    )
  );
});

test("le profil invalide l’avatar partagé et la Topbar le recharge", () => {
  const profile = readFileSync(path.join(root, "lib/data/profile.ts"), "utf8");
  const topbar = readFileSync(path.join(root, "components/topbar.tsx"), "utf8");
  assert.match(
    normalizeWhitespace(profile),
    normalizeWhitespace(/publishPlayerSnapshotInvalidation\(\["profile"\]\)/)
  );
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/refreshProfile\(\);const unsubscribe/)
  );
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/scopes\.includes\("profile"\)/)
  );
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/image=\{avatarUrl\}/)
  );
});

test("l’avatar ouvre un menu profil compact avec résumé et actions", () => {
  const topbar = readFileSync(path.join(root, "components/topbar.tsx"), "utf8");
  const account = readFileSync(
    path.join(root, "components/account-menu.tsx"),
    "utf8"
  );
  const css = readFileSync(path.join(root, "styles/topbar.css"), "utf8");
  imageAsset(topbar, "yk-brand-image");
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-brand \{ display: flex; width: 104px;/)
  );
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/aria-label=\{t\("openMyAccount"\)\}/)
  );
  assert.equal(englishMessages.topbar.openMyAccount, "Open my account");
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/panel==="account"/)
  );
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/className="yk-account-panel"/)
  );
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/>\{t\("viewMyProfile"\)\}<\/Link>/)
  );
  assert.equal(englishMessages.topbar.viewMyProfile, "View my profile");
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/>\{t\("settings"\)\}<\/Link>/)
  );
  assert.equal(englishMessages.topbar.settings, "Settings");
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/>\{t\("myAchievements"\)\}<\/Link>/)
  );
  assert.equal(englishMessages.topbar.myAchievements, "My achievements");
  assert.doesNotMatch(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/aria-current=\{view === "achievements"/)
  );
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/toLocaleString\("en-US"\).*Karas/)
  );
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/className="yk-account-karas"/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/yk-mobile-account/)
  );
  assert.ok(
    normalizeWhitespace(topbar).indexOf(
      normalizeWhitespace('href="/wishlist"')
    ) <
      normalizeWhitespace(topbar).indexOf(
        normalizeWhitespace('href="/catalog" aria-current')
      )
  );
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(
      /document\.addEventListener\("pointerdown",closeOnOutsidePointer\)/
    )
  );
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/closest\(`#\$\{panelId\},\[aria-controls=/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/Gère ton profil et ta session/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/>Close<\/button>/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(topbar),
    normalizeWhitespace(/<Modal open=\{panel === "account"\}/)
  );
  assert.match(
    normalizeWhitespace(account),
    normalizeWhitespace(/<SignOutButton \/>/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/width: min\(280px/)
  );
  // Tests-only transition before the separately reviewed midnight menu ships.
  // Presence of its dedicated contract selects the exact new palette; neither
  // palette is accepted interchangeably once that feature is installed.
  if (existsSync(path.join(root, "tests/account-menu-navy.test.mjs"))) {
    const menuSurface = css.match(/\.yk-account-panel\s*\{([^}]+)\}/)?.[1];
    assert.ok(menuSurface, "The account menu surface must be defined");
    assert.match(
      normalizeWhitespace(menuSurface),
      normalizeWhitespace(/background: var\(--color-night\)/)
    );
    assert.match(
      normalizeWhitespace(menuSurface),
      normalizeWhitespace(/border: 1px solid #344964/)
    );
    assert.match(
      normalizeWhitespace(menuSurface),
      normalizeWhitespace(/box-shadow: 0 12px 32px -4px rgba\(6,9,19,0?\.95\)/)
    );
    assert.match(
      readFileSync(path.join(root, "tailwind.config.ts"), "utf8"),
      /night: "#060913"/
    );
    assert.doesNotMatch(menuSurface, /#0f0c1d|#1d1844|82,\s*68,\s*181/);
  } else {
    assert.match(
      normalizeWhitespace(css),
      normalizeWhitespace(/background: #0f0c1d/)
    );
    assert.match(
      normalizeWhitespace(css),
      normalizeWhitespace(/box-shadow: 0 12px 32px -4px rgba\(4,0,11,0?\.95\)/)
    );
  }
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-account-karas \{ display: none; \}/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /max-width: 620px[^]*\.yk-account-karas \{ display: block; \}/
    )
  );
});

test("la destruction groupée demande une confirmation chiffrée", () => {
  const source = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/setBulkDiscardConfirm\(true\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/tc\("thisCantBeUndone"\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/selectedCards\.length/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/selectedValue\?\?"…"/)
  );
});

test("barre d'outils Collection compacte sur mobile et tiroir fermé même en mouvement réduit", () => {
  const collection = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  const css = readFileSync(path.join(root, "styles/collection.css"), "utf8");
  const ui = readFileSync(path.join(root, "styles/ui.css"), "utf8");
  // The filter trigger lives inside the toolbar so both collapse into two compact rows.
  assert.ok(
    collection.indexOf('className="yk-mobile-filter-trigger"') >
      collection.indexOf('<div className="yk-collection-toolbar">')
  );
  // Mobile: "Sélection multiple" becomes an icon; the label stays available to screen readers.
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /\.yk-collection-toolbar \.yk-selection-mode-label \{ position: absolute;/
    )
  );
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(/<SelectionModeButton active=\{selecting\}/)
  );
  // The global reduced-motion reset drops transforms: the closed drawer and the Karas gem must keep theirs.
  assert.match(
    normalizeWhitespace(ui),
    normalizeWhitespace(/transform: none !important/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /@media \(prefers-reduced-motion: reduce\) and \(max-width: 760px\) \{ \.yk-collection-sidebar:not\(\.yk-sidebar-open\) \{ transform: translateX\(-100%\) !important; \} \}/
    )
  );
  assert.match(
    normalizeWhitespace(ui),
    normalizeWhitespace(
      /\.yk-karas-gem \{ transform: rotate\(45deg\) !important; \}/
    )
  );
});

test("Collection, Catalogue et Marché partagent une seule échelle de colonnes", () => {
  const ui = readFileSync(path.join(root, "styles/ui.css"), "utf8");
  assert.match(
    normalizeWhitespace(ui),
    normalizeWhitespace(
      /\.yk-card-grid \{ display: grid; grid-template-columns: repeat\(var\(--card-grid-columns,var\(--card-grid-columns-xl\)\)/
    )
  );
  assert.match(
    normalizeWhitespace(ui),
    normalizeWhitespace(
      /max-width: 760px\) \{ \.yk-card-grid \{ --card-grid-columns: var\(--card-grid-columns-sm\)/
    )
  );
  assert.match(
    normalizeWhitespace(
      readFileSync(path.join(root, "components/collection.tsx"), "utf8")
    ),
    normalizeWhitespace(/className=\{`yk-card-grid yk-collection-grid /)
  );
  assert.match(
    normalizeWhitespace(
      readFileSync(path.join(root, "components/community-views.tsx"), "utf8")
    ),
    normalizeWhitespace(/className="yk-card-grid yk-market-list"/)
  );
  assert.match(
    normalizeWhitespace(
      readFileSync(path.join(root, "components/community-views.tsx"), "utf8")
    ),
    normalizeWhitespace(/className="yk-card-grid yk-wishlist-grid"/)
  );
  // No page may redefine its own column count for these grids (the 1280px :not() override broke mobile).
  for (const file of ["collection", "community", "market"]) {
    const css = readFileSync(path.join(root, `styles/${file}.css`), "utf8");
    assert.doesNotMatch(
      normalizeWhitespace(css),
      normalizeWhitespace(
        /\.yk-(?:collection-grid|catalogue-grid|market-list|wishlist-grid)(?::not\([^)]*\))? \{[^}]*grid-template-columns: repeat/
      )
    );
  }
});

test("collection requires five normal SSR copies or three normal/Shiny LR copies for INFINITY", () => {
  const source = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /const evolutionRequired = selected\?\.rarity === "LR" \? 3 : 5/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/SSR evolution/i)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/tc\("evolutionProgress"\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /\{evolvableCopies\}\/\{evolutionRequired\}\{tc\("copiesLeadingSpace"\)\}/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/tc\("confirmLrEvolution"\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /\(selected.rarity === "LR" \|\| !selected.shiny\)&& !selected.isEvolved/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/tc\("confirmSsrEvolution"\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /tc\("image"\)[^]*card\.customImageUrl[^]*tc\("customCanBeKept"\):tc\("original"\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /tc\("evolutionImageKept", \{ rarity: selected\?\.rarity \?\? "SSR" \}\)/
    )
  );
  assert.match(source, /tc\("chooseTheCustomImageToKeep"\)/);
  assert.doesNotMatch(source, /custom \(will be lost\)/);
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /onEvolve\(evolutionCards\.map\(card=>card\.instanceId\)\)/
    )
  );
});

test("le Decision Pack confirmé affiche une carte gardée et quatre perdues", () => {
  const { BoosterReveal } = load("components/boosters.tsx");
  const cards = Array.from({ length: 5 }, (_, i) => ({
    ...card,
    instanceId: `copy-${i}`
  }));
  const html = render(BoosterReveal, {
    cards,
    revealed: 5,
    onReveal() {},
    onRevealAll() {},
    onReturn() {},
    decision: {
      keptId: "copy-3",
      async onKeep() {
        assert.fail("Rendering must not confirm a choice");
      }
    }
  });
  assert.equal((html.match(/yk-lost-stamp/g) || []).length, 4);
  assert.equal((html.match(/KEPT/g) || []).length, 1);
  assert.doesNotMatch(html, />Destroy</);
  assert.match(
    html,
    /Card added to your collection · \+0 Karas from the cards you didn&#x27;t keep/
  );
  assert.doesNotMatch(html, />SSR ×(?:<!-- -->)?\d+</);
  assert.doesNotMatch(html, />SSR ×(?:<!-- -->)?5</);
});

test("la collection pagine par multiples de 6 pour remplir la grille", () => {
  const { CollectionView } = load("components/collection.tsx");
  const cards = Array.from({ length: 30 }, (_, i) => ({
    ...card,
    id: `card-${i}`,
    instanceId: `copy-${i}`,
    folderId: null
  }));
  const html = render(CollectionView, {
    cards,
    categories: [],
    folders: [],
    async onMoveCard() {},
    async onCreateAuction() {},
    async onEvolve() {},
    async onSetCustomImage() {},
    async onDiscard() {},
    async onDiscardMany() {}
  });
  assert.equal((html.match(/class="yk-collection-card[ "]/g) || []).length, 24);
  assert.match(
    html,
    /<option value="24"[^>]*>24<\/option><option value="36"[^>]*>36<\/option><option value="48"[^>]*>48<\/option>/
  );
  assert.doesNotMatch(html, /Cards per page \(unavailable/);
});

test("le Classeur affiche 28 cartes par page par défaut", () => {
  const source = readFileSync("components/collection.tsx", "utf8");
  const pagination = readFileSync("lib/ui/pagination.ts", "utf8");

  assert.match(source, /BINDER_CARD_PAGE_SIZES\[0\]/);
  assert.match(source, /BINDER_CARD_PAGE_SIZES\.map/);
  assert.match(pagination, /BINDER_CARD_PAGE_SIZES = \[28, 42, 56\]/);
});

test("les copies normales et Shiny forment des tuiles distinctes avec badge de quantité", () => {
  const { CollectionView } = load("components/collection.tsx");
  const copies = [
    { ...card, instanceId: "normal-1", folderId: null, shiny: false },
    {
      ...card,
      instanceId: "normal-2",
      folderId: "favorites",
      shiny: false,
      customImageUrl: "https://i.imgur.com/custom.png",
      image: "/custom.png"
    },
    { ...card, instanceId: "shiny-1", folderId: null, shiny: true }
  ];
  const html = render(CollectionView, {
    cards: copies,
    categories: [],
    folders: [{ id: "favorites", name: "Favoris" }],
    async onDiscardMany() {},
    async onEvolve() {}
  });
  assert.equal((html.match(/class="yk-collection-card[ "]/g) || []).length, 2);
  assert.match(html, /×(?:<!-- -->)?2/);
  assert.doesNotMatch(html, /×(?:<!-- -->)?1/);
  assert.match(html, /custom\.png/);
});

test("la collection signale et catégorise les cartes en enchères", () => {
  const { CollectionView } = load("components/collection.tsx");
  const auctionCard = { ...card, instanceId: "auction-copy", folderId: null };
  const html = render(CollectionView, {
    cards: [auctionCard],
    categories: [],
    presentation: {
      "auction-copy": {
        frozen: { remaining: "2026-10-07T12:00:00Z" },
        auctionId: "auction-1"
      }
    },
    async onCreateAuction() {}
  });
  assert.match(html, /Status/);
  assert.match(html, /In auctions/);
  assert.match(html, /yk-group-frozen/);
  assert.match(html, /1 in auction/);
});

test("Phase 5 : habillage des boosters sans toucher au reveal", () => {
  const { BoosterReveal, Boosters } = load("components/boosters.tsx");
  const cards = Array.from({ length: 5 }, (_, i) => ({
    ...card,
    instanceId: `copy-${i}`,
    anime: "Spirit Realm"
  }));
  const regular = render(BoosterReveal, {
    cards,
    revealed: 2,
    onReveal() {},
    onReturn() {},
    async onDiscard() {}
  });
  assert.equal((regular.match(/>Discard</g) || []).length, 0);
  assert.match(regular, /data-reveal-state="revealing"/);
  assert.match(regular, /<h2 class="sr-only">Reveal your cards<\/h2>/);
  assert.match(regular, /data-pack-kind="regular"/);
  assert.doesNotMatch(
    normalizeWhitespace(regular),
    normalizeWhitespace(/>Select</)
  );
  assert.doesNotMatch(
    normalizeWhitespace(regular),
    normalizeWhitespace(/View my collection|yk-reveal-summary/)
  );
  const regularDone = render(BoosterReveal, {
    cards,
    revealed: 5,
    onReveal() {},
    onReturn() {},
    async onDiscard() {}
  });
  assert.match(
    normalizeWhitespace(regularDone),
    normalizeWhitespace(/href="\/collection"[^>]*>View my collection</)
  );
  assert.match(
    normalizeWhitespace(regularDone),
    normalizeWhitespace(/>Select</)
  );
  assert.equal((regularDone.match(/>Discard</g) || []).length, 5);
  assert.match(regularDone, /data-reveal-state="complete"/);
  assert.equal(
    (regularDone.match(/yk-slot-button yk-reveal-discard/g) || []).length,
    5
  );
  assert.doesNotMatch(regularDone, />SSR ×(?:<!-- -->)?\d+</);
  const withNext = render(BoosterReveal, {
    cards,
    revealed: 5,
    onReveal() {},
    onReturn() {},
    onNext() {}
  });
  assert.match(withNext, /yk-reveal-screen yk-reveal-complete/);
  assert.equal((withNext.match(/>Next pack</g) || []).length, 1);
  assert.match(
    withNext,
    /class="yk-reveal-next"><button[^>]*>Next pack<\/button><\/span>/
  );
  const withRemaining = render(BoosterReveal, {
    cards,
    revealed: 5,
    onReveal() {},
    onReturn() {},
    onNext() {},
    nextRemaining: 3
  });
  assert.match(
    withRemaining,
    />Next pack<span class="font-normal"> · 3 left<\/span><\/button>/
  );
  const decisionRevealing = render(BoosterReveal, {
    cards,
    revealed: 2,
    onReveal() {},
    onReturn() {},
    decision: {
      async onKeep() {
        return 0;
      }
    }
  });
  assert.match(decisionRevealing, /data-pack-kind="decision"/);
  assert.match(decisionRevealing, /data-reveal-state="revealing"/);
  assert.match(decisionRevealing, /<h2 class="sr-only">One choice<\/h2>/);
  assert.doesNotMatch(decisionRevealing, />Keep this one<|>Discard</);
  const choosing = render(BoosterReveal, {
    cards,
    revealed: 5,
    onReveal() {},
    onReturn() {},
    decision: {
      async onKeep() {
        return 0;
      }
    }
  });
  assert.match(choosing, /data-pack-kind="decision"/);
  assert.match(choosing, /data-reveal-state="complete"/);
  assert.equal((choosing.match(/>Keep this one</g) || []).length, 5);
  assert.equal(
    (choosing.match(/aria-label="View details for /g) || []).length,
    5
  );
  assert.doesNotMatch(
    normalizeWhitespace(choosing),
    normalizeWhitespace(/yk-slot-button">Discard/)
  );
  const selection = render(Boosters, {
    status: { available: 0, maximum: 5, nextPackAt: Date.now() + 60_000 },
    countdown: "01:00",
    decisionStatus: {
      available: false,
      pending: [],
      nextPackAt: new Date().setHours(24, 30, 0, 0)
    },
    decisionCountdown: "10:00:00",
    busy: false,
    draw: [],
    drawKind: "regular",
    collection: [],
    revealed: 0,
    async onOpen() {},
    async onKeepDecision() {
      return 0;
    },
    async onDiscard() {},
    onReveal() {}
  });
  assert.match(
    normalizeWhitespace(selection),
    normalizeWhitespace(/aria-label="0 of 5 packs in reserve"/)
  );
  assert.match(
    normalizeWhitespace(selection),
    normalizeWhitespace(/Next in 01:00/)
  );
  assert.match(
    normalizeWhitespace(selection),
    normalizeWhitespace(/Daily · Keep 1 of 5/)
  );
  assert.match(
    normalizeWhitespace(selection),
    normalizeWhitespace(/Available in 10:00:00/)
  );
  assert.equal(
    (
      selection.match(
        /aria-label="View (?:Regular|Decision) Pack drop rates/g
      ) || []
    ).length,
    2
  );
  assert.match(
    normalizeWhitespace(
      readFileSync(path.join(root, "components/boosters.tsx"), "utf8")
    ),
    normalizeWhitespace(/tp\("viewRegularPackDropRates"\)/)
  );
  const source = readFileSync(
    path.join(root, "components/boosters.tsx"),
    "utf8"
  );
  assert.match(
    source,
    /DECISION_DROP_RATES[^\n]*SR", percent: 96\.5[^\n]*SSR", percent: 3[^\n]*LR", percent: 0\.5/
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/decisionDropRates = DECISION_DROP_RATES/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /ratesKind === "decision" \? decisionDropRates : dropRates/
    )
  );
  assert.match(
    normalizeWhitespace(
      readFileSync(path.join(root, "components/game.tsx"), "utf8")
    ),
    normalizeWhitespace(/decisionDropRates=\{info\?\.decisionDropRates\}/)
  );
  const boosterStyles = readFileSync(
    path.join(root, "styles/boosters.css"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/tp\("keepLossPrefix"\)\}\{cards\.length - 1\}/)
  );
  assert.match(
    normalizeWhitespace(boosterStyles),
    normalizeWhitespace(
      /\.yk-reveal-selection-mode \{[^}]*width: auto;[^}]*min-height: 32px;/
    )
  );
  assert.match(
    normalizeWhitespace(boosterStyles),
    normalizeWhitespace(
      /@media \(max-width: 40rem\) \{[\s\S]*\.yk-reveal-progress \{ grid-column: 1; grid-row: 2; justify-self: start; \}[\s\S]*\.yk-reveal-selection-mode \{ grid-column: 2; grid-row: 2; \}/
    )
  );
  assert.match(
    normalizeWhitespace(boosterStyles),
    normalizeWhitespace(
      /\.yk-invocation\[open\] \{ display: grid; place-items: center; overflow: hidden; \}/
    )
  );
  assert.match(
    normalizeWhitespace(boosterStyles),
    normalizeWhitespace(
      /\.yk-invocation > div:first-child \{ position: absolute;/
    )
  );
  assert.match(
    normalizeWhitespace(boosterStyles),
    normalizeWhitespace(
      /\.yk-invocation > div:last-child \{ grid-area: 1 \/ 1;/
    )
  );
  assert.doesNotMatch(boosterStyles, /\.yk-reveal-(?:ssr|lr)/);
  assert.match(source, /<CardCinematic[^>]*card=\{spot\}/);
});

test("les boosters annoncent les gains autoritaires avant confirmation", () => {
  const { BoosterReveal } = load("components/boosters.tsx");
  const values = [1, 2, 3, 4, 5];
  const cards = values.map((destructionValue, i) => ({
    ...card,
    instanceId: `copy-${i}`,
    destructionValue
  }));
  const regular = render(BoosterReveal, {
    cards,
    revealed: 5,
    onReveal() {},
    onReturn() {},
    async onDiscard() {}
  });
  assert.match(normalizeWhitespace(regular), normalizeWhitespace(/>Select</));
  assert.doesNotMatch(
    normalizeWhitespace(regular),
    normalizeWhitespace(/Discard \(\+/)
  );
  const decision = render(BoosterReveal, {
    cards,
    revealed: 5,
    onReveal() {},
    onReturn() {},
    decision: {
      async onKeep() {
        return 14;
      },
      async onSellAll() {
        return 15;
      }
    }
  });
  assert.equal((decision.match(/>Keep this one</g) || []).length, 5);
  assert.equal((decision.match(/>Sell all cards</g) || []).length, 1);
  assert.match(decision, /yk-button-danger[^>]*>Sell all cards</);
  assert.match(
    normalizeWhitespace(decision),
    normalizeWhitespace(/Receive 15 Karas and keep none\./)
  );
  assert.doesNotMatch(
    normalizeWhitespace(decision),
    normalizeWhitespace(/Keep this one \(\+/)
  );
  const source = readFileSync(
    path.join(root, "components/boosters.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /selectedCards\.reduce\(\(sum,card\)=>sum\+card\.destructionValue!/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /tp\("youllReceive"\)\}<strong className="text-karas">\{format\.number\(selectedValue\)\}/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/if\(destroyingAll\)onReturn\(\)/)
  );
  const migration = readFileSync(
    path.join(
      root,
      "supabase/migrations/20261001000002_booster_destruction_estimates.sql"
    ),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(migration),
    normalizeWhitespace(/public\.card_destruction_value\(owned\.rarity\)/)
  );
  assert.match(
    normalizeWhitespace(migration),
    normalizeWhitespace(
      /sum\(public\.card_destruction_value\(other_choices\.rarity\)\)/
    )
  );
  assert.doesNotMatch(
    normalizeWhitespace(migration),
    normalizeWhitespace(/reward\s*:=\s*case/)
  );
  assert.ok(
    existsSync(
      path.join(root, "app/design-system/booster-karas-preview/page.tsx")
    )
  );
});

test("une carte révélée ouvre le détail de collection avant sa mise en vente", () => {
  const boosters = readFileSync(
    path.join(root, "components/boosters.tsx"),
    "utf8"
  );
  const game = readFileSync(path.join(root, "components/game.tsx"), "utf8");
  assert.match(
    normalizeWhitespace(boosters),
    normalizeWhitespace(
      /<CollectionView[^]*detailOnly[^]*initialSelectedId=\{detailCard\.instanceId\}/
    )
  );
  assert.doesNotMatch(
    normalizeWhitespace(boosters),
    normalizeWhitespace(/className="yk-slot-button">List for auction<\/Button>/)
  );
  assert.match(
    normalizeWhitespace(boosters),
    normalizeWhitespace(
      /auctioned\.has\(card\.instanceId\)\?\(?<StatusPill tone="info">\{tp\("listed"\)\}/
    )
  );
  assert.match(
    normalizeWhitespace(boosters),
    normalizeWhitespace(
      /visibleCards\.filter\(card=>!auctioned\.has\(card\.instanceId\)&&!locked\.has\(card\.instanceId\)\)/
    )
  );
  assert.match(
    normalizeWhitespace(game),
    normalizeWhitespace(/onAuction=\{auctionCard\}/)
  );
});

test("le détail d'une carte révélée propose verrouillage puis enchère", () => {
  const boosters = readFileSync(
    path.join(root, "components/boosters.tsx"),
    "utf8"
  );
  const game = readFileSync(path.join(root, "components/game.tsx"), "utf8");
  assert.match(boosters, /onMoveCard=\{onMoveCard\}/);
  assert.match(boosters, /onCreateAuction=\{auction\}/);
  assert.match(boosters, /onSetLocked=\{lock\}/);
  assert.match(boosters, /onSetCustomImage=\{onSetCustomImage\}/);
  assert.match(boosters, /onDiscard=\{onDiscard\}/);
  assert.match(game, /onSetLocked=\{lockCard\}/);
});

test("la modale de détail hiérarchise verrouillage, progression et actions avancées", () => {
  const source = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  const modal = source.slice(
    source.indexOf('title={tc("cardDetails")}'),
    source.indexOf('tc("destroyCopiesLabel")')
  );
  assert.ok(modal.indexOf("yk-detail-art") < modal.indexOf("yk-detail-folder"));
  assert.ok(
    modal.indexOf("yk-detail-folder") < modal.indexOf("yk-detail-info")
  );
  assert.ok(
    modal.indexOf("yk-detail-actions") < modal.indexOf("yk-detail-image")
  );
  assert.ok(
    modal.indexOf("yk-detail-image") < modal.indexOf("yk-detail-danger")
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(
      /className="yk-detail-title-row"><h3[^>]*>\{selected\.name\}<\/h3>[^]*className="yk-detail-lock-toggle"/
    )
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(/aria-pressed=\{!!selected\.locked\}/)
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(/role="progressbar"/)
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(
      /aria-valuenow=\{Math\.min\(evolvableCopies,evolutionRequired\)\}/
    )
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(
      /<details className="yk-detail-image"><summary>\{tc\("customizeImage"\)\}/
    )
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(/tc\("destroyCopies"\)/)
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(/tc\("restoreOriginalImage"\)/)
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(/selectedMeta\?\.marketValue!=null&&/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(modal),
    normalizeWhitespace(/Une carte verrouillée ne peut pas être vendue/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(modal),
    normalizeWhitespace(/aria-label=\{`Destroy \$\{selected\.name\}`\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/setDiscardConfirm\(true\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/setDiscardQuantity\(destructibleCards\.length\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /\{discardValue == null \? undefined : format\.number\(discardValue\)\} Karas/
    )
  );
});

test("les cartes verrouillees sont exclues des actions sensibles", () => {
  const source = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /filter\(card=>!card\.locked&&!presentation\[card\.instanceId\]\?\.frozen\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /filter\(c=>!c\.locked&&!presentation\[c\.instanceId\]\?\.frozen\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/tc\("lockCard"\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/tc\("unlockCard"\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/selected\.locked\?tc\("cardLocked"\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/tc\("lockedCards"\)/)
  );
  // #388: the collection filter moved to lib/ui/collection-filter.ts.
  assert.match(
    normalizeWhitespace(
      readFileSync(path.join(root, "lib/ui/collection-filter.ts"), "utf8")
    ),
    normalizeWhitespace(/\(!lockedOnly \|\| !!c\.locked\)/)
  );
  // Locked cards is a Status toggle like In auctions, independent of folders.
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/aria-pressed=\{lockedOnly\}/)
  );
  assert.doesNotMatch(source, /LOCKED_FOLDER/);
});

test("la Collection groupe les tuiles et sélectionne tous les exemplaires disponibles", () => {
  const source = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /const groups = groupCollection\(filtered, displayedCopies\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/visibleGroups\.map\(group=>/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /group\.cards\.length>1&&\(?<span[^>]*>×\{group\.cards\.length\}/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/toggleGroup\(group\.cards\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/count=\{selectedCards\.length\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/frozenCount>0/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(source),
    normalizeWhitespace(/Last copy obtained on/)
  );
  assert.doesNotMatch(
    source,
    /<time dateTime=\{historyGroup\.firstObtainedAt\}/
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/<FirstLrCopyMeta[^]*instanceIds=\{group\.cards\.map/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/yk-copy-picker/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/itemLabel="exemplaire"/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/toggleEvolutionCard/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /tc\("chooseExactly"\)\}\{evolutionRequired\}\{tc\("evolutionCustomCarry"/
    )
  );
});

test("la sélection multiple peut être rangée dans un dossier", () => {
  const collection = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  const game = readFileSync(path.join(root, "components/game.tsx"), "utf8");
  const styles = readFileSync(path.join(root, "styles/collection.css"), "utf8");
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(
      /onMoveCards\?: \(instanceIds: string\[\], folderId: string \| null\)/
    )
  );
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(/selectedCards\.map\(card => card\.instanceId\)/)
  );
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(/>\{tc\("chooseAFolder"\)\}<\/option>/)
  );
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(/bulkFolderBusy\?tc\("moving"\):tc\("move"\)/)
  );
  assert.match(
    normalizeWhitespace(game),
    normalizeWhitespace(/onMoveCards=\{moveCards\}/)
  );
  assert.match(
    normalizeWhitespace(styles),
    normalizeWhitespace(/\.yk-selection-folder \{/)
  );
});

test("la mise en vente suggère la valeur de marché sans remplacer le prix par défaut", () => {
  const source = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/loadCardDiscovery = getCardDiscovery/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/await loadCardDiscovery\(selected\.id\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/setAuctionPrice\("10"\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/value!=null&&Number\.isFinite\(value\)&&value>0/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /tc\("suggested"\)\}<Karas amount=\{auctionSuggestion\}/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /onClick=\{\(\)=>setAuctionPrice\(String\(auctionSuggestion\)\)\}>\{tc\("useThisValue"\)\}/
    )
  );
  const proof = readFileSync(
    path.join(root, "components/auction-suggestion-proof.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(proof),
    normalizeWhitespace(/marketValue: disabled \? null : 240/)
  );
  const preview = readFileSync(
    path.join(root, "app/design-system/auction-suggestion-preview/page.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(preview),
    normalizeWhitespace(/\(await searchParams\)\.disabled === "1"/)
  );
});

test("Phase 6 : liste du marché, suivi et Mes enchères", () => {
  const { MarketView } = load("components/community-views.tsx");
  const auction = (id, extra = {}) => ({
    id,
    card: { ...card, id: `card-${id}` },
    amount: 120,
    remaining: "00:12:00",
    remainingSeconds: 720,
    seller: "Kitsune",
    sellerAvatarUrl: "https://cdn.example/kitsune.png",
    bids: 3,
    ...extra
  });
  const lists = {
    active: [
      auction("a", { wishlist: true }),
      auction("b", { remainingSeconds: 120, remaining: "00:02:00" })
    ],
    mine: [],
    won: [],
    sold: []
  };
  for (const [count, label] of [
    [0, "0 cards up for auction"],
    [1, "1 card up for auction"],
    [2, "2 cards up for auction"]
  ]) {
    const pluralHtml = render(MarketView, {
      lists: { ...lists, active: lists.active.slice(0, count) }
    });
    assert.ok(pluralHtml.includes(label), label);
  }
  const html = render(MarketView, {
    lists,
    activeSales: "0",
    async onToggleWatch() {}
  });
  assert.equal((html.match(/class="yk-market-tile"/g) || []).length, 2);
  assert.doesNotMatch(html, /aria-label="(?:Unwatch|Watch) auction"/);

  assert.match(
    normalizeWhitespace(html),
    normalizeWhitespace(/https:\/\/cdn\.example\/kitsune\.png/)
  );

  assert.match(
    normalizeWhitespace(html),
    normalizeWhitespace(/yk-market-timer yk-urgency-critical/)
  );
  assert.match(
    normalizeWhitespace(html),
    normalizeWhitespace(
      /<aside id="market-filters" class="yk-collection-sidebar /
    )
  );
  assert.match(
    normalizeWhitespace(html),
    normalizeWhitespace(/id="market-query" type="search"/)
  );
  assert.match(
    normalizeWhitespace(html),
    normalizeWhitespace(
      /aria-pressed="true"><span class="yk-filter-check"><\/span><span>Ending soon<\/span>/
    )
  );
  assert.match(
    normalizeWhitespace(html),
    normalizeWhitespace(
      /<span>Price: low to high<\/span>.*<span>Price: high to low<\/span>/
    )
  );
  assert.match(
    normalizeWhitespace(html),
    normalizeWhitespace(/aria-controls="market-filters"/)
  );
  const search = render(MarketView, {
    pageHeading: React.createElement(
      "div",
      null,
      React.createElement("h1", null, "Market")
    ),
    lists: {
      ...lists,
      active: [
        auction("l", {
          card: {
            ...card,
            id: "l",
            name: "Luffy",
            anime: "One Piece",
            category: "Manga"
          }
        }),
        auction("z", {
          card: {
            ...card,
            id: "z",
            name: "Zoro",
            anime: "One Piece",
            category: "Manga"
          }
        })
      ]
    }
  });
  assert.match(
    normalizeWhitespace(search),
    normalizeWhitespace(/2 cards up for auction/)
  );
  assert.match(search, /role="status" class="sr-only"/);
  assert.match(search, /<header class="yk-market-heading">/);
  assert.equal((search.match(/<h1(?:\s|>)/g) ?? []).length, 1);
  assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 0);
  assert.doesNotMatch(search, /Vendre une carte|All active auctions/);
  assert.match(
    normalizeWhitespace(search),
    normalizeWhitespace(/<span>Manga<\/span>/)
  );
  assert.match(
    normalizeWhitespace(html),
    normalizeWhitespace(
      /aria-pressed="false"><span class="yk-filter-check"><\/span><span>Most popular<\/span>/
    )
  );
  assert.match(normalizeWhitespace(html), normalizeWhitespace(/>My auctions</));
  const source = readFileSync(
    path.join(root, "components/community-views.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /matchesCardSearch\(query,\[a\.card\.name,a\.card\.anime\]\)/
    )
  );
  assert.doesNotMatch(
    normalizeWhitespace(source),
    normalizeWhitespace(/terms\.every|const terms=/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /const mineTabs=\[\["all","All"\],\["mine","Active"\],\["won","Won"\],\["sales","Sold"\],\["unsold","Unsold"\]\]/
    )
  );
  assert.doesNotMatch(
    normalizeWhitespace(source),
    normalizeWhitespace(/"Vendues"/)
  );
  // One sidebar for both tabs; My auctions swaps the price sort for a Status section.
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /\{section==="mine"&&\(?<CatalogueFilterSection title="Status">/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /<div className="yk-market-filter-scroll">\{section==="browse"&&\(?<FilterGroup title=\{tm\("sort"\)\}>/
    )
  );
  // Same layout as Collection/Catalogue: the sidebar stays in normal page flow without its own scroll area.
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /<div className="yk-collection-layout">\s*<aside id="market-filters"/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/className="yk-market-filter-scroll"/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /className="yk-collection-toolbar yk-market-toolbar-band"/
    )
  );
  const marketCss = readFileSync(path.join(root, "styles/market.css"), "utf8");
  const collectionCss = readFileSync(
    path.join(root, "styles/collection.css"),
    "utf8"
  );
  assert.doesNotMatch(
    normalizeWhitespace(collectionCss),
    normalizeWhitespace(/\.yk-collection-sidebar \{[^}]*position: sticky/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(marketCss),
    normalizeWhitespace(/\.yk-market-filter-scroll \{[^}]*overflow-y: auto/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(marketCss),
    normalizeWhitespace(/\.yk-market-sidebar \{[^}]*max-height:/)
  );
});

test("la recherche du marché filtre en mémoire par nom et franchise", () => {
  const source = readFileSync(
    path.join(root, "components/community-views.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/const \[query,setQuery\]=useState\(""\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /matchesCardSearch\(query,\[a\.card\.name,a\.card\.anime\]\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /&&\(!rarity\.length\|\|rarity\.includes\(a\.card\.rarity\)\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/id="market-query" type="search" value=\{query\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/tm\("noMatch"\)/)
  );
  assert.ok(
    existsSync(
      path.join(root, "app/design-system/market-search-preview/page.tsx")
    )
  );
});

test("market empty state keeps the exact English message and its French translation", () => {
  assert.equal(
    englishMessages.market.noMatch,
    "No auctions match your search and filters."
  );
  const french = JSON.parse(
    readFileSync(path.join(root, "messages/fr.json"), "utf8")
  );
  assert.equal(
    french.market.noMatch,
    "Aucune enchère ne correspond à la recherche et aux filtres."
  );
  assert.equal(englishMessages.market.status, "Status");
  assert.equal(french.market.status, "Statut");
  assert.equal(englishMessages.market.sort, "Sort by");
  assert.equal(french.market.sort, "Trier par");
});

test("le Marché trie par favoris_count puis fin et identifiant", () => {
  const { compareMarketAuctions } = load("components/community-views.tsx");
  const auction = (id, popularity, remainingSeconds) => ({
    id,
    card,
    amount: 100,
    remaining: "",
    remainingSeconds,
    seller: "",
    bids: 0,
    popularity
  });
  const values = [
    auction("b", 900, 200),
    auction("z", 120, 50),
    auction("c", 900, 100),
    auction("a", 900, 100)
  ];
  assert.deepEqual(
    values
      .toSorted((a, b) => compareMarketAuctions(a, b, "popular"))
      .map(item => item.id),
    ["a", "c", "b", "z"]
  );
  const migration = readFileSync(
    path.join(root, "supabase/migrations/20261001000001_market_popularity.sql"),
    "utf8"
  );
  assert.match(migration, /'popularity',coalesce\(c\.favoris_count,0\)/);
  assert.doesNotMatch(migration, /join public\.auction_watchers/);
  assert.ok(
    existsSync(
      path.join(root, "app/design-system/market-popularity-preview/page.tsx")
    )
  );
});

test("la recherche multi-termes partage une sémantique ET entre Collection, Catalogue et Marché", () => {
  const { cardSearchTerms, matchesCardSearch } = load("lib/ui/card-search.ts");
  assert.deepEqual(
    [...cardSearchTerms("  LUFFY, One PIECE ")],
    ["luffy", "one", "piece"]
  );
  assert.equal(
    matchesCardSearch("one piece luffy", ["Monkey D. Luffy", "One Piece"]),
    true
  );
  assert.equal(
    matchesCardSearch("LUFFY ONE PIECE", ["Monkey D. Luffy", "One Piece"]),
    true
  );
  assert.equal(
    matchesCardSearch("one piece naruto", ["Monkey D. Luffy", "One Piece"]),
    false
  );
  const collection = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  const community = readFileSync(
    path.join(root, "components/community-views.tsx"),
    "utf8"
  );
  const cards = readFileSync(path.join(root, "lib/data/cards.ts"), "utf8");
  // #388: the collection filter moved to lib/ui/collection-filter.ts.
  assert.match(
    normalizeWhitespace(
      readFileSync(path.join(root, "lib/ui/collection-filter.ts"), "utf8")
    ),
    normalizeWhitespace(
      /matchesCardSearch\(query,\[c\.name,c\.category,c\.anime\]\)/
    )
  );
  assert.match(
    normalizeWhitespace(community),
    normalizeWhitespace(
      /matchesCardSearch\(query,\[a\.card\.name,a\.card\.anime\]\)/
    )
  );
  assert.match(
    normalizeWhitespace(cards),
    normalizeWhitespace(/const terms\s*=\s*cardSearchTerms\(query\)/)
  );
  assert.match(
    normalizeWhitespace(cards),
    normalizeWhitespace(
      /\.rpc\("get_catalogue_cards_page",\s*\{[\s\S]*p_query:\s*terms\.join\(" "\)/
    )
  );
  assert.ok(
    existsSync(
      path.join(root, "app/design-system/multi-term-search-preview/page.tsx")
    )
  );
});

test("Phase 6 : détail d'enchère, solde, minute ajoutée, historique et issues", () => {
  const { AuctionView, presentAuction } = load(
    "components/community-views.tsx"
  );
  const base = {
    id: "a",
    card: { ...card, anime: "Spirit Realm" },
    amount: 120,
    remaining: "00:04:00",
    remainingSeconds: 240,
    seller: "Kitsune",
    bids: 2,
    nextBid: 130,
    minimumBid: 130,
    balance: 100,
    extended: true,
    history: [
      { id: "h1", name: "Oni", amount: 120, time: "14:32" },
      { id: "h2", name: "Moi", amount: 110, time: "14:30", mine: true }
    ]
  };
  const live = render(AuctionView, { auction: base, async onBid() {} });
  for (const wishlist of [false, true]) {
    const watchHtml = render(AuctionView, {
      auction: { ...base, wishlist },
      async onToggleWatch() {}
    });
    assert.match(watchHtml, /yk-auction-watch/);
    if (wishlist) {
      assert.match(
        normalizeWhitespace(watchHtml),
        normalizeWhitespace(
          /aria-pressed="true"[^>]*aria-label="Unwatch auction"[^>]*>.*?<span class="yk-watch-label">Watching<\/span>/
        )
      );
    } else {
      assert.match(
        normalizeWhitespace(watchHtml),
        normalizeWhitespace(
          /aria-pressed="false"[^>]*aria-label="Watch auction"[^>]*>.*?<span class="yk-watch-label">Watch<\/span>/
        )
      );
    }
  }
  assert.match(live, />\+10 Karas<span>· 130 Karas<\/span>/);
  assert.match(live, /One minute has been added to the auction\./);
  assert.match(live, /Not enough Karas \(your balance: 100 Karas\)/);
  assert.match(
    live,
    /Oni<\/a><span class="text-ink-3"> · <\/span><span class="text-karas tabular-nums">120 Karas<\/span><span class="text-ink-3"> · <\/span><time[^>]*>14:32<\/time>/
  );
  assert.ok(
    live.indexOf("yk-auction-history") > live.indexOf("yk-auction-panel")
  );
  assert.match(
    render(AuctionView, {
      auction: { ...base, finished: true, status: "won" }
    }),
    /Auction won!/
  );
  assert.match(
    render(AuctionView, {
      auction: { ...base, finished: true, status: "lost", winner: "Oni" }
    }),
    /Auction lost[^]*Won by Oni/
  );
  const ownSale = { ...base, bids: 0, nextBid: undefined, status: "mine" };
  assert.equal(
    (
      render(AuctionView, { auction: ownSale, async onCancel() {} }).match(
        /Cancel listing/g
      ) ?? []
    ).length,
    2
  );
  const bidSale = render(AuctionView, {
    auction: { ...ownSale, bids: 1 },
    async onCancel() {}
  });
  assert.equal((bidSale.match(/Cancel listing/g) ?? []).length, 1);
  assert.match(
    bidSale,
    /can&#x27;t be canceled because a bid has already been placed/
  );
  const raw = {
    id: "a",
    card,
    amount: 120,
    endsAt: new Date(Date.now() + 60_000).toISOString(),
    status: "active",
    seller: "Kitsune",
    sellerId: "s",
    buyerId: "x",
    bids: 2,
    watched: false,
    balance: 50,
    history: [
      {
        id: "h1",
        name: "Oni",
        amount: 120,
        createdAt: "2026-09-29T12:32:00Z",
        mine: false
      },
      {
        id: "h2",
        name: "Moi",
        amount: 110,
        createdAt: "2026-09-29T12:30:00Z",
        mine: true
      }
    ]
  };
  assert.equal(presentAuction(raw, "me").status, "outbid");
  assert.equal(presentAuction({ ...raw, status: "sold" }, "me").status, "lost");
  assert.equal(
    presentAuction({ ...raw, status: "sold", buyerId: "me" }, "me").status,
    "won"
  );
  assert.match(
    presentAuction(raw, "me").history[0].time,
    /^\d{2}:\d{2} [AP]M$/
  );
});

test("Mes enchères répartit l'historique en Won, Sold et Unsold", () => {
  const { presentAuction } = load("components/community-views.tsx");
  const raw = {
    id: "a",
    card,
    amount: 300,
    endsAt: "2026-10-20T12:00:00Z",
    status: "sold",
    seller: "Me",
    sellerId: "me",
    buyerId: "rival",
    bids: 2,
    watched: false
  };
  const sold = presentAuction({ ...raw, buyer: "Rival" }, "me");
  assert.equal(sold.status, "sold");
  assert.equal(sold.buyer, "Rival");
  assert.equal(sold.endsAt, raw.endsAt);
  assert.equal(
    presentAuction({ ...raw, buyer: null }, "me").buyer,
    "Deleted player"
  );
  // Before the migration the RPC does not send the buyer: no invented name.
  assert.equal(presentAuction(raw, "me").buyer, undefined);
  assert.equal(presentAuction(raw, "rival").status, "won");
  assert.equal(
    presentAuction({ ...raw, status: "expired", buyerId: null }, "me").status,
    "unsold"
  );
});

test("Mes enchères : actives d'abord par fin proche, puis historique par fin décroissante", () => {
  const { compareMarketAuctions } = load("components/community-views.tsx");
  const item = (id, remainingSeconds, finished, endsAt) => ({
    id,
    card,
    amount: 10,
    remaining: "",
    remainingSeconds,
    seller: "",
    bids: 0,
    finished,
    endsAt
  });
  const sorted = [
    item("old", 0, true, "2026-10-01T00:00:00Z"),
    item("late", 900, false, "2026-10-26T00:15:00Z"),
    item("recent", 0, true, "2026-10-24T00:00:00Z"),
    item("soon", 60, false, "2026-10-26T00:01:00Z")
  ].toSorted((a, b) => compareMarketAuctions(a, b, "end"));
  assert.deepEqual(
    sorted.map(a => a.id),
    ["soon", "late", "recent", "old"]
  );
});

test("Mes enchères affiche tout l'historique par défaut, avec compteurs, badges et récap", () => {
  const { MarketView } = load("components/community-views.tsx");
  const tile = (id, status, endsAt, extra = {}) => ({
    id,
    card: { ...card, id: `card-${id}`, name: `Card ${id}` },
    amount: 250,
    remaining: "00:00:00",
    remainingSeconds: 0,
    seller: "Kitsune",
    bids: 1,
    status,
    finished: true,
    endsAt,
    ...extra
  });
  const lists = {
    active: [],
    mine: [],
    won: [tile("won", "won", "2026-10-20T12:00:00Z")],
    sold: [
      tile("sold", "sold", "2026-10-22T12:00:00Z", { buyer: "Tanuki" }),
      tile("unsold", "unsold", "2026-10-18T12:00:00Z")
    ]
  };
  const counts = {
    active: 4,
    mine: 0,
    won: 16,
    sold: 44,
    activeSales: 0,
    all: 60,
    sales: 3,
    unsold: 41,
    salesKaras: 12500
  };
  const html = render(MarketView, {
    initialSection: "mine",
    lists,
    marketPage: { items: [], hasMore: false, counts }
  });
  // No status is preselected away from history: All is the default, even with 0 active.
  assert.match(
    html,
    /aria-pressed="true"><span class="yk-filter-check"><\/span><span>All<\/span><strong>60<\/strong>/
  );
  for (const [label, count] of [
    ["Active", 0],
    ["Won", 16],
    ["Sold", 3],
    ["Unsold", 41]
  ])
    assert.match(
      html,
      new RegExp(
        `aria-pressed="false"><span class="yk-filter-check"></span><span>${label}</span><strong>${count}</strong>`
      )
    );
  assert.doesNotMatch(html, /No auctions in progress/);
  assert.equal(
    (html.match(/class="yk-market-tile yk-market-tile-ended"/g) || []).length,
    3
  );
  // Most recent end first.
  assert.deepEqual(
    [...html.matchAll(/View auction for (Card \w+)/g)]
      .map(match => match[1])
      .filter((name, index, all) => all.indexOf(name) === index),
    ["Card sold", "Card won", "Card unsold"]
  );
  assert.match(html, />Won<\/span>/);
  assert.match(html, />Sold<\/span>/);
  assert.match(html, />Bought from Kitsune</);
  assert.match(html, />Sold to Tanuki</);
  assert.match(html, />Unsold<\/span>/);
  assert.match(html, />Returned to collection</);
  assert.match(html, /Oct 22, 2026/);
  assert.match(
    html,
    /16 won · 3 sold · 41 unsold · 12,500 Karas earned from sales/
  );
  assert.match(html, /aria-label="My auctions · All"/);

  const empty = normalizeWhitespace(
    render(MarketView, {
      initialSection: "mine",
      lists: { active: [], mine: [], won: [], sold: [] },
      marketPage: {
        items: [],
        hasMore: false,
        counts: {
          ...counts,
          mine: 0,
          won: 0,
          sold: 0,
          all: 0,
          sales: 0,
          unsold: 0
        }
      }
    })
  );
  assert.match(empty, /Noauctionsyet/);
  // Legacy RPC (no history counts): still a real empty state, never a crash.
  const legacy = normalizeWhitespace(
    render(MarketView, {
      initialSection: "mine",
      lists: { active: [], mine: [], won: [], sold: [] }
    })
  );
  assert.match(legacy, /Noauctionsyet/);
});

test("Mes enchères conserve les participations surenchéries exposées par list_auctions", () => {
  const { buildAuctionLists, presentAuction } = load(
    "components/community-views.tsx"
  );
  const raw = {
    id: "outbid",
    card,
    amount: 120,
    endsAt: new Date(Date.now() + 60_000).toISOString(),
    status: "active",
    seller: "Kitsune",
    sellerId: "seller",
    buyerId: "rival",
    hasBid: true,
    bids: 2,
    watched: false
  };
  assert.equal(presentAuction(raw, "viewer").status, "outbid");
  assert.deepEqual(
    buildAuctionLists([raw], "viewer").mine.map(item => item.id),
    ["outbid"]
  );
  assert.deepEqual(
    buildAuctionLists([{ ...raw, hasBid: false }], "viewer").mine,
    []
  );
  const migration = readFileSync(
    path.join(
      root,
      "supabase/migrations/20261001000000_auction_participation.sql"
    ),
    "utf8"
  );
  assert.match(migration, /where b\.bidder_id=player_id/);
  assert.match(
    migration,
    /bids_bidder_auction_idx on public\.bids\(bidder_id,auction_id\)/
  );
  assert.ok(
    existsSync(
      path.join(
        root,
        "app/design-system/auction-participation-preview/page.tsx"
      )
    )
  );
});

test("Phase 6 : la mise en vente confirme le verrouillage et signale la réinitialisation d'image", () => {
  const source = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/tc\("cardListedForAuctionLockedUntilTheAuction"\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /selected\.customImageUrl&&\(?<li>\{tc\("thisCardsCustomImageWillBeReset"\)\}<\/li>/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /\[\["15","15 min"\],\["30","30 min"\],\["60","1 h"\],\["240","4 h"\],\["720","12 h"\],\["1440","24 h"\]\]/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/useState\("10"\)/)
  );
});

test("l’inscription vérifie le pseudo après debounce sans remplacer la validation de soumission", () => {
  const form = readFileSync(
    path.join(root, "components/auth-form.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(form),
    normalizeWhitespace(/window\.setTimeout\(async \(\) => \{/)
  );
  assert.match(normalizeWhitespace(form), normalizeWhitespace(/\}, 450\)/));
  assert.match(
    normalizeWhitespace(form),
    normalizeWhitespace(/pseudoValidationError\(pseudo\.trim\(\)\)/)
  );
  assert.match(
    normalizeWhitespace(form),
    normalizeWhitespace(/pseudoRequest\.current \+= 1/)
  );
  assert.match(
    normalizeWhitespace(form),
    normalizeWhitespace(/if \(pseudoRequest\.current !== request\) return/)
  );
  assert.match(
    normalizeWhitespace(form),
    normalizeWhitespace(/t\("available"\)/)
  );
  assert.match(
    normalizeWhitespace(form),
    normalizeWhitespace(/t\("alreadyTaken"\)/)
  );
  assert.equal(englishMessages.authForm.available, "Available");
  assert.equal(englishMessages.authForm.alreadyTaken, "Already taken");
  assert.doesNotMatch(
    normalizeWhitespace(form),
    normalizeWhitespace(/disabled=\{[^}]*pseudoAvailability/)
  );
  const actions = readFileSync(path.join(root, "app/auth/actions.ts"), "utf8");
  assert.match(
    normalizeWhitespace(actions),
    normalizeWhitespace(
      /export async function checkPseudoAvailabilityWhileTyping/
    )
  );
  assert.match(
    normalizeWhitespace(actions),
    normalizeWhitespace(
      /return await checkPseudoAvailability\(supabase, cleanPseudo\)/
    )
  );
  assert.match(
    normalizeWhitespace(actions),
    normalizeWhitespace(
      /export async function signUp[\s\S]*const pseudoAvailable = await checkPseudoAvailability\(supabase, input\.pseudo\)/
    )
  );
});

test("les notifications connues ont un texte et une redirection, les inconnues un repli sûr", () => {
  const source =
    readFileSync(path.join(root, "components/topbar.tsx"), "utf8") +
    readFileSync(path.join(root, "lib/notification-item.ts"), "utf8");
  const model = readFileSync(
    path.join(root, "lib/data/notifications.ts"),
    "utf8"
  );
  for (const type of [
    "wishlist_card_on_auction",
    "friend_request",
    "outbid",
    "trade_offer_received",
    "trade_counter_offer_received",
    "trade_offer_accepted",
    "trade_offer_declined",
    "trade_offer_cancelled",
    "auction_won",
    "auction_sold",
    "auction_chat_mention",
    "achievement_completed"
  ]) {
    assert.match(model, new RegExp(type));
  }
  assert.match(
    JSON.stringify(englishMessages.topbar),
    /on your wishlist is now up for auction. Take a look!/
  );
  assert.match(JSON.stringify(englishMessages.topbar), /You've been outbid on/);
  assert.match(JSON.stringify(englishMessages.topbar), /You won/);
  assert.match(JSON.stringify(englishMessages.topbar), /You sold/);
  assert.match(
    JSON.stringify(englishMessages.topbar),
    /sent you a trade offer/
  );
  assert.match(
    JSON.stringify(englishMessages.topbar),
    /sent you a counteroffer/
  );
  assert.match(
    JSON.stringify(englishMessages.topbar),
    /accepted your trade offer/
  );
  assert.match(
    JSON.stringify(englishMessages.topbar),
    /declined your trade offer/
  );
  assert.match(
    JSON.stringify(englishMessages.topbar),
    /canceled their trade offer/
  );
  assert.match(JSON.stringify(englishMessages.topbar), /New activity/);
  for (const glyph of ["⇄", "↺", "✓", "×"])
    assert.match(source, new RegExp(glyph));
  assert.match(JSON.stringify(englishMessages.topbar), /New achievement/);
  assert.match(
    JSON.stringify(englishMessages.topbar),
    /sent you a friend request/
  );
  for (const href of [
    "/market/",
    "/friends",
    "/trades?offre=",
    "/achievements#"
  ]) {
    assert.match(source, new RegExp(href.replace("?", "\\?")));
  }
  const { notificationItem } = load("lib/notification-item.ts");
  const unknown = notificationItem(
    {
      id: "unknown",
      type: "future_type",
      referenceId: "ref",
      readAt: null,
      createdAt: "2026-10-05T00:00:00Z",
      cardName: null,
      actorPseudo: null,
      achievementName: null
    },
    intl.useTranslations("topbar")
  );
  assert.equal(unknown.title, "New activity");
  assert.equal(unknown.text, "New activity is available.");
  const sold = notificationItem(
    {
      id: "sold",
      type: "auction_sold",
      referenceId: "auction",
      readAt: null,
      createdAt: "2026-10-05T00:00:00Z",
      cardName: "Kitsune",
      actorPseudo: null,
      achievementName: null,
      karaAmount: 1250
    },
    intl.useTranslations("topbar")
  );
  assert.equal(sold.title, "Card sold");
  assert.equal(sold.text, "You sold Kitsune for 1,250 Karas.");
  assert.equal(sold.kind, "sold");
  assert.equal(sold.href, "/market/auction");
  const mention = notificationItem(
    {
      id: "mention",
      type: "auction_chat_mention",
      referenceId: "auction",
      readAt: null,
      createdAt: "2026-10-05T00:00:00Z",
      cardName: "Kitsune",
      actorPseudo: "Bob",
      achievementName: null
    },
    intl.useTranslations("topbar")
  );
  assert.equal(mention.text, "Bob mentioned you in the chat for Kitsune.");
  assert.equal(mention.href, "/market/auction#chat-enchere");
  assert.equal(mention.kind, "mention");
});

test("les notifications se relisent à l'ouverture du panneau et au retour sur l'onglet", () => {
  const hook = readFileSync(
    path.join(root, "hooks/use-notification-feed.ts"),
    "utf8"
  );
  const topbar = readFileSync(path.join(root, "components/topbar.tsx"), "utf8");
  const community = readFileSync(
    path.join(root, "components/community-views.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(hook),
    normalizeWhitespace(
      /startVisiblePolling\(\(\) => void refresh\(\), POLL_INTERVAL_MS\)/
    )
  );
  const polling = readFileSync(
    new URL("../lib/ui/visible-polling.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(polling),
    normalizeWhitespace(/addEventListener\("visibilitychange"/)
  );
  assert.match(
    normalizeWhitespace(polling),
    normalizeWhitespace(/removeEventListener\("visibilitychange"/)
  );
  assert.match(
    normalizeWhitespace(hook),
    normalizeWhitespace(/inFlight\.current\) return/)
  );
  assert.match(
    normalizeWhitespace(topbar),
    normalizeWhitespace(
      /setPanel\("notifications"\);if\(notifications\)onRefreshNotifications\?\.\(\);else void feed\.refresh\(\);/
    )
  );
  assert.match(
    normalizeWhitespace(community),
    normalizeWhitespace(
      /onRefreshNotifications=\{\(\)=>void feed\.refresh\(\)\}/
    )
  );
  for (const source of [topbar, community])
    assert.doesNotMatch(
      normalizeWhitespace(source),
      normalizeWhitespace(/getNotifications\(\)/)
    );
  assert.ok(
    existsSync(
      path.join(root, "app/design-system/notification-refresh-preview/page.tsx")
    )
  );
});

test("les pages Paramètres et Admin transmettent le solde de Karas à la Topbar", () => {
  const session = readFileSync(path.join(root, "lib/auth/session.ts"), "utf8");
  const settings = readFileSync(
    path.join(root, "app/settings/page.tsx"),
    "utf8"
  );
  const admin = readFileSync(
    path.join(root, "app/admin/cards/page.tsx"),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(session),
    normalizeWhitespace(/export async function getCurrentKarasBalance/)
  );
  assert.match(
    normalizeWhitespace(session),
    normalizeWhitespace(/rpc\("get_game_info"\)/)
  );
  assert.match(
    normalizeWhitespace(settings),
    normalizeWhitespace(/getCurrentKarasBalance\(\)/)
  );
  assert.match(
    normalizeWhitespace(settings),
    normalizeWhitespace(/<Topbar view="settings"[\s\S]{0,200}karas=\{karas\}/)
  );
  assert.match(
    normalizeWhitespace(admin),
    normalizeWhitespace(/getCurrentKarasBalance\(client\)/)
  );
  assert.match(
    normalizeWhitespace(admin),
    normalizeWhitespace(/<Topbar view="admin"[\s\S]{0,200}karas=\{karas\}/)
  );
});

test("les paramètres permettent de changer le mot de passe après vérification de l’actuel", () => {
  const settings = readFileSync(
    path.join(root, "components/settings.tsx"),
    "utf8"
  );
  assert.match(settings, /name="currentPassword"/);
  assert.match(settings, /name="password"/);
  assert.match(settings, /name="confirmPassword"/);
  assert.match(settings, /useActionState\(changePassword/);
});

test("tri de la Collection : rareté par défaut, dates, nom français et ordre stable", () => {
  const {
    sortCollection,
    COLLECTION_SORTS,
    DEFAULT_COLLECTION_SORT,
    isCollectionSort
  } = load("lib/ui/collection-sort.ts");
  const make = (instanceId, name, rarity, shiny, obtainedAt) => ({
    ...card,
    instanceId,
    name,
    rarity,
    shiny,
    obtainedAt
  });
  const cards = [
    make("a", "Écho", "SR", false, "2026-03-01T10:00:00Z"),
    make("b", "akira", "LR", false, "2026-01-15T10:00:00Z"),
    make("c", "Zorro", "SSR", true, "2026-05-10T10:00:00Z"),
    make("d", "Mochi", "SSR", false, "2026-05-10T10:00:00Z"),
    make("e", "Bashō", "C", false, "2026-07-01T10:00:00Z"),
    make("f", "Kitsune", "R", true, "2025-12-31T10:00:00Z")
  ];
  const names = sort =>
    sortCollection(cards, sort)
      .map(item => item.name)
      .join(",");
  assert.equal(DEFAULT_COLLECTION_SORT, "rarity");
  assert.equal(
    COLLECTION_SORTS.map(option => option.label).join(" | "),
    "Rarity | Newest first | Oldest first | Name (A → Z)"
  );
  assert.equal(names("rarity"), "akira,Zorro,Mochi,Écho,Kitsune,Bashō");
  assert.equal(names("recent"), "Bashō,Zorro,Mochi,Écho,akira,Kitsune");
  assert.equal(names("oldest"), "Kitsune,akira,Écho,Zorro,Mochi,Bashō");
  assert.equal(names("name"), "akira,Bashō,Écho,Kitsune,Mochi,Zorro");
  assert.equal(cards[0].name, "Écho", "le tri ne modifie pas le tableau reçu");
  const twins = [
    make("z", "Double", "C", false, "2026-01-01T00:00:00Z"),
    make("y", "Double", "C", false, "2026-01-01T00:00:00Z")
  ];
  assert.equal(
    sortCollection(twins, "name")
      .map(item => item.instanceId)
      .join(),
    "y,z"
  );
  assert.ok(isCollectionSort("oldest"));
  assert.ok(!isCollectionSort("franchise"));
  assert.ok(!isCollectionSort(null));
  const source = readFileSync(
    path.join(root, "components/collection.tsx"),
    "utf8"
  );
  // #388: the collection filter moved to lib/ui/collection-filter.ts.
  assert.match(
    normalizeWhitespace(
      readFileSync(path.join(root, "lib/ui/collection-filter.ts"), "utf8")
    ),
    normalizeWhitespace(/sortCollection\(cards\.filter\(/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/filterCollection\(/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/setSort\(e\.target\.value\);setPage\(1\);/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(source),
    normalizeWhitespace(/yk-sort-placeholder|Tri non disponible/)
  );
  const css = readFileSync(path.join(root, "styles/collection.css"), "utf8");
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-sort-control \{[^}]*white-space: nowrap;/),
    "les libellés longs restent sur une ligne"
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /\.yk-collection-toolbar-actions > :not\(dialog\) \{[^}]*width: calc\(var\(--spacing\) \* 50\);/
    ),
    "la largeur partagée des actions ne change pas"
  );
});

test("English selection and achievement labels handle singulars, plurals and en-US numbers", () => {
  const { SelectionBar } = load("components/ui/index.tsx");
  const noop = () => {};
  for (const [count, itemLabel, expected] of [
    [0, "carte", "0 cards selected"],
    [1, "exemplaire", "1 copy selected"],
    [2, "exemplaire", "2 copies selected"],
    [1000, "carte", "1,000 cards selected"]
  ]) {
    const html = render(SelectionBar, {
      count,
      itemLabel,
      onAll: noop,
      onNone: noop,
      onDestroy: noop,
      onClose: noop
    });
    assert.ok(html.replace(/<[^>]*>/g, "").includes(expected), expected);
    assert.match(html, /aria-label="Exit multi-select"/);
  }
  const { AchievementCard } = load("components/achievements.tsx");
  for (const [conditionType, target, expected] of [
    ["first_lr_card", 1, "0/1 LR card"],
    ["shiny_cards_collected", 2, "0/2 Shiny cards"],
    ["regular_packs_opened", 1000, "0/1,000 packs opened"]
  ]) {
    const html = render(AchievementCard, {
      item: {
        id: "proof",
        title: "Proof",
        description: "Proof description.",
        conditionType,
        progressCurrent: 0,
        progressTarget: target,
        karasReward: 10
      },
      onClaim: noop
    });
    assert.ok(html.includes(expected), expected);
  }
});

test("empty Regular Pack reserve shows the countdown only on its disabled button", () => {
  const { Boosters } = load("components/boosters.tsx");
  const props = {
    countdown: "01:00",
    decisionCountdown: "10:00:00",
    busy: false,
    draw: [],
    drawKind: "regular",
    collection: [],
    revealed: 0,
    onOpen() {},
    onKeepDecision() {},
    onReveal() {}
  };
  for (const available of [0, 3, 5]) {
    const html = render(Boosters, {
      ...props,
      status: { available, maximum: 5, nextPackAt: available === 5 ? null : 1 }
    });
    assert.equal(
      (html.match(/Next in 01:00/g) || []).length,
      available === 5 ? 0 : 1
    );
    if (available === 0)
      assert.match(html, /disabled="">Next in 01:00<\/button>/);
    else assert.match(html, />Open<\/button>/);
    if (available === 5) assert.match(html, /Reserve full/);
  }
  const source = readFileSync(
    path.join(root, "components/boosters.tsx"),
    "utf8"
  );
  assert.ok(source.includes('tp("reveal5CardsAndChooseOneToKeep")'));
  assert.ok(source.includes('tp("openARegularPackAndAddAll5")'));
});

test("Regular Pack refill and availability share one compact line", () => {
  const { Boosters } = load("components/boosters.tsx");
  for (const available of [3, 5]) {
    const html = render(Boosters, {
      status: { available, maximum: 5, nextPackAt: available === 5 ? null : 1 },
      countdown: "01:00",
      decisionCountdown: "10:00:00",
      busy: false,
      draw: [],
      drawKind: "regular",
      collection: [],
      revealed: 0,
      onOpen() {},
      onKeepDecision() {},
      onReveal() {}
    });
    const regular = html.split("yk-decision-panel")[0];
    const line = regular.match(
      /<p class="yk-pack-timing">([\s\S]*?)<\/p>/
    )?.[1];
    assert.ok(
      line?.includes(available === 5 ? "Reserve full" : "Next in 01:00")
    );
    assert.ok(line?.includes("Available now"));
    assert.doesNotMatch(regular, /<p class="text-success">/);
  }
});

test("empty Regular Pack uses the same unavailable styling as a locked Decision Pack", () => {
  const { Boosters } = load("components/boosters.tsx");
  for (const available of [0, 3, 5]) {
    const html = render(Boosters, {
      status: { available, maximum: 5, nextPackAt: 1 },
      decisionStatus: { available: false, pending: [], nextPackAt: 1 },
      countdown: "01:00",
      decisionCountdown: "10:00:00",
      busy: false,
      draw: [],
      drawKind: "regular",
      collection: [],
      revealed: 0,
      onOpen() {},
      onKeepDecision() {},
      onReveal() {}
    });
    assert.ok(
      html.includes(
        `<article class="yk-pack-panel" data-unavailable="${available === 0}">`
      )
    );
    assert.ok(
      html.includes(
        '<article class="yk-pack-panel yk-decision-panel" data-unavailable="true">'
      )
    );
  }
});

test("Decision Packs show server quota and the existing countdown without a browser-timezone dependency", () => {
  const { Boosters } = load("components/boosters.tsx");
  for (const [maximum, remaining] of [
    [1, 0],
    [2, 1],
    [2, 0]
  ]) {
    const html = render(Boosters, {
      status: { available: 0, maximum: 5, nextPackAt: 1 },
      decisionStatus: {
        available: remaining > 0,
        pending: [],
        nextPackAt: 1,
        maximum,
        remaining,
        resetAt: 1,
        resetTimeZone: "Europe/Paris"
      },
      countdown: "01:00",
      decisionCountdown: "10:00:00",
      busy: false,
      draw: [],
      drawKind: "regular",
      collection: [],
      revealed: 0,
      onOpen() {},
      onKeepDecision() {},
      onReveal() {}
    });
    const decision = html.split("yk-decision-panel")[1];
    assert.ok(decision.includes(`${remaining}/${maximum} packs left`));
    assert.ok(decision.includes("Resets in 10:00:00"));
    assert.ok(
      decision.includes(
        remaining > 0 ? "Available now" : "Available in 10:00:00"
      )
    );
    assert.doesNotMatch(decision, /Available (?:today|tomorrow) at/);
  }
});

test("LR and SSR Evolved use infinity and preserve their rarity and Evolved treatment", () => {
  const { YokaiCard } = load("components/yokai-card.tsx");
  for (const rarity of ["LR", "SSR"]) {
    const html = render(YokaiCard, {
      ...card,
      rarity,
      shiny: false,
      isEvolved: true,
      animated: false
    });
    assert.match(html, new RegExp(`yk-rarity-${rarity}`));
    assert.match(html, /yk-evolved/);
    assert.match(
      html,
      new RegExp(`${rarity} ${rarity === "SSR" ? "INFINITY" : "EVOLVED"}`)
    );
    assert.match(html, /<svg class="yk-evolved-symbol"[^>]*aria-hidden="true"/);
    assert.match(
      html,
      /<path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8Z"/
    );
    assert.doesNotMatch(html, /yk-shiny(?: |")/);
    assert.doesNotMatch(html, new RegExp(`${rarity} Shiny`));
  }
  const shiny = render(YokaiCard, {
    ...card,
    rarity: "LR",
    shiny: true,
    isEvolved: false,
    animated: false
  });
  assert.match(shiny, /LR Shiny/);
  assert.match(shiny, />✦<\/span>/);
  assert.doesNotMatch(shiny, /yk-evolved-symbol/);
});

test("le bouton son du topbar reste visible sur mobile", () => {
  const css = readFileSync(path.join(root, "styles/topbar.css"), "utf8");
  const mobile = css.slice(css.indexOf("@media (max-width: 620px)"));
  const hidden = mobile.slice(0, mobile.indexOf("display: none"));
  assert.doesNotMatch(hidden, /\.yk-icon-button:nth-child\(2\)/);
  const source = readFileSync(path.join(root, "components/topbar.tsx"), "utf8");
  assert.match(source, /aria-label=\{sound\.enabled \? t\("disableSound"\)/);
  assert.equal(englishMessages.topbar.disableSound, "Disable sound");
});

test("« All » de la collection ajoute la page courante sans effacer les autres pages", () => {
  const collection = normalizeWhitespace(
    readFileSync(path.join(root, "components/collection.tsx"), "utf8")
  );
  const onAll = collection.match(/onAll=\{\(\)=>.*?onNone=/)?.[0] ?? "";
  assert.match(onAll, /\.\.\.current,/);
  assert.match(onAll, /visibleGroups\.flatMap/);
  assert.doesNotMatch(onAll, /\bgroups\.flatMap/);
});

test("LR Infinity Shiny displays both variant markers", () => {
  const { YokaiCard } = load("components/yokai-card.tsx");
  const html = render(YokaiCard, {
    ...card,
    rarity: "LR",
    shiny: true,
    isEvolved: true,
    animated: false
  });
  assert.match(html, /yk-evolved-symbol/);
  assert.match(html, /LR INFINITY Shiny/);
  assert.match(html, /aria-label="Shiny"/);
});
