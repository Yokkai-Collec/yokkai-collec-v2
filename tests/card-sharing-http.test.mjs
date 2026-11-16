import { intl, intlServer, englishMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { licenseName } from "./helpers/license-name.mjs";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);

function load(file, globals = {}) {
  const source = ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  const context = { exports: {}, Response, Uint8Array, URL, ...globals };
  context.require = name => {
    if (name === "@/lib/ui/license-name") return licenseName;
    if (name === "next-intl") return intl;
    if (name === "next-intl/server") return intlServer;
    if (name === "@/lib/ui/card-rarity-label")
      return load("lib/ui/card-rarity-label.ts");
    if (globals.require) return globals.require(name);
    throw new Error(`Unexpected import: ${name}`);
  };
  vm.runInNewContext(source, context);
  return context.exports;
}

const { cardShareImageResponse } = load("lib/server/card-share-image-route.ts");
const pageShell = {
  "@/components/yokai-card": load("components/yokai-card.tsx", {
    require(name) {
      if (name === "@/components/pro-access")
        return { useOwnProfileStyle: () => null };
      if (name.endsWith(".css")) return {};
      return require(name);
    }
  }),
  "@/components/card-shell": { CardShell: ({ children }) => children },
  "@/components/site-footer": { SiteFooter: () => null },
  "@/lib/discord-invite": { getDiscordInviteUrl: () => null },
  "next/image": { __esModule: true, default: () => null }
};
const id = "a".repeat(32);
const card = {
  cardName: "Kitsune",
  franchise: "Yokkai",
  rarity: "SSR",
  shiny: false,
  catalogueImageUrl: "https://example.test/card.png"
};

