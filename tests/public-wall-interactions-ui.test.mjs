import * as wallMediaCleanup from "../lib/server/wall-media-cleanup.mjs";
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
function load(file, mocks = {}, extra = {}) {
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
                : require(name),
      ...extra
    }
  );
  return exports;
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
const activity = {
  likes: 0,
  likedByMe: false,
  items: [],
  replyCount: 0,
  next: null
};
function interactions(read) {
  const slots = [];
  let cursor = 0;
  const effects = [];
  const hook = initial => {
    const n = cursor++;
    if (!(n in slots))
      slots[n] = typeof initial === "function" ? initial() : initial;
    return [
      slots[n],
      value => {
        slots[n] = typeof value === "function" ? value(slots[n]) : value;
      }
    ];
  };
  const mockReact = {
    ...React,
    useState: hook,
    useRef: initial => hook(() => ({ current: initial }))[0],
    useId: () => hook("reply-field")[0],
    useCallback: (callback, deps) => {
      const [memo, set] = hook(() => ({ callback, deps }));
      if (deps.some((v, i) => v !== memo.deps[i])) {
        set({ callback, deps });
        return callback;
      }
      return memo.callback;
    },
    useEffect: (effect, deps = []) => {
      const [old, set] = hook(() => null);
      if (!old || deps.some((v, i) => v !== old[i])) {
        set(deps);
        effects.push(effect);
      }
    }
  };
  const { WallPostInteractions } = load(
    "components/wall-post-interactions.tsx",
    {
      "@/components/wall-mentions": wallMentions,
      react: mockReact,
      "next/link": {
        __esModule: true,
        default: ({ children, ...props }) =>
          React.createElement("a", props, children)
      },
      "@/components/ui": ui,
      "@/components/emoji-reaction-picker": { EmojiReactionPicker: () => null },
      "@/hooks/use-is-admin": { useIsAdmin: () => false },
      "@/components/gif-picker": { GifPicker: () => null },
      "@/components/player-moderation": { PlayerModeration: () => null },
      "@/lib/ui/reaction-emojis": {},
      "@/lib/data/wall-interactions": { liveWallInteractions: { read } },
      "@/styles/wall-interactions.css": {}
    }
  );
  return {
    render: props => {
      cursor = 0;
      return renderToStaticMarkup(
        React.createElement(WallPostInteractions, { postId: "post", ...props })
      );
    },
    flush: async () => {
      effects.splice(0).forEach(effect => effect());
      await Promise.resolve();
      await Promise.resolve();
    },
    open: () => {
      slots[1] = true;
    }
  };
}
test("public stranger interactions are API-authorized and legacy refusal is silent", async () => {
  const accepted = interactions(async () => ({
    ...activity,
    publicReplyNotice: true
  }));
  assert.equal(accepted.render({ hideUnavailable: true }), "");
  await accepted.flush();
  assert.match(
    accepted.render({ hideUnavailable: true }),
    /data-post-activity/
  );
  accepted.open();
  assert.match(
    accepted.render({ hideUnavailable: true }),
    /Your reply will be visible to anyone who can see this post\./
  );
  assert.match(
    accepted.render({ hideUnavailable: true }),
    /Visibility follows the\s*post\./
  );
  assert.doesNotMatch(
    accepted.render({ hideUnavailable: true }),
    /post and your profile settings/
  );
  const legacy = interactions(async () => {
    throw Object.assign(new Error("Unavailable"), {
      code: "WALL_POST_UNAVAILABLE"
    });
  });
  legacy.render({ hideUnavailable: true });
  await legacy.flush();
  assert.equal(legacy.render({ hideUnavailable: true }), "");
  const failed = interactions(async () => {
    throw new Error("Network failure");
  });
  failed.render({ hideUnavailable: true });
  await failed.flush();
  assert.match(
    failed.render({ hideUnavailable: true }),
    /Couldn&#x27;t load this post/
  );
});
test("API metadata controls owner moderation and stranger notice, with old payload compatibility", () => {
  for (const [canDelete, expected] of [
    [true, true],
    [false, false],
    [undefined, false]
  ]) {
    const fixture = interactions(async () => activity);
    fixture.render({
      initialActivity: {
        ...activity,
        items: [
          {
            id: "reply",
            text: "Reply",
            isMe: false,
            canDelete,
            createdAt: "2026-10-25",
            author: { id: "author", name: "Author" }
          }
        ]
      }
    });
    fixture.open();
    const html = fixture.render({
      initialActivity: {
        ...activity,
        items: [
          {
            id: "reply",
            text: "Reply",
            isMe: false,
            canDelete,
            createdAt: "2026-10-25",
            author: { id: "author", name: "Author" }
          }
        ]
      }
    });
    assert.equal(html.includes("Delete reply"), expected);
    assert.doesNotMatch(html, /Your reply will be visible/);
  }
  const { ProfileWall } = load("components/profile-wall.tsx", {
    "@/components/wall-mentions": wallMentions,
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) =>
        React.createElement("a", props, children)
    },
    "@/components/ui": ui,
    "@/hooks/use-is-admin": { useIsAdmin: () => false },
    "@/components/gif-picker": {},
    "@/components/player-moderation": { PlayerModeration: () => null },
    "@/components/wall-post-interactions": {
      WallPostInteractions: ({ hideUnavailable }) =>
        React.createElement("div", { "data-optional": String(hideUnavailable) })
    },
    "@/components/styled-player-name": { StyledPlayerName: ({ name }) => name },
    "@/lib/data/profile-wall": { liveWall: {} }
  });
  const props = {
    ownerId: "author",
    pseudo: "Author",
    avatarUrl: null,
    isMe: false,
    isPublic: true,
    canRead: true,
    active: true,
    canInteract: false,
    feedPost: {
      id: "post",
      text: "Story",
      createdAt: "2026-10-25",
      mediaPath: null,
      gifUrl: null
    }
  };
  assert.match(
    renderToStaticMarkup(React.createElement(ProfileWall, props)),
    /data-optional="true"/
  );
  assert.doesNotMatch(
    renderToStaticMarkup(
      React.createElement(ProfileWall, { ...props, isPublic: false })
    ),
    /data-optional/
  );
});
test("moderated media cleanup authenticates and authorizes before creating a privileged client", async () => {
  const path =
    "95000000-0000-4000-8000-000000000001/95000000-0000-4000-8000-000000000002.png";
  for (const scenario of [
    "allowed",
    "unauthenticated",
    "denied",
    "missing",
    "wrong-path",
    "no-key",
    "storage-failed"
  ]) {
    let privileged = 0,
      removed = [];
    const { discardModeratedReplyMedia } = load(
      "app/social/actions.ts",
      {
        "@/lib/server/wall-media-cleanup.mjs": wallMediaCleanup,
        "next/headers": { cookies: async () => ({}) },
        "@/utils/supabase/server": {
          createClient: () => ({
            auth: {
              getUser: async () => ({
                data: {
                  user: scenario === "unauthenticated" ? null : { id: "owner" }
                },
                error: null
              })
            },
            rpc: async (name, args) => {
              assert.equal(name, "authorize_wall_reply_media_cleanup");
              assert.equal(args.p_path, path);
              return {
                data:
                  scenario === "missing"
                    ? null
                    : scenario === "wrong-path"
                      ? "other"
                      : path,
                error:
                  scenario === "denied"
                    ? { message: "WALL_MEDIA_INVALID" }
                    : null
              };
            }
          })
        },
        "@supabase/supabase-js": {
          createClient: () => {
            privileged++;
            return {
              storage: {
                from: bucket => {
                  assert.equal(bucket, "profile-wall-media");
                  return {
                    remove: async paths => {
                      removed = paths;
                      return {
                        error: scenario === "storage-failed" ? {} : null
                      };
                    }
                  };
                }
              }
            };
          }
        },
        "@/utils/supabase/config": {
          getSupabaseConfig: () => ({ url: "https://example.test" })
        }
      },
      {
        process: {
          env: scenario === "no-key" ? {} : { SUPABASE_SECRET_KEY: "test-only" }
        }
      }
    );
    assert.equal(
      (await discardModeratedReplyMedia(path)).ok,
      ["allowed", "missing"].includes(scenario),
      scenario
    );
    assert.equal(
      privileged,
      ["allowed", "storage-failed"].includes(scenario) ? 1 : 0,
      scenario
    );
    if (privileged) assert.deepEqual(Array.from(removed), [path]);
    assert.equal((await discardModeratedReplyMedia("../unsafe")).ok, false);
  }
});
