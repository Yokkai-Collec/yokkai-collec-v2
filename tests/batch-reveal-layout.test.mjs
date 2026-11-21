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
                  : require(name)
    }
  );
  return exports;
}
const pack = load("lib/ui/pack-opening.ts", { "@/lib/ui/animations": {} });
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
      useCallback: fn => fn
    }
  };
}
function revealHarness(count = 10, environment = "development") {
  const state = hooks();
  const motion = { matches: true };
  const { BoosterReveal } = load(
    "components/boosters.tsx",
    {
      react: state.react,
      "next/dynamic": { default: () => "Dynamic" },
      "next/link": { default: "Link" },
      "@/lib/ui/pack-opening": pack,
      "@/lib/ui/animations": {},
      "@/components/referral-reminder": { ReferralReminder: "Reminder" },
      "@/components/ambient-glow": { AmbientGlow: "AmbientGlow" },
      "@/components/gta-sunset-event": {
        useGtaSunsetEvent: () => ({ event: null })
      },
      "@/components/card-sharing": { CardShareButton: "CardShareButton" },
      "@/components/ui": {
        Button: "Button",
        Modal: "Modal",
        SelectionBar: "SelectionBar",
        SelectionModeButton: "SelectionModeButton",
        StatusPill: "StatusPill"
      },
      "@/components/yokai-card": {
        CardBack: "CardBack",
        YokaiCard: "YokaiCard"
      }
    },
    {
      process: { env: { NODE_ENV: environment } },
      window: { matchMedia: () => motion }
    }
  );
  const props = {
    previewOnly: true,
    finalCinematics: true,
    releasedCinematics: true,
    packCount: count,
    cards: Array.from({ length: count * 5 }, (_, i) => ({
      id: `card-${i}`,
      instanceId: `copy-${i}`,
      name: `Card ${i}`,
      image: "/card.png",
      rarity: i % 5 === 4 ? "LR" : i % 5 === 3 ? "SSR" : "C",
      isNew: true
    })),
    revealed: 0,
    onReveal() {},
    onReturn() {},
    onComplete() {}
  };
  const render = () => {
    state.reset();
    return descendants(BoosterReveal(props));
  };
  const slots = tree =>
    React.Children.toArray(
      tree.find(
        node =>
          node.type === "ol" &&
          node.props.className.startsWith("yk-reveal-grid")
      ).props.children
    );
  return { props, render, slots, motion };
}

test("five-card windows cover every reward, clamp page requests and never expose an unrevealed future group", () => {
  for (const total of [25, 50]) {
    const covered = new Set();
    for (let revealed = 0; revealed <= total; revealed++) {
      const window = pack.packRevealWindow(total, revealed);
      assert.equal(window.end - window.start, 5);
      assert.equal(window.pages, total / 5);
      assert.equal(
        window.page,
        Math.min(total / 5 - 1, Math.floor(revealed / 5))
      );
      assert.equal(
        pack.packRevealWindow(total, revealed, 100).page,
        window.latest
      );
      assert.equal(pack.packRevealWindow(total, revealed, -1).page, 0);
      assert.equal(
        pack.packRevealWindow(total, revealed, NaN).page,
        window.page
      );
      for (let index = window.start; index < window.end; index++)
        covered.add(index);
    }
    assert.equal(covered.size, total);
  }
});

test("batch reveals mount only five result slots and a compact accessible progress meter", () => {
  for (const count of [5, 10]) {
    const { props, render, slots } = revealHarness(count);
    for (const revealed of [0, 4, 5, 6, count * 5 - 1]) {
      props.revealed = revealed;
      const tree = render();
      const group = slots(tree);
      assert.equal(group.length, 5);
      assert.deepEqual(
        group.map(node => node.props.style["--slot-i"]),
        [0, 1, 2, 3, 4]
      );
      const window = pack.packRevealWindow(props.cards.length, revealed);
      group.forEach((node, index) =>
        assert.equal(
          node.props.className.includes("yk-filled"),
          window.start + index < revealed
        )
      );
      const progress = tree.find(node => node.props?.role === "progressbar");
      assert.equal(progress.props["aria-valuenow"], revealed);
      assert.equal(progress.props["aria-valuemax"], count * 5);
      assert.equal(progress.props["aria-label"], "Cards revealed");
      assert.equal(
        tree.some(
          node =>
            node.type === "ol" &&
            node.props.className.startsWith("yk-reveal-progress")
        ),
        false
      );
      assert.equal(
        tree.find(node => node.props?.["aria-label"] === "Next five cards")
          .props.disabled,
        true
      );
    }
  }
});

