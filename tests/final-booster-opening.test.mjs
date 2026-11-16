import { licenseName } from "./helpers/license-name.mjs";
import { intl, intlServer, gameMessages } from "./helpers/i18n.mjs";
import { cardRarityLabels } from "./helpers/card-rarity-labels.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const asset = read("data/booster-opening/reveal.html").replaceAll("\r\n", "\n");
const { boosterOpeningDocument } = load("lib/ui/booster-opening-document.ts");
const documentFor = kind =>
  boosterOpeningDocument(asset, "https://yokkai-collec.com", kind);
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
  let refIndex = 0;
  return {
    states,
    effects,
    refs,
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
      useEffect: fn => effects.push(fn),
      useRef: initial => {
        const position = refIndex++;
        refs[position] ??= { current: initial };
        return refs[position];
      },
      useCallback: fn => fn
    }
  };
}

test("replacement booster sequence is pinned; only known real pack images enter the sandbox", () => {
  assert.equal(
    createHash("sha256").update(asset).digest("hex"),
    "6e46c80d6b3210b3cfa9c1208160301a6f7d5bc00565b77dc7fdc8de05b40b67"
  );
  for (const kind of ["regular", "decision"]) {
    const html = documentFor(kind);
    assert.ok(
      html.includes(
        asset
          .match(/<style>[\s\S]*?<\/style>/)[0]
          .replaceAll(
            "__CARD_BACK__",
            "https://yokkai-collec.com/assets/bubble-card-back-v1.png"
          )
      )
    );
    assert.match(html, /<html lang="en" class="yokkai-wait-booster">/);
    assert.match(html, /<title>Yokkai booster opening<\/title>/);
    assert.match(html, new RegExp(`/assets/chrome-${kind}-booster-v1\\.png`));
    assert.match(html, new RegExp(kind === "decision" ? "#ff69be" : "#8dbdff"));
    assert.match(html, /"tearAt":17\.3/);
    assert.doesNotMatch(html, /data:image|Embedded default image:|Rejouer/);
    assert.doesNotMatch(html, /<button\b/);
    assert.match(html, /prefers-reduced-motion:reduce/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /form-action 'none'/);
    assert.match(html, /setTimeout\(failed,5000\)/);
    assert.match(
      html,
      /\.scene:not\(\.running\) \*[^}]*animation-name:none!important/
    );
  }
  for (const kind of ["../../secret", "LR", "", "Regular"])
    assert.throws(() =>
      boosterOpeningDocument(asset, "https://yokkai-collec.com", kind)
    );
  assert.throws(() =>
    boosterOpeningDocument(asset, "javascript:alert(1)", "regular")
  );
  assert.throws(() =>
    boosterOpeningDocument("bad", "https://yokkai-collec.com", "regular")
  );
});

test("the native setter loads both real-image layers and dimensions, with no standalone auto-start", async () => {
  const html = documentFor("regular");
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1];
  const events = [];
  class ImageMock {
    complete = true;
    naturalWidth = 600;
    naturalHeight = 1200;
    addEventListener() {}
    removeEventListener() {}
  }
  const body = new ImageMock(),
    lid = new ImageMock();
  const properties = new Map();
  const scene = {
    clientWidth: 390,
    clientHeight: 844,
    offsetWidth: 300,
    style: { setProperty: (key, value) => properties.set(key, value) },
    classList: {
      remove: value => events.push(["remove", value]),
      add: value => events.push(["add", value])
    }
  };
  const window = { addEventListener() {} };
  vm.runInNewContext(script, {
    window,
    Image: ImageMock,
    CSS: { supports: () => true },
    setTimeout,
    clearTimeout,
    document: {
      getElementById: id =>
        ({
          scene,
          packBody: body,
          packLid: lid,
          replay: { addEventListener() {} }
        })[id]
    }
  });
  assert.equal(events.length, 0);
  assert.equal(body.src, undefined);
  await window.setYokkaiBooster({
    boosterImage:
      "https://yokkai-collec.com/assets/chrome-regular-booster-v1.png",
    tearAt: 11,
    accentColor: "#8dbdff"
  });
  assert.equal(body.src, lid.src);
  assert.equal(properties.get("--pack-ratio"), "2.000000");
  assert.equal(properties.get("--foil-cut"), "11%");
  assert.equal(properties.get("--booster-accent"), "#8dbdff");
  assert.equal(
    Number.parseFloat(properties.get("--foil-h")),
    2 * Number.parseFloat(properties.get("--p"))
  );
  assert.ok(
    events.some(([type, value]) => type === "add" && value === "running")
  );
});

