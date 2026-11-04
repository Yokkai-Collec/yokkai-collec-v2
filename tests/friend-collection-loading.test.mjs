import { intl, gameMessages, loadLocaleModule } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(file, mocks) {
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
      process: { env: { NEXT_PUBLIC_STABLE_BINDERS_ENABLED: "true" } },
      require: name =>
        name === "next-intl"
          ? intl
          : name === "@/i18n/game-messages"
            ? gameMessages
            : name === "@/i18n/locale"
              ? loadLocaleModule()
              : name in mocks
                ? mocks[name]
                : require(name)
    }
  );
  return exports;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const card = {
  id: "card",
  instanceId: "copy",
  name: "Kept card",
  category: "ANIME/MANGA",
  rarity: "LR",
  customImageUrl: "https://i.imgur.com/custom.png",
  image: "https://i.imgur.com/custom.png",
  locked: true
};

test("friend collection can return cards without binder reads while default consumers retain enrichment", async () => {
  const held = deferred();
  let enriched = 0;
  const { getFriendCollection } = load("lib/data/profile.ts", {
    "@/utils/supabase/client": {
      createClient: () => ({
        rpc: (name, args) => {
          assert.equal(name, "get_friend_collection");
          assert.equal(args.p_friend_id, "owner");
          return { abortSignal: async () => ({ data: [card], error: null }) };
        }
      })
    },
    "@/lib/data/read-request": {
      readRequest: read => read(new AbortController().signal)
    },
    "@/lib/data/cards": {},
    "@/lib/data/player-state": {},
    "@/lib/data/binders": {
      withBinderMetadata: async cards => {
        enriched++;
        await held.promise;
        return cards.map(c => ({ ...c, binders: [{ name: "Alias" }] }));
      }
    }
  });
  const fast = await getFriendCollection("owner", false);
  assert.equal(fast[0], card);
  assert.equal(enriched, 0);
  let settled = false;
  const full = getFriendCollection("owner").then(cards => {
    settled = true;
    return cards;
  });
  await flush();
  assert.equal(settled, false);
  assert.equal(enriched, 1);
  held.resolve();
  assert.equal((await full)[0].binders[0].name, "Alias");
  assert.equal(fast[0].binders, undefined);
});

function harness(adapter) {
  const slots = [];
  let cursor = 0,
    effects = [],
    buttons = [];
  const runtime = require("react/jsx-runtime");
  const wrap = name => (type, props, key) => {
    if (type === "button") buttons.push(props);
    return runtime[name](type, props, key);
  };
  const stub = () => null;
  const CollectionView = ({ cards }) =>
    React.createElement("div", {
      "data-grid": cards
        .map(
          c =>
            `${c.instanceId}:${c.binders?.[0]?.name ?? "raw"}:${c.customImageUrl}:${c.locked}`
        )
        .join(",")
    });
  const { ProfileExperience } = load("components/profile.tsx", {
    react: {
      ...React,
      useSyncExternalStore: (_subscribe, _client, server) => server(),
      useState: initial => {
        const i = cursor++;
        if (!(i in slots))
          slots[i] = typeof initial === "function" ? initial() : initial;
        return [
          slots[i],
          next => {
            slots[i] = typeof next === "function" ? next(slots[i]) : next;
          }
        ];
      },
      useRef: initial => {
        const i = cursor++;
        return (slots[i] ??= { current: initial });
      },
      useEffect: (effect, deps) => {
        const i = cursor++;
        if (!slots[i] || deps.some((d, n) => d !== slots[i].deps[n])) {
          const previous = slots[i];
          slots[i] = { deps };
          effects.push(() => {
            previous?.cleanup?.();
            slots[i].cleanup = effect();
          });
        }
      },
      useCallback: fn => fn,
      useMemo: fn => fn()
    },
    "react/jsx-runtime": { ...runtime, jsx: wrap("jsx"), jsxs: wrap("jsxs") },
    "next/link": { __esModule: true, default: ({ children }) => children },
    "next/dynamic": {
      __esModule: true,
      default: loader =>
        /profile-completion|profile-featured/.test(loader.toString())
          ? stub
          : CollectionView
    },
    "next/navigation": {
      usePathname: () => "/profile/Alice",
      useSearchParams: () => new URLSearchParams()
    },
    "@/components/ui": {
      Avatar: stub,
      Button: ({ children, ...props }) => {
        buttons.push({ ...props, children });
        return React.createElement("button", props, children);
      },
      Modal: ({ open, children }) =>
        open
          ? React.createElement("section", { "data-modal": true }, children)
          : null,
      Toast: stub
    },
    "@/components/yokai-card": { YokaiCard: stub },
    "@/components/card-shell": { CardShell: stub },
    "@/components/player-moderation": { PlayerModeration: stub },
    "@/components/profile-license-picker": {},
    "@/components/profile-wall": { ProfileWall: stub },
    "@/components/profile-private": { ProfilePrivate: stub },
    "@/components/banner-crop": {},
    "@/components/banner-image": { BannerImage: stub },
    "@/components/profile-style-fields": {},
    "@/components/avatar-decoration": load(
      "components/avatar-decoration.tsx",
      {}
    ),
    "@/components/styled-player-name": { StyledPlayerName: ({ name }) => name },
    "@/lib/ui/profile-style": load("lib/ui/profile-style.ts", {
      "@/lib/ui/name-contrast": load("lib/ui/name-contrast.ts", {})
    }),
    "@/components/pro-access": { useProMembershipStatus: () => false },
    "@/lib/data/moderation": {},
    "@/components/friends": { FriendAction: stub, FriendMessageButton: stub },
    "@/lib/data/profile": {},
    "@/lib/data/wishlist": {},
    "@/lib/ui/card-search": {},
    "@/lib/ui/banner-card-sort": {},
    "@/components/collection": { CollectionView }
  });
  return {
    identifier: "Alice",
    render() {
      cursor = 0;
      effects = [];
      buttons = [];
      const html = renderToStaticMarkup(
        React.createElement(ProfileExperience, {
          identifier: this.identifier,
          adapter
        })
      );
      effects.forEach(effect => effect());
      return html;
    },
    open() {
      return buttons.find(b => b["aria-label"]?.startsWith("View ")).onClick();
    },
    retry() {
      return buttons
        .find(b => React.Children.toArray(b.children).join("") === "Try again ")
        .onClick();
    }
  };
}
const profile = name => ({
  id: name,
  pseudo: name,
  canViewCollection: true,
  isPublic: true,
  friendshipStatus: "accepted",
  featuredCards: [],
  friends: [],
  friendsVisible: false,
  cardCount: 1,
  distinctCardCount: 1
});
const baseAdapter = {
  profile: async name => profile(name),
  wishlist: async () => [],
  blocked: async () => []
};

