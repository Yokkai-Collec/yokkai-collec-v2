import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getVerifiedUser } from "@/lib/auth/session";
import { createClient } from "@/utils/supabase/server";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer"
};

export async function POST(request: Request) {
  let origin: string;
  try {
    const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
    if (
      site.username ||
      site.password ||
      !(
        site.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" &&
          site.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(site.hostname))
      )
    )
      throw new Error("SITE_UNAVAILABLE");
    origin = site.origin;
  } catch {
    return new Response(null, { status: 503, headers: privateHeaders });
  }
  if (request.headers.get("origin") !== origin)
    return new Response(null, { status: 403, headers: privateHeaders });
  const user = await getVerifiedUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin), 303);
  try {
    const client = createClient(await cookies());
    const { data, error } = await client.rpc("claim_twitter_visit_reward");
    if (error || !["claimed", "already-claimed"].includes(data))
      throw new Error("REWARD_UNAVAILABLE");
  } catch {
    const t = await getTranslations("homeContent");
    return new Response(t("twitterUnavailable"), {
      status: 503,
      headers: {
        ...privateHeaders,
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }
  const response = NextResponse.redirect("https://x.com/YokkaiCollec", 303);
  for (const [name, value] of Object.entries(privateHeaders))
    response.headers.set(name, value);
  return response;
}
