import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { intl } from "./helpers/i18n.mjs";
import postcss from "postcss";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
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
        name === "next-intl"
          ? intl
          : name in mocks
            ? mocks[name]
            : name.endsWith(".css")
              ? {}
              : require(name)
    }
  );
  return exports;
}
function reminder(pathname, dismissed = false, homeCard = false, options = {}) {
  const states = [],
    effects = [],
    writes = [],
    copied = [],
    calls = [];
  let index = 0;
  const { ReferralReminder } = load(
    "components/referral-reminder.tsx",
    {
      react: {
        ...React,
        useState: initial => {
          const current = index++;
          if (!(current in states)) states[current] = initial;
          return [
            states[current],
            value => {
              states[current] = value;
            }
          ];
        },
        useRef: () => ({ current: null }),
        useEffect: fn => effects.push(fn)
      },
      "react-dom": { createPortal: content => content },
      "next/link": {
        __esModule: true,
        default: ({ children, ...props }) =>
          React.createElement("a", props, children)
      },
      "next/navigation": { usePathname: () => pathname },
      "next/image": {
        __esModule: true,
        default: ({ alt, src }) => React.createElement("img", { alt, src })
      },
      "@/lib/premium/offer": load("lib/premium/offer.ts"),
      "@/components/referral-event": { ReferralEventPromotion: () => null },
      "@/components/ui": {
        Modal: ({ open, children }) =>
          open ? React.createElement("div", null, children) : null,
        Button: ({ children, ...props }) =>
          React.createElement("button", props, children)
      },
      "@/lib/ui/referral-footer": {
        trackReferralFooter: () => {
          throw Error("No DOM tracker in SSR");
        }
      },
      "@/utils/supabase/client": {
        createClient: () => ({
          auth: {
            getSession: async () => {
              calls.push("auth");
              return { data: { session: { user: { id: "viewer" } } } };
            }
          },
          rpc: async name => {
            calls.push(name);
            if (name === "create_referral_code")
              return { data: "created code" };
            assert.equal(name, "get_referral_status");
            return { data: options.status ?? { code: "my code" } };
          }
        })
      }
    },
    {
      document: {
        body: { appendChild() {} },
        createElement: () => ({ style: {}, select() {}, remove() {} }),
        execCommand: () => {
          calls.push("fallbackCopy");
          return !options.fallbackFails;
        }
      },
      localStorage: {
        getItem: () => (dismissed ? "1" : null),
        setItem: (...args) => writes.push(args)
      },
      window: { location: { origin: "https://example.test" } },
      navigator: {
        ...options.navigator,
        clipboard: {
          writeText: async value => {
            if (options.copyFails) throw Error("denied");
            copied.push(value);
          }
        }
      }
    }
  );
  return {
    render: () => {
      index = 0;
      effects.length = 0;
      return ReferralReminder({
        packChoices: homeCard || pathname === "/boosters",
        homeCard
      });
    },
    start: () => effects[1](),
    writes,
    copied,
    calls
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("Boosters reminder ignores old dismissals, has no close action, and keeps copy-link functional", async () => {
  const s = reminder("/boosters", true);
  assert.equal(s.render(), null);
  s.start();
  await flush();
  const tree = s.render(),
    html = renderToStaticMarkup(tree);
  assert.match(html, /yk-referral-reminder--boosters/);
  assert.match(html, /Want more packs\?/);
  assert.doesNotMatch(html, /Dismiss referral reminder|<input|role="dialog"/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(html, /<strong>\+5<\/strong> packs/);
  assert.doesNotMatch(
    html,
    /Regular Packs in reserve|Each friend who confirms/
  );
  assert.match(html, /href="\/premium"/);
  assert.doesNotMatch(html, />Share</);
  const findCopy = node => {
    if (!node || typeof node !== "object") return;
    if (node.props?.children === "Copy link") return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const found = findCopy(child);
      if (found) return found;
    }
  };
  const copy = findCopy(tree);
  assert.ok(copy);
  copy.props.onClick();
  await flush();
  assert.deepEqual(s.copied, ["https://example.test/signup?ref=my%20code"]);
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.calls, ["auth", "get_referral_status"]);
  assert.match(renderToStaticMarkup(s.render()), /Copied/);
});

function findAction(node, label) {
  if (!node || typeof node !== "object") return;
  if (node.props?.children === label) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = findAction(child, label);
    if (found) return found;
  }
}

