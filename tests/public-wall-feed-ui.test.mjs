import { intl, gameMessages, loadLocaleModule } from "./helpers/i18n.mjs";
import { wallMentions } from "./helpers/wall-mentions.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: 1, target: 9, jsx: 4 }
    }).outputText,
    {
      exports,
      Error,
      AbortSignal,
      require: name =>
        name in mocks
          ? mocks[name]
          : name === "next-intl"
            ? intl
            : name === "@/i18n/game-messages"
              ? gameMessages
              : name === "@/i18n/locale"
                ? loadLocaleModule()
                : require(name)
    }
  );
  return exports;
}
const activity = {
  likes: 2,
  likedByMe: false,
  reactions: [],
  replyCount: 0,
  items: [],
  next: null
};
function adapter(result) {
  const calls = [];
  const api = load("lib/data/wall-interactions.ts", {
    "@/utils/supabase/client": {
      createClient: () => ({
        rpc: (name, args) => ({
          abortSignal: async () => {
            calls.push({ name, args });
            return result(name, args);
          }
        })
      })
    },
    "./profile-wall": { liveWall: {} }
  });
  return { calls, ...api };
}
test("Social loads one batch per new page, no individual activity reads and no repeat on polling", async () => {
  const api = adapter((name, args) => ({
    data: Object.fromEntries(args.p_post_ids.map(id => [id, activity])),
    error: null
  }));
  const { appendFeedPage } = load("lib/data/friend-feed.ts", {
    "@/utils/supabase/client": {},
    "@/lib/data/read-request": {}
  });
  const { createSocialFeedStore } = load("lib/ui/social-feed-store.ts", {
    "@/lib/data/friend-feed": { appendFeedPage }
  });
  const posts = Array.from({ length: 60 }, (_, n) => ({
    id: String(n),
    createdAt: new Date(2026, 0, 1, 0, n).toISOString()
  }));
  let offset = 0;
  const store = createSocialFeedStore(async cursor => {
    offset = cursor ? Number(cursor.id) : 0;
    return {
      items: posts.slice(offset, offset + 20),
      next:
        offset < 40
          ? { id: String(offset + 20), at: posts[offset + 20].createdAt }
          : null
    };
  }, api.hydrateFeedActivity);
  await store.refresh();
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].args.p_post_ids.length, 20);
  await store.refresh();
  assert.equal(
    api.calls.length,
    1,
    "mounted activity must not reload at 60s polling"
  );
  await store.more();
  await store.more();
  assert.equal(api.calls.length, 3);
  assert.ok(api.calls.every(call => call.name === "get_wall_posts_activity"));
  assert.equal(store.getSnapshot().items.length, 60);
  assert.ok(store.getSnapshot().items.every(post => post.activity.likes === 2));
  assert.match(
    readFileSync("components/social-feed-provider.tsx", "utf8"),
    /createSocialFeedStore\(getFriendFeed, hydrateFeedActivity\)/
  );
  assert.match(
    readFileSync("components/social-feed-provider.tsx", "utf8"),
    /createSocialFeedStore\(getPublicFeed, hydrateFeedActivity\)/
  );
  assert.match(
    readFileSync("components/profile-wall.tsx", "utf8"),
    /initialActivity=\{initialActivity\}/
  );
});
test("batch adapter falls back only for missing RPCs and omits inaccessible posts", async () => {
  for (const code of ["PGRST202", "42883"]) {
    const api = adapter((name, args) =>
      name === "get_wall_posts_activity"
        ? { error: { code } }
        : args.p_post_id === "hidden"
          ? { error: { message: "WALL_POST_UNAVAILABLE" } }
          : { data: activity, error: null }
    );
    const result = await api.getWallPostsActivity(["a", "hidden", "b"]);
    assert.deepEqual(Object.keys(result), ["a", "b"]);
    assert.equal(api.calls.length, 4);
    assert.equal(api.calls[1].name, "get_wall_post_activity");
  }
  const api = adapter(() => ({ error: { code: "42501", message: "SECRET" } }));
  await assert.rejects(
    api.getWallPostsActivity(["a"]),
    /Couldn't load this page's activity/
  );
  assert.equal(api.calls.length, 1);
  assert.deepEqual(Object.keys(await api.getWallPostsActivity([])), []);
  await assert.rejects(
    api.getWallPostsActivity(Array(21).fill("a")),
    /up to 20/
  );
  assert.equal(api.calls.length, 1);
});
test("seeded post UI never issues an initial unit read; profile still does", async () => {
  for (const seed of [activity, null, undefined]) {
    const effects = [];
    let reads = 0;
    const { WallPostInteractions } = load(
      "components/wall-post-interactions.tsx",
      {
        "@/components/wall-mentions": wallMentions,
        react: { ...React, useEffect: effect => effects.push(effect) },
        "next/link": {
          __esModule: true,
          default: ({ children, ...props }) =>
            React.createElement("a", props, children)
        },
        "@/components/ui": {
          Avatar: () => null,
          Button: ({ children, ...props }) =>
            React.createElement("button", props, children)
        },
        "@/components/emoji-reaction-picker": {
          EmojiReactionPicker: () => null
        },
        "@/components/gif-picker": { GifPicker: () => null },
        "@/components/player-moderation": { PlayerModeration: () => null },
        "@/lib/ui/reaction-emojis": {},
        "@/lib/data/wall-interactions": {
          liveWallInteractions: {
            read: async () => {
              reads++;
              return activity;
            }
          }
        },
        "@/styles/wall-interactions.css": {}
      }
    );
    renderToStaticMarkup(
      React.createElement(WallPostInteractions, {
        postId: "a",
        initialActivity: seed
      })
    );
    effects.forEach(effect => effect());
    await Promise.resolve();
    assert.equal(reads, seed === undefined ? 1 : 0);
  }
});
test("public adapter has a safe missing-RPC fallback, composite cursor and no home-feed substitution", async () => {
  let error = { code: "PGRST202" };
  let calls = [];
  const { getPublicFeed } = load("lib/data/friend-feed.ts", {
    "@/utils/supabase/client": {
      createClient: () => ({
        rpc: (name, args) => ({
          abortSignal: async () => {
            calls.push({ name, args });
            return { data: { items: [], next: null }, error };
          }
        })
      })
    },
    "@/lib/data/read-request": { readRequest: read => read(undefined) }
  });
  assert.equal((await getPublicFeed()).items.length, 0);
  error = { code: "42883" };
  assert.equal((await getPublicFeed()).next, null);
  error = null;
  await getPublicFeed({ id: "a", at: "2026-10-25" });
  assert.ok(calls.every(call => call.name === "get_public_wall_feed"));
  assert.equal(calls.at(-1).args.p_before_id, "a");
  error = { message: "AUTH_REQUIRED" };
  await assert.rejects(getPublicFeed(), /Sign in again/);
  error = { message: "FEED_CURSOR_INVALID" };
  await assert.rejects(getPublicFeed(), /Refresh your feed/);
  error = { code: "42501", message: "SECRET" };
  await assert.rejects(getPublicFeed(), /Couldn't load your timeline/);
});
