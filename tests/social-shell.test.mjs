import {
  intl,
  gameMessages,
  socialMessages,
  loadLocaleModule
} from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    URLSearchParams,
    require: name =>
      name === "next-intl"
        ? intl
        : name === "@/i18n/game-messages"
          ? gameMessages
          : name === "@/i18n/social-messages"
            ? socialMessages
            : name === "@/i18n/locale"
              ? loadLocaleModule()
              : name in mocks
                ? mocks[name]
                : require(name)
  });
  return exports;
}

test("Social tab navigation preserves the shared tree while boosters and standalone pages keep their reset boundaries", () => {
  let pathname = "/social";
  const { BoostersLoadPriority, PrioritySession } = load(
    "components/boosters-load-priority.tsx",
    {
      "next/navigation": { usePathname: () => pathname }
    }
  );
  const render = path => {
    pathname = path;
    return BoostersLoadPriority({ children: "stateful subtree" });
  };
  const feed = render("/social");
  for (const path of [
    "/social/everyone",
    "/social/friends",
    "/social/leaderboard",
    "/social"
  ]) {
    const next = render(path);
    assert.equal(next.type, PrioritySession);
    assert.equal(
      next.key,
      feed.key,
      "Switching Social tabs must not remount their stores"
    );
    assert.equal(
      next.props.pathname,
      path,
      "The priority session still receives the real route"
    );
  }
  const boosters = render("/boosters");
  const standalone = render("/leaderboard");
  assert.notEqual(boosters.key, feed.key);
  assert.notEqual(standalone.key, feed.key);
  assert.notEqual(render("/friends").key, feed.key);
  assert.notEqual(boosters.key, standalone.key);
  assert.notEqual(render("/social-other").key, feed.key);
  assert.equal(render("/boosters").props.pathname, "/boosters");
});

test("legacy Social Friends redirects preserve messages, repeated parameters and encoded values", async () => {
  const { default: page } = load("app/social/friends/page.tsx", {
    "next/navigation": {
      redirect: href => {
        throw new Error(href);
      }
    },
    "@/components/community-page": {}
  });
  await assert.rejects(page({ searchParams: Promise.resolve({}) }), {
    message: "/social"
  });
  const destination = await page({
    searchParams: Promise.resolve({
      message: "player+123",
      tag: ["one", "two"],
      q: "a & b",
      empty: ""
    })
  }).catch(error => error.message);
  const url = new URL(destination, "https://example.invalid");
  assert.equal(url.pathname, "/social");
  assert.equal(url.searchParams.get("message"), "player+123");
  assert.deepEqual(url.searchParams.getAll("tag"), ["one", "two"]);
  assert.equal(url.searchParams.get("q"), "a & b");
  assert.equal(url.searchParams.get("empty"), "");
});

test("friend and private message notifications open Social Friends", () => {
  const { notificationItem } = load(
    "lib/notification-item.ts",
    new Proxy(
      {},
      {
        has: () => true,
        get: (_, name) =>
          name === "react" || name === "react/jsx-runtime" ? require(name) : {}
      }
    )
  );
  const notification = {
    id: "note",
    referenceId: "player+123",
    readAt: null,
    createdAt: "2026-10-24T12:00:00Z",
    actorPseudo: "Alice"
  };
  assert.equal(
    notificationItem(
      { ...notification, type: "friend_request" },
      intl.useTranslations("topbar")
    ).href,
    "/friends"
  );
  assert.equal(
    notificationItem(
      { ...notification, type: "private_message_received" },
      intl.useTranslations("topbar")
    ).href,
    "/friends?message=player%2B123"
  );
});

test("Social opens Feed and hides Everyone until its availability probe succeeds", () => {
  const SocialFeed = () => React.createElement("section", null, "Feed content");
  const { default: page } = load("app/social/page.tsx", {
    "@/components/social-feed": { SocialFeed }
  });
  assert.equal(page().type, SocialFeed);
  const { SocialTabs } = load("components/social-tabs.tsx", {
    "next-intl": intl,
    "@/components/social-feed-provider": {
      useSocialFeeds: () => ({
        public: {
          subscribe: () => () => {},
          getSnapshot: () => unavailable
        }
      })
    },
    "next/navigation": { usePathname: () => "/social" },
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) =>
        React.createElement("a", props, children)
    }
  });
  const unavailable = { available: undefined };
  const { default: Layout } = load("app/social/layout.tsx", {
    "@/components/community-views": {
      FriendsView: () => React.createElement("div", null, "Friends sidebar")
    },
    "@/components/social-feed-provider": {
      SocialFeedProvider: ({ children }) => children
    },
    "@/components/social-tabs": { SocialTabs },
    "@/components/community-page": { CommunityPage: ({ children }) => children }
  });
  const html = renderToStaticMarkup(
    React.createElement(Layout, null, "Friends content")
  );
  assert.match(html, /aria-label="Feed sections"/);
  assert.doesNotMatch(html, /href="\/friends"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Friends content/);
  assert.match(
    html,
    /<aside class="yk-social-friends"><div>Friends sidebar<\/div><\/aside>/
  );
  assert.match(html, /href="\/social\/leaderboard"/);
  assert.match(
    html,
    /href="\/social"[^>]*aria-current="page"[^>]*>Friends’ posts/
  );
  assert.doesNotMatch(html, /Public posts/);
});

test("Friends shows a skeleton initially and waits through search debounce before showing no results", () => {
  const states = [];
  let index = 0;
  const hooks = {
    ...React,
    useState: initial => {
      const slot = index++;
      if (!(slot in states)) states[slot] = initial;
      return [
        states[slot],
        value => {
          states[slot] = value;
        }
      ];
    },
    useEffect: () => {},
    useMemo: () => null,
    useRef: () => ({ current: undefined })
  };
  const { FriendsPanel } = load(
    "components/friends.tsx",
    new Proxy(
      {},
      {
        has: () => true,
        get: (_, name) => {
          if (name === "react") return hooks;
          if (name === "next-intl") return intl;
          if (name === "react/jsx-runtime") return require(name);
          if (name === "@/hooks/use-social-unread")
            return { useSocialUnread: () => undefined };
          if (name === "@/components/ui")
            return {
              Skeleton: ({ label }) =>
                React.createElement("span", { role: "status" }, label),
              Modal: () => null,
              Tabs: ({ items }) =>
                React.createElement(
                  "div",
                  null,
                  items.map(item => item.label).join(" | ")
                )
            };
          return {};
        }
      }
    )
  );
  const render = () => {
    index = 0;
    return FriendsPanel();
  };
  let tree = render();
  const initial = renderToStaticMarkup(tree);
  assert.match(initial, /Loading relationships/);
  assert.doesNotMatch(
    initial,
    /No incoming requests|Your circle is still empty/
  );
  assert.ok(
    initial.indexOf("My friends") < initial.indexOf("Received requests")
  );
  const input = tree.props.children[0].props.children[1].props.children[1];
  input.props.onChange({ target: { value: "Alice" } });
  tree = render();
  const pending = renderToStaticMarkup(tree);
  assert.match(pending, /Searching/);
  assert.doesNotMatch(pending, /No players found/);
});
