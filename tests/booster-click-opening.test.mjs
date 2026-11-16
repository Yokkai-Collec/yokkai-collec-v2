import { licenseName } from "./helpers/license-name.mjs";
import { intl, intlServer, gameMessages } from "./helpers/i18n.mjs";
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
      Response,
      AbortController,
      ...globals,
      require: name =>
        name === "@/lib/ui/license-name"
          ? licenseName
          : name === "next-intl"
            ? intl
            : name === "next-intl/server"
              ? intlServer
              : name === "@/i18n/game-messages"
                ? gameMessages
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
function descendants(element) {
  if (!element || typeof element !== "object") return [];
  return [
    element,
    ...React.Children.toArray(element.props?.children).flatMap(descendants)
  ];
}
function hooks() {
  const states = [],
    refs = [],
    effects = [];
  let index = 0,
    refIndex = 0;
  return {
    states,
    refs,
    effects,
    reset() {
      index = 0;
      refIndex = 0;
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
      useRef(initial) {
        const position = refIndex++;
        return (refs[position] ??= { current: initial });
      },
      useEffect(fn) {
        effects.push(fn);
      },
      useCallback: fn => fn
    }
  };
}
const asset = read("data/booster-opening/reveal.html");
const { boosterOpeningDocument } = load("lib/ui/booster-opening-document.ts");

test("closed Regular and Decision packs never tear or complete before a trusted gesture, including reduced motion", async () => {
  for (const kind of ["regular", "decision"])
    for (const reduced of [false, true])
      for (const earlyClick of [false, true]) {
        const html = boosterOpeningDocument(
          asset,
          "https://yokkai-collec.com",
          kind,
          true
        );
        const script = [
          ...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)
        ].at(-1)[1];
        const messages = [],
          timers = [],
          classes = new Set();
        let receive,
          loaded,
          replays = 0;
        const parent = { postMessage: data => messages.push(data.type) };
        const gesture = {
          source: parent,
          origin: "https://yokkai-collec.com",
          data: { type: "yokkai-booster-open" }
        };
        vm.runInNewContext(script, {
          parent,
          performance: { now: () => 0 },
          setTimeout: (fn, ms) => {
            timers.push({ fn, ms });
            return timers.length;
          },
          clearTimeout() {},
          document: {
            styleSheets: [],
            addEventListener() {},
            documentElement: {
              classList: {
                add: value => classes.add(value),
                remove: value => classes.delete(value)
              }
            }
          },
          window: {
            addEventListener: (type, fn) => {
              if (type === "message") receive = fn;
            },
            matchMedia: () => ({ matches: reduced }),
            setYokkaiBooster: () =>
              new Promise(resolve => {
                loaded = resolve;
              }),
            replayYokkaiBooster: () => replays++
          }
        });
        assert.ok(classes.has("yokkai-await-click"));
        receive({ ...gesture, data: { type: "yokkai-booster-next-step" } });
        assert.equal(
          timers.length,
          0,
          "advancing cannot bypass the closed pack"
        );
        receive({ ...gesture, source: {} });
        receive({ ...gesture, origin: "https://evil.example" });
        if (earlyClick) receive(gesture);
        loaded(true);
        await tick();
        assert.equal(messages[0], "YOKKAI_BOOSTER_READY");
        if (!earlyClick) {
          receive({ ...gesture, data: { type: "yokkai-booster-next-step" } });
          assert.equal(
            timers.length,
            0,
            "waiting indefinitely must not complete the opening"
          );
          assert.equal(replays, 0);
          assert.ok(classes.has("yokkai-await-click"));
          receive(gesture);
        }
        assert.equal(classes.has("yokkai-await-click"), false);
        assert.equal(replays, 1);
        assert.equal(timers.length, 1);
        assert.equal(timers[0].ms, reduced ? 500 : 2940);
        receive(gesture);
        receive(gesture);
        assert.equal(
          replays,
          1,
          "duplicate messages do not restart the opening"
        );
        timers[0].fn();
        timers[0].fn();
        assert.equal(
          messages.filter(type => type === "YOKKAI_BOOSTER_COMPLETE").length,
          1
        );
        assert.match(
          html,
          /\.yokkai-await-click \.scene \*[^}]*animation:none!important/
        );
        assert.match(
          html,
          /\.yokkai-await-click \.foil-lid\{display:block!important;opacity:1!important;transform:none!important\}/
        );
      }
});

