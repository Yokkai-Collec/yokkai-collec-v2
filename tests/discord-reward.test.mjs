import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";

const userId = "d1500000-0000-4000-8000-000000000001";
const discordId = "123456789012345678";
const env = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://example.test",
  DISCORD_CLIENT_ID: "1564269299944788049",
  DISCORD_GUILD_ID: "1553766666343817368",
  DISCORD_CLIENT_SECRET: "test-secret",
  SUPABASE_SECRET_KEY: "test-service-key"
};
function load(file, imports = {}, globals = {}) {
  const context = {
    exports: {},
    URL,
    URLSearchParams,
    Buffer,
    Response,
    AbortSignal,
    process: { env },
    ...globals,
    require(name) {
      if (name === "server-only") return {};
      if (name === "node:crypto") return crypto;
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import ${name}`);
    }
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    context
  );
  return context.exports;
}
const imports = { "@supabase/supabase-js": {}, "@/utils/supabase/config": {} };
const core = load("lib/discord-reward.ts", imports);
const config = core.discordRewardConfig();

test("Discord uses narrow scopes and a short-lived state bound to the current player", () => {
  assert.equal(core.DISCORD_REWARD_COOKIE, "__Host-yk-discord-reward");
  const { cookie, state } = core.beginDiscordReward(userId);
  assert.equal(core.validDiscordRewardState(cookie, state, userId), true);
  assert.equal(
    core.validDiscordRewardState(cookie, "a".repeat(64), userId),
    false
  );
  assert.equal(
    core.validDiscordRewardState(cookie, state, "other-player"),
    false
  );
  assert.equal(
    core.validDiscordRewardState(cookie, state, userId, Date.now() + 601000),
    false
  );
  assert.equal(core.validDiscordRewardState(undefined, state, userId), false);
  const url = core.discordRewardAuthorizeUrl(config, state);
  assert.equal(url.origin, "https://discord.com");
  assert.equal(url.searchParams.get("scope"), "identify guilds.members.read");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://example.test/auth/discord-reward/callback"
  );
  for (const overrides of [
    { DISCORD_CLIENT_SECRET: "" },
    { DISCORD_GUILD_ID: "../other" },
    { NEXT_PUBLIC_SITE_URL: "http://example.test" },
    { NEXT_PUBLIC_SITE_URL: "https://user:pass@example.test" }
  ]) {
    assert.equal(
      load("lib/discord-reward.ts", imports, {
        process: { env: { ...env, ...overrides } }
      }).discordRewardConfig(),
      null
    );
  }
});

test("only confirmed Discord membership can reach the credit step; failures stay closed", async () => {
  for (const [memberStatus, body, expected] of [
    [200, { user: { id: discordId }, pending: false }, "verified"],
    [200, { user: { id: discordId }, pending: true }, "pending"],
    [404, { code: 10007 }, "not-member"],
    [403, {}, null],
    [429, {}, null],
    [503, {}, null],
    [200, { user: { id: "223456789012345678" } }, null],
    [200, {}, null]
  ]) {
    const calls = [];
    const responses = [
      Response.json({
        access_token: "test-access",
        token_type: "Bearer",
        scope: "identify guilds.members.read"
      }),
      Response.json({ id: discordId }),
      Response.json(body, { status: memberStatus })
    ];
    const api = load("lib/discord-reward.ts", imports, {
      fetch: async (url, options) => {
        calls.push({ url, options });
        return responses.shift();
      }
    });
    if (expected)
      assert.equal(
        (await api.verifyDiscordReward("test-code", config)).status,
        expected
      );
    else
      await assert.rejects(
        api.verifyDiscordReward("test-code", config),
        /DISCORD_UNAVAILABLE/
      );
    assert.equal(
      calls[2].url,
      `https://discord.com/api/v10/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`
    );
    for (const { options } of calls) {
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
    }
  }
  const missingScope = load("lib/discord-reward.ts", imports, {
    fetch: async () =>
      Response.json({
        access_token: "test",
        token_type: "Bearer",
        scope: "identify"
      })
  });
  await assert.rejects(
    missingScope.verifyDiscordReward("test-code", config),
    /DISCORD_UNAVAILABLE/
  );
});