test("une image inconnue ou un identifiant invalide rend 404 avant tout rendu", async () => {
  for (const [shareId, getShare] of [
    ["bad", async () => assert.fail("invalid must not query")],
    [id, async () => null]
  ]) {
    let renders = 0;
    const response = await cardShareImageResponse(shareId, "og", {
      getShare,
      cache: { getOrRender: async (_key, render) => render() },
      render: async () => {
        renders += 1;
        return new Uint8Array([1]);
      }
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(renders, 0);
  }
});

test("la requête suivant une suppression rend 404 avant le cache mémoire chaud", async () => {
  let exists = true;
  let cacheReads = 0;
  let queries = 0;
  const dependencies = {
    getShare: async () => {
      queries += 1;
      return exists ? card : null;
    },
    cache: {
      getOrRender: async () => {
        cacheReads += 1;
        return new Uint8Array([1]);
      }
    },
    render: async () => assert.fail("must not render")
  };
  assert.equal(
    (await cardShareImageResponse(id, "og", dependencies)).status,
    200
  );
  assert.equal(
    (await cardShareImageResponse(id, "og", dependencies)).status,
    200
  );
  exists = false;
  const response = await cardShareImageResponse(id, "og", dependencies);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(cacheReads, 2);
  assert.equal(
    queries,
    3,
    "un appel RPC par requête, même avec un cache chaud"
  );
});

function assertShortCache(header) {
  assert.doesNotMatch(header, /immutable/i);
  const lifetimes = [...header.matchAll(/(?:s-maxage|max-age)=(\d+)/g)].map(
    match => Number(match[1])
  );
  assert.ok(lifetimes.length > 0);
  assert.ok(lifetimes.every(seconds => seconds <= 300));
  assert.match(header, /must-revalidate/);
  assert.doesNotMatch(header, /stale-while-revalidate|stale-if-error/i);
}

test("contre-preuve : l'ancien en-tête échoue à la politique de cache court", () => {
  assert.throws(
    () => assertShortCache("public, max-age=31536000, immutable"),
    assert.AssertionError
  );
});

test("une image valide est un PNG public limité à 300 secondes", async () => {
  const response = await cardShareImageResponse(id, "square", {
    getShare: async () => card,
    cache: {
      getOrRender: async (key, render) => {
        assert.equal(key, `${id}:square:${card.catalogueImageUrl}`);
        return render();
      }
    },
    render: async (value, format) => {
      assert.equal(value, card);
      assert.equal(format, "square");
      return new Uint8Array([137, 80, 78, 71]);
    }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assertShortCache(response.headers.get("cache-control"));
});

test("une panne de rendu ne devient jamais une erreur 500", async () => {
  const response = await cardShareImageResponse(id, "story", {
    getShare: async () => card,
    cache: { getOrRender: async (_key, render) => render() },
    render: async () => {
      throw new Error("renderer failed");
    }
  });
  assert.equal(response.status, 204);
});

test("la page et ses métadonnées restent strictement publiques", () => {
  const page = readFileSync(
    new URL("../app/share/[id]/page.tsx", import.meta.url),
    "utf8"
  );
  assert.equal(englishMessages.shareUi.join, "Join Yokkai Collec'");
  assert.match(page, /t\("join"\)/);
  assert.match(page, /href="\/signup"/);
  assert.match(page, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
  assert.match(page, /summary_large_image/);
  assert.match(page, /NEXT_PUBLIC_SITE_URL/);
  assert.doesNotMatch(
    page,
    /customImage|custom_image|ownerId|instanceId|auction|chat|gif/i
  );
});

const { isShareImageUrl } = load("lib/server/card-sharing.ts", {
  require(name) {
    if (name === "server-only" || name === "@supabase/supabase-js") return {};
    if (name === "@/utils/supabase/config")
      return {
        getSupabaseConfig: () => ({
          url: "https://catalogue.example",
          key: "test"
        })
      };
    throw new Error(`Unexpected import: ${name}`);
  }
});

test("page publique : validation partagée et cadre nommé pour un autre hôte", async () => {
  for (const [url, valid] of [
    [
      "https://catalogue.example/storage/v1/object/public/card-images/card.png",
      true
    ],
    ["https://i.imgur.com/custom.png", true],
    ["https://imgur.com/custom.jpg", true],
    ["https://i.imgur.com.evil.example/custom.png", false],
    ["https://imgur.com@evil.example/custom.png", false],
    ["https://evil@i.imgur.com/custom.png", false],
    ["https://i.imgur.com:444/custom.png", false],
    ["http://i.imgur.com/custom.png", false],
    ["https://i.imgur.com/", false],
    [
      "https://evil.example/storage/v1/object/public/card-images/card.png",
      false
    ],
    [
      "http://catalogue.example/storage/v1/object/public/card-images/card.png",
      false
    ],
    [
      "https://catalogue.example:444/storage/v1/object/public/card-images/card.png",
      false
    ],
    [
      "https://catalogue.example/storage/v1/object/public/other/card.png",
      false
    ],
    [
      "https://catalogue.example/storage/v1/object/public/card-images-evil/card.png",
      false
    ],
    ["invalid", false]
  ]) {
    assert.equal(isShareImageUrl(url), valid);
    const page = load("app/share/[id]/page.tsx", {
      require(name) {
        if (name === "@/lib/server/card-sharing")
          return {
            isShareImageUrl,
            getSharedCard: async () => ({ ...card, catalogueImageUrl: url })
          };
        if (name === "next/link") return { __esModule: true, default: "a" };
        if (name === "next/navigation")
          return { notFound: () => assert.fail("share exists") };
        if (name in pageShell) return pageShell[name];
        return require(name);
      }
    });
    assert.equal(page.dynamic, "force-dynamic");
    const html = renderToStaticMarkup(
      await page.default({ params: Promise.resolve({ id }) })
    );
    if (valid) assert.match(html, /<img/);
    else {
      assert.doesNotMatch(html, /<img|evil\.example/);
      assert.match(html, /yk-card-missing">Artwork unavailable</);
      assert.match(html, /yk-card-name" title="Kitsune">Kitsune</);
    }
  }
});

test("changer l’illustration produit un nouveau PNG malgré un cache mémoire chaud", async () => {
  const { RenderCache } = load("lib/server/image-cache.ts");
  const cache = new RenderCache(1024);
  let shared = { ...card, catalogueImageUrl: "https://i.imgur.com/first.png" };
  let renders = 0;
  const dependencies = {
    getShare: async () => shared,
    cache,
    render: async () => new Uint8Array([++renders])
  };
  const first = await cardShareImageResponse(id, "og", dependencies);
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [1]);
  shared = { ...shared, catalogueImageUrl: "https://i.imgur.com/second.png" };
  const next = await cardShareImageResponse(id, "og", dependencies);
  assert.deepEqual([...new Uint8Array(await next.arrayBuffer())], [2]);
  const again = await cardShareImageResponse(id, "og", dependencies);
  assert.deepEqual([...new Uint8Array(await again.arrayBuffer())], [2]);
  assert.equal(renders, 2);
});

test("shared metadata uses the English canonical URL and keeps the same opaque ID", async () => {
  const page = load("app/share/[id]/page.tsx", {
    process: {
      env: {
        NEXT_PUBLIC_SITE_URL: "https://yokkai.example",
        NODE_ENV: "production"
      }
    },
    require(name) {
      if (name === "@/lib/server/card-sharing")
        return {
          getSharedCard: async () => card,
          isShareImageUrl: () => false
        };
      if (name === "next/link") return { __esModule: true, default: "a" };
      if (name === "next/navigation")
        return { notFound: () => assert.fail("share exists") };
      if (name in pageShell) return pageShell[name];
      return require(name);
    }
  });
  const metadata = await page.generateMetadata({
    params: Promise.resolve({ id })
  });
  assert.equal(
    metadata.alternates.canonical,
    `https://yokkai.example/share/${id}`
  );
  assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
  assert.equal(
    metadata.openGraph.images[0].url,
    `${metadata.alternates.canonical}/image/og`
  );
  assert.equal(metadata.robots.index, false);
  assert.equal(metadata.robots.follow, false);
});