test("direct choices create a missing code, omit referral counters and omit sharing even when supported", async () => {
  const shared = [];
  const s = reminder("/boosters", false, false, {
    status: { verifiedReferrals: 1, packsEarned: 5 },
    navigator: { share: async value => shared.push(value) }
  });
  s.render();
  s.start();
  await flush();
  const tree = s.render();
  assert.doesNotMatch(renderToStaticMarkup(tree), /friend joined|packs earned/);
  assert.deepEqual(s.calls, [
    "auth",
    "get_referral_status",
    "create_referral_code"
  ]);
  assert.equal(findAction(tree, "Share"), undefined);
  assert.deepEqual(shared, []);
  const plural = reminder("/boosters", false, false, {
    status: { code: "ready", verifiedReferrals: 3, packsEarned: 15 }
  });
  plural.render();
  plural.start();
  await flush();
  assert.doesNotMatch(
    renderToStaticMarkup(plural.render()),
    /friends joined|packs earned/
  );
});

test("direct choices retain copy fallback and announce failures without opening a dialog", async () => {
  for (const fallbackFails of [false, true]) {
    const s = reminder("/boosters", false, false, {
      copyFails: true,
      fallbackFails
    });
    s.render();
    s.start();
    await flush();
    findAction(s.render(), "Copy link").props.onClick();
    await flush();
    const html = renderToStaticMarkup(s.render());
    assert.ok(s.calls.includes("fallbackCopy"));
    assert.match(html, fallbackFails ? /role="alert"/ : /Copied/);
    assert.doesNotMatch(html, /<input|role="dialog"/);
  }
});

test("other pages keep their dismissal and Home keeps its inline invitation", async () => {
  const hidden = reminder("/collection", true);
  hidden.render();
  hidden.start();
  await flush();
  assert.equal(hidden.render(), null);
  const other = reminder("/collection");
  other.render();
  other.start();
  await flush();
  const tree = other.render();
  assert.match(renderToStaticMarkup(tree), /Dismiss referral reminder/);
  tree.props.children[0].props.children
    .find(child => child?.props?.["aria-label"] === "Dismiss referral reminder")
    .props.onClick();
  assert.equal(other.render(), null);
  assert.deepEqual(other.writes, [
    ["yokkai-referral-reminder-dismissed:viewer", "1"]
  ]);
  const home = reminder("/");
  home.render();
  home.start();
  await flush();
  assert.equal(home.render(), null);
  assert.deepEqual(home.calls, []);
});

test("footer offset handles no footer, visible footer and resized viewport", () => {
  const { referralFooterOffset: offset } = load("lib/ui/referral-footer.ts");
  assert.equal(offset(900, null), 0);
  assert.equal(offset(900, 1100), 0);
  assert.equal(offset(900, 900), 0);
  assert.equal(offset(900, 820), 80);
  assert.equal(offset(600, 450), 150);
  for (const [height, top] of [
    [NaN, 1],
    [0, 1],
    [900, NaN],
    [900, Infinity]
  ])
    assert.equal(offset(height, top), 0);
});

test("scroll/resize tracking keeps the reminder above late or resizing footers and cleans up", () => {
  const values = new Map(),
    frames = new Map(),
    listeners = new Map(),
    viewport = new Map(),
    observers = [];
  let top = 920,
    selected = null,
    nextFrame = 0;
  const footer = { isConnected: true, getBoundingClientRect: () => ({ top }) };
  class Observer {
    constructor(fn) {
      this.fn = fn;
      this.stopped = false;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.stopped = true;
    }
  }
  const window = {
    innerHeight: 900,
    requestAnimationFrame: fn => {
      frames.set(++nextFrame, fn);
      return nextFrame;
    },
    cancelAnimationFrame: id => frames.delete(id),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
    visualViewport: {
      addEventListener: (name, fn) => viewport.set(name, fn),
      removeEventListener: name => viewport.delete(name)
    }
  };
  const { trackReferralFooter } = load(
    "lib/ui/referral-footer.ts",
    {},
    {
      window,
      document: { body: {}, querySelector: () => selected },
      ResizeObserver: Observer,
      MutationObserver: Observer
    }
  );
  const stop = trackReferralFooter({
    style: {
      setProperty: (key, value) => values.set(key, value),
      removeProperty: key => values.delete(key)
    }
  });
  assert.equal(values.get("--yk-referral-footer-offset"), "0px");
  assert.equal(values.get("--yk-referral-positioned"), "visible");
  selected = footer;
  top = 820;
  observers[1].fn();
  listeners.get("scroll")();
  listeners.get("scroll")();
  assert.equal(frames.size, 1);
  const tick = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const fn of pending) fn();
  };
  tick();
  assert.equal(values.get("--yk-referral-footer-offset"), "80px");
  top = 700;
  observers[0].fn();
  tick();
  assert.equal(values.get("--yk-referral-footer-offset"), "200px");
  window.innerHeight = 800;
  listeners.get("resize")();
  tick();
  assert.equal(values.get("--yk-referral-footer-offset"), "100px");
  top = 1200;
  viewport.get("resize")();
  tick();
  assert.equal(values.get("--yk-referral-footer-offset"), "0px");
  listeners.get("scroll")();
  stop();
  assert.equal(frames.size, 0);
  assert.equal(listeners.size, 0);
  assert.equal(viewport.size, 0);
  assert.equal(values.size, 0);
  assert.ok(observers.every(observer => observer.stopped));
});

