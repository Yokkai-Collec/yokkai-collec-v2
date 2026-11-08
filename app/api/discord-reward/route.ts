import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/auth/session";
import { createClient } from "@/utils/supabase/server";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import {
  beginDiscordReward,
  discordRewardAuthorizeUrl,
  discordRewardConfig,
  DISCORD_REWARD_COOKIE
} from "@/lib/discord-reward";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET() {
  if (!discordRewardConfig() || !getDiscordInviteUrl())
    return Response.json({ available: false }, { headers: privateHeaders });
  const user = await getVerifiedUser();
  if (!user)
    return new Response(null, { status: 401, headers: privateHeaders });
  const db = createClient(await cookies());
  const { data, error } = await db.rpc("get_discord_reward_status");
  if (
    error ||
    typeof data?.claimed !== "boolean" ||
    typeof data?.dismissed !== "boolean"
  )
    return new Response(null, { status: 503, headers: privateHeaders });
  return Response.json(
    {
      available: true,
      userId: user.id,
      claimed: data.claimed,
      dismissed: data.dismissed
    },
    { headers: privateHeaders }
  );
}

export async function POST(request: Request) {
  const config = discordRewardConfig();
  if (!config || request.headers.get("origin") !== config.origin)
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store" }
    });
  const user = await getVerifiedUser();
  if (!user)
    return NextResponse.redirect(new URL("/login", config.origin), 303);
  if (new URL(request.url).searchParams.get("action") === "dismiss") {
    const db = createClient(await cookies());
    const { error } = await db.rpc("dismiss_discord_reward_prompt");
    return new Response(null, {
      status: error ? 503 : 204,
      headers: privateHeaders
    });
  }
  const { state, cookie } = beginDiscordReward(user.id);
  const store = await cookies();
  store.set(DISCORD_REWARD_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600
  });
  const response = NextResponse.redirect(
    discordRewardAuthorizeUrl(config, state),
    303
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
