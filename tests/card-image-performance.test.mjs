import { licenseName } from "./helpers/license-name.mjs";
import { intl } from "./helpers/i18n.mjs";
import { createRequire } from "node:module";
import { cardRarityLabels } from "./helpers/card-rarity-labels.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const catalogue =
  "https://images.example.test/storage/v1/object/public/card-images/card-a";
const source = readFileSync(
  new URL("../components/yokai-card.tsx", import.meta.url),
  "utf8"
);
function load(input = source) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(input, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    }).outputText,
    {
      exports,
      URL,
      process: {
        env: { NEXT_PUBLIC_SUPABASE_URL: "https://images.example.test" }
      },
      require: name => {
        if (name === "@/lib/ui/license-name") return licenseName;
        if (name === "next-intl") return intl;
        if (name === "@/lib/ui/card-rarity-label") return cardRarityLabels;
        if (name.endsWith(".css")) return {};
        if (name === "@/components/pro-access")
          return { useOwnProfileStyle: () => null };
        if (name === "react") return React;
        if (name === "react/jsx-runtime") return jsxRuntime;
        if (name === "next/image")
          assert.fail(
            "Card illustrations must load their original, not next/image"
          );
        assert.fail(name);
      }
    }
  );
  return exports.YokaiCard;
}

test("Blackout catalogue art keeps the Blackout frame for GIF and WebP cards", () => {
  const YokaiCard = load();
  const renderCard = (image, catalogueImage) =>
    renderToStaticMarkup(
      React.createElement(YokaiCard, {
        id: "b8341284-d4bc-4095-b2a9-fbc29be4e12b",
        name: "Satoru Gojo",
        category: "ANIME/MANGA",
        rarity: "LR",
        image,
        catalogueImage
      })
    );
  const gojoGif = "/assets/events/blackout/cards/satoru-gojo.gif";
  const regularGif = "/assets/cards/satoru-gojo.gif";

  for (const card of [
    renderCard(gojoGif),
    renderCard("/assets/events/blackout/cards/example.webp"),
    renderCard(regularGif, gojoGif)
  ]) {
    assert.match(card, /data-blackout="true"/);
    assert.match(card, /class="yk-card yk-rarity-LR yk-evolved\b/);
  }
  assert.doesNotMatch(renderCard(regularGif), /data-blackout|yk-evolved/);
});

// Product decision (PhyesGG, 2026-11-05): grid tiles of catalogue art hosted on
// our public Storage load a resized WebP at quality 85 (2x density). Details
// and every other source keep exactly the original, never recompressed.
test("details and non-catalogue sources load exactly the original, without resizing or recompression", () => {
  const YokaiCard = load();
  for (const image of [
    catalogue,
    "https://s4.anilist.co/file/anilistcdn/character/large/card.png",
    "https://i.imgur.com/card.png",
    "https://media.giphy.com/media/card/giphy.gif",
    "https://other.example.test/art.jpg",
    "/assets/booster-pack.png",
    `${catalogue}?token=private`
  ]) {
    for (const rarity of ["C", "R", "SR", "SSR", "LR"]) {
      const props = {
        name: "Card",
        category: "Test",
        rarity,
        image,
        animated: false
      };
      const detail = renderToStaticMarkup(
        React.createElement(YokaiCard, props)
      );
      assert.doesNotMatch(
        detail,
        /_next\/image|data-optimized|srcSet=|srcset=|sizes=|quality=/
      );
      assert.ok(detail.includes(`src="${image}"`));
      if (image === catalogue) continue;
      for (const imageSizes of ["100vw", "(max-width: 640px) 45vw, 200px"]) {
        const grid = renderToStaticMarkup(
          React.createElement(YokaiCard, { ...props, imageSizes })
        );
        assert.equal(grid, detail, `${rarity} ${image}`);
        assert.match(grid, /loading="lazy"/);
        assert.match(grid, /decoding="async"/);
      }
    }
  }
});

test("catalogue grid tiles load resized quality-85 variants and keep the original as src", () => {
  const YokaiCard = load();
  const sizes = "(max-width: 640px) 45vw, 200px";
  for (const rarity of ["C", "R", "SR", "SSR", "LR"]) {
    const grid = renderToStaticMarkup(
      React.createElement(YokaiCard, {
        name: "Card",
        category: "Test",
        rarity,
        image: catalogue,
        animated: false,
        imageSizes: sizes
      })
    );
    const url = encodeURIComponent(catalogue);
    for (const width of [256, 384, 640])
      assert.ok(
        grid.includes(
          `/_next/image?url=${url}&amp;w=${width}&amp;q=85 ${width}w`
        ),
        `${rarity} ${width}`
      );
    assert.doesNotMatch(grid, /q=(?!85)\d+/);
    assert.ok(grid.includes(`sizes="${sizes}"`));
    assert.ok(grid.includes(`src="${catalogue}"`));
    assert.match(grid, /loading="lazy"/);
    assert.match(grid, /decoding="async"/);
  }
});

test("personal image failure falls back to the native catalogue source and never loops", () => {
  const YokaiCard = load();
  let art;
  function visit(node) {
    if (!React.isValidElement(node)) return;
    if (node.props.onError) art = node;
    React.Children.forEach(node.props.children, visit);
  }
  visit(
    YokaiCard({
      name: "Card",
      category: "Test",
      rarity: "SR",
      image: "https://i.imgur.com/custom.png",
      catalogueImage: catalogue,
      imageSizes: "100vw"
    })
  );
  let replacements = 0;
  const target = {
    src: "https://i.imgur.com/custom.png",
    removeAttribute: () => {},
    set src(value) {
      this.current = value;
      replacements++;
    },
    get src() {
      return this.current;
    }
  };
  target.current = "https://i.imgur.com/custom.png";
  art.props.onError({ currentTarget: target });
  assert.equal(target.src, catalogue);
  art.props.onError({ currentTarget: target });
  assert.equal(replacements, 1);
});

test("optimizer remains restricted for other callers: exact public Storage origin, HTTPS, no redirects", () => {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../next.config.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true
        }
      }
    ).outputText,
    {
      exports,
      require: createRequire(import.meta.url),
      URL,
      process: {
        env: { NEXT_PUBLIC_SUPABASE_URL: "https://images.example.test" }
      }
    }
  );
  const images = exports.default.images;
  assert.equal(images.remotePatterns.length, 1);
  assert.equal(images.remotePatterns[0].hostname, "images.example.test");
  assert.equal(
    images.remotePatterns[0].pathname,
    "/storage/v1/object/public/card-images/**"
  );
  assert.equal(images.remotePatterns[0].search, "");
  assert.equal(images.maximumRedirects, 0);
  assert.notEqual(images.dangerouslyAllowLocalIP, true);
});

