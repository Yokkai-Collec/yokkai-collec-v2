import {
  intl,
  intlServer,
  gameMessages,
  socialMessages
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
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: 1, target: 9, jsx: 4 }
    }).outputText,
    {
      exports,
      Error,
      ...globals,
      require: name => {
        if (name in mocks) return mocks[name];
        if (name === "next-intl") return intl;
        if (name === "next-intl/server") return intlServer;
        if (name === "@/i18n/game-messages") return gameMessages;
        if (name === "@/i18n/social-messages") return socialMessages;
        return require(name);
      }
    }
  );
  return exports;
}
const link = {
  __esModule: true,
  default: ({ children, ...props }) => React.createElement("a", props, children)
};
const data = load("lib/data/friend-feed.ts", {
  "@/utils/supabase/client": {},
  "@/lib/data/read-request": {}
});
const { createSocialFeedStore } = load("lib/ui/social-feed-store.ts", {
  "@/lib/data/friend-feed": data
});
const post = n => ({
  id: String(n),
  text: `Post ${n}`,
  createdAt: new Date(2026, 0, 1, 0, n).toISOString(),
  author: { id: "alice", name: "Alice" }
});

test("Everyone availability distinguishes an empty public feed from a missing RPC", async () => {
  for (const code of ["PGRST202", "42883", null]) {
    const { getPublicFeed } = load("lib/data/friend-feed.ts", {
      "@/utils/supabase/client": {
        createClient: () => ({
          rpc: () => ({
            abortSignal: async () => ({
              data: { items: [], next: null },
              error: code ? { code } : null
            })
          })
        })
      },
      "@/lib/data/read-request": { readRequest: read => read() }
    });
    const store = createSocialFeedStore(getPublicFeed);
    await store.refresh();
    assert.equal(store.getSnapshot().available, !code);
    assert.equal(store.getSnapshot().error, "");
  }
});

test("Feed tabs expose Everyone only after public RPC success and keep Friends separate", () => {
  for (const available of [undefined, false, true]) {
    const state = { available };
    const { SocialTabs } = load("components/social-tabs.tsx", {
      "next-intl": intl,
      "next/navigation": { usePathname: () => "/social/everyone" },
      "next/link": link,
      "@/components/social-feed-provider": {
        useSocialFeeds: () => ({
          public: { subscribe: () => () => {}, getSnapshot: () => state }
        })
      }
    });
    const html = renderToStaticMarkup(React.createElement(SocialTabs));
    assert.equal(html.includes('href="/social/everyone"'), available === true);
    assert.match(html, /href="\/social"/);
    assert.doesNotMatch(html, /href="\/friends"/);
    if (available) {
      assert.ok(
        html.indexOf(">Friends’ posts<") < html.indexOf(">Public posts<")
      );
      assert.ok(html.indexOf(">Public posts<") < html.indexOf(">Leaderboard<"));
      assert.match(html, /href="\/social\/everyone"[^>]*aria-current="page"/);
    }
  }
});

test("separate sources isolate pages, cursors, pending posts and New posts insertion", async () => {
  let publicItems = [post(2)];
  const cursor = { id: "1", at: post(1).createdAt };
  const friends = createSocialFeedStore(async () => ({
    items: [post(1)],
    next: cursor
  }));
  const everyone = createSocialFeedStore(async () => ({
    items: publicItems,
    next: null
  }));
  await friends.refresh();
  await everyone.refresh();
  publicItems = [post(3), post(2)];
  await everyone.refresh();
  assert.deepEqual(
    Array.from(everyone.getSnapshot().items, p => p.id),
    ["2"]
  );
  assert.deepEqual(
    Array.from(friends.getSnapshot().items, p => p.id),
    ["1"]
  );
  assert.equal(friends.getSnapshot().pending.length, 0);
  assert.deepEqual(friends.getSnapshot().next, cursor);
  everyone.showNew();
  assert.deepEqual(
    Array.from(everyone.getSnapshot().items, p => p.id),
    ["3", "2"]
  );
  assert.deepEqual(
    Array.from(friends.getSnapshot().items, p => p.id),
    ["1"]
  );
});

