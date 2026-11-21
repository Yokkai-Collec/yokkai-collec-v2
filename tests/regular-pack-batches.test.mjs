import { licenseName } from "./helpers/license-name.mjs";
import { intl, gameMessages } from "./helpers/i18n.mjs";
import { cardRarityLabels } from "./helpers/card-rarity-labels.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
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
      AbortController,
      ...globals,
      require: name =>
        name === "@/lib/ui/license-name"
          ? licenseName
          : name === "next-intl"
            ? intl
            : name === "@/i18n/game-messages"
              ? gameMessages
              : name === "@/lib/ui/card-rarity-label"
                ? cardRarityLabels
                : name in mocks
                  ? mocks[name]
                  : require(name)
    }
  );
  return exports;
}
function descendants(element) {
  if (!element || typeof element !== "object") return [];
  return [
    element,
    ...React.Children.toArray(element.props?.children).flatMap(descendants)
  ];
}
function hooks() {
  const states = [],
    refs = [];
  let index = 0,
    refIndex = 0;
  return {
    reset() {
      index = 0;
      refIndex = 0;
    },
    react: {
      ...React,
      useState(initial) {
        const position = index++;
        if (!(position in states))
          states[position] =
            typeof initial === "function" ? initial() : initial;
        return [
          states[position],
          value => {
            states[position] =
              typeof value === "function" ? value(states[position]) : value;
          }
        ];
      },
      useRef(initial) {
        return (refs[refIndex++] ??= { current: initial });
      },
      useEffect() {},
      useCallback: fn => fn,
      useSyncExternalStore: (_subscribe, _snapshot, serverSnapshot) =>
        serverSnapshot()
    }
  };
}

test("batch client submits one bounded reward RPC, sorts all cards, invalidates snapshots and never retries", async () => {
  for (const count of [1, 5, 10]) {
    const calls = [],
      invalidations = [];
    let user = "alice",
      error;
    const client = {
      auth: {
        getSession: async () => ({
          data: { session: user ? { user: { id: user } } : null }
        }),
        onAuthStateChange() {}
      },
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (error) return { error };
        if (name === "get_pack_destruction_values")
          return {
            data: Object.fromEntries(args.p_instance_ids.map(id => [id, 1]))
          };
        assert.equal(
          name,
          count === 1 ? "open_regular_pack" : "open_regular_packs"
        );
        assert.equal(args?.p_count, count === 1 ? undefined : count);
        return {
          data: Array.from({ length: count * 5 }, (_, i) => ({
            id: `card-${i}`,
            instanceId: `copy-${i}`,
            rarity: i % 2 ? "C" : "LR",
            image: "/card.png",
            liveFranchise: true,
            anime: "Batch"
          }))
        };
      }
    };
    const { openBoosters } = load("lib/data/cards.ts", {
      "@/utils/supabase/client": { createClient: () => client },
      "@/lib/ui/card-search": {},
      "@/lib/data/read-request": {},
      "@/lib/data/player-state": {
        createPlayerSnapshotCache: () => ({ deleteScope() {}, clear() {} }),
        PLAYER_SNAPSHOT_TTL: {},
        subscribePlayerSnapshotInvalidation() {},
        publishPlayerSnapshotInvalidation: scopes =>
          invalidations.push(Array.from(scopes))
      }
    });
    const cards = await openBoosters(count);
    assert.equal(cards.length, count * 5);
    assert.equal(new Set(cards.map(card => card.instanceId)).size, count * 5);
    assert.equal(cards[0].rarity, "C");
    assert.equal(cards.at(-1).rarity, "LR");
    assert.ok(
      cards.every(card => card.destructionValue === 1 && card.anime === "Batch")
    );
    assert.equal(
      calls.filter(call => /open_regular_pack/.test(call.name)).length,
      1
    );
    assert.deepEqual(invalidations, [["collection"]]);
    const before = calls.length;
    for (const invalid of [0, 2, -1, 11, 1.5, "5", null])
      await assert.rejects(openBoosters(invalid), /Choose 1, 5, or 10/);
    assert.equal(calls.length, before);
    error = { message: "INSUFFICIENT_PACKS" };
    await assert.rejects(openBoosters(count), /Choose a smaller quantity/);
    error = { message: "private SQL internals" };
    await assert.rejects(openBoosters(count), /Couldn't reach game data/);
    assert.equal(
      calls.filter(call => /open_regular_pack/.test(call.name)).length,
      3,
      "each explicit attempt is one request; no retry loop"
    );
    user = null;
    await assert.rejects(openBoosters(count), /Sign in/);
    assert.equal(
      calls.filter(call => /open_regular_pack/.test(call.name)).length,
      3
    );
  }
});

