import { licenseName } from "./helpers/license-name.mjs";
import { intl, gameMessages } from "./helpers/i18n.mjs";
import { cardRarityLabels } from "./helpers/card-rarity-labels.mjs";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(read(file), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      URL,
      URLSearchParams,
      ...globals,
      require: name =>
        name === "@/lib/ui/license-name"
          ? licenseName
          : name === "@/i18n/game-messages"
            ? gameMessages
            : name === "next-intl"
              ? intl
              : name === "@/lib/ui/card-rarity-label"
                ? cardRarityLabels
                : name in mocks
                  ? mocks[name]
                  : name.endsWith(".css")
                    ? {}
                    : require(name)
    }
  );
  return exports;
}
const { createLocalLrPack } = load("lib/ui/local-lr-packs.ts");

function descendants(element) {
  if (!element || typeof element !== "object") return [];
  return [
    element,
    ...React.Children.toArray(element.props?.children).flatMap(descendants)
  ];
}

test("every demo pack has five cards and exactly one LR, always at the end", () => {
  const instances = new Set();
  for (const kind of ["regular", "decision"]) {
    for (let sequence = 0; sequence < 12; sequence++) {
      const cards = createLocalLrPack(kind, sequence);
      assert.equal(cards.length, 5);
      assert.equal(cards.filter(card => card.rarity === "LR").length, 1);
      assert.equal(cards[4].rarity, "LR");
      assert.equal(
        cards[4].name,
        ["Madara Uchiha", "Omni-Man", "Shadow the Hedgehog"][sequence % 3]
      );
      for (const card of cards) {
        assert.ok(!instances.has(card.instanceId));
        instances.add(card.instanceId);
        assert.match(card.id, /^local-demo-/);
        assert.equal(card.shiny, false);
        assert.match(card.image, /^\/assets\//);
        assert.ok(
          existsSync(new URL(`../public${card.image}`, import.meta.url))
        );
        if (kind === "decision")
          assert.ok(["SR", "SSR", "LR"].includes(card.rarity));
      }
    }
  }
  const cards = createLocalLrPack("regular", 0);
  cards[0].name = "Changed";
  assert.equal(createLocalLrPack("regular", 0)[0].name, "Monkey D. Luffy");
  for (const sequence of [-1, Infinity, NaN, 1.5]) {
    assert.throws(() => createLocalLrPack("regular", sequence));
  }
  assert.throws(() => createLocalLrPack("real-pack", 0));
});

function stateHooks() {
  const states = [];
  let index = 0;
  return {
    states,
    reset: () => {
      index = 0;
    },
    react: {
      ...React,
      useState: initial => {
        const position = index++;
        if (!(position in states))
          states[position] =
            typeof initial === "function" ? initial() : initial;
        return [
          states[position],
          next => {
            states[position] =
              typeof next === "function" ? next(states[position]) : next;
          }
        ];
      },
      useEffect: () => {},
      useCallback: fn => fn,
      useSyncExternalStore: (_subscribe, _snapshot, serverSnapshot) =>
        serverSnapshot(),
      useRef: value => ({ current: value })
    }
  };
}

test("the pack playground cycles indefinitely and progress ignores repeated callbacks", async () => {
  const hooks = stateHooks();
  const { LocalLrPacksPreview } = load(
    "components/local-lr-packs-preview.tsx",
    {
      react: hooks.react,
      "@/components/boosters": { Boosters: "Boosters" },
      "@/lib/ui/local-lr-packs": { createLocalLrPack },
      "@/hooks/use-sfx": {
        useSfx: () => ({ enabled: true, play: () => {}, toggle: () => {} })
      }
    },
    {
      process: { env: { NODE_ENV: "development" } },
      fetch: () => assert.fail("Demo packs must never access pack APIs")
    }
  );
  const render = () => {
    hooks.reset();
    return descendants(LocalLrPacksPreview()).find(
      node => node.type === "Boosters"
    ).props;
  };
  for (let i = 0; i < 8; i++) {
    const kind = i % 2 ? "decision" : "regular";
    const before = render();
    assert.equal(before.previewOnly, true);
    assert.equal(before.status.available, 10);
    assert.equal(before.decisionStatus.available, true);
    const cards = await before.onOpen(kind);
    const opened = render();
    assert.equal(opened.draw, cards);
    assert.equal(opened.drawKind, kind);
    assert.equal(opened.revealed, 0);
    assert.equal(cards[4].rarity, "LR");
    for (let slot = 0; slot < 5; slot++) {
      opened.onReveal(slot);
      opened.onReveal(slot);
    }
    assert.equal(render().revealed, 5);
    assert.equal(await opened.onKeepDecision(cards[4].instanceId), 0);
    assert.equal(hooks.states[3], i + 1);
  }
  for (const file of [
    "lib/ui/local-lr-packs.ts",
    "components/local-lr-packs-preview.tsx"
  ]) {
    assert.doesNotMatch(
      read(file),
      /createClient|\.rpc\(|fetch\(|getUser|localStorage/
    );
  }
});

function boostersMocks(react) {
  return {
    react,
    "next/dynamic": { default: () => "LazyPreview" },
    "next/link": { default: "Link" },
    "@/components/ambient-glow": { AmbientGlow: "AmbientGlow" },
    "@/components/gta-sunset-event": {
      useGtaSunsetEvent: () => ({ event: null })
    },
    "@/components/referral-reminder": { ReferralReminder: "ReferralReminder" },
    "@/lib/ui/pack-opening": { packCopyLabels: cards => cards },
    "@/components/card-sharing": { CardShareButton: "CardShareButton" },
    "@/components/ui": {
      Button: "Button",
      Modal: "Modal",
      StatusPill: "StatusPill",
      SelectionModeButton: "SelectionModeButton"
    },
    "@/components/yokai-card": { CardBack: "CardBack", YokaiCard: "YokaiCard" },
    "@/lib/ui/animations": {}
  };
}

test("demo summaries disable real sharing/selection without changing production actions", () => {
  for (const environment of ["development", "production"]) {
    const hooks = stateHooks();
    const { BoosterReveal } = load(
      "components/boosters.tsx",
      boostersMocks(hooks.react),
      {
        process: { env: { NODE_ENV: environment } }
      }
    );
    const tree = descendants(
      BoosterReveal({
        previewOnly: true,
        cards: createLocalLrPack("regular", 0),
        revealed: 5,
        onReveal: () => {},
        onReturn: () => {},
        onComplete: () => {}
      })
    );
    assert.equal(
      tree.some(node => node.type === "CardShareButton"),
      environment === "production"
    );
    assert.equal(
      tree.some(node => node.type === "SelectionModeButton"),
      environment === "production"
    );
  }
});

test("demo BoosterReveal returns to packs and never receives a destruction handler", () => {
  const hooks = stateHooks();
  hooks.states.push("idle", "regular", false, true);
  const { Boosters } = load(
    "components/boosters.tsx",
    boostersMocks(hooks.react),
    {
      process: { env: { NODE_ENV: "development" } }
    }
  );
  const tree = descendants(
    Boosters({
      previewOnly: true,
      status: { available: 10, maximum: 10, nextPackAt: null },
      draw: createLocalLrPack("regular", 0),
      drawKind: "regular",
      revealed: 5,
      collection: [],
      busy: false,
      onDiscard: () => assert.fail("Real destruction must not be exposed")
    })
  );
  const reveal = tree.find(
    node =>
      typeof node.type === "function" && node.type.name === "BoosterReveal"
  );
  assert.ok(reveal);
  assert.equal(reveal.props.previewOnly, true);
  assert.equal(reveal.props.onDiscard, undefined);
  reveal.props.onComplete();
  assert.equal(hooks.states[3], false);
  assert.ok(!tree.some(node => node.type === "ReferralReminder"));
});

test("LR packs route actual card fields to the native reveal without a sandbox request", () => {
  const { CardCinematic } = load("components/card-cinematic.tsx", {
    "@/components/lr-card-reveal": { LrCardReveal: "LR" }
  });
  const card = createLocalLrPack("regular", 0)[4];
  const reveal = CardCinematic({ card });
  assert.equal(reveal.type, "LR");
  assert.equal(reveal.props.card, card);
});

test("cinematic preview Next advances to the next demo card and keeps the selected variant", () => {
  const hooks = stateHooks();
  const { CardCinematicsPreview } = load(
    "components/card-cinematics-preview.tsx",
    {
      react: hooks.react,
      "@/components/card-cinematic": { CardCinematic: "Cinematic" },
      "@/lib/ui/local-lr-packs": { createLocalLrPack }
    }
  );
  const render = () => {
    hooks.reset();
    return descendants(CardCinematicsPreview());
  };
  const nodes = render();
  nodes
    .find(
      node =>
        node.type === "button" &&
        React.Children.toArray(node.props.children).join("") ===
          "LR Shiny cinematic"
    )
    .props.onClick();
  const first = render().find(node => node.type === "Cinematic");
  assert.equal(typeof first.props.onContinue, "function");
  first.props.onContinue();
  const next = render().find(node => node.type === "Cinematic");
  assert.notEqual(next.key, first.key);
  assert.notEqual(next.props.card.image, first.props.card.image);
  assert.equal(next.props.card.rarity, "LR");
  assert.equal(next.props.card.shiny, true);
});

test("the packs page and its client playground are development-only", () => {
  const page = load(
    "app/design-system/lr-packs/page.tsx",
    {
      "next/link": { default: "Link" },
      "next/navigation": {
        notFound: () => {
          throw new Error("NOT_FOUND");
        }
      },
      "@/components/local-lr-packs-preview": { LocalLrPacksPreview: "Preview" }
    },
    { process: { env: { NODE_ENV: "production" } } }
  );
  assert.throws(() => page.default(), /NOT_FOUND/);
  assert.equal(page.metadata.robots.index, false);
  const hooks = stateHooks();
  const { LocalLrPacksPreview } = load(
    "components/local-lr-packs-preview.tsx",
    {
      react: hooks.react,
      "@/components/boosters": {},
      "@/lib/ui/local-lr-packs": { createLocalLrPack },
      "@/hooks/use-sfx": { useSfx: () => ({}) }
    },
    { process: { env: { NODE_ENV: "production" } } }
  );
  assert.equal(LocalLrPacksPreview(), null);
  assert.match(
    read("app/design-system/lr-cinematic/page.tsx"),
    /href="\/design-system\/lr-packs"/
  );
});

test("local pack management simulates normal actions without APIs and respects locks and listings", async () => {
  const hooks = stateHooks();
  const { LocalLrPacksPreview } = load(
    "components/local-lr-packs-preview.tsx",
    {
      react: hooks.react,
      "@/components/boosters": { Boosters: "Boosters" },
      "@/lib/ui/local-lr-packs": { createLocalLrPack },
      "@/hooks/use-sfx": {
        useSfx: () => ({ enabled: false, play() {}, toggle() {} })
      }
    },
    {
      process: { env: { NODE_ENV: "development" } },
      fetch: () => assert.fail("demo actions must never use an API")
    }
  );
  const render = () => {
    hooks.reset();
    return descendants(LocalLrPacksPreview()).find(
      node => node.type === "Boosters"
    ).props;
  };
  const cards = await render().onOpenMany(5);
  assert.equal(render().simulateActions, true);
  assert.equal(render().collection.length, 25);
  assert.ok(
    cards.every(
      card =>
        card.obtainedAt && card.catalogueImage && card.destructionValue > 0
    )
  );
  const id = cards[0].instanceId;
  await render().onSetLocked(id, true);
  assert.equal(render().draw[0].locked, true);
  await assert.rejects(render().onDiscard(id));
  await render().onSetLocked(id, false);
  await render().onMoveCard(id, "demo-favorites");
  assert.equal(
    render().collection.find(card => card.instanceId === id).folderId,
    "demo-favorites"
  );
  await render().onSetCustomImage(id, cards[1].image);
  assert.equal(render().draw[0].image, cards[1].image);
  await render().onDiscard(id);
  assert.equal(render().collection.length, 24);
  assert.equal(render().draw[0].discarded, true);
  await assert.rejects(render().onDiscard(id));
  const listedId = cards[1].instanceId;
  await render().onAuction(listedId, 10, 60);
  await assert.rejects(render().onDiscard(listedId));
  await assert.rejects(render().onSetLocked(listedId, true));
  const copies = render().collection.filter(card => card.rarity === "SSR");
  const evolved = await render().onEvolve(copies.map(card => card.instanceId));
  assert.equal(evolved.shiny, true);
  assert.equal(evolved.isEvolved, true);
  assert.equal(
    render().collection.filter(card => card.rarity === "SSR").length,
    1
  );
});
