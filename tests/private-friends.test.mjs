import { intl, gameMessages, loadLocaleModule } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, overrides) {
  const exports = {};
  const code = ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    }
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    require: name =>
      name === "next-intl"
        ? intl
        : name === "@/i18n/game-messages"
          ? gameMessages
          : name === "@/i18n/locale"
            ? loadLocaleModule()
            : name in overrides
              ? overrides[name]
              : require(name)
  });
  return exports;
}
const friend = { id: "bob", pseudo: "Bob", avatarUrl: null };
const base = {
  id: "alice",
  pseudo: "Alice",
  bio: "",
  avatarUrl: null,
  bannerCard: null,
  friendshipStatus: "self",
  isPublic: true,
  canViewCollection: true,
  featuredCards: [],
  cardCount: 0,
  distinctCardCount: 0
};
function profileApi(response) {
  return load("lib/data/profile.ts", {
    "@/lib/data/read-request": {
      readRequest: load => load(new AbortController().signal)
    },
    "@/utils/supabase/client": {
      createClient: () => ({
        rpc: () => {
          const result = Promise.resolve({ data: response, error: null });
          result.abortSignal = () => result;
          return result;
        }
      })
    },
    "@/lib/data/cards": { withLiveCardFranchises: async cards => cards },
    "@/lib/data/player-state": { publishPlayerSnapshotInvalidation: () => {} }
  });
}

test("profil : réponses anciennes et nouvelles, friends absent ou null", async () => {
  for (const status of ["self", "accepted", "none"])
    for (const friends of [undefined, null, [], [friend]]) {
      const result = await profileApi({
        ...base,
        friendshipStatus: status,
        friends
      }).getProfile();
      assert.equal(result.friendsVisible, status === "self");
      assert.equal(
        result.friends.length,
        status === "self" && Array.isArray(friends) ? friends.length : 0
      );
    }
  for (const flag of [true, false]) {
    const api = profileApi({
      ...base,
      friends: [friend],
      friendsVisible: flag
    });
    for (const result of [
      await api.getProfile(),
      await api.saveProfile("", null, [], null)
    ]) {
      assert.equal(
        result.friendsVisible,
        flag,
        "le flag explicite prévaut sur la longueur et le fallback"
      );
      assert.equal(result.friends.length, flag ? 1 : 0);
    }
  }
});

const h = React.createElement;
const ui = {
  Avatar: ({ name }) => h("span", null, name),
  Button: ({ children, onClick, disabled, ...props }) =>
    h(
      "button",
      { "aria-label": props["aria-label"], onClick, disabled },
      children
    ),
  StatusPill: ({ children }) => h("span", null, children),
  Modal: () => null,
  Toast: () => null
};
const link = ({ href, children, ...props }) =>
  h("a", { href, "aria-label": props["aria-label"] }, children);