test("both provider sources batch activity once per new page and invalidate together", async () => {
  const effects = [];
  const listeners = new Map();
  const reads = { friends: 0, public: 0 };
  let reported = false;
  const batches = [];
  const source = name => async cursor => {
    reads[name]++;
    return {
      items:
        reported && name === "public"
          ? [post(3), post(2)]
          : [post(cursor ? 1 : 2)],
      next: cursor ? null : { id: "2", at: post(2).createdAt }
    };
  };
  const document = {
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const { SocialFeedProvider } = load(
    "components/social-feed-provider.tsx",
    {
      react: {
        ...React,
        useMemo: create => create(),
        useEffect: effect => effects.push(effect)
      },
      "next/navigation": { usePathname: () => "/social/everyone" },
      "@/lib/data/friend-feed": {
        getFriendFeed: source("friends"),
        getPublicFeed: source("public")
      },
      "@/lib/data/wall-interactions": {
        hydrateFeedActivity: async posts => {
          if (posts.length) batches.push(posts.map(p => p.id));
          return posts.map(p => ({ ...p, activity: { likes: 0 } }));
        }
      },
      "@/lib/ui/social-feed-store": { createSocialFeedStore }
    },
    {
      document,
      window: {
        addEventListener: (name, listener) => listeners.set(name, listener),
        removeEventListener: name => listeners.delete(name)
      }
    }
  );
  const feeds = SocialFeedProvider({ children: null }).props.value;
  const cleanup = effects.map(effect => effect());
  await feeds.public.refresh();
  // Let the initial capability read finish before paginating the same store.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads.public, 1);
  assert.equal(reads.friends, 0);
  await feeds.public.more();
  await feeds.friends.refresh();
  await feeds.friends.more();
  assert.equal(batches.length, 4, "one activity batch for each source/page");
  await feeds.public.refresh();
  await feeds.friends.refresh();
  assert.equal(batches.length, 4, "polling reuses mounted activity");
  const inactiveReads = reads.friends;
  listeners.get("profile-wall-changed")({
    detail: { kind: "deleted", id: "1" }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(
    Object.values(feeds).every(
      store => !store.getSnapshot().items.some(p => p.id === "1")
    )
  );
  reported = true;
  listeners.get("profile-wall-changed")({
    detail: { kind: "reported", id: "2" }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(feeds.friends.getSnapshot().items.length, 1);
  assert.equal(feeds.public.getSnapshot().items.length, 1);
  assert.equal(feeds.public.getSnapshot().items[0].id, "2");
  assert.equal(
    feeds.public.getSnapshot().pending[0].id,
    "3",
    "report refresh must not insert above the reader"
  );
  assert.equal(
    reads.friends,
    inactiveReads,
    "invalidation must not poll the hidden source"
  );
  document.hidden = true;
  const before = reads.public;
  listeners.get("player-block-changed")();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads.public, before);
  assert.equal(feeds.public.getSnapshot().items.length, 0);
  cleanup.forEach(stop => stop());
  assert.equal(listeners.size, 0);
});

test("a successful wall report emits the shared feed invalidation, not a failed report", async () => {
  const events = [];
  let error = null;
  const { reportUser } = load(
    "lib/data/moderation.ts",
    {
      "@/utils/supabase/client": {
        createClient: () => ({ rpc: async () => ({ error }) })
      },
      "@/lib/data/cards": { invalidatePlayerSnapshots: () => {} }
    },
    { window: { dispatchEvent: event => events.push(event) }, CustomEvent }
  );
  const input = {
    userId: "alice",
    contextType: "wall_reply",
    contextId: "reply",
    reason: "spam",
    details: "",
    blockAlso: false
  };
  await reportUser(input);
  assert.equal(events[0].type, "profile-wall-changed");
  assert.equal(events[0].detail.kind, "reported");
  assert.equal(events[0].detail.id, "reply");
  error = { message: "REPORT_DUPLICATE" };
  await assert.rejects(reportUser(input), /already reported/);
  assert.equal(events.length, 1);
});

function feedCase({
  available = true,
  isPublic = false,
  loading = false,
  error = "",
  items = []
} = {}) {
  const published = [];
  const walls = [];
  const state = {
    available,
    items,
    next: null,
    pending: [],
    loading,
    loaded: !loading,
    error
  };
  const store = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    published: p => published.push(p),
    removed: () => {}
  };
  let slot = 0;
  const { SocialFeed } = load("components/social-feed.tsx", {
    react: {
      ...React,
      useEffect: () => {},
      useState: initial => [
        slot++ === 0
          ? { id: "me", pseudo: "Me", friends: [], isPublic }
          : initial,
        () => {}
      ]
    },
    "next/link": link,
    "next/navigation": {
      redirect: href => {
        throw new Error(`redirect:${href}`);
      }
    },
    "@/components/social-feed-provider": {
      useSocialFeeds: () => ({ friends: store, public: store })
    },
    "@/components/everyone-friend-action": { EveryoneFriendAction: () => null },
    "@/components/profile-wall": {
      ProfileWall: props => {
        walls.push(props);
        return React.createElement("div", {
          "data-composer": !!props.composerOnly
        });
      }
    },
    "@/components/ui": {
      Skeleton: ({ label }) => React.createElement("p", null, label),
      Button: ({ children }) => React.createElement("button", null, children)
    },
    "@/components/public-post-focus": { PublicPostFocus: () => null },
    "@/styles/social-post-focus.css": {},
    "@/lib/data/profile": {},
    "@/lib/ui/visible-polling": {}
  });
  return {
    render: () =>
      renderToStaticMarkup(
        React.createElement(SocialFeed, { source: "public" })
      ),
    walls,
    published
  };
}

test("Everyone redirects only when the public RPC is missing", async () => {
  assert.throws(
    () => feedCase({ available: false }).render(),
    /redirect:\/social/
  );
  assert.match(
    feedCase({ available: undefined, loading: true }).render(),
    /Loading/
  );
  const SocialFeed = () => null;
  const { default: page, generateMetadata } = load(
    "app/social/everyone/page.tsx",
    {
      "@/components/social-feed": { SocialFeed }
    }
  );
  assert.equal(page().props.source, "public");
  assert.equal((await generateMetadata()).title, "Everyone");
});

test("private composer explains privacy and never inserts a private publication into Everyone", () => {
  for (const isPublic of [false, true]) {
    const view = feedCase({ isPublic });
    const html = view.render();
    assert.equal(html.includes("Your profile is private:"), !isPublic);
    if (!isPublic) {
      assert.match(html, /won&#x27;t appear in Everyone/);
      assert.match(html, /href="\/settings"/);
    }
    let stateSlot = 0;
    const composerWalls = [];
    const { SocialComposer } = load("components/social-composer.tsx", {
      react: {
        ...React,
        useEffect: () => {},
        useState: initial => [
          stateSlot++ === 0
            ? true
            : stateSlot === 2
              ? { id: "me", pseudo: "Me", isPublic }
              : initial,
          () => {}
        ]
      },
      "@/components/social-feed-provider": {
        useSocialFeeds: () => ({
          friends: { published: () => {} },
          public: { published: p => view.published.push(p) }
        })
      },
      "@/lib/data/profile": {},
      "@/components/ui": {
        Button: ({ children }) => React.createElement("button", null, children),
        Modal: ({ children, keepMounted }) => {
          assert.equal(keepMounted, true);
          return children;
        },
        Skeleton: () => null
      },
      "@/components/profile-wall": {
        ProfileWall: props => {
          composerWalls.push(props);
          return null;
        }
      }
    });
    const composerHtml = renderToStaticMarkup(
      React.createElement(SocialComposer)
    );
    assert.match(composerHtml, /Post/);
    const composer = composerWalls.find(p => p.composerOnly);
    assert.ok(composer);
    composer.onPublished(post(4));
    assert.equal(view.published.length, isPublic ? 1 : 0);
  }
});

test("Everyone shows loading, public empty, retry and end states without friend-feed copy", () => {
  const initial = feedCase({ loading: true }).render();
  assert.match(initial, /Loading/);
  assert.doesNotMatch(initial, /No public posts yet/);
  assert.match(feedCase().render(), /No public posts yet/);
  assert.match(feedCase().render(), /Publish a post/);
  const failure = feedCase({ error: "Please try again." }).render();
  assert.match(failure, /role="alert"/);
  assert.match(failure, /Refresh feed/);
  assert.doesNotMatch(failure, /No public posts yet/);
  const populated = feedCase({ items: [post(1)] }).render();
  assert.match(populated, /caught up/);
  assert.doesNotMatch(populated, /Find friends|Add friend/);
});