test("real transformations fail the rendered contract for grids and details, for every source", () => {
  for (const image of [
    catalogue,
    "https://s4.anilist.co/art.png",
    "https://i.imgur.com/art.png",
    "https://media.giphy.com/art.gif",
    "https://other.test/art.jpg"
  ]) {
    for (const imageSizes of [undefined, "100vw", "190px"]) {
      const props = {
        name: "Card",
        category: "Test",
        rarity: "C",
        image,
        imageSizes
      };
      for (const replacement of [
        'src: "/_next/image?url=" + encodeURIComponent(image ?? "") + "&w=128&q=75"',
        'src: (image ?? "") + "?width=128&quality=75"',
        'src: image ?? "", srcSet: (image ?? "") + "?width=128 128w", sizes: "100px"'
      ]) {
        const mutated = load(source.replace('src: image ?? ""', replacement));
        const html = renderToStaticMarkup(React.createElement(mutated, props));
        assert.throws(
          () => {
            assert.match(html, /<img\b/);
            assert.doesNotMatch(
              html,
              /_next\/image|srcSet=|sizes=|quality=|width=128/
            );
            assert.ok(html.includes('src="' + image + '"'));
          },
          undefined,
          image + " " + replacement
        );
      }
    }
  }
});

test("production grid and detail callers only select original image fields", () => {
  const names = [
    "collection",
    "profile",
    "community-views",
    "trades",
    "boosters"
  ];
  function originalObject(node) {
    return (
      ts.isIdentifier(node) ||
      (ts.isPropertyAccessExpression(node) && originalObject(node.expression))
    );
  }
  function originalExpression(node) {
    if (ts.isPropertyAccessExpression(node))
      return (
        originalObject(node.expression) &&
        ["image", "catalogueImage", "customImageUrl"].includes(node.name.text)
      );
    if (ts.isConditionalExpression(node))
      return (
        originalExpression(node.whenTrue) && originalExpression(node.whenFalse)
      );
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
        node.operatorToken.kind
      )
    )
      return originalExpression(node.left) && originalExpression(node.right);
    return false;
  }
  for (const name of names) {
    const text = readFileSync(
      new URL("../components/" + name + ".tsx", import.meta.url),
      "utf8"
    );
    const ast = ts.createSourceFile(
      name + ".tsx",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    let count = 0;
    function walk(node) {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(ast) === "YokaiCard"
      ) {
        count++;
        for (const a of node.attributes.properties) {
          if (
            ts.isJsxAttribute(a) &&
            ["image", "fallbackImage", "catalogueImage"].includes(
              a.name.getText(ast)
            )
          ) {
            assert.ok(
              a.initializer &&
                ts.isJsxExpression(a.initializer) &&
                a.initializer.expression &&
                originalExpression(a.initializer.expression),
              name + ": transformed image at caller"
            );
          }
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(ast);
    assert.ok(count > 0, name + ": grid/detail coverage missing");
  }
});

test("custom art shows its resized catalogue art until painted, never an empty frame", () => {
  const YokaiCard = load();
  const custom = "https://i.pinimg.com/originals/aa/bb/cc/art.gif";
  const html = renderToStaticMarkup(
    React.createElement(YokaiCard, {
      name: "Card",
      category: "Test",
      rarity: "SR",
      image: custom,
      catalogueImage: catalogue,
      animated: false
    })
  );
  // The placeholder is the catalogue art, resized, under the exact custom art.
  assert.match(html, /data-art-layers="true"/);
  assert.match(
    html,
    new RegExp(
      `<img class="yk-card-art-placeholder" src="${catalogue}" srcSet="[^"]*_next/image[^"]*q=85[^"]*"`
    )
  );
  assert.ok(html.includes(`src="${custom}"`));
  assert.ok(html.indexOf("yk-card-art-placeholder") < html.indexOf(custom));
  // No custom art, or art from another host: no placeholder layer.
  for (const props of [
    { image: catalogue, catalogueImage: catalogue },
    { image: custom, catalogueImage: "https://other.example.test/art.jpg" }
  ]) {
    const plain = renderToStaticMarkup(
      React.createElement(YokaiCard, {
        name: "Card",
        category: "Test",
        rarity: "SR",
        animated: false,
        ...props
      })
    );
    assert.doesNotMatch(plain, /yk-card-art-placeholder/);
  }
});

test("Imgur GIF art plays its MP4 and keeps the GIF only as a fallback", () => {
  const YokaiCard = load();
  const gif = "https://i.imgur.com/AbC123.gif";
  const html = renderToStaticMarkup(
    React.createElement(YokaiCard, {
      name: "Card",
      category: "Test",
      rarity: "SR",
      image: gif,
      catalogueImage: catalogue,
      animated: false
    })
  );
  assert.match(html, /<video src="https:\/\/i\.imgur\.com\/AbC123\.mp4"/);
  assert.match(html, /autoPlay=""|autoplay=""/);
  assert.match(html, /muted=""/);
  assert.match(html, /loop=""/);
  assert.match(html, /playsInline=""|playsinline=""/);
  // The heavy GIF is not downloaded unless the MP4 fails.
  assert.ok(html.includes(`data-gif-fallback="${gif}"`));
  assert.doesNotMatch(html, new RegExp(`src="${gif.replace(/\./g, "\.")}"`));
  // Other GIFs (Pinterest, still Imgur images) stay images.
  for (const image of [
    "https://i.pinimg.com/originals/aa/bb/cc/art.gif",
    "https://i.imgur.com/AbC123.png"
  ]) {
    const other = renderToStaticMarkup(
      React.createElement(YokaiCard, {
        name: "Card",
        category: "Test",
        rarity: "SR",
        image,
        catalogueImage: catalogue,
        animated: false
      })
    );
    assert.doesNotMatch(other, /<video/);
    assert.ok(other.includes(`src="${image}"`));
  }
});

test("landscape catalogue art asks for a variant wide enough for the portrait frame", () => {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    }).outputText,
    {
      exports,
      URL,
      process: { env: {} },
      require: name =>
        name === "react/jsx-runtime"
          ? jsxRuntime
          : name === "react"
            ? React
            : {}
    }
  );
  const frame = { clientWidth: 190, clientHeight: 266 };
  const img = (naturalWidth, naturalHeight, sizes = "190px") => ({
    naturalWidth,
    naturalHeight,
    sizes,
    parentElement: frame
  });
  // 16:9 art in a 190x266 frame: cover scale 2.49, 473 px of width needed.
  const landscape = img(1280, 720);
  exports.fitCoverSizes(landscape);
  assert.equal(landscape.sizes, "473px");
  // Portrait art, details without sizes, and unloaded art are left alone.
  const portrait = img(2000, 3000);
  exports.fitCoverSizes(portrait);
  assert.equal(portrait.sizes, "190px");
  const detail = img(1280, 720, "");
  exports.fitCoverSizes(detail);
  assert.equal(detail.sizes, "");
  const unloaded = img(0, 0);
  exports.fitCoverSizes(unloaded);
  assert.equal(unloaded.sizes, "190px");
  // The large variants exist in every catalogue grid srcset.
  const grid = renderToStaticMarkup(
    React.createElement(load(), {
      name: "Card",
      category: "Test",
      rarity: "C",
      image: catalogue,
      animated: false,
      imageSizes: "190px"
    })
  );
  for (const width of [1080, 1920])
    assert.ok(grid.includes(`w=${width}&amp;q=85 ${width}w`));
});
