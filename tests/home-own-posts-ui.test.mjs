import { wallMentions } from "./helpers/wall-mentions.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { intl, gameMessages, loadLocaleModule } from "./helpers/i18n.mjs";

const require = createRequire(import.meta.url);
function load(file, mocks) {
  const testModule = { exports: {} };
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
  vm.runInNewContext(js, {
    module: testModule,
    exports: testModule.exports,
    crypto: globalThis.crypto,
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
  });
  return testModule.exports;
}
const button = ({ children, variant, ...props }) => {
  void variant;
  return React.createElement("button", props, children);
};
const ui = {
  Button: button,
  Avatar: () => null,
  Modal: () => null,
  Toast: () => null
};
const player = { id: "viewer", name: "Raven", avatarUrl: null };

test("a successful Home publication reloads the first page and includes the own post", async () => {
  let onPublished;
  let loadCount = 0;
  const states = [];
  const ownPost = {
    id: "new-post",
    author: player,
    text: "A new favorite",
    createdAt: "2026-10-21T10:00:00Z",
    hasMedia: false,
    gifUrl: null
  };
  const { HomeFriendFeed } = load("components/home-friend-feed.tsx", {
    react: {
      ...React,
      useState: initial => {
        const i = states.length;
        states.push(initial);
        return [
          initial,
          value => {
            states[i] = typeof value === "function" ? value(states[i]) : value;
          }
        ];
      }
    },
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) =>
        React.createElement("a", props, children)
    },
    "@/components/ui": ui,
    "@/components/profile-wall": {
      ProfileWall: props => {
        onPublished = props.onPublished;
        return null;
      }
    },
    "@/components/styled-player-name": { StyledPlayerName: () => null },
    "@/components/wall-post-interactions": { WallPostInteractions: () => null },
    "@/lib/data/friend-feed": {},
    "@/lib/data/profile-wall": { liveWall: {} },
    "@/lib/ui/public-post-link": { publicPostHref: () => "/social/everyone" },
    "@/styles/friend-feed.css": {}
  });
  const html = renderToStaticMarkup(
    React.createElement(HomeFriendFeed, {
      initial: { items: [], next: null },
      viewer: player,
      load: async cursor => {
        assert.equal(cursor, undefined);
        loadCount++;
        return { items: [ownPost], next: null };
      }
    })
  );
  assert.match(html, /Friend feed/);
  assert.doesNotMatch(html, /Your posts and your friends|Between friends/);
  assert.doesNotMatch(html, /You &amp; friends/);
  assert.equal(typeof onPublished, "function");
  onPublished();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loadCount, 1);
  assert.equal(states[0].items[0].id, ownPost.id);
  assert.equal(states[1], false);
  assert.equal(states[2], "");
});

test("the shared composer notifies Home only after confirmed publication, keeping failed drafts", async () => {
  for (const fail of [false, true]) {
    let submit;
    let notified = 0;
    const states = [];
    const runtime = require("react/jsx-runtime");
    const wrap = name => (type, props, key) => {
      if (type === "form") submit = props.onSubmit;
      return runtime[name](type, props, key);
    };
    const { ProfileWall } = load("components/profile-wall.tsx", {
      "@/components/wall-mentions": wallMentions,
      "@/components/player-moderation": { PlayerModeration: () => null },
      react: {
        ...React,
        useState: initial => {
          const i = states.length;
          const value = i === 6 ? "Posting from Home" : initial;
          states.push(value);
          return [
            value,
            next => {
              states[i] = typeof next === "function" ? next(states[i]) : next;
            }
          ];
        }
      },
      "react/jsx-runtime": { ...runtime, jsx: wrap("jsx"), jsxs: wrap("jsxs") },
      "@/components/ui": ui,
      "@/hooks/use-is-admin": { useIsAdmin: () => false },
      "@/components/gif-picker": { GifPicker: () => null },
      "@/components/wall-post-interactions": {
        WallPostInteractions: () => null
      },
      "@/components/styled-player-name": { StyledPlayerName: () => null },
      "@/lib/data/profile-wall": {
        liveWall: {},
        wallRequestId: () => "00000000-0000-4000-8000-000000000001"
      }
    });
    renderToStaticMarkup(
      React.createElement(ProfileWall, {
        ownerId: player.id,
        pseudo: player.name,
        avatarUrl: null,
        isMe: true,
        isPublic: false,
        canRead: true,
        active: true,
        composerOnly: true,
        onPublished: () => {
          notified++;
        },
        adapter: {
          publish: async input => {
            assert.equal(notified, 0);
            assert.equal(input.text, "Posting from Home");
            if (fail)
              throw new Error(
                "Couldn't publish your post. Your draft has been kept."
              );
            return { ...input, createdAt: "2026-10-21T10:00:00Z" };
          }
        }
      })
    );
    submit({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(notified, fail ? 0 : 1);
    assert.equal(states[6], fail ? "Posting from Home" : "");
    assert.equal(states[10], false);
  }
});

test("Eggplant is a named, searchable reaction and its SQL guard matches the full catalogue", () => {
  const { REACTION_EMOJIS, reactionEmoji } = load(
    "lib/ui/reaction-emojis.ts",
    {}
  );
  assert.equal(reactionEmoji("eggplant").emoji, "🍆");
  assert.equal(reactionEmoji("eggplant").label, "Eggplant");
  const sql = readFileSync(
    "supabase/migrations/20261021030000_home_wall_feed_and_eggplant.sql",
    "utf8"
  );
  const lists = [...sql.matchAll(/array\[([^\]]+)\]/g)].map(match =>
    [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]).sort()
  );
  assert.equal(lists.length, 2);
  for (const list of lists)
    assert.deepEqual(list, Array.from(REACTION_EMOJIS, item => item.id).sort());
  assert.equal(REACTION_EMOJIS.length, 25);
});
