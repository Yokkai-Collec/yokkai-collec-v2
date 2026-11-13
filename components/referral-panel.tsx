"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations, useFormatter } from "next-intl";

import { useActionState, useMemo, useState } from "react";
import {
  createReferralLink,
  type ReferralActionState
} from "@/app/settings/referral-actions";
import type { ReferralStatus } from "@/lib/referrals/shared";
import { referralRankLabel } from "@/lib/referrals/rank.mjs";
import { Button, Modal } from "@/components/ui";
import { ReferralDetails } from "@/components/referral-details";

export function ReferralPanel({
  initialStatus,
  siteOrigin,
  compact = false
}: {
  initialStatus: ReferralStatus;
  siteOrigin: string;
  compact?: boolean;
}) {
  const fmt = useFormatter();
  const t = useTranslations();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [state, action, pending] = useActionState<
    ReferralActionState,
    FormData
  >(createReferralLink, {});
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle"
  );
  const code = state.code ?? initialStatus.code;
  const rankLabel = referralRankLabel(initialStatus.rank);
  const link = useMemo(
    () => (code ? `${siteOrigin}/signup?ref=${encodeURIComponent(code)}` : ""),
    [code, siteOrigin]
  );

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <section
      id="referrals"
      className={
        compact
          ? "yk-referral-event-invite"
          : "mt-6 rounded-panel border border-veil bg-surface p-6"
      }
    >
      {!compact && <p className="eyebrow">{t("proPromotion.inviteFriends")}</p>}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-2xl">
          <h2 className="font-display text-xl">
            {t("settingsUi.yourReferralLink")}
          </h2>
          {!compact && (
            <p className="mt-3 text-sm leading-6 text-ink-2">
              {t("settingsUi.referralRewardNotice")}{" "}
            </p>
          )}
        </div>
        {!compact && (
          <div className="yk-referral-counters">
            <button
              type="button"
              className="yk-referral-counter"
              aria-haspopup="dialog"
              onClick={() => setDetailsOpen(true)}
            >
              <span className="text-xs text-ink-3">
                {t("settingsUi.verifiedFriends")}
              </span>
              <strong className="text-xl">
                {fmt.number(initialStatus.verifiedReferrals)}
              </strong>
              {rankLabel && initialStatus.rank?.position != null ? (
                <>
                  <span className="yk-referral-rank">
                    {t("settingsUi.referralRankLabel", {
                      value: rankLabel.slice(4)
                    })}
                  </span>
                  <span className="yk-referral-rank-position">
                    {t("settingsUi.referralPosition", {
                      position: initialStatus.rank.position,
                      total: initialStatus.rank.totalPlayers
                    })}
                  </span>
                </>
              ) : initialStatus.rank ? (
                <span className="yk-referral-rank-position">
                  {t("settingsUi.notRankedYet")}
                </span>
              ) : null}
              <span className="yk-referral-counter-link">
                {t("settingsUi.viewReferrals")}
              </span>
            </button>
            <div className="yk-referral-counter yk-referral-counter-static">
              <span className="text-xs text-ink-3">
                {t("settingsUi.packsEarned")}
              </span>
              <strong className="text-xl">
                {fmt.number(initialStatus.packsEarned)}
              </strong>
            </div>
          </div>
        )}
      </div>
      {state.error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {t(gameErrorKey(state.error, "settingsUi.couldntSaveSettings"))}
        </p>
      )}
      {link ? (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="referral-link">
            {t("settingsUi.referralLink")}{" "}
          </label>
          <input
            id="referral-link"
            className="yk-field-control min-w-0 flex-1"
            readOnly
            value={link}
            onFocus={event => event.currentTarget.select()}
          />
          <Button type="button" onClick={() => void copyLink()}>
            {copyState === "copied"
              ? t("referralReminder.copied")
              : t("referralReminder.copyLink")}
          </Button>
        </div>
      ) : (
        <form action={action} className="mt-5">
          <Button type="submit" disabled={pending}>
            {pending
              ? t("settingsUi.creatingLink")
              : t("settingsUi.createMyReferralLink")}
          </Button>
        </form>
      )}
      {copyState === "error" && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {t("settingsUi.referralManualCopy")}{" "}
        </p>
      )}
      {!compact && initialStatus.bonusPacks > 0 && (
        <p className="mt-4 text-sm text-success">
          {t("settingsUi.bonusPacksReady", { count: initialStatus.bonusPacks })}
        </p>
      )}
      <Modal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={t("settingsUi.yourReferrals")}
        className="yk-referral-modal"
      >
        {initialStatus.rank && (
          <p className="mb-4 text-xs leading-5 text-ink-3">
            {t("settingsUi.referralRankingHint")}{" "}
          </p>
        )}
        <ReferralDetails />
      </Modal>
    </section>
  );
}
