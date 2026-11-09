"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui";
import { DISCORD_MARK_PATH } from "@/components/site-footer";

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
  const requested = useSearchParams().get("discord-reward");
  const [visible, setVisible] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [afterJoin, setAfterJoin] = useState(false);
  const [discordAvailable, setDiscordAvailable] = useState(false);
  const [discordClaimed, setDiscordClaimed] = useState(false);
  const [twitterClaimed, setTwitterClaimed] = useState(false);

  useEffect(() => {
    if (!enabled || pathname !== "/") return;
    let active = true;
    async function preparePromo() {
      const url = new URL(window.location.href);
      try {
        const response = await fetch("/api/discord-reward", {
          cache: "no-store"
        });
        if (!active) return;
        if (response.status === 401) {
          if (requested === "claim") router.push("/login");
          return;
        }
        if (!response.ok) {
          if (requested) setFeedback(t("unavailable"));
          return;
        }
        const status = await response.json();
        if (!active) return;
        if (!status.available) {
          if (requested) setFeedback(t("unavailable"));
          return;
        }
        if (typeof status.userId !== "string") return;
        setUserId(status.userId);
        setDiscordAvailable(status.discordAvailable === true);
        setDiscordClaimed(status.claimed === true);
        setTwitterClaimed(status.twitterClaimed === true);
        if (requested) {
          url.searchParams.delete("discord-reward");
          window.history.replaceState(
            null,
            "",
            url.pathname + url.search + url.hash
          );
        }
        if (
          requested !== "claim" &&
          (status.claimed || (!requested && status.twitterClaimed))
        ) {
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
  }, [enabled, pathname, requested, router, t]);

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
    setFeedback(t(discordClaimed ? "alreadyClaimed" : "afterJoin"));
    setAfterJoin(!discordClaimed);
  }

  if (!enabled || pathname !== "/") return null;
  return (
    <>
      <Modal
        open={visible}
        onClose={dismiss}
        title={t("title")}
        className="yk-discord-reward-modal max-w-3xl"
      >
        <p className="yk-community-intro">{t("optionsIntro")}</p>
        <div className="yk-community-options">
          <section
            aria-labelledby="reward-discord"
            className="yk-community-reward"
            data-network="discord"
          >
            <div className="yk-community-network">
              <span className="yk-community-brand" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d={DISCORD_MARK_PATH} />
                </svg>
              </span>
              <h3 id="reward-discord">{t("discordLabel")}</h3>
            </div>
            <p className="yk-community-gift">{t("reward", { count: 5 })}</p>
            <p className="yk-community-description">{t("existingMembers")}</p>
            {discordClaimed && (
              <p role="status" className="yk-community-claimed">
                {t("alreadyClaimed")}
              </p>
            )}
            {discordAvailable ? (
              <div className="yk-community-actions">
                {!discordClaimed && (
                  <p className="yk-community-step">
                    {t("step", { number: 1 })}
                    <span>{t("discordJoinStep")}</span>
                  </p>
                )}
                <a
                  href="/discord"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={join}
                  className="yk-button yk-community-secondary"
                >
                  {t("join")}
                </a>
                {!discordClaimed && (
                  <form
                    action="/api/discord-reward"
                    method="post"
                    onSubmit={rememberDismissal}
                  >
                    <p className="yk-community-step">
                      {t("step", { number: 2 })}
                      <span>{t("discordClaimStep")}</span>
                    </p>
                    <button
                      type="submit"
                      className="yk-button yk-community-claim"
                    >
                      {t("claim")}
                    </button>
                  </form>
                )}
              </div>
            ) : (
              <p role="status" className="mt-5 text-sm leading-6 text-ink-3">
                {t("discordUnavailable")}
              </p>
            )}
          </section>
          <section
            aria-labelledby="reward-twitter"
            className="yk-community-reward"
            data-network="twitter"
          >
            <div className="yk-community-network">
              <span className="yk-community-brand" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 15.6 6.4 22H3.1l7.3-8.4L.8 2h6.5l4.4 5.8L18.9 2Zm-1.1 18h1.8L6.3 3.9H4.4L17.8 20Z" />
                </svg>
              </span>
              <h3 id="reward-twitter">{t("twitterLabel")}</h3>
            </div>
            <p className="yk-community-gift">{t("reward", { count: 5 })}</p>
            <p className="yk-community-description">{t("twitterDetails")}</p>
            {twitterClaimed && (
              <p role="status" className="yk-community-claimed">
                {t("alreadyClaimed")}
              </p>
            )}
            <div className="yk-community-actions yk-community-twitter-actions">
              {!twitterClaimed && (
                <p className="yk-community-step">{t("twitterClaimStep")}</p>
              )}
              <button
                type="submit"
                form="community-twitter-claim"
                className={`yk-button ${twitterClaimed ? "yk-community-secondary" : "yk-community-claim"}`}
              >
                {t(twitterClaimed ? "twitterVisit" : "twitterAction")}
              </button>
            </div>
          </section>
        </div>
        <div className="yk-community-footer">
          <p className="yk-community-once">{t("eachGiftOnce")}</p>
          <p>{t("dismissal")}</p>
          <a href="/privacy" className="yk-community-privacy">
            {t("privacy")}
          </a>
        </div>
      </Modal>
      {/* Keep the submitting form mounted while the dialog closes. */}
      <form
        id="community-twitter-claim"
        action="/twitter"
        method="post"
        target="_blank"
        rel="noopener"
        onSubmit={dismiss}
        hidden
      />
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