test("trusted bridge completes once after the last effect, respects reduced motion, never reveals fallback art on error", async () => {
  for (const reduced of [false, true])
    for (const success of [false, true]) {
      const script = [
        ...documentFor("decision").matchAll(
          /<script[^>]*>([\s\S]*?)<\/script>/g
        )
      ].at(-1)[1];
      const messages = [],
        timers = [],
        removed = [];
      const parent = {
        postMessage: (data, origin) => {
          assert.equal(origin, "https://yokkai-collec.com");
          messages.push(data.type);
        }
      };
      let listener;
      vm.runInNewContext(script, {
        parent,
        performance: { now: () => 0 },
        setTimeout: (fn, ms) => {
          timers.push({ fn, ms });
          return 1;
        },
        clearTimeout() {},
        document: {
          styleSheets: [],
          addEventListener() {},
          documentElement: {
            classList: { remove: value => removed.push(value) }
          }
        },
        window: {
          addEventListener: (type, fn) => {
            if (type === "message") listener = fn;
          },
          matchMedia: () => ({ matches: reduced }),
          setYokkaiBooster: async () => success
        }
      });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(
        messages[0],
        success ? "YOKKAI_BOOSTER_READY" : "YOKKAI_BOOSTER_ERROR"
      );
      assert.equal(removed.length, success ? 1 : 0);
      const status = {
        source: parent,
        origin: "https://yokkai-collec.com",
        data: { type: "yokkai-booster-status" }
      };
      listener({ ...status, source: {} });
      listener({ ...status, origin: "https://evil.example" });
      assert.equal(messages.length, success ? 2 : 1);
      if (success) assert.equal(messages[1], "YOKKAI_BOOSTER_STARTED");
      listener(status);
      assert.equal(messages.length, success ? 3 : 2);
      assert.equal(messages.at(-1), messages[0]);
      if (success) {
        assert.equal(timers[0].ms, reduced ? 500 : 2940);
        timers[0].fn();
        timers[0].fn();
        assert.equal(
          messages.filter(value => value === "YOKKAI_BOOSTER_COMPLETE").length,
          1
        );
      } else assert.equal(timers.length, 0);
    }
});

test("production route bounds requests and serves one fixed inert template, never arbitrary paths or media", async () => {
  let reads = 0;
  const { GET } = load(
    "app/api/booster-opening/route.ts",
    {
      "node:fs/promises": {
        readFile: async file => {
          reads++;
          assert.match(
            file.replaceAll("\\", "/"),
            /\/data\/booster-opening\/reveal\.html$/
          );
          return asset;
        }
      },
      "@/lib/ui/booster-opening-document": { boosterOpeningDocument }
    },
    { process: { env: { NODE_ENV: "production" }, cwd: () => "/workspace" } }
  );
  for (const query of [
    "kind=../../secret",
    "kind=LR",
    "",
    "kind=regular&padding=" + "x".repeat(600)
  ]) {
    assert.equal(
      (
        await GET(
          new Request("https://yokkai-collec.com/api/booster-opening?" + query)
        )
      ).status,
      400
    );
  }
  assert.equal(reads, 0);
  for (const kind of ["regular", "decision", "regular"]) {
    const response = await GET(
      new Request(
        `https://yokkai-collec.com/api/booster-opening?kind=${kind}&image=javascript:alert(1)`
      )
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-type"),
      "text/plain; charset=utf-8"
    );
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const html = await response.text();
    assert.match(html, new RegExp(`/assets/chrome-${kind}-booster-v1\\.png`));
    assert.doesNotMatch(html, /javascript:alert/);
  }
  assert.equal(reads, 1);
});

