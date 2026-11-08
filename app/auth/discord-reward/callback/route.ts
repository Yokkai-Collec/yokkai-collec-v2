import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getVerifiedUser } from "@/lib/auth/session";
import {
  creditDiscordReward,
  discordRewardConfig,
  DISCORD_REWARD_COOKIE,
  validDiscordRewardState,
  verifyDiscordReward
} from "@/lib/discord-reward";

export async function GET(request: NextRequest) {
  const config = discordRewardConfig();
  const store = await cookies();
  const saved = store.get(DISCORD_REWARD_COOKIE)?.value;
  store.set(DISCORD_REWARD_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  const params = request.nextUrl.searchParams;
  let status = "error";
  try {
    const user = await getVerifiedUser();
    if (
      config &&
      user &&
      validDiscordRewardState(saved, params.get("state"), user.id)
    ) {
      if (params.get("error") === "access_denied") status = "denied";
      else if (
        !params.has("error") &&
        params.get("iss") === "https://discord.com"
      ) {
        const code = params.get("code");
        if (code && code.length <= 2048) {
          const result = await verifyDiscordReward(code, config);
          status =
            result.status === "verified"
              ? await creditDiscordReward(user.id, result.discordId, config)
              : result.status;
        }
      }
    }
  } catch {
    // Never log codes, access tokens, credentials, or Discord response bodies.
    status = "error";
  }
  const response = NextResponse.redirect(
    new URL(
      `/?discord-reward=${status}`,
      config?.origin ?? request.nextUrl.origin
    ),
    303
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
