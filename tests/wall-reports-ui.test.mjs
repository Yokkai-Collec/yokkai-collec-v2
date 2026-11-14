import { intl, gameMessages, loadLocaleModule } from "./helpers/i18n.mjs";
import { wallMentions } from "./helpers/wall-mentions.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { deleteReportedWallContent } from "../lib/server/admin-wall-content-core.mjs";

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
const ui = {
  Avatar: ({ name }) => name,
  Button: ({ children, variant, ...props }) => {
    return React.createElement(
      "button",
      { ...props, "data-variant": variant },
      children
    );
  },
  Modal: () => null,
  Toast: () => null
};
test("shared profile/feed posts expose Report only for another known player's post", () => {
  let admin = false;
  const { ProfileWall } = load("components/profile-wall.tsx", {
    "@/components/wall-mentions": wallMentions,
    "@/components/player-moderation": {
      PlayerModeration: ({ contextId, contextType }) =>
        React.createElement(
          "button",
          { "data-report-id": contextId, "data-report-type": contextType },
          "Report"
        )
    },
    "@/components/ui": ui,
    "@/hooks/use-is-admin": { useIsAdmin: () => admin },
    "@/components/gif-picker": {},
    "@/components/wall-post-interactions": { WallPostInteractions: () => null },
    "@/lib/data/profile-wall": { liveWall: {} },
    "@/components/styled-player-name": { StyledPlayerName: ({ name }) => name },
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) =>
        React.createElement("a", props, children)
    }
  });
  const props = {
    ownerId: "alice",
    pseudo: "Alice",
    avatarUrl: null,
    isPublic: true,
    canRead: true,
    active: true,
    feedPost: {
      id: "post",
      text: "Story",
      createdAt: "2026-10-25T00:00:00Z",
      mediaPath: null,
      gifUrl: null
    }
  };
  const render = extra =>
    renderToStaticMarkup(
      React.createElement(ProfileWall, { ...props, ...extra })
    );
  assert.match(
    render({ isMe: false }),
    /data-report-id="post" data-report-type="wall_post"/
  );
  assert.doesNotMatch(render({ isMe: true }), /data-report-id/);
  assert.doesNotMatch(
    render({ isMe: false, canReport: false }),
    /data-report-id/
  );
  assert.doesNotMatch(render({ isMe: false }), /Delete this post/);
  admin = true;
  assert.match(
    render({ isMe: false }),
    /aria-label="Delete this post"[^>]*data-variant="danger"[^>]*>Remove/
  );
  admin = false;
  assert.doesNotMatch(render({ isMe: false }), /Delete this post/);
});

test("legacy databases return the neutral unavailable message for wall contexts, never SQL errors", async () => {
  for (const error of [
    { message: "REPORT_INVALID" },
    { code: "23514", message: "constraint details" },
    { code: "PGRST202", message: "RPC missing" }
  ]) {
    const { reportUser } = load("lib/data/moderation.ts", {
      "@/utils/supabase/client": {
        createClient: () => ({ rpc: async () => ({ error }) })
      },
      "@/lib/data/cards": {}
    });
    await assert.rejects(
      reportUser({
        userId: "alice",
        reason: "spam",
        contextType: "wall_post",
        contextId: "post",
        details: "",
        blockAlso: false
      }),
      { message: "Reporting this content isn't available yet." }
    );
  }
});

test("admin deletion invokes Storage cleanup only after the protected RPC and supports retry", async () => {
  const path =
    "91000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000002.png";
  const removed = [];
  let alreadyDeleted = false,
    fail = false;
  const client = {
    rpc: async (name, args) => {
      if (name === "authorize_wall_reply_media_cleanup") {
        assert.equal(args.p_path, path);
        return { data: path, error: null };
      }
      assert.equal(name, "admin_delete_reported_wall_content");
      assert.equal(args.p_report_id, "report");
      return { data: { alreadyDeleted, mediaPaths: [path] }, error: null };
    }
  };
  const storage = () => ({
    storage: {
      from: bucket => {
        assert.equal(bucket, "profile-wall-media");
        return {
          remove: async paths => {
            removed.push(paths);
            return { error: fail ? new Error("storage") : null };
          }
        };
      }
    }
  });
  assert.equal(
    (await deleteReportedWallContent(client, "report", storage)).ok,
    true
  );
  assert.deepEqual(removed, [[path]]);
  fail = true;
  const failed = await deleteReportedWallContent(client, "report", storage);
  assert.equal(failed.contentDeleted, true);
  assert.equal(failed.ok, false);
  assert.match(failed.message, /Retry/);
  fail = false;
  alreadyDeleted = true;
  assert.match(
    (await deleteReportedWallContent(client, "report", storage)).message,
    /already deleted/
  );
  let called = false;
  const denied = await deleteReportedWallContent(
    { rpc: async () => ({ error: { message: "ADMIN_REQUIRED" } }) },
    "report",
    () => {
      called = true;
    }
  );
  assert.equal(denied.ok, false);
  assert.equal(called, false);
});

test("admin report rows display wall snapshots, author links and a confirmation action", () => {
  const { ReportList } = load("app/admin/reports/report-list.tsx", {
    react: {
      ...React,
      useActionState: () => [{ ok: false, message: "" }, () => {}, false]
    },
    "./actions": {},
    "@/components/ui": ui,
    // Real English catalogue for the strings added in #379.
    "next-intl": {
      useTranslations: namespace =>
        createTranslator({
          locale: "en",
          messages: JSON.parse(readFileSync("messages/en.json", "utf8")),
          namespace
        })
    },
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) =>
        React.createElement("a", props, children)
    }
  });
  const html = renderToStaticMarkup(
    React.createElement(ReportList, {
      playerHrefBase: "/admin/reports?player=",
      reports: [
        {
          id: "report",
          reporterId: "bob",
          reporterPseudo: "Bob",
          reportedId: "alice",
          reportedPseudo: "Alice",
          reason: "spam",
          contextType: "wall_reply",
          contextId: "reply",
          snapshot: {
            message: "Reported story",
            hasMedia: true,
            author: { pseudo: "Alice" },
            createdAt: "2026-10-25T00:00:00Z",
            postId: "parent"
          },
          status: "pending",
          createdAt: "2026-10-25T00:00:00Z"
        }
      ]
    })
  );
  assert.match(html, /Wall reply/);
  assert.match(html, /Reported story/);
  assert.match(html, /Parent post: parent/);
  assert.match(html, /href="\/profile\/alice\?tab=wall"/);
  assert.match(html, /Delete content/);
  assert.match(html, /Private image bytes are not retained/);
});