test("the public document explicitly opts into gesture playback without changing the fixed-asset allowlist", async () => {
  const { GET } = load(
    "app/api/booster-opening/route.ts",
    {
      "node:fs/promises": { readFile: async () => asset },
      "@/lib/ui/booster-opening-document": { boosterOpeningDocument }
    },
    { process: { env: {}, cwd: () => "/workspace" } }
  );
  for (const kind of ["regular", "decision"]) {
    const response = await GET(
      new Request(
        `https://yokkai-collec.com/api/booster-opening?kind=${kind}&gesture=click`
      )
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /const waitForClick=true;/);
    assert.match(html, new RegExp(`/assets/chrome-${kind}-booster-v1\\.png`));
    assert.equal(
      response.headers.get("content-type"),
      "text/plain; charset=utf-8"
    );
  }
});

test("player queues early clicks, keeps failures/timeouts closed until clicked, and cleans up without a pack request", async () => {
  for (const failure of [false, true]) {
    const state = hooks(),
      timers = [],
      sent = [];
    let receive,
      completed = 0,
      torn = 0,
      requested;
    const child = { postMessage: data => sent.push(data.type) };
    const { BoosterOpening } = load(
      "components/booster-opening.tsx",
      { react: state.react },
      {
        AbortController,
        window: {
          setTimeout: (fn, ms) => {
            timers.push({ fn, ms });
            return timers.length;
          },
          clearTimeout() {},
          addEventListener: (_type, fn) => {
            receive = fn;
          },
          removeEventListener() {}
        },
        fetch: async url => {
          requested = url;
          return { ok: !failure, text: async () => "<html></html>" };
        }
      }
    );
    const props = {
      kind: "regular",
      openRequested: false,
      onComplete: () => completed++,
      onTear: () => torn++
    };
    const render = () => {
      state.reset();
      return descendants(BoosterOpening(props));
    };
    render();
    state.effects[0]();
    const cleanup = state.effects[1]();
    state.effects[2]();
    await tick();
    assert.equal(requested, "/api/booster-opening?kind=regular&gesture=click");
    state.refs[2].current = { contentWindow: child };
    const message = type => ({ source: child, origin: "null", data: { type } });
    receive(message("YOKKAI_BOOSTER_TEAR"));
    assert.equal(torn, 0);
    if (failure) {
      timers[0].fn();
      assert.equal(completed, 0);
      const tree = render();
      assert.ok(
        tree.find(
          node => node.props?.className === "yk-booster-opening-fallback"
        )
      );
      assert.ok(
        tree.find(
          node =>
            node.props?.children === "Click the pack or press Enter to open"
        )
      );
    }
    props.openRequested = true;
    render();
    state.effects[0]();
    const cancelWatchdog = state.effects[2]();
    if (failure) assert.equal(completed, 1);
    else {
      assert.ok(sent.includes("yokkai-booster-open"));
      assert.equal(completed, 0);
      receive(message("YOKKAI_BOOSTER_READY"));
      render();
      state.effects[2]();
      assert.equal(
        sent.filter(type => type === "yokkai-booster-open").length,
        2,
        "READY retries a click made before the document loaded"
      );
      receive({ ...message("YOKKAI_BOOSTER_COMPLETE"), source: {} });
      receive({
        ...message("YOKKAI_BOOSTER_COMPLETE"),
        origin: "https://evil.example"
      });
      assert.equal(completed, 0);
      receive(message("YOKKAI_BOOSTER_TEAR"));
      assert.equal(torn, 1);
      receive(message("YOKKAI_BOOSTER_COMPLETE"));
      receive(message("YOKKAI_BOOSTER_COMPLETE"));
      assert.equal(completed, 0, "the fan waits for a separate gesture");
      receive(message("YOKKAI_BOOSTER_REVEAL"));
      receive(message("YOKKAI_BOOSTER_REVEAL"));
      assert.equal(completed, 1);
    }
    cancelWatchdog?.();
    cleanup();
    for (const timer of timers) timer.fn();
    assert.equal(completed, 1);
  }
});

