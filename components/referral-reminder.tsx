"use client";
import { useTranslations } from "next-intl";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Button, Modal } from "@/components/ui";
import { createClient } from "@/utils/supabase/client";
import { PROPOSED_PLAN_RULES as rules } from "@/lib/premium/offer";
import "@/styles/referral-reminder.css";

type CopyState = "idle" | "copied" | "error";

function dismissalKey(userId: string) {
  return `yokkai-referral-reminder-dismissed:${userId}`;
}

function referralLink(code: string) {
  return `${window.location.origin}/signup?ref=${encodeURIComponent(code)}`;
}

function fallbackCopy(value: string) {
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("COPY_FAILED");
}

export function ReferralReminder({
  packChoices = false,
  homeCard = false
}: {
  packChoices?: boolean;
  homeCard?: boolean;
}) {
  const t = useTranslations("referralReminder");
  const [choicesOpen, setChoicesOpen] = useState(false);
  const pathname = usePathname();
  const isHome = pathname === "/" || pathname === "/design-system/home-preview";
  const isBoosters = pathname === "/boosters";
  const [visible, setVisible] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [progress, setProgress] = useState({ friends: 0, packs: 0 });

  const prepareHomeLink = homeCard && choicesOpen;
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = bar.current;
    const main = element?.closest<HTMLElement>(".yk-game-main");
    if (!element || !main) return;
    const measure = () =>
      main.style.setProperty(
        "--pack-choices-height",
        `${element.getBoundingClientRect().height}px`
      );
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      main.style.removeProperty("--pack-choices-height");
    };
  }, [visible]);

  useEffect(() => {
    if (
      (isHome && !homeCard) ||
      (homeCard && !prepareHomeLink) ||
      (isBoosters && !packChoices)
    )
      return;
    let active = true;
    const supabase = createClient();

    async function prepareLink() {
      // Display gating only (local session, no Auth round trip): every
      // protected read below is still authorized by the database.
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!active || !user) return;
      if (
        !isBoosters &&
        !homeCard &&
        localStorage.getItem(dismissalKey(user.id)) === "1"
      ) {
        setVisible(false);
        return;
      }

      setUserId(user.id);
      setVisible(true);

      const { data: status } = await supabase.rpc("get_referral_status");
      if (!active) return;
      if (status && typeof status === "object") {
        const { verifiedReferrals, packsEarned } = status as Record<
          string,
          unknown
        >;
        if (typeof verifiedReferrals === "number" && verifiedReferrals > 0)
          setProgress({
            friends: verifiedReferrals,
            packs: typeof packsEarned === "number" ? packsEarned : 0
          });
      }
      const existingCode =
        status &&
        typeof status === "object" &&
        "code" in status &&
        typeof status.code === "string"
          ? status.code
          : null;
      if (existingCode) {
        setCode(existingCode);
        return;
      }

      const { data: createdCode } = await supabase.rpc("create_referral_code");
      if (active && typeof createdCode === "string") setCode(createdCode);
    }

    void prepareLink();
    return () => {
      active = false;
    };
  }, [isHome, isBoosters, packChoices, homeCard, prepareHomeLink]);

  function dismiss() {
    if (userId) localStorage.setItem(dismissalKey(userId), "1");
    setVisible(false);
  }

  async function copyLink() {
    if (!code) return;
    const link = referralLink(code);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        fallbackCopy(link);
      }
      setCopyState("copied");
    } catch {
      try {
        fallbackCopy(link);
        setCopyState("copied");
      } catch {
        setCopyState("error");
      }
    }
  }

  async function shareLink() {
    if (!code) return;
    try {
      await navigator.share({
        title: "Yokkai Collec'",
        text: t("shareInvitation"),
        url: referralLink(code)
      });
    } catch {
      // Cancelled by the player or unsupported target: nothing to report.
    }
  }

  if (!homeCard && (!visible || isHome || (isBoosters && !packChoices)))
    return null;

  const inlineChoices = packChoices && !homeCard;
  const options = (
    <div className="yk-referral-options">
      <section className="yk-referral-option yk-referral-option--invite">
        <div className="yk-referral-option-head">
          <Image
            src="/assets/chrome-regular-booster-v1.png"
            alt=""
            width={36}
            height={64}
          />
          <div>
            <h3>{t("inviteFriends")}</h3>
            <p className="yk-referral-option-reward">
              <strong>+5</strong> {t("packs")}
            </p>
          </div>
        </div>
        {!inlineChoices && (
          <p className="yk-referral-option-detail">
            {t("forEachFriendWhoVerifiesTheirEmailTheyGet5")}
          </p>
        )}
        {!inlineChoices && progress.friends > 0 && (
          <p className="yk-referral-option-progress">
            {progress.friends}{" "}
            {progress.friends === 1 ? t("friend") : t("friends")} {t("joined")}{" "}
            {progress.packs} {t("packsEarned")}
          </p>
        )}
        {!inlineChoices && (
          <input
            readOnly
            aria-label={t("yourInviteLink")}
            className="yk-referral-link-field"
            value={code ? referralLink(code) : "Preparing your link…"}
            onFocus={event => event.currentTarget.select()}
          />
        )}
        <div className="yk-referral-option-actions">
          <Button disabled={!code} onClick={() => void copyLink()}>
            {!code
              ? t("preparing")
              : copyState === "copied"
                ? t("copied")
                : t("copyLink")}
          </Button>
          {!inlineChoices &&
            typeof navigator !== "undefined" &&
            typeof navigator.share === "function" && (
              <Button disabled={!code} onClick={() => void shareLink()}>
                {t("share")}
              </Button>
            )}
        </div>
        {copyState === "error" && (
          <p role="alert" className="text-sm text-danger">
            {t("couldnTCopyTheLinkPleaseTryAgain")}
          </p>
        )}
      </section>
      <section className="yk-referral-option yk-referral-option--pro">
        <div className="yk-referral-option-head">
          <Image
            src="/assets/chrome-decision-booster-v1.png"
            alt=""
            width={36}
            height={64}
          />
          <div>
            <h3>Yokkai Pro</h3>
            <p className="yk-referral-option-reward">
              {inlineChoices ? (
                t("compactReserve", {
                  multiplier:
                    rules.pro.regularPackReserve /
                    rules.basic.regularPackReserve
                })
              ) : (
                <>
                  <strong>
                    {rules.pro.regularPackReserve /
                      rules.basic.regularPackReserve}
                    ×
                  </strong>{" "}
                  {t("reserveSize")}
                </>
              )}
            </p>
          </div>
        </div>
        {!inlineChoices && (
          <ul className="yk-referral-option-detail">
            <li>
              {t("regularPackReserve", {
                count: rules.pro.regularPackReserve,
                basicCount: rules.basic.regularPackReserve,
                minutes: rules.pro.regularPackMinutes
              })}
            </li>
            <li>
              {t("decisionPacksPerDay", {
                packName: "Decision Packs",
                count: rules.pro.decisionPacksPerDay,
                basicCount: rules.basic.decisionPacksPerDay
              })}
            </li>
          </ul>
        )}
        <div className="yk-referral-option-actions">
          <Link href="/premium" className="yk-button yk-button-primary">
            {t("explorePro")}
          </Link>
        </div>
      </section>
    </div>
  );
  if (inlineChoices)
    return (
      <aside
        ref={bar}
        className="yk-referral-reminder--boosters"
        aria-label={t("wantMorePacks")}
      >
        {options}
      </aside>
    );

  const content = (
    <>
      {homeCard ? (
        <section
          aria-labelledby="home-referral"
          className="yk-home-referral yk-home-pack-options"
        >
          <div>
            <h2 id="home-referral">{t("donTStopNow")}</h2>
            <p>
              <em>{t("bonusPacksOrLargerReserve")}</em>
            </p>
          </div>
          <Button
            className="yk-home-panel-action"
            aria-haspopup="dialog"
            onClick={() => setChoicesOpen(true)}
          >
            {t("seeOptions")}
            <span aria-hidden="true">↗</span>
          </Button>
          <div className="yk-home-pack-options-art" aria-hidden="true">
            <Image
              src="/assets/home-booster-box.webp"
              alt=""
              width={640}
              height={483}
            />
          </div>
        </section>
      ) : (
        <aside
          style={choicesOpen ? { display: "none" } : undefined}
          aria-label={t("referralReward")}
          className={[
            "yk-referral-reminder fixed bottom-4 left-16 z-[70] grid w-[min(calc(100vw-5rem),32rem)]",
            "grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[18px]",
            "border border-veil-strong bg-surface/95 px-4 py-2.5 backdrop-blur-md",
            "shadow-[0_14px_45px_rgba(0,0,0,0.55),0_0_24px_rgba(141,173,255,0.08)]",
            "max-sm:left-3 max-sm:w-[calc(100vw-1.5rem)]"
          ].join(" ")}
        >
          <div className="min-w-0">
            <p className="yk-referral-reminder-title truncate font-display text-sm font-bold tracking-wide text-ink">
              {t("inviteFriendsEarn5BonusPacks")}
            </p>
            <p className="yk-referral-reminder-note mt-0.5 truncate text-[11px] text-ink-3">
              {t("rewardedAfterTheirEmailIsVerified")}
            </p>
          </div>
          <Button
            type="button"
            disabled={!code}
            onClick={() => void copyLink()}
            className="yk-referral-reminder-copy min-h-9 whitespace-nowrap !rounded-full px-5 py-2 text-xs"
          >
            {!code
              ? t("preparing")
              : copyState === "copied"
                ? t("copied")
                : t("copyLink")}
          </Button>
          {!isBoosters && (
            <button
              type="button"
              aria-label={t("dismissReferralReminder")}
              onClick={dismiss}
              className="grid h-7 w-7 place-items-center rounded-full border border-veil text-base leading-none text-ink-3 transition hover:border-focus hover:bg-veil hover:text-ink"
            >
              ×
            </button>
          )}
          {copyState === "error" && (
            <p role="alert" className="col-span-3 text-[11px] text-danger">
              {t("couldnTCopyTheLinkTryAgainFromSettings")}
            </p>
          )}
        </aside>
      )}
      <Modal
        open={choicesOpen}
        onClose={() => setChoicesOpen(false)}
        title={t("wantMoreBoosters")}
        className={
          homeCard
            ? "yk-referral-modal yk-home-booster-modal"
            : "yk-referral-modal"
        }
      >
        <p className="yk-referral-modal-lead">{t("twoWaysToOpenMorePacks")}</p>
        {options}
      </Modal>
    </>
  );
  return content;
}