test("previous groups remain reviewable and the next reveal follows the live group without altering reward indices", () => {
  const { props, render, slots } = revealHarness();
  props.revealed = 5;
  render()
    .find(node => node.props?.["aria-label"] === "Previous five cards")
    .props.onClick();
  let tree = render();
  assert.ok(
    tree.some(
      node =>
        React.Children.toArray(node.props?.children).join("") === "Cards 1–5"
    )
  );
  assert.ok(
    slots(tree).every(node => node.props.className.includes("yk-filled"))
  );
  assert.equal(
    tree.find(node => node.props?.["aria-label"] === "Next five cards").props
      .disabled,
    false
  );
  props.revealed = 6;
  tree = render();
  assert.ok(
    tree.some(
      node =>
        React.Children.toArray(node.props?.children).join("") === "Cards 6–10"
    )
  );
  assert.equal(
    slots(tree).filter(node => node.props.className.includes("yk-filled"))
      .length,
    1
  );
  const currentSlot = slots(tree).find(node =>
    node.props.className.includes("yk-slot-next")
  );
  assert.ok(currentSlot);
  assert.ok(
    descendants(currentSlot).some(node => node.props?.children === "07")
  );
});

test("completed batches end on the full overview without pagination or duplicate replay controls", () => {
  for (const count of [5, 10]) {
    const { props, render, slots } = revealHarness(count);
    props.revealed = count * 5;
    const tree = render();
    assert.equal(slots(tree).length, count * 5);
    assert.deepEqual(
      tree
        .filter(node => node.type === "YokaiCard")
        .map(node => node.props.instanceId)
        .sort(),
      props.cards.map(card => card.instanceId).sort()
    );
    const replayButtons = tree.filter(
      node =>
        node.type === "Button" &&
        React.Children.toArray(node.props.children)
          .join("")
          .startsWith("Replay cinematic:")
    );
    assert.equal(replayButtons.length, 0);
    assert.equal(
      tree.some(node => node.props?.["aria-label"] === "Previous five cards"),
      false
    );
  }
});

test("single packs and Decision choices keep their original five-card layout", () => {
  const { props, render, slots } = revealHarness(1);
  for (const decision of [undefined, { onKeep: async () => 0 }]) {
    props.decision = decision;
    const tree = render();
    assert.equal(slots(tree).length, 5);
    assert.equal(
      tree.some(node => node.props?.["aria-label"] === "Batch card groups"),
      false
    );
    assert.equal(
      tree.some(node => node.props?.role === "progressbar"),
      false
    );
    assert.ok(
      tree.find(
        node =>
          node.type === "ol" &&
          node.props.className.startsWith("yk-reveal-progress")
      )
    );
  }
});

test("discarded copies do not shift global reveal indices inside a group", () => {
  const { props, render, slots } = revealHarness();
  props.cards[5].discarded = true;
  props.revealed = 6;
  const group = slots(render());
  assert.equal(group.length, 4);
  assert.equal(
    group.filter(node => node.props.className.includes("yk-filled")).length,
    0
  );
  const current = group.find(node =>
    node.props.className.includes("yk-slot-next")
  );
  assert.ok(current);
  assert.ok(descendants(current).some(node => node.props?.children === "07"));
  assert.deepEqual(
    group.map(node => node.props.style["--slot-i"]),
    [1, 2, 3, 4]
  );
});

