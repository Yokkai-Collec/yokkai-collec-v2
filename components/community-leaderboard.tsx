"use client";

import { formatLicenseName } from "@/lib/ui/license-name";
import Link from "next/link";
import { RankingGoal, RankingTrend } from "@/components/ranking-progress";
import { useRankingPlayerPreview } from "@/components/ranking-player-preview";
import { RankingLicenseExplorer } from "@/components/ranking-license-explorer";
import { RankingLicenseCover } from "@/components/ranking-license-cover";
import type { PaniniAlbumProgress } from "@/lib/data/cards";
import { binderIdentity } from "@/lib/ui/binder-identity";
import { binderHref } from "@/lib/ui/binder-discovery";
import { RankingIcon } from "@/components/ranking-icon";
import { useEffect, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { GlobalLicenseStats } from "@/components/global-license-stats";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import { stableBindersEnabled } from "@/lib/data/binders";
import {
  getCommunityRanking,
  completionRatio,
  type CommunityRanking,
  type CommunityRankingKind,
  type CommunityRankingRequest
} from "@/lib/leaderboard/community";

export function CommunityLeaderboardView({
  userId,
  kind,
  embedded = false,
  navigation
}: {
  userId: string;
  kind: CommunityRankingKind;
  embedded?: boolean;
  navigation?: ReactNode;
}) {
  const playerPreview = useRankingPlayerPreview();
  const t = useTranslations("communityRanking"),
    common = useTranslations(),
    fmt = useFormatter();
  const [data, setData] = useState<CommunityRanking | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CommunityRankingRequest>({
    offset: 0,
    query: "",
    friendsOnly: embedded
  });
  const [selectedLicense, setSelectedLicense] =
    useState<PaniniAlbumProgress | null>(null);
  const [licenseRevision, setLicenseRevision] = useState(0);
  const reload = (next = options) => {
    setLoading(true);
    setError(false);
    setOptions({ ...next });
  };

  const isGlobal = kind === "licenses" && !selectedLicense;
  const rankingKey = isGlobal
    ? "global:progress-score" + (stableBindersEnabled() ? "" : ":legacy")
    : kind === "licenses" && selectedLicense
      ? binderIdentity(selectedLicense)
      : "";
  useEffect(() => {
    let active = true;
    const controller =
      typeof AbortController === "undefined" ? null : new AbortController();
    const run = async () => {
      try {
        let next = await getCommunityRanking(
          kind,
          options,
          rankingKey,
          controller?.signal
        );
        if (options.offset > 0 && !next.entries.length && active)
          next = await getCommunityRanking(
            kind,
            { ...options, offset: 0 },
            rankingKey,
            controller?.signal
          );
        if (active) {
          setData(next);
          setLoading(false);
        }
      } catch {
        if (active) {
          setData(null);
          setError(true);
          setLoading(false);
        }
      }
    };
    void run();
    return () => {
      active = false;
      controller?.abort();
    };
  }, [kind, options, rankingKey, userId]);

  const isLicense = kind === "licenses",
    mine = data?.mine,
    totalCards = data?.catalogue?.totalCards ?? 0;
  const Root = embedded ? "section" : "main",
    Heading = embedded ? "h2" : "h1";
  return (
    <Root
      onClickCapture={playerPreview.onClickCapture}
      id={embedded ? undefined : "main-content"}
      className={`yk-leaderboard yk-community-ranking${embedded ? " yk-leaderboard-social" : ""}`}
      aria-labelledby="community-ranking-title"
      data-ranking={kind}
    >
      <header className="yk-leaderboard-heading">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <Heading className="yk-title" id="community-ranking-title">
            {t(isLicense ? "licensesTitle" : "likesTitle")}
          </Heading>
          <p>{t(isLicense ? "licensesIntro" : "likesIntro")}</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            reload();
            setLicenseRevision(value => value + 1);
          }}
          disabled={loading}
        >
          {common("socialUi.refreshRankings")}
        </Button>
      </header>
      {navigation}

      <>
        <section
          className="yk-leaderboard-mine yk-community-progress"
          aria-label={t(
            isLicense
              ? isGlobal
                ? "yourGlobalProgress"
                : "yourProgress"
              : "yourLikes"
          )}
          aria-busy={loading}
        >
          {isLicense && selectedLicense ? (
            <RankingLicenseCover
              key={binderIdentity(selectedLicense)}
              binder={selectedLicense}
            />
          ) : (
            <div
              className="yk-leaderboard-emblem"
              data-ranking={kind}
              aria-hidden="true"
            >
              <RankingIcon kind={kind} />
            </div>
          )}
          <div className="yk-leaderboard-personal">
            <span className="eyebrow">
              {t(
                isLicense
                  ? isGlobal
                    ? "yourGlobalProgress"
                    : "yourProgress"
                  : "yourLikes"
              )}
            </span>
            {isLicense && selectedLicense && (
              <h2 className="yk-ranking-license-name">
                {formatLicenseName(selectedLicense.license)}
              </h2>
            )}
            {isGlobal ? (
              !loading &&
              mine && (
                <GlobalLicenseStats
                  completionScore={
                    data?.metric === "completion-score"
                      ? mine.completionScore
                      : undefined
                  }
                  completed={mine.completedLicenses ?? 0}
                  cards={mine.distinctCards ?? 0}
                  totalLicenses={data?.catalogue?.totalLicenses ?? 0}
                  totalCards={totalCards}
                />
              )
            ) : isLicense ? (
              <strong>
                {loading || !mine
                  ? "—"
                  : fmt.number(
                      completionRatio(
                        mine.value,
                        data?.binder?.total ?? selectedLicense?.total ?? 0
                      ),
                      { style: "percent", maximumFractionDigits: 1 }
                    )}
              </strong>
            ) : (
              <strong>{loading || !mine ? "—" : fmt.number(mine.value)}</strong>
            )}
            <div className="yk-personal-rank">
              {isLicense && !isGlobal && !loading && mine && (
                <p>
                  {t("licenseYourCards", {
                    owned: mine.value,
                    total: data?.binder?.total ?? selectedLicense?.total ?? 0
                  })}
                </p>
              )}
              <p>
                {loading
                  ? t("loading")
                  : !mine
                    ? t("unavailable")
                    : !mine.isPublic
                      ? t("private")
                      : mine.position
                        ? t("rank", {
                            position: mine.position,
                            count: data!.rankedPlayers
                          })
                        : t(isLicense ? "noCards" : "notRanked")}
              </p>
              {!loading && data && (
                <RankingTrend
                  inCard
                  initialState={
                    mine?.isPublic === false
                      ? "private"
                      : mine?.position
                        ? "pending"
                        : "unranked"
                  }
                  history={data.history?.[userId]}
                />
              )}
            </div>
            {isGlobal && !loading && (mine?.completedLicenses ?? 0) > 0 && (
              <Link href={binderHref(undefined, true)}>
                {t("viewCompletedBinders")}
              </Link>
            )}
            {mine && !mine.isPublic && (
              <Link href="/settings">
                {common("socialUi.manageProfilePrivacy")}
              </Link>
            )}
          </div>
        </section>

        {isLicense && (
          <RankingLicenseExplorer
            key={userId}
            userId={userId}
            revision={licenseRevision}
            selected={selectedLicense}
            onSelect={binder => {
              setSelectedLicense(binder);
              setQuery("");
              reload({ ...options, offset: 0, query: "" });
            }}
          />
        )}

        <div className="yk-leaderboard-layout">
          <section
            className="yk-leaderboard-board"
            aria-label={t("listLabel", { kind: isGlobal ? "global" : kind })}
            aria-busy={loading}
          >
            <div
              className="yk-leaderboard-scopes"
              role="group"
              aria-label={common("socialUi.leaderboardView")}
            >
              <Button
                variant="secondary"
                aria-pressed={!options.friendsOnly}
                onClick={() =>
                  reload({ ...options, offset: 0, friendsOnly: false })
                }
              >
                {common("socialUi.top100")}
              </Button>
              <Button
                variant="secondary"
                aria-pressed={options.friendsOnly}
                onClick={() =>
                  reload({ ...options, offset: 0, friendsOnly: true })
                }
              >
                {common("catalogueUi.friends")}
              </Button>
            </div>
            <form
              className="yk-leaderboard-search"
              onSubmit={event => {
                event.preventDefault();
                reload({ ...options, query, offset: 0 });
              }}
            >
              <label htmlFor="community-player-search">
                {common("socialUi.findAPlayer")}
              </label>
              <div>
                <input
                  id="community-player-search"
                  type="search"
                  maxLength={64}
                  value={query}
                  placeholder={common("socialUi.searchByUsername")}
                  onChange={event => setQuery(event.target.value)}
                />
                <Button type="submit" variant="secondary">
                  {common("socialUi.search")}
                </Button>
                {(query || options.query) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                      reload({ ...options, query: "", offset: 0 });
                    }}
                  >
                    {common("profileUi.clearSearch")}
                  </Button>
                )}
              </div>
              <p>
                {common(
                  options.friendsOnly
                    ? "socialUi.searchYourRankedFriendsByUsername"
                    : "socialUi.searchAllRankedPlayersIncludingOutsideThe"
                )}
              </p>
            </form>
            {error && (
              <div className="yk-leaderboard-message" role="alert">
                <p>{t("failed")}</p>
                <Button variant="secondary" onClick={() => reload()}>
                  {common("packs.tryAgain")}
                </Button>
              </div>
            )}
            {loading && (
              <p className="yk-leaderboard-loading" role="status">
                {t("loading")}
              </p>
            )}
            {!loading && !error && data && (
              <>
                <p className="yk-leaderboard-results" role="status">
                  {common("socialUi.collectionResults", {
                    count: data.total,
                    query: data.query,
                    scope: data.query
                      ? "search"
                      : data.friendsOnly
                        ? "friends"
                        : "top"
                  })}
                </p>
                <ol
                  className="yk-leaderboard-list"
                  aria-label={t("listLabel", {
                    kind: isGlobal ? "global" : kind
                  })}
                >
                  {data.entries.map(entry => (
                    <li
                      key={entry.userId}
                      className={`${entry.userId === userId ? "is-you" : ""} ${entry.position <= 3 ? "is-podium" : ""}`}
                    >
                      <span
                        className="yk-leaderboard-position"
                        aria-label={common("socialUi.rank", {
                          position: entry.position
                        })}
                      >
                        #{fmt.number(entry.position)}
                      </span>
                      <Link
                        href={`/profile/${encodeURIComponent(entry.pseudo)}`}
                        className="yk-leaderboard-player"
                      >
                        <StyledPlayerAvatar
                          cosmetics={data.profileStyles[entry.userId]}
                          name={entry.pseudo}
                          image={entry.avatarUrl ?? undefined}
                          size={42}
                        />
                        <span>
                          <strong>
                            <StyledPlayerName
                              name={entry.pseudo}
                              playerId={entry.userId}
                              cosmetics={data.profileStyles[entry.userId]}
                            />
                            {entry.userId === userId && (
                              <RankingTrend
                                compact
                                initialState="pending"
                                history={data.history?.[entry.userId]}
                              />
                            )}
                            {entry.userId === userId && (
                              <small>{common("homeLeaderboard.you")}</small>
                            )}
                            {entry.isFriend && (
                              <small className="yk-leaderboard-friend">
                                {common("socialUi.friend")}
                              </small>
                            )}
                          </strong>
                        </span>
                      </Link>
                      {isGlobal ? (
                        <GlobalLicenseStats
                          completionScore={
                            data.metric === "completion-score"
                              ? entry.completionScore
                              : undefined
                          }
                          completed={entry.completedLicenses ?? 0}
                          cards={entry.distinctCards ?? 0}
                          totalLicenses={data?.catalogue?.totalLicenses ?? 0}
                          totalCards={totalCards}
                          compact
                        />
                      ) : isLicense ? (
                        <span className="yk-leaderboard-points">
                          <strong>
                            {fmt.number(
                              completionRatio(
                                entry.value,
                                data.binder?.total ?? 0
                              ),
                              { style: "percent", maximumFractionDigits: 1 }
                            )}
                          </strong>
                          <small>
                            {t("licenseLeaderCards", {
                              owned: entry.value,
                              total: data.binder?.total ?? 0
                            })}
                          </small>
                        </span>
                      ) : (
                        <>
                          <span className="yk-leaderboard-points">
                            <strong>{fmt.number(entry.value)}</strong>
                            <small>
                              {t("likesNoun", { count: entry.value })}
                            </small>
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
                {!data.entries.length && (
                  <p className="yk-leaderboard-message">{t("empty")}</p>
                )}
                {data.total > data.limit && (
                  <nav
                    aria-label={common("socialUi.leaderboardPages")}
                    className="yk-leaderboard-pagination"
                  >
                    <Button
                      variant="secondary"
                      disabled={data.offset === 0}
                      onClick={() =>
                        reload({
                          ...options,
                          offset: Math.max(0, data.offset - data.limit)
                        })
                      }
                    >
                      {common("settingsUi.previous")}
                    </Button>
                    <span>
                      {common("socialUi.page", {
                        page: Math.floor(data.offset / data.limit) + 1,
                        total: Math.ceil(data.total / data.limit)
                      })}
                    </span>
                    <Button
                      variant="secondary"
                      disabled={data.offset + data.limit >= data.total}
                      onClick={() =>
                        reload({
                          ...options,
                          offset: data.offset + data.limit
                        })
                      }
                    >
                      {common("packs.next")}
                    </Button>
                  </nav>
                )}
              </>
            )}
          </section>
          <aside className="yk-ranking-side-column">
            {!loading && data && (
              <RankingGoal
                kind={kind}
                userId={userId}
                mine={data.mine ?? undefined}
                entries={data.entries}
                binder={data.binder}
              />
            )}
            <section className="yk-leaderboard-rules">
              <h2>{t("rules")}</h2>
              <p>
                {t(
                  isLicense
                    ? isGlobal
                      ? "globalRules"
                      : "licenseRules"
                    : "likesRules"
                )}
              </p>
              {isGlobal && data?.completionWeights && (
                <>
                  <h3>{t("completionWeightsTitle")}</h3>
                  <dl className="yk-completion-weights">
                    {(["C", "R", "SR", "SSR", "LR"] as const).map(rarity => (
                      <div key={rarity} data-rarity={rarity}>
                        <dt>{rarity}</dt>
                        <dd>{data.completionWeights?.[rarity]}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>{t("completionScoredCards")}</p>
                </>
              )}
              <p>{t("privacyRules")}</p>
              {isLicense && <p>{t("currentRules")}</p>}
            </section>
          </aside>
        </div>
      </>
      {playerPreview.preview}
    </Root>
  );
}
