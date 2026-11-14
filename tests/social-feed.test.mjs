import { wallMentions } from "./helpers/wall-mentions.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import {
  englishMessages,
  intl,
  gameMessages,
  loadLocaleModule
} from "./helpers/i18n.mjs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
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
      Error,
      require: name =>
        name === "@/i18n/game-messages"
          ? gameMessages
          : name === "next-intl"
            ? intl
            : name === "@/i18n/locale"
              ? loadLocaleModule()
              : name in mocks
                ? mocks[name]
                : require(name)
    }
  );
  return exports;
}
const data = load("lib/data/friend-feed.ts", {
  "@/utils/supabase/client": {},
  "@/lib/data/read-request": {}
});
const { createSocialFeedStore } = load("lib/ui/social-feed-store.ts", {
  "@/lib/data/friend-feed": data
});
const post = n => ({
  id: String(n),
  createdAt: `2026-10-24T12:${String(n).padStart(2, "0")}:00Z`,
  text: `Post ${n}`,
  hasMedia: false,
  gifUrl: null,
  author: { id: "alice", name: "Alice", avatarUrl: null }
});
const ids = store => Array.from(store.getSnapshot().items, item => item.id);

test("feed pages follow the cursor, deduplicate IDs and reach the end", async () => {
  const cursor = { at: post(2).createdAt, id: "2" };
  const calls = [];
  const store = createSocialFeedStore(async before => {
    calls.push(before);
    return before
      ? { items: [post(2), post(1)], next: null }
      : { items: [post(3), post(2)], next: cursor };
  });
  await store.refresh();
  await store.more();
  assert.deepEqual(calls, [null, cursor]);
  assert.deepEqual(ids(store), ["3", "2", "1"]);
  assert.equal(store.getSnapshot().next, null);
  await store.more();
  assert.equal(calls.length, 2);
});

test("polling queues new posts until clicked and restarts the cursor without losing gaps", async () => {
  let page = { items: [post(2), post(1)], next: null };
  const calls = [];
  const store = createSocialFeedStore(async cursor => {
    calls.push(cursor);
    return page;
  });
  await store.refresh();
  const cursor = { at: post(5).createdAt, id: "5" };
  page = { items: [post(6), post(5)], next: cursor };
  await store.refresh();
  await store.refresh();
  assert.deepEqual(
    ids(store),
    ["2", "1"],
    "background refresh must not move the reader"
  );
  assert.equal(store.getSnapshot().pending.length, 2);
  store.showNew();
  assert.deepEqual(ids(store), ["6", "5", "2", "1"]);
  assert.equal(store.getSnapshot().pending.length, 0);
  page = { items: [post(4), post(3), post(2)], next: null };
  await store.more();
  assert.deepEqual(calls.at(-1), cursor);
  assert.deepEqual(ids(store), ["6", "5", "4", "3", "2", "1"]);
});

