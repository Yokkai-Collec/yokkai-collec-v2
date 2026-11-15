"use client";

import Link from "next/link";
import { RankingIcon } from "@/components/ranking-icon";
import { useFormatter, useTranslations } from "next-intl";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import type {
  CommunityRanking,
  CommunityRankingKind
} from "@/lib/leaderboard/community";

function Metrics({
  kind,
  value,
  completed,
  cards,
  data
}: {
  kind: CommunityRankingKind;
  value: number;
  completed?: number;
  cards?: number;
  data: CommunityRanking;
}) {
  const t = useTranslations("communityRanking"),
    fmt = useFormatter();
  return kind === "likes" ? (
    <span className="yk-home-ranking-points">
      <strong>{fmt.number(value)}</strong>
      <small>{t("likesNoun", { count: value })}</small>
    </span>
  ) : data.metric === "completion-score" ? (
    <dl className="yk-home-ranking-license-metrics">
      <div data-global-stat="score">
        <dt>{t("completionScore")}</dt>
        <dd>{t("completionPoints", { count: value })}</dd>
      </div>
      <div data-global-stat="completed">
        <dt>{t("completedStat")}</dt>
        <dd>
          {t("ratio", {
            owned: completed ?? 0,
            total: data.catalogue?.totalLicenses ?? 0
          })}
        </dd>
      </div>
    </dl>
  ) : (
    <dl className="yk-home-ranking-license-metrics">
      <div>
        <dt>{t("completedStat")}</dt>
        <dd>
          {t("ratio", {
            owned: completed ?? 0,
            total: data.catalogue?.totalLicenses ?? 0
          })}
        </dd>
      </div>
      <div>
        <dt>{t("cardsStat")}</dt>
        <dd>
          {t("ratio", {
            owned: cards ?? 0,
            total: data.catalogue?.totalCards ?? 0
          })}
        </dd>
      </div>
    </dl>
  );
}
export function HomeCommunityRanking({
  userId,
  kind,
  data
}: {
  userId: string;
  kind: CommunityRankingKind;
  data: CommunityRanking;
}) {
  const t = useTranslations("homeRankingCarousel"),
    common = useTranslations("homeLeaderboard"),
    fmt = useFormatter(),
    progress = useTranslations("rankingProgress");
  const player = (
    entry: CommunityRanking["entries"][number],
    podium: boolean
  ) => (
    <Link
      className="yk-home-ranking-player"
      href={`/profile/${encodeURIComponent(entry.pseudo)}`}
    >
      <span className={podium ? "yk-home-ranking-avatar" : undefined}>
        {podium && entry.position === 1 && (
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
          cosmetics={data.profileStyles[entry.userId]}
          name={entry.pseudo}
          image={entry.avatarUrl ?? undefined}
          size={podium ? 64 : 36}
        />
      </span>
      <span>
        <strong>
          <StyledPlayerName
            name={entry.pseudo}
            playerId={entry.userId}
            cosmetics={data.profileStyles[entry.userId]}
          />
        </strong>
        {entry.userId === userId && <small>{common("you")}</small>}
      </span>
    </Link>
  );
  return (
    <div className={`yk-home-ranking yk-home-ranking-${kind}`}>
      <p className="yk-home-ranking-intro">
        {t(kind === "likes" ? "likesIntro" : "licensesIntro")}
      </p>
      {data.entries.length ? (
        <ol className="yk-home-ranking-podium" aria-label={t("podium")}>
          {data.entries.slice(0, 3).map((entry, index) => (
            <li
              key={entry.userId}
              data-slot={index + 1}
              data-rank={entry.position <= 3 ? entry.position : undefined}
              className={entry.userId === userId ? "is-you" : undefined}
            >
              <span
                className="yk-home-ranking-rank"
                aria-label={common("rank", { position: entry.position })}
              >
                #{fmt.number(entry.position)}
              </span>
              {player(entry, true)}
              <Metrics
                kind={kind}
                value={entry.value}
                completed={entry.completedLicenses}
                cards={entry.distinctCards}
                data={data}
              />
            </li>
          ))}
        </ol>
      ) : (
        <div className="yk-home-ranking-empty">
          <RankingIcon kind={kind} />
          <p>{t(kind === "likes" ? "emptyLikes" : "emptyLicenses")}</p>
          <Link className="yk-button yk-button-secondary" href="/social">
            {progress("discoverCommunity")}
          </Link>
        </div>
      )}
      {data.entries.length > 3 && (
        <ol
          className="yk-home-ranking-list"
          start={4}
          aria-label={t("morePlayers")}
        >
          {data.entries.slice(3).map(entry => (
            <li
              key={entry.userId}
              className={entry.userId === userId ? "is-you" : undefined}
            >
              <span
                className="yk-home-ranking-rank"
                aria-label={common("rank", { position: entry.position })}
              >
                #{fmt.number(entry.position)}
              </span>
              {player(entry, false)}
              <Metrics
                kind={kind}
                value={entry.value}
                completed={entry.completedLicenses}
                cards={entry.distinctCards}
                data={data}
              />
            </li>
          ))}
        </ol>
      )}
      {data.mine && (
        <div className="yk-home-ranking-mine">
          <div className="yk-home-ranking-personal-metrics">
            <span>{t(kind === "likes" ? "yourLikes" : "yourLicenses")}</span>
            <Metrics
              kind={kind}
              value={data.mine.value}
              completed={data.mine.completedLicenses}
              cards={data.mine.distinctCards}
              data={data}
            />
          </div>
          <span>
            {!data.mine.isPublic
              ? common("private")
              : data.mine.position
                ? common("position", {
                    position: fmt.number(data.mine.position),
                    total: fmt.number(data.rankedPlayers)
                  })
                : t("notRanked")}
          </span>
        </div>
      )}
    </div>
  );
}