test("start requires a same-origin POST and a verified Yokkai session", async () => {
  let player = { id: userId },
    cookie;
  const route = load("app/api/discord-reward/route.ts", {
    "next/headers": {
      cookies: async () => ({
        set: (...args) => {
          cookie = args;
        }
      })
    },
    "next/server": { NextResponse },
    "@/utils/supabase/server": {},
    "@/lib/discord-invite": {},
    "@/lib/auth/session": { getVerifiedUser: async () => player },
    "@/lib/discord-reward": core
  });
  const request = origin =>
    new Request("https://example.test/api/discord-reward", {
      method: "POST",
      headers: { origin }
    });
  assert.equal((await route.POST(request("https://evil.test"))).status, 403);
  assert.equal(cookie, undefined);
  player = null;
  assert.equal(
    (await route.POST(request(env.NEXT_PUBLIC_SITE_URL))).headers.get(
      "location"
    ),
    "https://example.test/login"
  );
  player = { id: userId };
  const response = await route.POST(request(env.NEXT_PUBLIC_SITE_URL));
  assert.equal(
    new URL(response.headers.get("location")).origin,
    "https://discord.com"
  );
  assert.equal(cookie[2].httpOnly, true);
  assert.equal(cookie[2].secure, true);
  assert.equal(cookie[2].maxAge, 600);
  assert.equal(cookie[2].sameSite, "lax");
});

test("home status and permanent dismissal use only the verified account", async () => {
  let player = { id: userId },
    claimed = false,
    dismissed = false;
  const calls = [];
  const route = load("app/api/discord-reward/route.ts", {
    "next/headers": { cookies: async () => ({}) },
    "next/server": { NextResponse },
    "@/lib/auth/session": { getVerifiedUser: async () => player },
    "@/lib/discord-reward": core,
    "@/lib/discord-invite": {
      getDiscordInviteUrl: () => "https://discord.gg/test"
    },
    "@/utils/supabase/server": {
      createClient: () => ({
        rpc: async name => {
          calls.push(name);
          if (name === "dismiss_discord_reward_prompt") dismissed = true;
          return { error: null, data: { claimed, dismissed } };
        }
      })
    }
  });
  player = null;
  assert.equal((await route.GET()).status, 401);
  assert.deepEqual(calls, []);
  player = { id: userId };
  assert.deepEqual(await (await route.GET()).json(), {
    available: true,
    userId,
    claimed: false,
    dismissed: false
  });
  const request = origin =>
    new Request(
      "https://example.test/api/discord-reward?action=dismiss&userId=another-player",
      { method: "POST", headers: { origin } }
    );
  assert.equal((await route.POST(request("https://evil.test"))).status, 403);
  assert.equal(dismissed, false);
  assert.equal(
    (await route.POST(request(env.NEXT_PUBLIC_SITE_URL))).status,
    204
  );
  const status = await route.GET();
  assert.equal((await status.json()).dismissed, true);
  assert.equal(status.headers.get("cache-control"), "private, no-store");
  claimed = true;
  assert.equal((await (await route.GET()).json()).claimed, true);
});

test("callback rejects forged state, issuer, or a changed Yokkai session before any Discord call", async () => {
  const { state, cookie } = core.beginDiscordReward(userId);
  for (const scenario of [
    "ok",
    "state",
    "session",
    "issuer",
    "denied",
    "not-member",
    "pending",
    "outage",
    "discord-used"
  ]) {
    let verified = 0,
      credited = 0,
      cleared;
    const route = load("app/auth/discord-reward/callback/route.ts", {
      "next/headers": {
        cookies: async () => ({
          get: () => ({ value: cookie }),
          set: (...args) => {
            cleared = args;
          }
        })
      },
      "next/server": { NextResponse },
      "@/lib/auth/session": {
        getVerifiedUser: async () => ({
          id: scenario === "session" ? "other" : userId
        })
      },
      "@/lib/discord-reward": {
        ...core,
        verifyDiscordReward: async () => {
          verified++;
          if (scenario === "outage") throw new Error("private-details");
          return ["not-member", "pending"].includes(scenario)
            ? { status: scenario }
            : { status: "verified", discordId };
        },
        creditDiscordReward: async (player, discord) => {
          credited++;
          assert.equal(player, userId);
          assert.equal(discord, discordId);
          return scenario === "discord-used" ? "discord-used" : "claimed";
        }
      }
    });
    const url = new URL("https://example.test/auth/discord-reward/callback");
    url.search = new URLSearchParams({
      state: scenario === "state" ? "bad" : state,
      iss: scenario === "issuer" ? "https://evil.test" : "https://discord.com",
      code: "test-code",
      ...(scenario === "denied" ? { error: "access_denied" } : {})
    }).toString();
    const response = await route.GET(new NextRequest(url));
    const expected = ["ok", "discord-used"].includes(scenario)
      ? scenario === "ok"
        ? "claimed"
        : scenario
      : ["denied", "not-member", "pending"].includes(scenario)
        ? scenario
        : "error";
    assert.equal(
      new URL(response.headers.get("location")).searchParams.get(
        "discord-reward"
      ),
      expected,
      scenario
    );
    assert.equal(
      credited,
      ["ok", "discord-used"].includes(scenario) ? 1 : 0,
      scenario
    );
    if (["state", "session", "issuer", "denied"].includes(scenario))
      assert.equal(verified, 0, scenario);
    assert.equal(cleared[2].maxAge, 0);
    assert.equal(cleared[2].secure, true);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  }
});