test("batch styles cap the visible stack, override its unbounded inline fan, and adapt the results to desktop/mobile", () => {
  const css = read("styles/boosters.css").replace(/\s+/g, " ");
  assert.match(css, /\.yk-reveal-batch \.yk-stacked-back \{ display: none; \}/);
  assert.match(
    css,
    /\.yk-reveal-batch \.yk-stacked-back:nth-child\(-n \+ 3\) \{ display: block; transform: translate\(6px, -6px\) rotate\(1deg\) !important; filter: brightness\(0\.9\) !important;/
  );
  assert.match(
    css,
    /\.yk-reveal-batch \.yk-stacked-back:first-child \{ transform: translate\(18px, -18px\) rotate\(3deg\) !important;/
  );
  assert.match(css, /\.yk-reveal-screen\.yk-reveal-batch \{ display: grid;/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(
    css,
    /\.yk-reveal-batch\.yk-reveal-complete > \.yk-reveal-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/
  );
  assert.doesNotMatch(css, /\.yk-reveal-batch[^}]*overflow:\s*hidden/);
});

test("batch fullscreen keeps its controls scrollable on short/mobile screens while retaining the pack background", () => {
  const css = read("styles/boosters.css").replace(/\s+/g, " ");
  assert.match(
    css,
    /\.yk-reveal-screen\.yk-reveal-batch\[data-reveal-state="revealing"\] \{ overflow-y: auto;/
  );
  assert.match(
    css,
    /grid-template-rows: auto auto auto auto; align-content: start;/
  );
  assert.match(css, /\.yk-batch-pagination button \{ min-height: 44px;/);
  const section = revealHarness()
    .render()
    .find(node => node.type === "section");
  assert.equal(section.props["data-pack-kind"], "regular");
  assert.equal(section.props["data-reveal-state"], "revealing");
  assert.ok(section.props.className.includes("yk-reveal-batch"));
});

test("Reveal all exposes common cards immediately, plays rare cinematics sequentially, and ends with every awarded copy once and no pagination", () => {
  for (const count of [5, 10])
    for (const alreadyRevealed of [0, 3, 5, count * 5 - 1]) {
      const { props, render, slots, motion } = revealHarness(count);
      motion.matches = false;
      props.cards.forEach((card, index) => {
        if (index % 5 < 3) card.rarity = ["C", "R", "SR"][index % 5];
      });
      const indices = [],
        sounds = [];
      props.revealed = alreadyRevealed;
      props.onSound = name => sounds.push(name);
      props.onReveal = index => {
        indices.push(index);
        if (props.revealed === index) props.revealed++;
      };
      const shortcut = render().find(
        node => node.type === "button" && node.props.children === "Reveal all"
      );
      assert.ok(shortcut);
      shortcut.props.onClick();
      shortcut.props.onClick();
      let sequenceTree = render();
      const pending = props.cards.flatMap((card, index) =>
        index >= alreadyRevealed && ["SSR", "LR"].includes(card.rarity)
          ? [index]
          : []
      );
      assert.equal(
        slots(sequenceTree).filter(node =>
          node.props.className.includes("yk-filled")
        ).length,
        props.cards.length - pending.length
      );
      assert.equal(
        sequenceTree.find(node => node.props?.children === "Reveal all").props
          .disabled,
        true
      );
      for (const index of pending) {
        const players = sequenceTree.filter(node => node.type === "Dynamic");
        assert.equal(players.length, 1, "only one cinematic is mounted");
        assert.equal(
          players[0].props.card.instanceId,
          props.cards[index].instanceId,
          "rare cinematics follow draw order, excluding already revealed cards"
        );
        assert.equal(players[0].props.autoAdvance, false);
        assert.equal(
          sounds.at(-1),
          props.cards[index].rarity === "LR" ? "lr-reveal" : "ssr-reveal",
          "the queued cinematic starts with its new rarity reveal cue"
        );
        assert.equal(
          sounds.length,
          pending.indexOf(index) * 2 + 1,
          "no rarity sound before the unskippable reveal starts"
        );
        players[0].props.onRevealStart();
        assert.equal(sounds.at(-1), props.cards[index].rarity.toLowerCase());
        players[0].props.onContinue();
        sequenceTree = render();
      }
      const tree = render(),
        cards = slots(tree);
      assert.deepEqual(
        indices,
        Array.from(
          { length: count * 5 - alreadyRevealed },
          (_, i) => alreadyRevealed + i
        )
      );
      assert.deepEqual(
        sounds,
        pending.flatMap(index => [
          props.cards[index].rarity === "LR" ? "lr-reveal" : "ssr-reveal",
          props.cards[index].rarity.toLowerCase()
        ]),
        "each queued card plays one entry cue and one sound at the start of its unskippable reveal"
      );
      assert.equal(props.revealed, count * 5);
      assert.equal(cards.length, count * 5);
      assert.equal(new Set(cards.map(node => node.key)).size, count * 5);
      assert.ok(
        cards.every(node => node.props.className.includes("yk-filled"))
      );
      const artworks = tree.filter(node => node.type === "YokaiCard");
      assert.equal(artworks.length, count * 5);
      assert.ok(artworks.every(node => node.props.animated === false));
      assert.equal(cards[0].props["data-batch-rarity"], "LR");
      assert.equal(
        cards.filter(node => node.props["data-batch-rarity"] === "LR").length,
        count
      );
      assert.equal(
        cards.filter(node => node.props["data-batch-rarity"] === "SSR").length,
        count
      );
      assert.equal(
        tree.filter(node => node.props?.className === "yk-batch-rarity-label")
          .length,
        count * 2
      );
      assert.equal(
        tree.some(node => node.props?.["aria-label"] === "Batch card groups"),
        false
      );
      assert.equal(
        tree.some(node => node.props?.children === "Reveal all"),
        false
      );
      assert.equal(
        tree.some(node => node.type === "Dynamic"),
        false
      );
      assert.equal(
        tree.some(
          node =>
            node.type === "Button" &&
            String(node.props.children).startsWith("Replay cinematic:")
        ),
        false
      );
      assert.equal(
        tree.some(node => node.type === "Modal" && node.props.open),
        false
      );
    }
});

test("Reveal all is only available for batch Regular Packs, never single packs or Decision choices", () => {
  for (const count of [1, 5, 10])
    for (const decision of [undefined, { onKeep: async () => 0 }]) {
      const { props, render } = revealHarness(count);
      props.decision = decision;
      assert.equal(
        render().some(node => node.props?.children === "Reveal all"),
        count > 1 && !decision
      );
    }
});

test("instant batch overview keeps discarded copies out without losing or repeating other rewards", () => {
  const { props, render, slots } = revealHarness(10);
  props.cards[0].discarded = true;
  props.cards[7].discarded = true;
  props.onReveal = index => {
    if (index === props.revealed) props.revealed++;
  };
  render()
    .find(node => node.props?.children === "Reveal all")
    .props.onClick();
  const tree = render();
  assert.equal(slots(tree).length, 48);
  const ids = tree
    .filter(node => node.type === "YokaiCard")
    .map(node => node.props.instanceId);
  assert.equal(new Set(ids).size, 48);
  assert.equal(ids.includes("copy-0"), false);
  assert.equal(ids.includes("copy-7"), false);
});

test("Reveal all stays under the stack and the static full grid adapts from two to five columns", () => {
  const css = read("styles/boosters.css").replace(/\s+/g, " ");
  assert.match(
    css,
    /\.yk-reveal-batch > \.yk-reveal-all \{ grid-column: 1; grid-row: 3;/
  );
  assert.match(
    css,
    /\.yk-reveal-instant \*, \.yk-reveal-instant \*::before, \.yk-reveal-instant \*::after \{ animation: none !important; transition: none !important;/
  );
  for (const columns of [2, 3, 4, 5])
    assert.ok(
      css.includes(`grid-template-columns: repeat(${columns}, minmax(0, 1fr));`)
    );
  for (const rarity of ["LR", "SSR"])
    assert.match(
      css,
      new RegExp(
        `\\.yk-reveal-instant \\[data-batch-rarity="${rarity}"\\] \\{[^}]*box-shadow:`
      )
    );
});

test("mobile Reveal all reserves intrinsic rows so the deck hint cannot cover its touch target", () => {
  const css = read("styles/boosters.css").replace(/\s+/g, " ");
  assert.match(
    css,
    /@media \(max-width: 900px\) \{ \/\*[^*]*\*\/ \.yk-reveal-screen\.yk-reveal-batch\[data-reveal-state="revealing"\]:has\( > \.yk-reveal-all \) \{ grid-template-rows: max-content max-content max-content max-content max-content;/
  );
  const { render } = revealHarness(10);
  const button = render().find(node => node.props?.children === "Reveal all");
  assert.equal(button.type, "button");
  assert.equal(button.props.disabled, undefined);
  assert.equal(typeof button.props.onClick, "function");
});

test("complete batch results expose viewport sizing and allow mouse, keyboard and touch inspection without cinematics", () => {
  for (const count of [5, 10]) {
    const { props, render } = revealHarness(count);
    props.onReveal = index => {
      if (index === props.revealed) props.revealed++;
    };
    render()
      .find(node => node.props?.children === "Reveal all")
      .props.onClick();
    let tree = render();
    const screen = tree.find(
      node => node.props?.["aria-label"] === "Pack cards"
    );
    assert.equal(
      screen.props.style["--overview-columns-wide"],
      count === 10 ? 10 : 5
    );
    assert.equal(
      screen.props.style["--overview-rows-wide"],
      count === 10 ? 5 : 5
    );
    const card = tree.find(
      node =>
        node.type === "button" &&
        node.props?.["aria-label"]?.startsWith("Inspect ")
    );
    assert.ok(card);
    assert.equal(card.props.disabled, false);
    card.props.onClick();
    tree = render();
    const preview = tree.find(
      node =>
        node.type === "Modal" && node.props.className === "yk-batch-inspection"
    );
    assert.equal(preview.props.open, true);
    assert.ok(preview.props.title);
    assert.equal(
      descendants(preview).find(node => node.type === "YokaiCard").props
        .animated,
      false
    );
    assert.equal(
      tree.some(node => node.type === "Dynamic"),
      false,
      "inspection is not a cinematic"
    );
    preview.props.onClose();
    assert.equal(
      render().find(node => node.props?.className === "yk-batch-inspection")
        .props.open,
      false
    );
  }
});

test("production overview inspection retains the existing card-management surface and server callbacks", () => {
  const { props, render } = revealHarness(10, "production");
  props.onReveal = index => {
    if (index === props.revealed) props.revealed++;
  };
  props.onDiscard = () => assert.fail("inspection cannot discard a card");
  props.onAuction = () => assert.fail("inspection cannot create an auction");
  props.onSetLocked = () => assert.fail("inspection cannot change a lock");
  render()
    .find(node => node.props?.children === "Reveal all")
    .props.onClick();
  render()
    .find(
      node =>
        node.type === "button" &&
        node.props?.["aria-label"]?.startsWith("Inspect ")
    )
    .props.onClick();
  const detail = render().find(
    node => node.type === "Dynamic" && node.props.detailOnly
  );
  assert.ok(detail);
  assert.equal(
    detail.props.cards.length,
    1,
    "the inspected result is available before the collection refresh finishes"
  );
  assert.equal(detail.props.onDiscard, props.onDiscard);
  assert.equal(typeof detail.props.onCreateAuction, "function");
  assert.equal(typeof detail.props.onSetLocked, "function");
});

test("compact batch results use viewport-bounded tiles, preserve hover/focus and keep cramped screens scrollable", () => {
  const css = read("styles/boosters.css").replace(/\s+/g, " ");
  assert.match(css, /--overview-card-width: max\(\s*44px,\s*min\(\s*150px,/);
  assert.match(
    css,
    /grid-template-columns: repeat\(\s*var\(--overview-columns\),\s*var\(--overview-card-width\)\s*\);/
  );
  assert.match(css, /height: 100dvh;/);
  assert.match(
    css,
    /\.yk-reveal-instant \.yk-reveal-card:focus-visible \{[^}]*transform: translateY\(-3px\) scale\(1\.12\);/
  );
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(
    css,
    /\.yk-reveal-instant \.yk-reveal-card:hover \{[^}]*transform: translateY\(-3px\) scale\(1\.12\);/
  );
  assert.match(
    css,
    /align-content: safe center; justify-content: center;[^}]*overflow: auto;/
  );
});

test("interactive demo results reuse the normal details modal without running actions on inspection", () => {
  const { props, render, slots } = revealHarness(5);
  props.onAuction = () =>
    assert.fail("opening details cannot create an auction");
  props.onDiscard = () => assert.fail("opening details cannot destroy a card");
  props.onSetLocked = () => assert.fail("opening details cannot lock a card");
  props.revealed = props.cards.length;
  slots(render())[0].props.children[0].props.children[0].props.onClick();
  const detail = render().find(
    node => node.type === "Dynamic" && node.props.detailOnly
  );
  assert.ok(detail);
  assert.equal(detail.props.previewOnly, true);
  assert.equal(detail.props.onDiscard, props.onDiscard);
  detail.props.onCardsRemoved([detail.props.initialSelectedId]);
  assert.equal(
    render().find(node => node.type === "Dynamic" && node.props.detailOnly)
      .props.cards.length,
    0
  );
});

test("batch selection covers the whole lot, excludes locked/listed copies, and confirms Karas before destruction", async () => {
  const { props, render, slots } = revealHarness(5);
  props.cards.forEach(card => {
    card.destructionValue = 2;
  });
  props.cards[20].locked = true;
  props.revealed = props.cards.length;
  const destroyed = [];
  props.onDiscard = async id => {
    destroyed.push(id);
  };
  render()
    .find(node => node.type === "SelectionModeButton")
    .props.onClick();
  let bar = render().find(node => node.type === "SelectionBar");
  bar.props.onAll();
  bar = render().find(node => node.type === "SelectionBar");
  assert.equal(bar.props.count, 24);
  assert.equal(bar.props.value, 48);
  assert.equal(destroyed.length, 0);
  const slotOf = id =>
    slots(render()).find(slot =>
      descendants(slot).some(node => node.props?.instanceId === id)
    );
  const locked = descendants(slotOf(props.cards[20].instanceId)).find(
    node => node.type === "button"
  );
  assert.equal(locked.props.disabled, true);
  locked.props.onClick();
  assert.equal(
    render().find(node => node.type === "SelectionBar").props.count,
    24
  );
  bar.props.onNone();
  assert.equal(
    render().find(node => node.type === "SelectionBar").props.count,
    0
  );
  bar.props.onAll();
  render()
    .find(node => node.type === "SelectionBar")
    .props.onDestroy();
  const confirmation = render().find(
    node =>
      node.type === "Modal" && node.props.title === "Destroy selected cards?"
  );
  assert.equal(confirmation.props.open, true);
  const destroy = descendants(confirmation).find(
    node => node.type === "Button" && node.props.variant === "danger"
  );
  destroy.props.onClick();
  destroy.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(
    destroyed.length,
    24,
    "a repeated click cannot send the same batch twice"
  );
  assert.ok(!destroyed.includes(props.cards[20].instanceId));
  assert.equal(slots(render()).length, 1);
});

test("batch selection destroys every selected card with one atomic request", async () => {
  const { props, render, slots } = revealHarness(5);
  props.cards.forEach(card => {
    card.destructionValue = 2;
  });
  props.revealed = props.cards.length;
  const requests = [];
  props.onDiscard = () =>
    assert.fail("the single-card fallback must not run for a bulk request");
  props.onDiscardMany = async ids => {
    requests.push(ids);
  };
  render()
    .find(node => node.type === "SelectionModeButton")
    .props.onClick();
  render()
    .find(node => node.type === "SelectionBar")
    .props.onAll();
  render()
    .find(node => node.type === "SelectionBar")
    .props.onDestroy();
  const confirmation = render().find(
    node =>
      node.type === "Modal" && node.props.title === "Destroy selected cards?"
  );
  descendants(confirmation)
    .find(node => node.type === "Button" && node.props.variant === "danger")
    .props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.deepEqual(
    [...requests[0]],
    props.cards.map(card => card.instanceId)
  );
  assert.equal(slots(render()).length, 0);
});

test("the live boosters route connects its existing atomic collection discard", () => {
  const game = read("components/game.tsx");
  const boosters = read("components/boosters.tsx");
  assert.match(
    game,
    /<Boosters[^]*onDiscardMany=\{[^]*discardCollectionCards[^]*\}/
  );
  assert.match(
    boosters,
    /<BoosterReveal[^]*onDiscardMany=\{[^]*onDiscardMany[^]*\}/
  );
});

test("listed copies remain inspectable but cannot enter bulk selection", async () => {
  const { props, render, slots } = revealHarness(5);
  props.revealed = props.cards.length;
  const listed = [];
  props.onAuction = async id => listed.push(id);
  props.onDiscard = () => assert.fail("selection cannot destroy a card");
  descendants(slots(render())[0])
    .find(node => node.type === "button")
    .props.onClick();
  const detail = render().find(
    node => node.type === "Dynamic" && node.props.detailOnly
  );
  const id = detail.props.initialSelectedId;
  await detail.props.onCreateAuction(id, 10, 60);
  assert.deepEqual(listed, [id]);
  assert.ok(
    render().find(node => node.type === "Dynamic" && node.props.detailOnly)
      .props.presentation[id].frozen
  );
  detail.props.onDetailClose();
  assert.equal(
    descendants(slots(render())[0]).find(node => node.type === "button").props
      .disabled,
    false
  );
  render()
    .find(node => node.type === "SelectionModeButton")
    .props.onClick();
  const bar = render().find(node => node.type === "SelectionBar");
  bar.props.onAll();
  assert.equal(
    render().find(node => node.type === "SelectionBar").props.count,
    24
  );
  assert.equal(
    descendants(slots(render())[0]).find(node => node.type === "button").props
      .disabled,
    true
  );
});

test("result cards reflect the current collection artwork without changing reward indices", () => {
  const { props, render, slots } = revealHarness(5);
  props.revealed = props.cards.length;
  props.collection = [{ ...props.cards[20], image: "/updated-artwork.png" }];
  const tile = descendants(render()[0]).find(
    node =>
      node.type === "YokaiCard" &&
      node.props.instanceId === props.cards[20].instanceId
  );
  assert.equal(tile.props.image, "/updated-artwork.png");
  assert.equal(slots(render()).length, props.cards.length);
});

test("bulk errors retain unprocessed selections and never retry successful destruction", async () => {
  const { props, render } = revealHarness(5);
  props.revealed = props.cards.length;
  props.cards.forEach(card => {
    card.destructionValue = 1;
  });
  const called = [];
  props.onDiscard = async id => {
    called.push(id);
    if (called.length === 2) throw new Error("Card is locked");
  };
  render()
    .find(node => node.type === "SelectionModeButton")
    .props.onClick();
  render()
    .find(node => node.type === "SelectionBar")
    .props.onAll();
  render()
    .find(node => node.type === "SelectionBar")
    .props.onDestroy();
  const modal = render().find(
    node =>
      node.type === "Modal" && node.props.title === "Destroy selected cards?"
  );
  descendants(modal)
    .find(node => node.type === "Button" && node.props.variant === "danger")
    .props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const bar = render().find(node => node.type === "SelectionBar");
  assert.equal(bar.props.count, 24);
  // Errors thrown outside the VM use the safe generic message across realms.
  assert.equal(bar.props.error, "collectionUi.couldntDestroyTheSelectedCards");
  assert.equal(
    intl.useTranslations()(gameMessages.gameErrorKey(bar.props.error)),
    "Couldn't destroy the selected cards."
  );
  assert.equal(bar.props.busy, false);
  assert.equal(called.length, 2);
  assert.equal(
    render().find(
      node =>
        node.type === "Modal" && node.props.title === "Destroy selected cards?"
    ).props.open,
    true
  );
});