test("publication is immediate, deletion removes queued posts and blocking rejects stale reads", async () => {
  let finish;
  const store = createSocialFeedStore(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  const pending = store.refresh();
  store.published(post(3));
  assert.deepEqual(ids(store), ["3"]);
  finish({ items: [post(2)], next: null });
  await pending;
  assert.deepEqual(ids(store), ["3", "2"]);
  store.removed("3");
  assert.deepEqual(ids(store), ["2"]);
  const stale = store.refresh();
  store.clear();
  finish({ items: [post(9)], next: null });
  await stale;
  assert.deepEqual(ids(store), []);
  assert.equal(store.getSnapshot().loaded, false);
});

test("pagination failures preserve the list and cursor for retry", async () => {
  let failed = true;
  const cursor = { at: post(2).createdAt, id: "2" };
  const store = createSocialFeedStore(async before => {
    if (!before) return { items: [post(2)], next: cursor };
    if (failed) throw new Error("Please retry.");
    return { items: [post(1)], next: null };
  });
  await store.refresh();
  await store.more();
  assert.equal(store.getSnapshot().error, "Please retry.");
  assert.deepEqual(ids(store), ["2"]);
  assert.deepEqual(store.getSnapshot().next, cursor);
  failed = false;
  await store.more();
  assert.deepEqual(ids(store), ["2", "1"]);
});

test("queued posts are discarded when the next protected read no longer returns them", async () => {
  let page = { items: [post(1)], next: null };
  const store = createSocialFeedStore(async () => page);
  await store.refresh();
  page = { items: [post(2), post(1)], next: null };
  await store.refresh();
  assert.equal(store.getSnapshot().pending.length, 1);
  page = { items: [post(1)], next: null };
  await store.refresh();
  assert.equal(store.getSnapshot().pending.length, 0);
  assert.deepEqual(ids(store), ["1"]);
});

test("feed errors have English messages and Home links to the full feed", () => {
  assert.match(data.feedErrorMessage("AUTH_REQUIRED"), /Sign in again/);
  assert.match(
    data.feedErrorMessage("FEED_CURSOR_INVALID"),
    /Refresh your feed/
  );
  assert.equal(
    data.feedErrorMessage("SECRET_DATABASE_ERROR"),
    "Couldn't load your timeline. Please try again."
  );
  const home = readFileSync("components/home-friend-feed.tsx", "utf8");
  assert.match(home, /href="\/social">\{t\("seeAll"\)\}<\/Link>/);
  assert.equal(englishMessages.homeFriendFeed.seeAll, "See all");
  assert.match(home, /page.items.slice\(0, 10\)/);
  const feed = readFileSync("components/social-feed.tsx", "utf8");
  assert.match(feed, /startVisiblePolling\(refresh, 60_000\)/);
  assert.match(feed, /store.showNew\(\)/);
});

test("Feed uses the actual profile post UI, private media route and interaction component", () => {
  const liveWall = {};
  const { ProfileWall } = load("components/profile-wall.tsx", {
    "@/components/wall-mentions": wallMentions,
    "@/components/player-moderation": { PlayerModeration: () => null },
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) =>
        React.createElement("a", props, children)
    },
    "@/components/ui": {
      Avatar: ({ name }) => React.createElement("span", null, name),
      Button: ({ children, variant, ...props }) => {
        void variant;
        return React.createElement("button", props, children);
      },
      Modal: () => null,
      Toast: () => null
    },
    "@/hooks/use-is-admin": { useIsAdmin: () => false },
    "@/components/gif-picker": {},
    "@/components/wall-post-interactions": {
      WallPostInteractions: ({ postId }) =>
        React.createElement("div", { "data-interactions": postId })
    },
    "@/components/styled-player-name": { StyledPlayerName: ({ name }) => name },
    "@/lib/data/profile-wall": { liveWall }
  });
  const props = {
    ownerId: "alice",
    pseudo: "Alice",
    avatarUrl: null,
    isMe: true,
    isPublic: false,
    canRead: true,
    active: true,
    canInteract: true,
    feedPost: { ...post(1), mediaPath: null, hasMedia: true }
  };
  const html = renderToStaticMarkup(React.createElement(ProfileWall, props));
  assert.match(html, /data-interactions="1"/);
  assert.match(html, /<button[^>]*aria-label="Enlarge image"[^>]*><img/);
  assert.match(html, /src="\/api\/profile-wall\/media\/1"/);
  assert.match(html, /aria-label="Delete this post"/);
  assert.match(
    html,
    /<details class="yk-wall-post-menu"><summary aria-label="Actions for Alice">⋯<\/summary>/
  );
  assert.match(html, /href="\/profile\/alice\?tab=wall"/);
  assert.doesNotMatch(html, /<textarea|Wall of|first story/);
  assert.doesNotMatch(
    renderToStaticMarkup(
      React.createElement(ProfileWall, { ...props, isMe: false })
    ),
    /Delete this post/
  );
});

test("the feed loader maps server failures and forwards the composite cursor", async () => {
  let failure = "AUTH_REQUIRED";
  let args;
  const { getFriendFeed } = load("lib/data/friend-feed.ts", {
    "@/utils/supabase/client": {
      createClient: () => ({
        rpc: (name, params) => {
          assert.equal(name, "get_home_wall_feed");
          args = params;
          return {
            abortSignal: async () => ({
              data: { items: [], next: null },
              error: failure ? { message: failure } : null
            })
          };
        }
      })
    },
    "@/lib/data/read-request": { readRequest: async read => read(undefined) }
  });
  await assert.rejects(getFriendFeed(), /Sign in again/);
  failure = "FEED_CURSOR_INVALID";
  await assert.rejects(getFriendFeed(), /Refresh your feed/);
  failure = "DATABASE_SECRET";
  await assert.rejects(getFriendFeed(), /Couldn't load your timeline/);
  failure = "";
  await getFriendFeed({ at: post(1).createdAt, id: "1" });
  assert.equal(args.p_before, post(1).createdAt);
  assert.equal(args.p_before_id, "1");
  assert.ok(args.p_limit <= 20);
});