function boostersHarness(available = 10) {
  const state = hooks();
  const pack = load("lib/ui/pack-opening.ts", { "@/lib/ui/animations": {} });
  const { animation } = load("lib/ui/animations.ts");
  const { Boosters } = load(
    "components/boosters.tsx",
    {
      react: state.react,
      "next/dynamic": { default: () => "Dynamic" },
      "next/link": { default: "Link" },
      "@/components/referral-reminder": { ReferralReminder: "Reminder" },
      "@/components/ambient-glow": { AmbientGlow: "AmbientGlow" },
      "@/components/gta-sunset-event": {
        useGtaSunsetEvent: () => ({ event: null })
      },
      "@/components/card-sharing": {},
      "@/lib/ui/pack-opening": pack,
      "@/lib/ui/animations": { animation },
      "@/components/ui": {
        Button: "Button",
        Modal: "Modal",
        StatusPill: "StatusPill"
      },
      "@/components/yokai-card": {
        CardBack: "CardBack",
        YokaiCard: "YokaiCard"
      }
    },
    {
      process: { env: { NODE_ENV: "production" } },
      window: {
        matchMedia: () => ({ matches: false }),
        setTimeout: () => 1,
        clearTimeout() {}
      },
      clearTimeout() {},
      Image: class {
        decode() {
          return Promise.resolve();
        }
      }
    }
  );
  const props = {
    releasedOpening: true,
    clickToOpen: true,
    busy: false,
    status: { available, reserve: Math.min(available, 10), maximum: 10 },
    countdown: "00:00",
    decisionStatus: { available: true, pending: [], maximum: 2, remaining: 2 },
    decisionCountdown: "00:00",
    collection: [],
    draw: [],
    drawKind: "regular",
    revealed: 0,
    onOpen: async () => [],
    onOpenMany: async () => [],
    onKeepDecision: async () => 0,
    onDiscard: async () => {},
    onReveal() {}
  };
  const render = () => {
    state.reset();
    return descendants(Boosters(props));
  };
  return { props, render };
}

test("quantity choices follow the server reserve and safely fall back when availability changes", () => {
  for (const available of [0, 1, 4, 5, 9, 10, 15]) {
    const { props, render } = boostersHarness(available);
    for (const count of [1, 5, 10]) {
      const choice = render().find(
        node =>
          node.type === "button" &&
          node.props["aria-label"] ===
            `Open ${count} ${count === 1 ? "Regular Pack" : "Regular Packs"}`
      );
      assert.ok(choice);
      assert.equal(choice.props.disabled, available < count);
    }
    if (available >= 10) {
      render()
        .find(node => node.props?.["aria-label"] === "Open 10 Regular Packs")
        .props.onClick();
      assert.ok(
        render().find(
          node => node.type === "Button" && node.props.children === "Open ×10"
        )
      );
      props.status.available = 3;
      assert.ok(
        render().find(
          node => node.type === "Button" && node.props.children === "Open"
        )
      );
      assert.equal(
        render().find(
          node => node.props?.["aria-label"] === "Open 1 Regular Pack"
        ).props["aria-pressed"],
        true
      );
    }
    props.busy = true;
    assert.ok(
      render()
        .filter(
          node =>
            node.type === "button" && node.props["aria-pressed"] !== undefined
        )
        .every(node => node.props.disabled)
    );
  }
});

