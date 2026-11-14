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
const testModule = { exports: {} };
const mocks = {
  "@/components/wall-mentions": wallMentions,
  "@/components/player-moderation": { PlayerModeration: () => null },
  "@/components/wall-post-interactions": { WallPostInteractions: () => null },
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
  "@/components/gif-picker": {
    GifPicker: () => React.createElement("button", { type: "button" }, "GIF")
  },
  "@/lib/data/profile-wall": { liveWall: {} },
  "@/components/styled-player-name": {
    StyledPlayerName: ({ name }) => React.createElement("span", null, name)
  }
};
const source = readFileSync("components/profile-wall.tsx", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX
  }
}).outputText;
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
const { ProfileWall } = testModule.exports;
const own = {
  ownerId: "viewer",
  pseudo: "Raven",
  avatarUrl: null,
  isMe: true,
  isPublic: false,
  canRead: true,
  active: true
};
const render = props =>
  renderToStaticMarkup(React.createElement(ProfileWall, { ...own, ...props }));

test("Home reuses the real wall composer without the profile's timeline chrome", () => {
  const html = render({ composerOnly: true });
  assert.match(html, /Raven/);
  assert.match(html, /textarea[^>]*maxLength="3000"/i);
  assert.match(html, /Add image/);
  assert.match(html, />GIF</);
  assert.match(html, /type="submit" disabled=""/);
  assert.match(html, /One image or GIF per post/);
  assert.match(html, /Visibility follows your/);
  assert.doesNotMatch(
    html,
    /Wall of|first story|yk-wall-posts|See older posts/
  );
});

test("normal profile wall stays intact and private/non-owner views cannot compose", () => {
  const full = render({});
  assert.match(full, /Wall of Raven/);
  assert.match(full, /first story/);
  assert.match(full, /yk-wall-posts/);
  assert.doesNotMatch(
    render({ composerOnly: true, canRead: false }),
    /<form|<textarea/
  );
  assert.doesNotMatch(
    render({ composerOnly: true, isMe: false }),
    /<form|<textarea/
  );
});

test("Home obtains its own identity through the existing RPC rather than widening profile table access", () => {
  const home = readFileSync("components/home-dashboard.tsx", "utf8");
  assert.match(home, /\.rpc\("get_profile", \{ p_identifier: null \}\)/);
  assert.match(home, /profile.data\?\.id === userId/);
  assert.doesNotMatch(home, /\.from\("user_profiles"\)/);
});

test("the shared Home/profile wall textarea cannot be manually resized and keeps long drafts scrollable", () => {
  const css = readFileSync("styles/profile.css", "utf8");
  const rule = css.match(/\.yk-wall-composer textarea\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule, "Shared composer rule must exist");
  assert.match(rule, /resize:\s*none/);
  assert.match(rule, /overflow-y:\s*auto/);
});

test("the Home wall uses the same shared panel background as the surrounding dashboard", () => {
  const home = readFileSync("styles/home.css", "utf8");
  const feed = readFileSync("styles/friend-feed.css", "utf8");
  assert.match(home, /--home-panel-background:\s*linear-gradient\(/);
  assert.match(
    home,
    /\.yk-home-panel\s*\{[^}]*background:\s*var\(--home-panel-background\)/
  );
  assert.match(
    feed,
    /\.yk-friend-feed\s*\{[^}]*background:\s*var\(--home-panel-background,/
  );
  assert.match(
    feed,
    /\.yk-feed-composer \.yk-wall-composer\s*\{[^}]*background:\s*transparent/
  );
});
