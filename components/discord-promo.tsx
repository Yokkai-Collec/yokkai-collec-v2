"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui";

function dismissalKey(userId: string) {
  return `yokkai-discord-reward-dismissed:${userId}`;
}

function locallyDismissed(userId: string) {
  try {
    return localStorage.getItem(dismissalKey(userId)) === "1";
  } catch {
    return false;
  }
}

async function persistDismissal() {
  try {
    await fetch("/api/discord-reward?action=dismiss", {
      method: "POST",
      keepalive: true
    });
  } catch {
    /* The local receipt is retried when this player visits home again. */
  }
}

const resultMessages = {
  "not-member": "notMember",
  pending: "pending",
  "discord-used": "discordUsed",
  denied: "denied",
  error: "error"
} as const;

export function DiscordPromo({ enabled }: { enabled: boolean }) {
  const t = useTranslations("discordReward");
  const pathname = usePathname();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [afterJoin, setAfterJoin] = useState(false);

  useEffect(() => {
    if (!enabled || pathname !== "/") return;
    let active = true;
    async function preparePromo() {
      const url = new URL(window.location.href);
      const requested = url.searchParams.get("discord-reward");
      try {
        const response = await fetch("/api/discord-reward", {
          cache: "no-store"
        });
        if (!active) return;
        if (response.status === 401) {
          if (requested === "claim") router.push("/login");
          return;
        }
        if (!response.ok) return;
        const status = await response.json();
        if (!active) return;
        if (!status.available) {
          if (requested) setFeedback(t("unavailable"));
          return;
        }
        if (typeof status.userId !== "string") return;
        setUserId(status.userId);
        if (requested) {
          url.searchParams.delete("discord-reward");
          window.history.replaceState(
            null,
            "",
            url.pathname + url.search + url.hash
          );
        }
        if (status.claimed) {
          if (requested) setFeedback(t("claimed", { count: 5 }));
          return;
        }
        if (requested && requested !== "claim") {
          const key = Object.hasOwn(resultMessages, requested)
            ? resultMessages[requested as keyof typeof resultMessages]
            : null;
          if (key) setFeedback(t(key));
          return;
        }
        const local = locallyDismissed(status.userId);
        if (local && !status.dismissed) void persistDismissal();
        if (requested === "claim" || (!local && !status.dismissed))
          setVisible(true);
      } catch {
        /* An unavailable status must never force an invitation to appear. */
      }
    }
    void preparePromo();
    return () => {
      active = false;
    };
  }, [enabled, pathname, router, t]);

  function rememberDismissal() {
    if (userId) {
      try {
        localStorage.setItem(dismissalKey(userId), "1");
      } catch {
        /* Server persistence still works. */
      }
    }
    void persistDismissal();
  }
  function dismiss() {
    rememberDismissal();
    setVisible(false);
  }
  function join() {
    dismiss();
    setFeedback(t("afterJoin"));
    setAfterJoin(true);
  }

  if (!enabled || pathname !== "/") return null;
  return (
    <>
      <Modal
        open={visible}
        onClose={dismiss}
        title={t("title")}
        className="yk-discord-reward-modal max-w-lg"
      >
        <p className="font-display text-2xl font-bold text-ink">
          {t("reward", { count: 5 })}
        </p>
        <p className="mt-4 text-sm leading-7 text-ink-2">
          {t("existingMembers")}
        </p>
        <p className="mt-3 text-sm leading-7 text-ink-3">{t("once")}</p>
        <div className="mt-6 flex flex-col gap-3">
          <a
            href="/discord"
            target="_blank"
            rel="noopener noreferrer"
            onClick={join}
            className="yk-button min-h-11 whitespace-normal text-center"
          >
            {t("join")}
          </a>
          <form
            action="/api/discord-reward"
            method="post"
            onSubmit={rememberDismissal}
          >
            <button
              type="submit"
              className="yk-button yk-button-primary min-h-11 w-full whitespace-normal text-center"
            >
              {t("claim")}
            </button>
          </form>
        </div>
        <p className="mt-5 text-xs leading-6 text-ink-3">{t("consent")}</p>
        <p className="mt-3 text-xs leading-6 text-ink-3">{t("dismissal")}</p>
        <a
          href="/privacy"
          className="mt-3 inline-flex min-h-11 items-center text-xs text-ink-2 underline underline-offset-4"
        >
          {t("privacy")}
        </a>
      </Modal>
      {feedback && (
        <aside
          role="status"
          className="fixed right-4 bottom-24 z-[70] w-[min(calc(100vw-2rem),28rem)] rounded-2xl border border-veil bg-surface p-5 shadow-xl sm:bottom-4"
        >
          <p className="pr-10 text-sm leading-6 text-ink">{feedback}</p>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label={t("close")}
            className="absolute top-2 right-2 grid h-11 w-11 place-items-center rounded-full text-ink-2"
          >
            ×
          </button>
          {afterJoin && (
            <form action="/api/discord-reward" method="post" className="mt-4">
              <button
                type="submit"
                className="yk-button yk-button-primary min-h-11 w-full whitespace-normal"
              >
                {t("claim")}
              </button>
            </form>
          )}
        </aside>
      )}
    </>
  );
}
