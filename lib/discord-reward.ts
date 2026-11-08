import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/utils/supabase/config";

export const DISCORD_REWARD_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-yk-discord-reward"
    : "yk-discord-reward";
const scopes = "identify guilds.members.read";

export function discordRewardConfig() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const guildId = process.env.DISCORD_GUILD_ID;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
    if (
      !clientId ||
      !/^\d{17,20}$/.test(clientId) ||
      !clientSecret ||
      !guildId ||
      !/^\d{17,20}$/.test(guildId) ||
      !serviceKey ||
      site.username ||
      site.password ||
      !(
        site.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" &&
          site.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(site.hostname))
      )
    )
      return null;
    return {
      clientId,
      clientSecret,
      guildId,
      serviceKey,
      origin: site.origin,
      redirectUri: new URL("/auth/discord-reward/callback", site.origin).href
    };
  } catch {
    return null;
  }
}

export function beginDiscordReward(userId: string) {
  const state = randomBytes(32).toString("hex");
  return { state, cookie: `${state}.${userId}.${Date.now()}` };
}

export function validDiscordRewardState(
  cookie: string | undefined,
  state: string | null,
  userId: string,
  now = Date.now()
) {
  if (!cookie || !state || !/^[a-f0-9]{64}$/.test(state)) return false;
  const [saved, player, issuedAt] = cookie.split(".");
  return (
    /^[a-f0-9]{64}$/.test(saved) &&
    player === userId &&
    Number.isFinite(Number(issuedAt)) &&
    now >= Number(issuedAt) &&
    now - Number(issuedAt) < 600_000 &&
    timingSafeEqual(Buffer.from(saved), Buffer.from(state))
  );
}

export function discordRewardAuthorizeUrl(
  config: NonNullable<ReturnType<typeof discordRewardConfig>>,
  state: string
) {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: scopes,
    state,
    prompt: "consent"
  }).toString();
  return url;
}

// Only Discord can supply the identity and membership. No client-supplied id is trusted.
export async function verifyDiscordReward(
  code: string,
  config: NonNullable<ReturnType<typeof discordRewardConfig>>
) {
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri
    })
  });
  if (!tokenResponse.ok) throw new Error("DISCORD_UNAVAILABLE");
  const token = await tokenResponse.json();
  if (
    typeof token.access_token !== "string" ||
    token.token_type?.toLowerCase() !== "bearer" ||
    !scopes
      .split(" ")
      .every(
        scope =>
          typeof token.scope === "string" &&
          token.scope.split(" ").includes(scope)
      )
  )
    throw new Error("DISCORD_UNAVAILABLE");
  const options = () => ({
    cache: "no-store" as const,
    redirect: "error" as const,
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  const userResponse = await fetch(
    "https://discord.com/api/v10/users/@me",
    options()
  );
  if (!userResponse.ok) throw new Error("DISCORD_UNAVAILABLE");
  const user = await userResponse.json();
  if (typeof user.id !== "string" || !/^\d{17,20}$/.test(user.id) || user.bot)
    throw new Error("DISCORD_UNAVAILABLE");
  const memberResponse = await fetch(
    `https://discord.com/api/v10/users/@me/guilds/${config.guildId}/member`,
    options()
  );
  if (memberResponse.status === 404) return { status: "not-member" as const };
  if (!memberResponse.ok) throw new Error("DISCORD_UNAVAILABLE");
  const member = await memberResponse.json();
  if (member.user?.id !== user.id) throw new Error("DISCORD_UNAVAILABLE");
  if (member.pending === true) return { status: "pending" as const };
  return { status: "verified" as const, discordId: user.id };
}

export async function creditDiscordReward(
  userId: string,
  discordId: string,
  config: NonNullable<ReturnType<typeof discordRewardConfig>>
) {
  const db = createClient(getSupabaseConfig().url, config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const { data, error } = await db.rpc("claim_discord_reward", {
    p_user_id: userId,
    p_discord_id: discordId
  });
  if (error || !["claimed", "already-claimed", "discord-used"].includes(data))
    throw new Error("DISCORD_REWARD_UNAVAILABLE");
  return data as "claimed" | "already-claimed" | "discord-used";
}
