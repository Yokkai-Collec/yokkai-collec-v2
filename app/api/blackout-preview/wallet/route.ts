import { createClient } from "@supabase/supabase-js";
import { getVerifiedUser } from "@/lib/auth/session";
import { blackoutPreviewEnabled } from "@/lib/data/blackout-preview";
import { getSupabaseConfig } from "@/utils/supabase/config";

const headers = { "Cache-Control": "no-store" };

async function wallet(action: "read" | "buy" | "open", quantity?: number) {
  if (!blackoutPreviewEnabled) return new Response(null, { status: 404 });

  const { url } = getSupabaseConfig();
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
    return new Response(null, { status: 404 });

  const user = await getVerifiedUser();
  if (!user) return new Response(null, { status: 401, headers });

  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return new Response(null, { status: 503, headers });
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("blackout_preview_wallet", {
    p_user: user.id,
    p_action: action,
    p_quantity: quantity ?? null
  });

  if (error?.message === "BLACKOUT_DAILY_LIMIT")
    return Response.json(
      { error: "dailyLimitReached" },
      { status: 409, headers }
    );
  if (
    ["INSUFFICIENT_KARAS", "TRADE_INSUFFICIENT_KARAS"].includes(
      error?.message ?? ""
    )
  )
    return Response.json({ error: "notEnoughKaras" }, { status: 409, headers });
  if (error || !data) return new Response(null, { status: 503, headers });
  return Response.json(data, { headers });
}

export async function GET() {
  return wallet("read");
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return new Response(null, { status: 415, headers });
  const body = await request.json().catch(() => null);
  if (body?.action === "open") return wallet("open");
  if (
    body?.action !== "buy" ||
    !Number.isSafeInteger(body.quantity) ||
    body.quantity < 1 ||
    body.quantity > 3
  )
    return new Response(null, { status: 400, headers });
  return wallet("buy", body.quantity);
}