test("visual skip never advances before the real server result, nor requests a second pack", async () => {
  const { runFinalBoosterOpening } = load("lib/ui/pack-opening.ts", {
    "@/lib/ui/animations": {}
  });
  let respond, finish, images;
  let requests = 0,
    responses = 0,
    complete = false;
  const finished = new Promise(resolve => {
    finish = resolve;
  });
  const preloading = new Promise(resolve => {
    images = resolve;
  });
  const opening = runFinalBoosterOpening({
    open: () => {
      requests++;
      return new Promise(resolve => {
        respond = resolve;
      });
    },
    finished,
    onResponse: () => responses++,
    preload: () => preloading
  }).then(value => {
    complete = value;
  });
  finish();
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(complete, false);
  assert.equal(responses, 0);
  respond([{ id: "server-result" }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(complete, false);
  images();
  await opening;
  assert.equal(complete, true);
  assert.equal(requests, 1);
  assert.equal(responses, 1);
  for (const result of [undefined, []]) {
    assert.equal(
      await runFinalBoosterOpening({
        open: async () => result,
        finished: new Promise(() => {}),
        onResponse() {},
        preload: async () => assert.fail("No previous draw on failure")
      }),
      false
    );
  }
  await assert.rejects(
    runFinalBoosterOpening({
      open: async () => {
        throw Error("server error");
      },
      finished,
      onResponse() {
        assert.fail();
      },
      preload: async () => {}
    }),
    /server error/
  );
});

test("sandbox player scopes messages and cleans up; failure/timeout/completion release only the visual gate once", async () => {
  for (const responseOk of [true, false]) {
    const state = hooks();
    let requested,
      receive,
      completed = 0,
      torn = 0,
      removed = 0;
    const timers = [];
    const child = { postMessage() {} };
    const { BoosterOpening } = load(
      "components/booster-opening.tsx",
      { react: state.react },
      {
        AbortController,
        window: {
          setTimeout: (fn, ms) => {
            timers.push({ fn, ms });
            return 1;
          },
          clearTimeout() {},
          addEventListener: (type, fn) => {
            receive = fn;
          },
          removeEventListener: () => removed++
        },
        fetch: async url => {
          requested = url;
          return { ok: responseOk, text: async () => "<html></html>" };
        }
      }
    );
    const props = {
      kind: "decision",
      onComplete: () => completed++,
      onTear: () => torn++
    };
    BoosterOpening(props);
    const cleanup = state.effects[1]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requested, "/api/booster-opening?kind=decision");
    state.reset();
    const tree = descendants(BoosterOpening(props));
    assert.equal(tree.filter(node => node.type === "button").length, 0);
    if (responseOk) {
      const iframe = tree.find(node => node.type === "iframe");
      assert.equal(iframe.props.sandbox, "allow-scripts");
      assert.equal(iframe.props.tabIndex, -1);
      state.refs[2].current = { contentWindow: child };
      const message = {
        source: child,
        origin: "null",
        data: { type: "YOKKAI_BOOSTER_COMPLETE" }
      };
      receive({ ...message, source: {} });
      receive({ ...message, origin: "https://evil.example" });
      assert.equal(completed, 0);
      receive({ ...message, data: { type: "YOKKAI_BOOSTER_TEAR" } });
      assert.equal(torn, 1);
      receive(message);
      receive(message);
      assert.equal(completed, 0, "the existing fan waits for its own click");
      timers[0].fn();
      assert.equal(
        completed,
        0,
        "the watchdog must not dismiss an interactive fan"
      );
      receive({ ...message, data: { type: "YOKKAI_BOOSTER_REVEAL" } });
      receive({ ...message, data: { type: "YOKKAI_BOOSTER_REVEAL" } });
    }
    assert.equal(completed, 1);
    assert.equal(timers[0].ms, 16000);
    timers[0].fn();
    assert.equal(completed, 1);
    cleanup();
    assert.equal(removed, 1);
  }
  assert.doesNotMatch(
    read("components/booster-opening.tsx"),
    /\.rpc\(|onOpen|onReveal|createClient|allow-same-origin/
  );
});

test("the real Game and safe simulated packs opt in; the legacy renderer and SSR/LR flow remain intact", () => {
  assert.match(read("components/game.tsx"), /<Boosters\s/);
  assert.match(read("components/local-lr-packs-preview.tsx"), /previewOnly/);
  const source = read("components/boosters.tsx");
  assert.doesNotMatch(
    source,
    /releasedOpening|yk-pack-tear|runPackOpeningSequence/
  );
  assert.match(source, /if \(openingLock\.current\) return;/);
  assert.match(source, /type: "yokkai-booster-next-step"/);
  assert.match(
    source,
    /open: count > 1 && onOpenMany \? \(\) => onOpenMany\(count\) : \(\) => onOpen\(kind\)/
  );
  assert.match(source, /kind=\{openingKind\}/);
  assert.match(source, /<CardCinematic/);
  assert.match(source, /role="button" tabIndex=\{0\}/);
  assert.match(source, /tp\("nextOpeningStep"\)/);
  assert.equal(
    intl.useTranslations("packs")("nextOpeningStep"),
    "Next opening step"
  );
  assert.match(source, /element\.inert = true/);
  assert.match(
    read("styles/booster-opening.css"),
    /\.yk-opening-stage\s*\{[^}]*position: fixed;/
  );
});

test("live Boosters locks double clicks, permits keyboard skip and cannot reveal before its one server response", async () => {
  const state = hooks();
  const { runFinalBoosterOpening, packCopySnapshot, packCopyLabels } = load(
    "lib/ui/pack-opening.ts",
    { "@/lib/ui/animations": {} }
  );
  const { animation } = load("lib/ui/animations.ts");
  let respond,
    requests = 0;
  const { Boosters } = load(
    "components/boosters.tsx",
    {
      react: state.react,
      "next/dynamic": { default: () => "Dynamic" },
      "next/link": { default: "Link" },
      "@/components/ambient-glow": { AmbientGlow: "AmbientGlow" },
      "@/components/referral-reminder": { ReferralReminder: "Reminder" },
      "@/components/card-sharing": {},
      "@/lib/ui/pack-opening": {
        runFinalBoosterOpening,
        packCopySnapshot,
        packCopyLabels
      },
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
    status: { available: 1, reserve: 1, maximum: 5 },
    countdown: "00:00",
    decisionStatus: { available: true, pending: [], maximum: 1, remaining: 1 },
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
  assert.equal(requests, 1);
  const stage = render().find(
    node => node.props?.["aria-label"] === "Next opening step"
  );
  assert.ok(stage);
  stage.props.onKeyDown({ key: "Enter", preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(
    state.states[0],
    "tension",
    "visual skip must still wait for the server"
  );
  respond([
    { id: "real-card", instanceId: "real-instance", image: "/card.png" }
  ]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(
    state.states[0],
    "tension",
    "server response must not skip the animation"
  );
  const openingAnimation = render().find(
    node => node.type === "Dynamic" && node.props.onComplete
  );
  openingAnimation.props.onComplete();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.states[0], "idle");
  assert.equal(requests, 1);
});

test("production proxy origins use configured public site, not localhost or attacker-controlled forwarded headers", async () => {
  for (const environment of ["production", "development"]) {
    const globals = {
      process: {
        env: {
          NODE_ENV: environment,
          NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com"
        },
        cwd: () => "/workspace"
      }
    };
    const opening = load(
      "app/api/booster-opening/route.ts",
      {
        "node:fs/promises": { readFile: async () => asset },
        "@/lib/ui/booster-opening-document": { boosterOpeningDocument }
      },
      globals
    );
    const expected =
      environment === "production"
        ? "https://yokkai-collec.com"
        : "http://localhost:3000";
    const request = path =>
      new Request("http://localhost:3000" + path, {
        headers: {
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "http"
        }
      });
    const openingResponse = await opening.GET(
      request("/api/booster-opening?kind=regular")
    );
    assert.equal(openingResponse.status, 200);
    const openingHtml = await openingResponse.text();
    assert.match(
      openingHtml,
      new RegExp(`const hostOrigin=${JSON.stringify(expected)};`)
    );
    assert.ok(
      openingHtml.includes(expected + "/assets/chrome-regular-booster-v1.png")
    );
    assert.doesNotMatch(openingHtml, /evil\.example/);
  }
});

test("opening keeps the matching nebula behind both pack animations", () => {
  for (const kind of ["regular", "decision"]) {
    assert.ok(
      documentFor(kind).includes(
        `body{background:#070b13 url("https://yokkai-collec.com/assets/${kind}-opening-nebula.webp") center / cover no-repeat}`
      )
    );
  }
});

test("latency preview uses the same opening animation as the site", () => {
  assert.match(read("components/booster-opening-preview.tsx"), /<Boosters\s/);
});

test("two clicks advance to tearing then finish the opening", async () => {
  const script = [
    ...documentFor("regular").matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)
  ].at(-1)[1];
  const messages = [];
  const animation = { currentTime: 0, playbackRate: 1 };
  const timers = [];
  const parent = { postMessage: data => messages.push(data.type) };
  let receive;
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
      getAnimations: () => [animation],
      addEventListener() {},
      documentElement: { classList: { remove() {} } }
    },
    window: {
      addEventListener: (type, fn) => {
        if (type === "message") receive = fn;
      },
      matchMedia: () => ({ matches: false }),
      setYokkaiBooster: async () => true
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  const event = {
    source: parent,
    origin: "https://yokkai-collec.com",
    data: { type: "yokkai-booster-next-step" }
  };
  receive({ ...event, origin: "https://evil.example" });
  assert.equal(animation.currentTime, 0);
  receive(event);
  assert.equal(animation.currentTime, 680);
  assert.equal(messages.includes("YOKKAI_BOOSTER_COMPLETE"), false);
  receive(event);
  assert.equal(animation.currentTime, 680);
  const speed = Number(script.match(/const CUT_SPEED_MULTIPLIER=(\d+);/)[1]);
  assert.equal(speed, 3);
  assert.equal(animation.playbackRate, speed);
  assert.equal(messages.includes("YOKKAI_BOOSTER_COMPLETE"), false);
  assert.equal(timers.at(-1).ms, (2940 - 680) / speed);
  const timerCount = timers.length;
  receive(event);
  assert.equal(animation.currentTime, 680);
  assert.equal(animation.playbackRate, speed);
  assert.equal(timers.length, timerCount);
  timers.at(-1).fn();
  timers.at(-1).fn();
  receive(event);
  assert.equal(
    messages.filter(type => type === "YOKKAI_BOOSTER_COMPLETE").length,
    1
  );
});
