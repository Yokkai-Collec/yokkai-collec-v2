import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { getSupabaseConfig } from "@/utils/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff"
};
const identityPattern = /^v[1-9][0-9]*:[a-f0-9]{64}$/;
const deviceCookie = "yokkai_security_device";
const observationSeconds = 7 * 24 * 60 * 60;

function empty(status = 204) {
  return new Response(null, { status, headers: privateHeaders });
}

export async function POST(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return empty(403);

  const networkIdentity = request.headers.get("x-yokkai-ip-hmac") ?? "";
  const cookieStore = await cookies();
  let deviceToken = cookieStore.get(deviceCookie)?.value ?? "";
  if (!/^[a-f0-9]{64}$/.test(deviceToken)) {
    deviceToken = randomBytes(32).toString("hex");
    cookieStore.set(deviceCookie, deviceToken, {
      httpOnly: true,
      maxAge: observationSeconds,
      path: "/",
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production"
    });
  }
  const deviceIdentity = `v1:${createHash("sha256").update(deviceToken).digest("hex")}`;

  const client = createClient(cookieStore);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return empty();

  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return empty(503);
  const { url } = getSupabaseConfig();
  const admin = createAdminClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const validNetworkIdentity = identityPattern.test(networkIdentity)
    ? networkIdentity
    : null;
  const results = await Promise.all([
    validNetworkIdentity
      ? admin.rpc("record_anticheat_network_observation", {
          p_user_id: data.user.id,
          p_network_identity: validNetworkIdentity
        })
      : Promise.resolve({ error: null }),
    admin.rpc("record_anticheat_device_observation", {
      p_user_id: data.user.id,
      p_device_identity: deviceIdentity
    }),
    admin
      .rpc("record_anticheat_trade_connection", {
        p_user_id: data.user.id,
        p_network_identity: validNetworkIdentity,
        p_device_identity: deviceIdentity
      })
      .then(result =>
        result.error?.code === "PGRST202" ? { error: null } : result
      )
  ]);
  if (results.some(result => result.error)) {
    console.error("ANTICHEAT_CONTEXT_OBSERVATION_FAILED");
    return empty(503);
  }
  return empty();
}

export function GET() {
  return new Response(null, {
    status: 405,
    headers: { ...privateHeaders, Allow: "POST" }
  });
}
export const HEAD = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