test("compact desktop selection reserves space for the reminder without clipping content or hiding controls", () => {
  const css = postcss.parse(
    readFileSync("styles/boosters-showcase.css", "utf8")
  );
  const compact = css.nodes.find(
    node =>
      node.type === "atrule" &&
      node.params === "(min-width: 1024px) and (max-height: 1200px)"
  );
  assert.ok(compact);
  const declarations = [];
  compact.walkDecls(decl => declarations.push(decl));
  assert.ok(
    declarations.some(
      ({ prop, value }) =>
        prop === "height" &&
        value.includes("100svh") &&
        value.includes("--pack-viewport-chrome")
    )
  );
  assert.ok(
    declarations.some(
      ({ prop, value }) => prop === "min-height" && value === "54px"
    )
  );
  for (const { prop, value } of declarations) {
    assert.notEqual(prop, "zoom");
    assert.ok(!(prop === "transform" && value.includes("scale")));
    assert.ok(
      !(
        ["overflow", "overflow-y"].includes(prop) &&
        ["hidden", "clip"].includes(value)
      )
    );
    assert.ok(!(prop === "display" && value === "none"));
    assert.ok(!(prop === "height" && /^100(?:s|d)?vh$/.test(value)));
  }
  compact.walkRules(rule =>
    assert.doesNotMatch(rule.selector, /yk-reveal|yk-opening|^body|^html/)
  );
  const referral = readFileSync("styles/referral-reminder.css", "utf8");
  assert.match(referral, /width:\s*min\(100%, 720px\)/);
  assert.match(referral, /min-width: 640px/);
  assert.match(referral, /border-left: 1px solid/);
  assert.match(referral, /border-top: 1px solid/);
  assert.match(referral, /min-width: 1024px\) and \(min-height: 701px/);
  assert.match(referral, /100vw - 480px/);
  assert.match(referral, /bottom:\s*66px/);
  assert.match(
    referral,
    /padding-bottom:\s*calc\(var\(--pack-choices-height, 80px\) \+ 24px\)/
  );
  assert.doesNotMatch(
    referral,
    /--yk-referral-footer-offset|376px|padding-bottom:\s*88px/
  );
  assert.doesNotMatch(
    readFileSync("components/referral-reminder.tsx", "utf8"),
    /createPortal/
  );
});

test("Home card opens the existing booster choices and prepares its link only on demand", async () => {
  const s = reminder("/", true, true);
  const tree = s.render();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Don’t stop now\./);
  assert.match(
    html,
    /Get \+5 packs per friend, or double your pack reserve with Pro\./
  );
  assert.match(html, /See options/);
  assert.match(html, /yk-home-pack-options-art/);
  assert.match(html, /home-booster-box\.webp/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.doesNotMatch(
    html,
    /yk-referral-reminder--boosters|Dismiss referral reminder/
  );
  s.start();
  await flush();
  assert.equal(s.calls.length, 0);
  tree.props.children[0].props.children[1].props.onClick();
  s.render();
  s.start();
  await flush();
  const open = renderToStaticMarkup(s.render());
  assert.match(open, /Two ways to open more packs/);
  assert.match(open, /Yokkai Pro/);
  assert.match(open, /value="https:\/\/example\.test\/signup\?ref=my%20code"/);
  assert.deepEqual(s.calls, ["auth", "get_referral_status"]);
});
