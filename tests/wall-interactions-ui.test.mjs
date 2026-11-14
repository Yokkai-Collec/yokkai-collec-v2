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
const own = {
  id: "own",
  text: "<script>alert(1)</script>",
  isMe: true,
  createdAt: "2026-10-20T12:00:00Z",
  author: { id: "friend", name: "Kitsune", avatarUrl: null }
};
const initial = {
  likes: 4,
  likedByMe: true,
  replyCount: 2,
  items: [own, { ...own, id: "other", isMe: false, text: "Great card!" }],
  next: null
};
function render({
  activity = initial,
  error = "",
  draft = "",
  file = null,
  preview = "",
  gif = ""
} = {}) {
  const states = [
    activity,
    true,
    draft,
    false,
    error,
    "",
    0,
    file,
    preview,
    gif,
    []
  ];
  let stateIndex = 0;
  const testModule = { exports: {} };
  const mocks = {
    "@/components/wall-mentions": wallMentions,
    "@/components/player-moderation": {
      PlayerModeration: ({ contextId }) =>
        React.createElement("button", { "data-report-id": contextId }, "Report")
    },
    react: {
      ...React,
      useState: () => [states[stateIndex++], () => {}],
      useEffect: () => {}
    },
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
      }
    },
    "@/lib/data/wall-interactions": { liveWallInteractions: {} },
    "@/components/emoji-reaction-picker": { EmojiReactionPicker: () => null },
    "@/components/gif-picker": {
      GifPicker: () => React.createElement("button", { type: "button" }, "GIF")
    },
    "@/lib/ui/reaction-emojis": {
      reactionEmoji: id => ({ id, label: id, emoji: "🔥" })
    },
    "@/styles/wall-interactions.css": {}
  };
  const js = ts.transpileModule(
    readFileSync("components/wall-post-interactions.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  vm.runInNewContext(js, {
    module: testModule,
    exports: testModule.exports,
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
  });
  return renderToStaticMarkup(
    React.createElement(testModule.exports.WallPostInteractions, {
      postId: "post-1"
    })
  );
}

test("activity renders accessible like state, escaped replies and only the current player's delete control", () => {
  const html = render();
  assert.match(html, /data-report-id="other"/);
  assert.doesNotMatch(html, /data-report-id="own"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Liked.*4/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /maxLength="1000"/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal((html.match(/Delete reply/g) ?? []).length, 1);
  assert.match(html, /href="\/profile\/friend\?tab=wall"/);
});

test("failed interactions clear private replies while retaining the draft and offering retry", () => {
  const html = render({
    activity: null,
    error: "Access changed. Please retry.",
    draft: "Keep my draft"
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /Retry/);
  assert.match(html, /Keep my draft/);
  assert.doesNotMatch(html, /data-wall-reply=/);
  assert.match(html, /type="submit" disabled=""/);
});

test("emoji reaction chips expose counts and whether the current player has reacted", () => {
  const html = render({
    activity: {
      ...initial,
      reactions: [
        { emoji: "fire", count: 3, reactedByMe: true },
        { emoji: "heart", count: 1, reactedByMe: false }
      ]
    }
  });
  assert.match(html, /aria-label="Post reactions"/);
  assert.match(html, /aria-label="Fire: 3 reactions" aria-pressed="true"/);
  assert.match(html, /aria-label="Love: 1 reaction" aria-pressed="false"/);
  assert.match(html, /Remove Fire reaction/);
});

test("reply composer supports one image/GIF, removable previews and media-only replies", () => {
  const html = render({
    draft: "",
    gif: "https://media.giphy.com/media/demo/giphy.gif"
  });
  assert.match(html, /Add image/);
  assert.match(html, />GIF</);
  assert.match(html, /aria-label="Reply image"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
  assert.match(html, /Reply attachment preview/);
  assert.match(html, /Remove attachment/);
  assert.match(html, /Up to 6 MB/);
  assert.doesNotMatch(html, /type="submit" disabled/);
  assert.match(render(), /type="submit" disabled/);
  const replies = render({
    activity: {
      ...initial,
      items: [
        { ...own, hasMedia: true, mediaPath: "not-exposed" },
        {
          ...own,
          id: "gif-reply",
          text: "",
          gifUrl: "https://media.giphy.com/media/demo/giphy.gif"
        }
      ]
    }
  });
  assert.match(replies, /src="\/api\/profile-wall\/reply-media\/own"/);
  assert.match(replies, /GIF attached to reply/);
  assert.match(replies, /loading="lazy"/);
  assert.doesNotMatch(replies, /not-exposed/);
});
