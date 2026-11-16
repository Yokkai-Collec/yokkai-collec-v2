import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createTranslator } from "next-intl";
import english from "@/messages/en.json";
import french from "@/messages/fr.json";
import { i18nEnabled } from "@/i18n/locale";
import { notificationItem } from "@/lib/notification-item";
import { deliverPush } from "@/lib/server/push-delivery.mjs";
import { getSupabaseConfig } from "@/utils/supabase/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.PUSH_DISPATCH_SECRET;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  if (
    !secret ||
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    return new Response(null, { status: 401 });
  try {
    const body = await request.text();
    if (body.length > 512) return new Response(null, { status: 413 });
    const { id, createdAt } = JSON.parse(body);
    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id
      ) ||
      typeof createdAt !== "string" ||
      createdAt.length > 40 ||
      !Number.isFinite(Date.parse(createdAt))
    )
      return new Response(null, { status: 400 });
    const key =
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!key || !publicKey || !privateKey || !subject)
      return new Response(null, { status: 503 });
    const db = createClient(getSupabaseConfig().url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    // Only an ID/version crosses the webhook boundary. SQL rechecks live visibility.
    const { data, error } = await db.rpc("get_push_notification", {
      p_id: id,
      p_created_at: createdAt
    });
    if (error) throw error;
    if (!data?.notification) return new Response(null, { status: 204 });
    const { data: subscriptions, error: subscriptionError } = await db
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("user_id", data.userId);
    if (subscriptionError) throw subscriptionError;
    const locale = i18nEnabled() && data.locale === "fr" ? "fr" : "en";
    const { topbar, achievementUi, missionUi, achievementCatalog } =
      locale === "fr" ? french : english;
    const messages: Record<string, unknown> = {
      topbar,
      achievementUi,
      missionUi,
      achievementCatalog
    };
    const t = createTranslator({ locale, messages, namespace: "topbar" });
    const achievementT = createTranslator({
      locale,
      messages,
      namespace: "achievementUi"
    });
    const item = notificationItem(
      data.notification,
      t,
      undefined,
      achievementT,
      createTranslator({ locale, messages, namespace: "missionUi" }),
      createTranslator({ locale, messages, namespace: "achievementCatalog" })
    );
    const { default: webpush } = await import("web-push");
    const failures = await deliverPush(
      subscriptions ?? [],
      {
        title: item.title,
        body: item.text,
        url: item.href ?? "/",
        tag: id,
        lang: locale
      },
      (subscription, payload) =>
        webpush.sendNotification(subscription, payload, {
          vapidDetails: { subject, publicKey, privateKey },
          TTL: 86400,
          timeout: 5000
        }),
      async endpoint => {
        const { error } = await db
          .from("push_subscriptions")
          .delete()
          .eq("user_id", data.userId)
          .eq("endpoint", endpoint);
        if (error) throw error;
      }
    );
    if (failures)
      console.warn("[push] transient delivery failures", { count: failures });
    return new Response(null, { status: failures ? 502 : 204 });
  } catch {
    // Never log endpoints, key material, message contents or authorization headers.
    console.error("[push] dispatch failed");
    return new Response(null, { status: 500 });
  }
}