const friendsModule = load("components/friends.tsx", {
  "@/components/styled-player-avatar": { StyledPlayerAvatar: ui.Avatar },
  "@/components/styled-player-name": {
    StyledPlayerName: ({ name }) => h("span", null, name)
  },
  "@/hooks/use-social-unread": { useSocialUnread: () => undefined },
  "@/lib/data/social-unread": { invalidateSocialUnread: () => {} },
  "@/components/unread-badge": load("components/unread-badge.tsx", {}),
  "@/components/private-messages": { PrivateMessages: () => null },
  "@/components/friend-message-button": load(
    "components/friend-message-button.tsx",
    {
      "@/components/ui": ui,
      "@/components/private-messages": { PrivateMessages: () => null }
    }
  ),
  "next/link": link,
  "@/components/ui": ui,
  "@/lib/data/friends": {},
  "@/lib/data/moderation": { liveModeration: {} }
});
function renderProfile(profile) {
  let stateIndex = 0;
  const { ProfileExperience } = load("components/profile.tsx", {
    react: {
      ...React,
      useEffect: () => {},
      useState: initial =>
        React.useState(stateIndex++ === 0 ? profile : initial)
    },
    "next/link": link,
    "next/navigation": {
      usePathname: () => "/profile/Alice",
      useSearchParams: () => new URLSearchParams()
    },
    "@/components/ui": ui,
    "@/components/friends": friendsModule,
    "@/components/profile-private": load("components/profile-private.tsx", {}),
    "next/dynamic": {
      __esModule: true,
      default: loader => {
        if (loader.toString().includes("profile-completion"))
          return load("components/profile-completion.tsx", {
            "@/components/profile-favorite-binders": {
              ProfileFavoriteBinders: () => null
            },
            "next/link": link,
            "@/components/profile-private": load(
              "components/profile-private.tsx",
              {}
            )
          }).ProfileCompletion;
        const dynamic = require("next/dynamic");
        return (dynamic.default ?? dynamic)(loader);
      }
    },
    "@/lib/data/moderation": {},
    "@/components/player-moderation": { PlayerModeration: () => null },
    "@/components/profile-wall": { ProfileWall: () => null },
    "@/components/profile-sales": { ProfileSales: () => null },
    "@/components/pro-access": {
      useProAccess: () => false,
      ProFeatureNotice: () => null
    },
    "@/components/profile-style-fields": { ProfileStyleFields: () => null },
    "@/components/avatar-decoration": load(
      "components/avatar-decoration.tsx",
      {}
    ),
    "@/components/styled-player-name": { StyledPlayerName: ({ name }) => name },
    "@/lib/ui/profile-style": load("lib/ui/profile-style.ts", {
      "@/lib/ui/name-contrast": load("lib/ui/name-contrast.ts", {})
    }),
    "@/components/banner-crop": load("components/banner-crop.tsx", {
      "@/components/ui": ui,
      "@/components/banner-image": load("components/banner-image.tsx", {
        "@/lib/ui/banner-frame": load("lib/ui/banner-frame.ts", {})
      }),
      "@/lib/ui/banner-frame": load("lib/ui/banner-frame.ts", {})
    }),
    "@/components/banner-image": load("components/banner-image.tsx", {
      "@/lib/ui/banner-frame": load("lib/ui/banner-frame.ts", {})
    }),
    "@/components/community-views": { CatalogueCardModal: () => null },
    "@/components/profile-license-picker": load(
      "components/profile-license-picker.tsx",
      {
        "@/components/ui": ui,
        "@/lib/data/profile": {}
      }
    ),
    "@/components/yokai-card": { YokaiCard: () => null },
    "@/components/card-shell": {},
    "@/components/collection": {},
    "@/lib/data/profile": {},
    "@/lib/data/wishlist": {},
    "@/lib/data/cards": {},
    "@/lib/ui/banner-card-sort": load("lib/ui/banner-card-sort.ts", {}),
    "@/lib/ui/card-search": {}
  });
  return renderToStaticMarkup(h(ProfileExperience, {}));
}
test("profil rendu : propriétaire sans ami voit 0, visiteurs sans tuile ni colonne", () => {
  for (const friends of [undefined, null, []]) {
    const html = renderProfile({ ...base, friends, friendsVisible: true });
    assert.match(html, />Friends<\/p>/);
    assert.match(html, />0<\/p>/);
    assert.match(html, />Friends<\/h3>/);
  }
  const own = renderProfile({
    ...base,
    friends: [friend],
    friendsVisible: true
  });
  assert.match(own, /href="\/profile\/Bob"/);
  for (const status of ["accepted", "none"])
    for (const friends of [undefined, null, [], [friend]]) {
      const html = renderProfile({
        ...base,
        friendshipStatus: status,
        friends,
        friendsVisible: false
      });
      assert.doesNotMatch(
        html,
        />Friends<\/(?:p|h3)>|\/profile\/Bob|yk-profile-columns/
      );
      assert.match(html, /View collection/);
    }
});
test("les quatre états du bouton d'amitié restent disponibles", () => {
  for (const [status, label] of [
    ["none", "Add friend"],
    ["outgoing", "Request sent"],
    ["incoming", "Accept"],
    ["accepted", "Already friends"]
  ]) {
    const html = renderToStaticMarkup(
      h(friendsModule.FriendAction, { userId: "bob", status })
    );
    assert.ok(html.includes(label));
    if (status === "incoming") assert.ok(html.includes("Decline"));
  }
});
test("aperçu social historique : le visiteur reste masqué sans flag public explicite", () => {
  const { SocialPreview } = load("components/social-preview.tsx", {
    "next/link": link,
    "@/components/ui": ui,
    "@/components/friends": {},
    "@/components/yokai-card": { YokaiCard: () => null }
  });
  const own = renderToStaticMarkup(h(SocialPreview, { screen: "profile" }));
  const visitor = renderToStaticMarkup(h(SocialPreview, { screen: "public" }));
  assert.match(own, />Amis<\/(?:p|h3)>/);
  assert.doesNotMatch(visitor, />Amis<\/(?:p|h3)>/);
});

test("FriendAction : bloqué par moi prévaut sur tous les états reçus du profil", () => {
  for (const status of ["none", "incoming", "outgoing", "accepted"]) {
    const html = renderToStaticMarkup(
      h(friendsModule.FriendAction, {
        userId: "bob",
        status,
        blockedByMe: true
      })
    );
    assert.match(html, /Unblock/);
    assert.doesNotMatch(
      html,
      /Add friend|Accept|Decline|Already friends|Request sent/
    );
  }
});
