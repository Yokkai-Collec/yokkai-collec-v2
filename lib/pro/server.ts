import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth/session";
import { getSupabaseConfig } from "@/utils/supabase/config";
import { DECISION_PACK_RESET } from "@/lib/premium/offer";
import { matchesProRequestOrigin } from "@/lib/pro/request-origin";

export class ProError extends Error {
  constructor(
    public code: string,
    public status = 503
  ) {
    super(code);
  }
}
export function proClient() {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new ProError("PRO_UNAVAILABLE");
  return createClient(getSupabaseConfig().url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}
export async function proUser(request: Request, mutate = false) {
  if (mutate) {
    let origin;
    try {
      const site = new URL(
        process.env.NEXT_PUBLIC_SITE_URL ||
          (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000")
      );
      if (
        site.username ||
        site.password ||
        (process.env.NODE_ENV === "production" && site.protocol !== "https:")
      )
        throw Error();
      origin = site.origin;
    } catch {
      throw new ProError("PRO_UNAVAILABLE");
    }
    if (
      !matchesProRequestOrigin(
        request,
        origin,
        process.env.NODE_ENV === "development"
      )
    )
      throw new ProError("REQUEST_DENIED", 403);
  }
  const user = await getCurrentUser();
  if (!user) throw new ProError("AUTH_REQUIRED", 401);
  return user;
}
export async function hasPaidPro(userId: string, client = proClient()) {
  const { data, error } = await client.rpc("billing_has_game_pro", {
    p_user: userId
  });
  if (error || typeof data !== "boolean") throw new ProError("PRO_UNAVAILABLE");
  return data;
}
export function benefits(active: boolean) {
  return {
    active,
    regularPackMinutes: 5,
    regularPackReserve: active ? 10 : 5,
    decisionPacksPerDay: active ? 2 : 1,
    decisionPackResetHour: DECISION_PACK_RESET.hour,
    decisionPackResetTimeZone: DECISION_PACK_RESET.timeZone,
    maxActiveAuctions: active ? 6 : 3,
    maxShowcaseCards: active ? 10 : 5,
    canCustomizeCards: active,
    canUploadBanners: active,
    canUseAnimatedAvatar: active,
    canCustomizeProfile: active
  };
}
export function proReply(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
export function proFailure(error: unknown) {
  const known = error instanceof ProError;
  return proReply(
    {
      code: known ? error.code : "PRO_UNAVAILABLE",
      error:
        known && error.status === 401
          ? "Sign in to continue."
          : known && error.code === "ACCOUNT_BANNED"
            ? "Your account is banned."
            : known && error.code === "PROFILE_MEDIA_QUOTA_EXCEEDED"
              ? "You've reached your profile image upload limit. Try again later."
              : known && error.code === "PRO_REQUIRED"
                ? "This feature is available to Pro members only."
                : known && error.status === 429
                  ? "Please wait a moment before trying again."
                  : known && error.status === 400
                    ? "Check your selection and try again."
                    : known && error.status === 413
                      ? "Your image must be 4 MB or smaller."
                      : "This feature is temporarily unavailable. Please try again."
    },
    known ? error.status : 503
  );
}
export async function boundedBody(request: Request, maximum: number) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new ProError("REQUEST_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  return Buffer.concat(chunks);
}

// The database independently checks membership and all style fields at write
// time; this API accepts only the authenticated user's bounded cosmetic data.
export async function saveProStyle(
  userId: string,
  style: unknown,
  client = proClient()
) {
  if (
    !style ||
    Array.isArray(style) ||
    typeof style !== "object" ||
    JSON.stringify(style).length > 4096
  )
    throw new ProError("PROFILE_STYLE_INVALID", 400);
  if (Object.keys(style).length && !(await hasPaidPro(userId, client)))
    throw new ProError("PRO_REQUIRED", 403);
  // The database validation owns the list of allowed scenes. Persist the
  // actual scene chosen by the player so every new atmosphere keeps its own
  // identity (and does not silently render as a legacy replacement).
  const storedStyle = style;
  const { error } = await client
    .from("profile_customizations")
    .upsert({ user_id: userId, style: storedStyle });
  if (error?.message === "PRO_REQUIRED")
    throw new ProError("PRO_REQUIRED", 403);
  if (error?.message === "ACCOUNT_DELETED")
    throw new ProError("REQUEST_DENIED", 403);
  if (error?.message === "PROFILE_STYLE_INVALID" || error?.code === "23514")
    throw new ProError("PROFILE_STYLE_INVALID", 400);
  if (error?.message === "PROFILE_STYLE_RATE_LIMITED")
    throw new ProError("PROFILE_STYLE_RATE_LIMITED", 429);
  if (error) throw new ProError("PRO_UNAVAILABLE");
  return { style: storedStyle };
}
