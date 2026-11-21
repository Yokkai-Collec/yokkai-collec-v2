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
      URL,
      URLSearchParams,
      Response,
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
const card = {
  id: "card",
  instanceId: "instance",
  name: "Actual card",
  category: "ANIME/MANGA",
  anime: "Naruto",
  image: "/assets/card.png",
  rarity: "SSR"
};
function descendants(element) {
  if (!element || typeof element !== "object") return [];
  return [
    element,
    ...React.Children.toArray(element.props?.children).flatMap(descendants)
  ];
}
function hooks() {
  const states = [],
    effects = [],
    refs = [];
  let index = 0;
  return {
    states,
    effects,
    refs,
    reset() {
      index = 0;
      effects.length = 0;
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
      useEffect: fn => effects.push(fn),
      useRef: initial => {
        const ref = { current: initial };
        refs.push(ref);
        return ref;
      },
      useCallback: fn => fn
    }
  };
}

test("both rare cards use the native shared face, without document requests", () => {
  const { CardCinematic } = load("components/card-cinematic.tsx", {
    "@/components/lr-card-reveal": { LrCardReveal: "Native" }
  });
  for (const rarity of ["SSR", "LR"]) {
    const actual = { ...card, rarity };
    const onContinue = () => {};
    const onRevealStart = () => {};
    const onReplay = () => {};
    const player = CardCinematic({
      card: actual,
      onContinue,
      onRevealStart,
      onReplay
    });
    assert.equal(player.type, "Native");
    assert.equal(player.props.card, actual);
    assert.equal(player.props.onContinue, onContinue);
    assert.equal(player.props.onRevealStart, onRevealStart);
    assert.equal(player.props.onReplay, onReplay);
  }
  assert.doesNotMatch(
    read("components/card-cinematic.tsx"),
    /iframe|fetch|LocalCardCinematic/
  );
  const keys = [
    { rarity: "LR", shiny: false, isEvolved: false },
    { rarity: "LR", shiny: true, isEvolved: false },
    { rarity: "LR", shiny: true, isEvolved: true }
  ].map(variant => CardCinematic({ card: { ...card, ...variant } }).key);
  assert.equal(
    new Set(keys).size,
    3,
    "variant changes must remount the old sequence"
  );
});

test("released real-pack reveals use final SSR/LR without reward calls or summary replay controls", () => {
  for (const rarity of ["SSR", "LR"]) {
    const state = hooks();
    let progress = 0;
    const timers = [];
    const { BoosterReveal } = load(
      "components/boosters.tsx",
      {
        react: state.react,
        "next/dynamic": {
          default: factory =>
            factory.toString().includes('components/card-cinematic"')
              ? "ReleasedCinematic"
              : "OtherDynamic"
        },
        "next/link": { default: "Link" },
        "@/components/ambient-glow": { AmbientGlow: "AmbientGlow" },
        "@/components/gta-sunset-event": {
          useGtaSunsetEvent: () => ({ event: null })
        },
        "@/components/referral-reminder": {},
        "@/lib/ui/pack-opening": {},
        "@/components/card-sharing": {},
        "@/components/ui": {
          Button: "Button",
          Modal: "Modal",
          StatusPill: "StatusPill"
        },
        "@/components/yokai-card": {
          CardBack: "CardBack",
          YokaiCard: "YokaiCard"
        },
        "@/lib/ui/animations": {}
      },
      {
        process: { env: { NODE_ENV: "production" } },
        window: {
          setTimeout: (fn, ms) => {
            timers.push({ fn, ms });
            return 1;
          },
          clearTimeout() {}
        },
        clearTimeout() {}
      }
    );
    const props = {
      cards: [{ ...card, rarity }],
      revealed: 0,
      onReveal: () => progress++,
      onReturn() {}
    };
    const render = () => {
      state.reset();
      return descendants(BoosterReveal(props));
    };
    render()
      .find(
        node =>
          node.type === "button" &&
          node.props["aria-label"] === "Reveal card 1 of 1"
      )
      .props.onClick();
    assert.equal(progress, 0);
    assert.equal(timers.length, 0);
    const modal = render().find(
      node => node.type === "Modal" && node.props.open
    );
    assert.ok(modal.props.className.includes("yk-lr-file-modal"));
    assert.equal(modal.props.children.type, "ReleasedCinematic");
    modal.props.children.props.onContinue();
    assert.equal(state.states[2], null);
    assert.equal(progress, 0);
    props.revealed = 1;
    state.states[0] = false;
    const summary = render();
    const replay = summary.find(
      node =>
        node.type === "Button" &&
        React.Children.toArray(node.props.children)
          .join("")
          .includes("Replay cinematic:")
    );
    assert.equal(replay, undefined);
    assert.equal(
      summary.filter(node => node.type === "Modal" && node.props.open).length,
      0
    );
    assert.equal(progress, 0);
  }
  assert.match(
    read("components/boosters.tsx"),
    /<CardCinematic[^>]*card=\{spot\}/
  );
  assert.doesNotMatch(
    read("components/card-cinematic.tsx"),
    /\.rpc\(|openPack|createClient/
  );
});