test("profile shows raw cards before optional metadata, deduplicates opens and ignores stale enrichment after navigation", async () => {
  const raw = deferred(),
    metadata = deferred();
  let calls = 0;
  const ui = harness({
    ...baseAdapter,
    friendCollection: () => {
      calls++;
      return raw.promise;
    },
    enrichFriendCollection: () => metadata.promise
  });
  ui.render();
  await flush();
  ui.render();
  ui.open();
  ui.open();
  assert.equal(calls, 1);
  assert.match(ui.render(), /Loading collection/);
  raw.resolve([card]);
  await flush();
  assert.match(
    ui.render(),
    /data-grid="copy:raw:https:\/\/i.imgur.com\/custom.png:true"/
  );
  ui.identifier = "Bob";
  ui.render();
  await flush();
  assert.doesNotMatch(ui.render(), /data-grid="copy/);
  metadata.resolve([{ ...card, binders: [{ name: "Late alias" }] }]);
  await flush();
  assert.doesNotMatch(ui.render(), /Late alias|data-grid="copy/);
});

test("optional metadata failures preserve cards and raw read failures offer a working retry", async () => {
  let calls = 0;
  const ui = harness({
    ...baseAdapter,
    friendCollection: async () => {
      if (++calls === 1) throw Error("Collection unavailable.");
      return [card];
    },
    enrichFriendCollection: async () => {
      throw Error("Metadata unavailable");
    }
  });
  ui.render();
  await flush();
  ui.render();
  ui.open();
  await flush();
  assert.match(ui.render(), /Collection unavailable/);
  ui.retry();
  await flush();
  assert.match(ui.render(), /data-grid="copy:raw:/);
  assert.doesNotMatch(
    ui.render(),
    /Metadata unavailable|Collection unavailable/
  );
  ui.open();
  assert.equal(calls, 2);
});

test("late binder enrichment updates search metadata without changing custom images or locks", async () => {
  const metadata = deferred();
  const ui = harness({
    ...baseAdapter,
    friendCollection: async () => [card],
    enrichFriendCollection: () => metadata.promise
  });
  ui.render();
  await flush();
  ui.render();
  ui.open();
  await flush();
  assert.match(ui.render(), /data-grid="copy:raw:/);
  metadata.resolve([{ ...card, binders: [{ name: "Alias" }] }]);
  await flush();
  assert.match(
    ui.render(),
    /data-grid="copy:Alias:https:\/\/i.imgur.com\/custom.png:true"/
  );
});