test("a batch is requested once, stays closed until clicked and forwards all 25/50 cards to the existing reveal", async () => {
  for (const count of [5, 10]) {
    const { props, render } = boostersHarness();
    let respond,
      batchCalls = 0;
    props.onOpen = () => assert.fail("must not loop over single packs");
    props.onOpenMany = quantity => {
      assert.equal(quantity, count);
      batchCalls++;
      return new Promise(resolve => {
        respond = resolve;
      });
    };
    render()
      .find(
        node => node.props?.["aria-label"] === `Open ${count} Regular Packs`
      )
      .props.onClick();
    const open = render().find(
      node => node.type === "Button" && node.props.children === `Open ×${count}`
    );
    open.props.onClick({ currentTarget: {} });
    open.props.onClick({ currentTarget: {} });
    assert.equal(batchCalls, 1);
    const cards = Array.from({ length: count * 5 }, (_, i) => ({
      id: `card-${i}`,
      instanceId: `copy-${i}`,
      image: "/card.png"
    }));
    props.draw = cards;
    respond(cards);
    await tick();
    const player = () =>
      render().find(node => node.type === "Dynamic" && node.props.onTear);
    assert.equal(player().props.openRequested, false);
    render()
      .find(node => node.props?.["aria-label"] === "Tear open the pack")
      .props.onClick();
    assert.equal(player().props.openRequested, true);
    player().props.onComplete();
    await tick();
    const reveal = render().find(node => node.type?.name === "BoosterReveal");
    assert.ok(reveal);
    assert.equal(reveal.props.cards.length, count * 5);
    assert.equal(reveal.props.packCount, count);
    assert.equal(reveal.props.releasedCinematics, undefined);
    assert.ok(
      read("components/boosters.tsx").includes(
        "<CardCinematic key={spot.instanceId} card={spot}"
      )
    );
    assert.equal(batchCalls, 1);
  }
});

test("the safe local playground supports real-sized batches without APIs and produces unique copies per pack", async () => {
  const state = hooks();
  const { createLocalLrPack } = load("lib/ui/local-lr-packs.ts");
  const { LocalLrPacksPreview } = load(
    "components/local-lr-packs-preview.tsx",
    {
      react: state.react,
      "@/components/boosters": { Boosters: "Boosters" },
      "@/lib/ui/local-lr-packs": { createLocalLrPack },
      "@/hooks/use-sfx": {
        useSfx: () => ({ enabled: false, play() {}, toggle() {} })
      }
    },
    {
      process: { env: { NODE_ENV: "development" } },
      fetch: () => assert.fail("no production reward writes")
    }
  );
  const render = () => {
    state.reset();
    return descendants(LocalLrPacksPreview()).find(
      node => node.type === "Boosters"
    ).props;
  };
  const allIds = new Set();
  for (const count of [5, 10]) {
    const cards = await render().onOpenMany(count);
    assert.equal(cards.length, count * 5);
    assert.equal(render().draw, cards);
    assert.equal(render().drawKind, "regular");
    assert.equal(render().revealed, 0);
    cards.forEach((card, index) => {
      assert.equal(allIds.has(card.instanceId), false);
      allIds.add(card.instanceId);
      if (index % 5 === 4) assert.equal(card.rarity, "LR");
    });
  }
});

test("batch layout keeps both Open controls aligned and progress bounded on small screens", () => {
  const css = read("styles/boosters.css").replace(/\s+/g, " ");
  assert.match(
    css,
    /@media \(min-width: 701px\)[\s\S]*?\.yk-pack-grid:has\(\.yk-pack-batch-picker\) \.yk-pack-panel \.yk-pack-body\s*\{\s*flex: 1;/
  );
  assert.match(
    css,
    /\.yk-pack-grid:has\(\.yk-pack-batch-picker\) \.yk-pack-panel \.yk-pack-body > \.yk-button\s*\{\s*margin-top: auto;/
  );
  assert.match(
    css,
    /\.yk-reveal-progress\.yk-reveal-progress-batch\s*\{[^}]*max-width: 100%;[^}]*flex-wrap: wrap;/
  );
  assert.doesNotMatch(css, /\.yk-pack-grid:has\(\.yk-pack-batch-picker\)[^{]*\.yk-pack-art-stage\s*\{/);
  assert.match(
    read("components/game.tsx").replace(/\s+/g, " "),
    /onOpenMany=\{\s*previewData \? undefined : count => open\("regular", count\)\s*\}/
  );
});
