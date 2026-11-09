import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { englishMessages } from "./helpers/i18n.mjs";
import { homePresentation } from "./helpers/home-presentation.mjs";

const read = path => readFileSync(path, "utf8");

test("Discord links use one internal redirect backed by a server-only setting", () => {
  const config = read("lib/discord-invite.ts");
  const route = read("app/discord/route.ts");
  const env = read(".env.example");

  assert.match(config, /process\.env\.DISCORD_INVITE_URL/);
  assert.doesNotMatch(config, /NEXT_PUBLIC_DISCORD/);
  assert.match(config, /discord\.gg/);
  assert.match(config, /discord\.com/);
  assert.match(config, /inviteUrl\.protocol === "https:"/);
  assert.match(route, /NextResponse\.redirect\(inviteUrl, 307\)/);
  assert.match(route, /status: 503/);
  assert.match(env, /^DISCORD_INVITE_URL=$/m);
});

test("the account menu and public footer expose the Discord invitation safely", () => {
  const account = read("components/account-menu.tsx");
  const presentation = homePresentation();
  const landing = presentation.footer;

  for (const source of [account, landing]) {
    assert.match(source, /href="\/discord"/);
    assert.match(source, /target="_blank"/);
    assert.match(source, /rel="noopener noreferrer"/);
    assert.match(source, /discordEnabled/);
  }
  assert.match(account, /t\("joinTheYokkaiDiscord"\)/);
  assert.equal(
    englishMessages.accountMenu.joinTheYokkaiDiscord,
    "Join the Yokkai Discord"
  );
  assert.match(
    landing,
    presentation.shared ? /t\("joinTheYokkaiDiscord"\)/ : /Join our Discord/
  );
  if (presentation.shared)
    assert.equal(
      englishMessages.siteFooter.joinTheYokkaiDiscord,
      "Join the Yokkai Discord"
    );
});

test("the home Discord gift uses the accessible centered modal and remembers dismissal on the account", () => {
  const promo = read("components/discord-promo.tsx");
  const layout = read("app/layout.tsx");

  assert.match(promo, /fetch\("\/api\/discord-reward"/);
  assert.match(read("app/api/discord-reward/route.ts"), /getVerifiedUser\(\)/);
  assert.match(promo, /yokkai-discord-reward-dismissed:/);
  assert.match(promo, /localStorage\.setItem/);
  assert.match(promo, /<Modal\s+open=\{visible\}\s+onClose=\{dismiss\}/);
  assert.match(promo, /pathname !== "\/"/);
  assert.match(promo, /status\.claimed/);
  assert.match(promo, /status\.dismissed/);
  assert.match(promo, /\/api\/discord-reward\?action=dismiss/);
  assert.match(promo, /keepalive: true/);
  assert.equal(
    englishMessages.discordPromo.dismissDiscordInvitation,
    "Dismiss Discord invitation"
  );
  assert.match(promo, /t\("join"\)/);
  assert.equal(englishMessages.discordPromo.joinDiscord, "Join Discord");
  const modal = read("components/ui/index.tsx");
  assert.match(modal, /dialog\.showModal\(\)/);
  assert.match(modal, /onCancel=/);
  assert.match(layout, /<DiscordPromo enabled \/>/);
  assert.match(promo, /requested !== "claim"/);
  assert.match(promo, /action="\/twitter"/);
  const twitterForm = promo.match(
    /<form\s+id="community-twitter-claim"[\s\S]*?\/>/
  )?.[0];
  assert.ok(twitterForm);
  assert.match(twitterForm, /rel="noopener"/);
  assert.doesNotMatch(twitterForm, /noreferrer/);
});
