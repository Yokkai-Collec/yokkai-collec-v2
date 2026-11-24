import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { intlServer } from "./helpers/i18n.mjs";

const require = createRequire(import.meta.url);

function load(path, imports) {
  const source = readFileSync(path, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    }
  });
  const loadedModule = { exports: {} };
  vm.runInNewContext(outputText, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: name =>
      name === "next-intl/server"
        ? intlServer
        : name === "@/components/locale-controls"
          ? { LocaleSelector: () => null }
          : Object.hasOwn(imports, name)
            ? imports[name]
            : name === "@/lib/ui/packs-market-announcement"
              ? packsMarketAnnouncement
              : require(name),
    process: { env: {} }
  });
  return loadedModule.exports;
}

const packsMarketAnnouncement = load("lib/ui/packs-market-announcement.ts", {});

test("the anonymous home page renders the same signup and shell with referral parameters intact", async () => {
  const AuthLayout = () => null;
  const SignUpPage = () => null;
  const home = load("app/page.tsx", {
    "@/components/maintenance-compensation": {
      MaintenanceCompensation: () => null
    },
    "@/lib/maintenance-compensation": {
      hasUnseenMaintenanceCompensation: async () => {
        throw new Error("Anonymous users must not query compensation");
      }
    },
    "@/lib/auth/session": { getVerifiedUser: async () => null },
    "@/components/home-dashboard": { HomeDashboard: () => null },
    "./(auth)/layout": { default: AuthLayout, __esModule: true },
    "./(auth)/signup/page": { default: SignUpPage, __esModule: true }
  });
  const searchParams = Promise.resolve({ ref: "0123456789ab" });
  const tree = await home.default({ searchParams });
  assert.equal(tree.type, AuthLayout);
  assert.equal(tree.props.children.type, SignUpPage);
  assert.equal(tree.props.children.props.searchParams, searchParams);
  const metadata = await home.generateMetadata();
  assert.equal(metadata.alternates.canonical, "/");
  assert.equal(metadata.openGraph.url, "/");
});

test("the connected home page renders the dashboard for the authenticated player", async () => {
  const HomeDashboard = () => null;
  const player = { id: "home-player", user_metadata: {} };
  const home = load("app/page.tsx", {
    "@/components/maintenance-compensation": {
      MaintenanceCompensation: () => null
    },
    "@/lib/maintenance-compensation": {
      hasUnseenMaintenanceCompensation: async id => {
        assert.equal(id, "home-player");
        return false;
      }
    },
    "@/lib/auth/session": {
      getVerifiedUser: async () => player
    },
    "@/components/home-dashboard": { HomeDashboard },
    "./(auth)/layout": { default: () => null, __esModule: true },
    "./(auth)/signup/page": { default: () => null, __esModule: true }
  });
  const tree = await home.default({ searchParams: Promise.resolve({}) });
  const dashboard = tree;
  assert.equal(dashboard.type, HomeDashboard);
  assert.equal(dashboard.props.userId, "home-player");
  assert.equal(dashboard.props.announcePacksMarket, true);

  player.user_metadata.yokkai_seen_mystery_auction_announcement =
    "2026-11-mystery-twice-daily-lr";
  const afterOlderReceipt = await home.default({
    searchParams: Promise.resolve({})
  });
  assert.equal(afterOlderReceipt.props.announcePacksMarket, true);

  player.user_metadata[
    packsMarketAnnouncement.PACKS_MARKET_ANNOUNCEMENT_METADATA_KEY
  ] = packsMarketAnnouncement.PACKS_MARKET_ANNOUNCEMENT_ID;
  const afterReceipt = await home.default({
    searchParams: Promise.resolve({})
  });
  assert.equal(afterReceipt.props.announcePacksMarket, false);
});

test("the dashboard mounts only the current release announcement", () => {
  const dashboard = readFileSync("components/home-dashboard.tsx", "utf8");
  assert.match(dashboard, /<PacksMarketReleaseNotice\b/);
  assert.doesNotMatch(dashboard, /<MysteryAuctionAnnouncement\b/);
});

test("the retired compensation popup is never queried or rendered, even for an eligible player", async () => {
  const HomeDashboard = () => null;
  const MaintenanceCompensation = () => null;
  const home = load("app/page.tsx", {
    "@/components/maintenance-compensation": { MaintenanceCompensation },
    "@/lib/maintenance-compensation": {
      hasUnseenMaintenanceCompensation: async id => {
        assert.fail("Retired compensation must not be queried on home");
      }
    },
    "@/lib/auth/session": {
      getVerifiedUser: async () => ({ id: "gift-player" })
    },
    "@/components/home-dashboard": { HomeDashboard },
    "./(auth)/layout": { default: () => null, __esModule: true },
    "./(auth)/signup/page": { default: () => null, __esModule: true }
  });
  const tree = await home.default({ searchParams: Promise.resolve({}) });
  assert.equal(tree.type, HomeDashboard);
  assert.equal(tree.props.userId, "gift-player");
});

function shell(getCurrentUser, redirect) {
  const SiteFooter = () => null;
  const { default: AuthLayout } = load("app/(auth)/layout.tsx", {
    "next/link": { default: () => null, __esModule: true },
    "next/image": { default: () => null, __esModule: true },
    "next/navigation": { redirect },
    "@/lib/auth/session": { getCurrentUser },
    "@/components/site-footer": { SiteFooter },
    "@/lib/discord-invite": {
      getDiscordInviteUrl: () => "https://discord.gg/dDVjCJyJs"
    },
    "@/styles/auth.css": {}
  });
  return { AuthLayout, SiteFooter };
}

test("a signed-in visitor goes directly to their packs instead of registration", async () => {
  const redirected = new Error("redirected");
  const { AuthLayout } = shell(
    async () => ({ id: "local-player" }),
    path => {
      assert.equal(path, "/boosters");
      throw redirected;
    }
  );
  await assert.rejects(
    AuthLayout({ children: "signup" }),
    error => error === redirected
  );
});

test("an anonymous visitor gets signup content and the shared Discord footer", async () => {
  const { AuthLayout, SiteFooter } = shell(
    async () => null,
    () => {
      assert.fail("An anonymous visitor must see registration, not a redirect");
    }
  );
  const tree = await AuthLayout({ children: "signup" });
  const children = tree.props.children;
  assert.equal(children[1].type, "main");
  assert.equal(children[1].props.children, "signup");
  assert.equal(children[2].type, SiteFooter);
  assert.equal(children[2].props.discordEnabled, true);
});
