"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReferralEvent } from "@/lib/referrals/event";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import "@/styles/home-leaderboard.css";

export default function ReferralEventLeaderboard({
  ranking
}: {
  ranking: NonNullable<ReferralEvent["leaderboard"]>;
}) {
  const t = useTranslations("referralEvent"),
    common = useTranslations("homeLeaderboard"),
    fmt = useFormatter();
  const row = (
    entry: (typeof ranking.entries)[number],
    index: number,
    podium: boolean
  ) => (
    <li
      key={entry.pseudo}
      data-slot={podium ? index + 1 : undefined}
      data-rank={podium ? entry.position : undefined}
      data-mine={entry.mine}
      className={entry.mine ? "is-you" : undefined}
    >
      <span
        className="yk-home-ranking-rank"
        aria-label={common("rank", { position: entry.position })}
      >
        #{fmt.number(entry.position)}
      </span>
      <Link
        className="yk-home-ranking-player"
        href={`/profile/${encodeURIComponent(entry.pseudo)}`}
      >
        <span className={podium ? "yk-home-ranking-avatar" : undefined}>
          {podium && index === 0 && (
            <svg
              className="yk-home-ranking-crown"
              viewBox="0 0 32 28"
              aria-hidden="true"
            >
              <path
                d="m4 9 6.5 5L16 4l5.5 10L28 9l-3 13H7L4 9ZM7 23h18v3H7Z"
                fill="currentColor"
              />
            </svg>
          )}
          <StyledPlayerAvatar
            name={entry.pseudo}
            image={entry.avatarUrl ?? undefined}
            cosmetics={entry.cosmetics}
            size={podium ? 64 : 36}
          />
        </span>
        <span>
          <strong>
            <StyledPlayerName
              name={entry.pseudo}
              playerId={entry.userId}
              cosmetics={entry.cosmetics}
            />
          </strong>
          {entry.mine && <small>{t("leaderboardYou")}</small>}
        </span>
      </Link>
      <span className="yk-home-ranking-points">
        <strong>{fmt.number(entry.validCount)}</strong>
        <small>{t("leaderboardReferrals", { count: entry.validCount })}</small>
      </span>
    </li>
  );
  return (
    <section
      className="yk-referral-leaderboard"
      aria-labelledby="referral-leaderboard-title"
    >
      <h2 id="referral-leaderboard-title">{t("leaderboardTitle")}</h2>
      <p>{t("leaderboardHint")}</p>
      <p className="yk-referral-leaderboard-mine">
        {ranking.mine?.position != null
          ? t("leaderboardPosition", { rank: ranking.mine.position })
          : t(
              ranking.mine?.isPublic === false
                ? "leaderboardPrivate"
                : "leaderboardUnranked"
            )}
      </p>
      {ranking.entries.length ? (
        <div
          className="yk-home-ranking yk-referral-leaderboard-body"
          data-has-rest={ranking.entries.length > 3}
        >
          <ol className="yk-home-ranking-podium" aria-label={common("podium")}>
            {ranking.entries
              .slice(0, 3)
              .map((entry, index) => row(entry, index, true))}
          </ol>
          {ranking.entries.length > 3 && (
            <ol
              className="yk-home-ranking-list"
              start={4}
              tabIndex={0}
              aria-label={t("leaderboardRemaining")}
            >
              {ranking.entries
                .slice(3)
                .map((entry, index) => row(entry, index + 3, false))}
            </ol>
          )}
        </div>
      ) : (
        <p role="status">{t("leaderboardEmpty")}</p>
      )}
    </section>
  );
}
