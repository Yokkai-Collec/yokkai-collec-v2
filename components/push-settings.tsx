"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";
import { disablePushSubscription } from "@/lib/data/push-subscriptions";

// Home only: avoid interrupting pack openings, trades or the settings switch.
export function PushInvitation() {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    const {
      data: { subscription }
    } = createClient().auth.onAuthStateChange((_event, session) =>
      setUserId(session?.user.id ?? null)
    );
    return () => subscription.unsubscribe();
  }, []);
  return pathname === "/" && userId ? (
    <PushSettings key={userId} userId={userId} invitation />
  ) : null;
}

export function PushSettings({
  userId,
  invitation = false
}: {
  userId: string;
  invitation?: boolean;
}) {
  const t = useTranslations("settingsUi");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("pushLoading");
  const [error, setError] = useState(false);
  const [available, setAvailable] = useState(false);
  const [visible, setVisible] = useState(false);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const seenKey = `yokkai-push-invitation-seen:${userId}`;
    async function load() {
      if (invitation) {
        // If persistence is unavailable, skip the invitation rather than repeat it.
        if (
          !("Notification" in window) ||
          Notification.permission !== "default" ||
          localStorage.getItem(seenKey)
        )
          return;
      }
      const ios =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone;
      let reason = "pushDescription";
      if (ios && !standalone) reason = "pushIos";
      else if (
        !window.isSecureContext ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      )
        reason = "pushUnsupported";
      else if (!publicKey) reason = "pushUnavailable";
      else if (Notification.permission === "denied") reason = "pushDenied";
      if (reason !== "pushDescription") {
        if (active) {
          setNotice(reason);
          setBusy(false);
        }
        return;
      }
      // Registering prepares the worker; it never asks for notification permission.
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none"
      });
      const subscription = await registration.pushManager.getSubscription();
      let owned = false;
      if (subscription) {
        const { data, error } = await createClient()
          .from("push_subscriptions")
          .select("endpoint")
          .eq("user_id", userId)
          .eq("endpoint", subscription.endpoint)
          .maybeSingle();
        if (error) throw error;
        owned = Boolean(data);
      }
      if (active) {
        setEnabled(owned);
        setAvailable(true);
        setNotice(reason);
        setBusy(false);
        if (invitation && !owned) {
          const show = () => {
            if (!active || Notification.permission !== "default") return;
            if (
              document.visibilityState === "hidden" ||
              document.querySelector("dialog[open]")
            ) {
              timer = setTimeout(show, 1000);
              return;
            }
            try {
              if (localStorage.getItem(seenKey)) return;
              localStorage.setItem(seenKey, "1");
              setVisible(true);
            } catch {
              /* Settings remain available without browser storage. */
            }
          };
          timer = setTimeout(show, 8000);
        }
      }
    }
    void load().catch(() => {
      if (active) {
        setError(true);
        setNotice("pushError");
        setBusy(false);
      }
    });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [publicKey, userId, invitation]);

  async function toggle() {
    setBusy(true);
    setError(false);
    try {
      if (enabled) {
        await disablePushSubscription();
        setEnabled(false);
      } else {
        // This is the ONLY permission request, before any asynchronous preparation.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setNotice(permission === "denied" ? "pushDenied" : "pushDismissed");
          if (permission === "denied") setAvailable(false);
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        // A shared browser must never retain another account's subscription.
        const previous = await registration.pushManager.getSubscription();
        if (previous && !(await previous.unsubscribe()))
          throw new Error("PUSH_UNSUBSCRIBE_FAILED");
        const bytes = Uint8Array.from(
          atob(publicKey!.replace(/-/g, "+").replace(/_/g, "/")),
          c => c.charCodeAt(0)
        );
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes
        });
        const json = subscription.toJSON();
        const { error } = await createClient()
          .from("push_subscriptions")
          .upsert(
            {
              user_id: userId,
              endpoint: subscription.endpoint,
              p256dh: json.keys?.p256dh,
              auth: json.keys?.auth
            },
            { onConflict: "endpoint" }
          );
        if (error) {
          await subscription.unsubscribe();
          throw error;
        }
        setEnabled(true);
        if (invitation) setVisible(false);
      }
      setNotice("pushDescription");
    } catch {
      setError(true);
      setNotice("pushError");
    } finally {
      setBusy(false);
    }
  }

  if (invitation) {
    if (!visible) return null;
    return (
      <aside
        aria-labelledby="push-invitation-title"
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 right-4 z-[70] mx-auto max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] overflow-y-auto rounded-panel border border-veil bg-surface p-5 shadow-xl sm:w-96"
      >
        <h2 id="push-invitation-title" className="font-display text-lg">
          {t("pushInviteTitle")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          {t("pushInviteBody")}
        </p>
        {notice !== "pushDescription" && (
          <p
            role={error ? "alert" : "status"}
            className="mt-2 text-sm leading-6 text-ink-2"
          >
            {t(notice)}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="yk-button yk-button-primary min-h-11"
            disabled={busy || !available}
            onClick={() => void toggle()}
          >
            {t("pushInviteEnable")}
          </button>
          <button
            type="button"
            className="yk-button yk-button-secondary min-h-11"
            onClick={() => setVisible(false)}
          >
            {t("pushInviteDismiss")}
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-ink-2">
          {t("pushInviteSettings")}
        </p>
      </aside>
    );
  }

  return (
    <section
      className="mb-6 rounded-panel border border-veil bg-surface p-6"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-48">
          <h2 id="push-title" className="font-display text-xl">
            {t("pushTitle")}
          </h2>
          <p
            id="push-notice"
            role={error ? "alert" : "status"}
            className="mt-3 text-sm leading-6 text-ink-2"
          >
            {t(notice)}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-labelledby="push-title"
          aria-describedby="push-notice"
          aria-checked={enabled}
          disabled={busy || !available}
          onClick={() => void toggle()}
          className="yk-shiny-toggle min-h-11 shrink-0"
        >
          <span>{t(enabled ? "pushEnabled" : "pushDisabled")}</span>
          <i aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