test("the real pack stage requires a first pointer/keyboard gesture; repeated keys and fast double clicks cannot skip it", async () => {
  for (const keyboard of [false, true]) {
    const state = hooks();
    const packOpening = load("lib/ui/pack-opening.ts", {
      "@/lib/ui/animations": {}
    });
    const { animation } = load("lib/ui/animations.ts");
    let respond,
      requests = 0;
    const { Boosters } = load(
      "components/boosters.tsx",
      {
        react: state.react,
        "next/dynamic": { default: () => "Dynamic" },
        "next/link": { default: "Link" },
        "@/components/referral-reminder": { ReferralReminder: "Reminder" },
        "@/components/ambient-glow": { AmbientGlow: "AmbientGlow" },
        "@/components/card-sharing": {},
        "@/lib/ui/pack-opening": packOpening,
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
      clickToOpen: true,
      status: { available: 1, reserve: 1, maximum: 5 },
      countdown: "00:00",
      decisionStatus: {
        available: true,
        pending: [],
        maximum: 1,
        remaining: 1
      },
      decisionCountdown: "00:00",
      collection: [],
      draw: [],
      drawKind: "regular",
      revealed: 0,
      onOpen: () => {
        requests++;
        return new Promise(resolve => {
          respond = resolve;
        });
      },
      onKeepDecision: async () => 0,
      onDiscard: async () => {},
      onReveal() {}
    };
    const render = () => {
      state.reset();
      return descendants(Boosters(props));
    };
    const open = render().find(
      node => node.type === "Button" && node.props.children === "Open"
    );
    open.props.onClick({ currentTarget: {} });
    open.props.onClick({ currentTarget: {} });
    const stage = render().find(
      node => node.props?.["aria-label"] === "Tear open the pack"
    );
    assert.ok(stage);
    const player = () =>
      render().find(node => node.type === "Dynamic" && node.props.onTear);
    // Exercise the real iframe bridge so this parent test also checks cut speed.
    const html = boosterOpeningDocument(
      asset,
      "https://yokkai-collec.com",
      "regular",
      true
    );
    const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(
      -1
    )[1];
    const cutAnimation = { currentTime: 0, playbackRate: 1 };
    const cutTimers = [];
    let receiveStep,
      completions = 0;
    const parent = {
      postMessage: data => {
        if (data.type === "YOKKAI_BOOSTER_COMPLETE") {
          completions++;
          player().props.onComplete();
        }
      }
    };
    vm.runInNewContext(script, {
      parent,
      performance: { now: () => 0 },
      setTimeout: fn => {
        cutTimers.push(fn);
        return cutTimers.length;
      },
      clearTimeout() {},
      document: {
        styleSheets: [],
        getAnimations: () => [cutAnimation],
        addEventListener() {},
        documentElement: { classList: { add() {}, remove() {} } }
      },
      window: {
        addEventListener: (type, fn) => {
          if (type === "message") receiveStep = fn;
        },
        matchMedia: () => ({ matches: false }),
        setYokkaiBooster: async () => true,
        replayYokkaiBooster() {}
      }
    });
    stage.props.ref.current = {
      querySelector: () => ({
        contentWindow: {
          postMessage: data =>
            receiveStep({
              source: parent,
              origin: "https://yokkai-collec.com",
              data
            })
        }
      })
    };
    assert.equal(player().props.openRequested, false);
    respond([
      { id: "real-card", instanceId: "real-instance", image: "/card.png" }
    ]);
    await tick();
    assert.equal(
      state.states[0],
      "tension",
      "the ready server result cannot auto-open a pack"
    );
    stage.props.onKeyDown({ key: "Enter", repeat: true, preventDefault() {} });
    assert.equal(player().props.openRequested, false);
    if (keyboard) stage.props.onKeyDown({ key: " ", preventDefault() {} });
    else stage.props.onClick();
    stage.props.onClick();
    await tick();
    assert.equal(player().props.openRequested, true);
    assert.equal(
      state.states[0],
      "tension",
      "a fast second click does not skip the tear"
    );
    player().props.onTear();
    render()
      .find(node => node.props?.["aria-label"] === "Skip booster opening")
      .props.onClick();
    await tick();
    assert.equal(state.states[0], "seal");
    assert.equal(cutAnimation.playbackRate, 3);
    assert.equal(completions, 0);
    cutTimers.at(-1)();
    cutTimers.at(-1)();
    await tick();
    assert.equal(state.states[0], "idle");
    assert.equal(completions, 1);
    assert.equal(requests, 1);
  }
  assert.match(
    read("components/game.tsx"),
    /<Boosters\s+(?:previewOnly\s+)?clickToOpen/
  );
  assert.match(
    read("components/local-lr-packs-preview.tsx"),
    /<Boosters\s+(?:previewOnly\s+)?clickToOpen/
  );
});
