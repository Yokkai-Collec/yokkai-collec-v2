"use client";
import { useTranslations, useFormatter } from "next-intl";

import { socialErrorKey as gameErrorKey } from "@/i18n/social-messages";
import Link from "next/link";
import { RankingGoal, RankingTrend } from "@/components/ranking-progress";
import { useRankingPlayerPreview } from "@/components/ranking-player-preview";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { Button } from "@/components/ui";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import {
  LeaderboardStatIcon,
  LeaderboardRarityBadge,
  LeaderboardStats
} from "@/components/leaderboard-stats";
import { getCollectionLeaderboard } from "@/lib/leaderboard/client";
import {
  COLLECTION_SCORE_RULES,
  type CollectionLeaderboard
} from "@/lib/leaderboard/shared";

type LeaderboardRequest = {
  offset: number;
  query: string;
  friendsOnly: boolean;
};

function Trophy() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 13v5m-4 3h8m-7-3h6v3H9z" />
    </svg>
  );
}

export function CollectionLeaderboardView({
  userId,
  embedded = false,
  navigation
}: {
  userId: string;
  embedded?: boolean;
  navigation?: ReactNode;
}) {
  const playerPreview = useRankingPlayerPreview();
  const tPr4 = useTranslations();
  const fmt = useFormatter();
  const number = fmt.number;
  const [data, setData] = useState<CollectionLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [friendsOnly, setFriendsOnly] = useState(embedded);
  const request = useRef(0);
  const lastRequest = useRef<LeaderboardRequest>({
    offset: 0,
    query: "",
    friendsOnly: embedded
  });
  const load = useCallback(async (options: LeaderboardRequest) => {
    const current = ++request.current;
    lastRequest.current = options;
    setLoading(true);
    setError("");
    try {
      let next = await getCollectionLeaderboard(
        options.offset,
        options.query,
        options.friendsOnly
      );
      // Holdings/visibility can change between pages. Recover from a removed last page.
      if (
        options.offset > 0 &&
        !next.entries.length &&
        current === request.current
      ) {
        lastRequest.current = { ...options, offset: 0 };
        next = await getCollectionLeaderboard(
          0,
          options.query,
          options.friendsOnly
        );
      }
      if (current === request.current) setData(next);
    } catch (reason) {
      if (current === request.current)
        setError(gameErrorKey(reason, "socialUi.leaderboardFailed"));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    const current = ++request.current;
    // Only the completed external request updates state on initial mount.
    lastRequest.current = { offset: 0, query: "", friendsOnly: embedded };
    void getCollectionLeaderboard(0, "", embedded)
      .then(next => {
        if (active && current === request.current) setData(next);
      })
      .catch(reason => {
        if (active && current === request.current)
          setError(gameErrorKey(reason, "socialUi.leaderboardFailed"));
      })
      .finally(() => {
        if (active && current === request.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, embedded]);

  const mine = data?.mine;
  const myCounts = data?.cardCounts?.[userId];
  const Root = embedded ? "section" : "main";
  const Heading = embedded ? "h2" : "h1";
  const Subheading = embedded ? "h3" : "h2";
  return (
    <Root
      onClickCapture={playerPreview.onClickCapture}
      id={embedded ? undefined : "main-content"}
      className={`yk-leaderboard${embedded ? " yk-leaderboard-social" : ""}`}
      aria-labelledby="leaderboard-title"
    >
      <header className="yk-leaderboard-heading">
        <div>
          <p className="eyebrow">{tPr4("socialUi.everyRareFindCounts")}</p>
          <Heading className="yk-title" id="leaderboard-title">
            {tPr4("socialUi.collectionLeaderboard")}
          </Heading>
          <p>{tPr4("socialUi.buildACollectionWorthClimbingFor")}</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void load(lastRequest.current)}
          disabled={loading}
        >
          {tPr4("socialUi.refreshScores")}
        </Button>
      </header>

      {navigation}

      <section
        className="yk-leaderboard-mine yk-community-progress yk-ranking-summary-power"
        aria-label={tPr4("socialUi.yourCollectionScore")}
      >
        <div className="yk-leaderboard-emblem">
          <Trophy />
        </div>
        <div className="yk-leaderboard-personal">
          <span className="eyebrow">
            {tPr4("socialUi.yourCollectionScore")}
          </span>
          <strong>
            {mine ? number(mine.score) : "—"}
            <small> {tPr4("socialUi.points")}</small>
          </strong>
          <div className="yk-personal-rank">
            <p>
              {!mine
                ? error
                  ? tPr4("socialUi.yourScoreIsCurrentlyUnavailable")
                  : tPr4("socialUi.loadingYourCollectionScore")
                : !mine.isPublic
                  ? tPr4("socialUi.privateProfileYourScoreIsVisibleOnly")
                  : mine.position
                    ? tPr4("socialUi.collectionRank", {
                        position: mine.position,
                        count: data!.rankedPlayers
                      })
                    : tPr4("socialUi.collectYourFirstCardToEnterThe")}
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
          {mine && !mine.isPublic && (
            <Link href="/settings">
              {tPr4("socialUi.manageProfilePrivacy")}
            </Link>
          )}
        </div>
        {mine && (
          <dl className="yk-leaderboard-counts">
            {(["sr", "ssr", "lr"] as const).map(rarity => (
              <div key={rarity} data-stat={rarity}>
                <dt>
                  <LeaderboardRarityBadge rarity={rarity.toUpperCase()} />
                  <span className="sr-only"> {tPr4("socialUi.cards")}</span>
                </dt>
                <dd>{myCounts ? number(myCounts[rarity]) : "—"}</dd>
              </div>
            ))}
            <div data-stat="infinity">
              <dt>
                <LeaderboardStatIcon kind="infinity" />
                Infinity
              </dt>
              <dd>{myCounts ? number(myCounts.infinity) : "—"}</dd>
            </div>
            <div data-stat="shiny">
              <dt>
                <LeaderboardStatIcon kind="shiny" />
                Shiny
              </dt>
              <dd>{myCounts ? number(myCounts.shiny) : "—"}</dd>
            </div>
          </dl>
        )}
      </section>

      <div className="yk-leaderboard-layout">
        <section
          className="yk-leaderboard-board"
          aria-labelledby="collectors-title"
          aria-busy={loading}
        >
          <div className="yk-leaderboard-section-heading">
            <Subheading id="collectors-title">
              {friendsOnly
                ? tPr4("socialUi.friendsLeaderboard")
                : tPr4("socialUi.top100Collectors")}
            </Subheading>
            <span>{tPr4("socialUi.currentCollectionScoreV1")}</span>
          </div>
          <p className="yk-leaderboard-note">
            {friendsOnly
              ? tPr4("socialUi.youAndYourFriendsOrderedByGlobal")
              : tPr4("socialUi.publicProfilesOnlyEqualScoresShareThe")}
          </p>
          <div
            className="yk-leaderboard-scopes"
            role="group"
            aria-label={tPr4("socialUi.leaderboardView")}
          >
            <Button
              variant="secondary"
              aria-pressed={!friendsOnly}
              onClick={() => {
                setFriendsOnly(false);
                void load({ offset: 0, query, friendsOnly: false });
              }}
            >
              {tPr4("socialUi.top100")}
            </Button>
            <Button
              variant="secondary"
              aria-pressed={friendsOnly}
              onClick={() => {
                setFriendsOnly(true);
                void load({ offset: 0, query, friendsOnly: true });
              }}
            >
              {tPr4("catalogueUi.friends")}
            </Button>
          </div>
          <form
            className="yk-leaderboard-search"
            onSubmit={event => {
              event.preventDefault();
              void load({ offset: 0, query, friendsOnly });
            }}
          >
            <label htmlFor="leaderboard-player-search">
              {tPr4("socialUi.findAPlayer")}
            </label>
            <div>
              <input
                id="leaderboard-player-search"
                type="search"
                maxLength={64}
                value={query}
                placeholder={tPr4("socialUi.searchByUsername")}
                aria-describedby="leaderboard-search-help"
                onChange={event => setQuery(event.target.value)}
              />
              <Button type="submit" variant="secondary">
                {tPr4("socialUi.search")}
              </Button>
              {(query || data?.query) && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    void load({ offset: 0, query: "", friendsOnly });
                  }}
                >
                  {tPr4("profileUi.clearSearch")}
                </Button>
              )}
            </div>
            <p id="leaderboard-search-help">
              {friendsOnly
                ? tPr4("socialUi.searchYourRankedFriendsByUsername")
                : tPr4("socialUi.searchAllRankedPlayersIncludingOutsideThe")}
            </p>
          </form>
          {error && (
            <div className="yk-leaderboard-message" role="alert">
              <p>{tPr4(error)}</p>
              <Button
                variant="secondary"
                onClick={() => void load(lastRequest.current)}
                disabled={loading}
              >
                {tPr4("packs.tryAgain")}
              </Button>
            </div>
          )}
          {loading && (
            <p className="yk-leaderboard-loading" role="status">
              {tPr4("socialUi.updatingCollectionScores")}
            </p>
          )}
          {loading && (
            <div className="yk-leaderboard-skeleton" aria-hidden="true">
              {[1, 2, 3, 4, 5].map(i => (
                <span key={i} />
              ))}
            </div>
          )}
          {data && !loading && !error && (
            <>
              <p className="yk-leaderboard-results" role="status">
                {tPr4("socialUi.collectionResults", {
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
                aria-label={tPr4("socialUi.collectorsRankedByScore")}
              >
                {data.entries.map(entry => (
                  <li
                    key={entry.userId}
                    className={`${entry.userId === userId ? "is-you" : ""} ${entry.position <= 3 ? "is-podium" : ""}`}
                  >
                    <span
                      className="yk-leaderboard-position"
                      aria-label={tPr4("socialUi.rank", {
                        position: entry.position
                      })}
                    >
                      #{number(entry.position)}
                    </span>
                    <Link
                      href={`/profile/${encodeURIComponent(entry.pseudo)}`}
                      className="yk-leaderboard-player"
                    >
                      <StyledPlayerAvatar
                        cosmetics={data.profileStyles?.[entry.userId]}
                        name={entry.pseudo}
                        image={entry.avatarUrl ?? undefined}
                        size={42}
                      />
                      <span>
                        <strong>
                          <StyledPlayerName
                            name={entry.pseudo}
                            playerId={entry.userId}
                            cosmetics={data.profileStyles?.[entry.userId]}
                          />
                          {entry.userId === userId && (
                            <RankingTrend
                              compact
                              initialState="pending"
                              history={data.history?.[entry.userId]}
                            />
                          )}
                          {entry.userId === userId && (
                            <small> {tPr4("homeLeaderboard.you")}</small>
                          )}
                          {entry.isFriend && (
                            <small className="yk-leaderboard-friend">
                              {tPr4("socialUi.friend")}
                            </small>
                          )}
                        </strong>
                        <LeaderboardStats
                          counts={data.cardCounts?.[entry.userId]}
                        />
                      </span>
                    </Link>
                    <span className="yk-leaderboard-points">
                      <strong>{number(entry.score)}</strong>
                      <small>{tPr4("socialUi.points")}</small>
                    </span>
                  </li>
                ))}
              </ol>
              {!data.entries.length && !loading && !error && (
                <p className="yk-leaderboard-message">
                  {data.query
                    ? tPr4("socialUi.noRankedPlayersFoundTryAnotherUsername")
                    : data.friendsOnly
                      ? tPr4("socialUi.noRankedFriendsYetFriendsWithPublic")
                      : tPr4("socialUi.noRankedCollectionsYetCollectACard")}
                </p>
              )}
              {data.total > data.limit && (
                <nav
                  aria-label={tPr4("socialUi.leaderboardPages")}
                  className="yk-leaderboard-pagination"
                >
                  <Button
                    variant="secondary"
                    disabled={loading || data.offset === 0}
                    onClick={() =>
                      void load({
                        offset: Math.max(0, data.offset - data.limit),
                        query: data.query,
                        friendsOnly: data.friendsOnly
                      })
                    }
                  >
                    {tPr4("settingsUi.previous")}
                  </Button>
                  <span>
                    {tPr4("socialUi.page", {
                      page: Math.floor(data.offset / data.limit) + 1,
                      total: Math.ceil(data.total / data.limit)
                    })}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={loading || data.offset + data.limit >= data.total}
                    onClick={() =>
                      void load({
                        offset: data.offset + data.limit,
                        query: data.query,
                        friendsOnly: data.friendsOnly
                      })
                    }
                  >
                    {tPr4("packs.next")}
                  </Button>
                </nav>
              )}
            </>
          )}
        </section>

        <aside className="yk-ranking-side-column">
          {!loading && data && (
            <RankingGoal
              kind="collection"
              userId={userId}
              mine={data.mine}
              entries={data.entries}
            />
          )}
          <section
            className="yk-leaderboard-rules"
            aria-labelledby="score-title"
          >
            <div className="yk-leaderboard-section-heading">
              <Subheading id="score-title">
                {tPr4("socialUi.howScoringWorks")}
              </Subheading>
            </div>
            <p>{tPr4("socialUi.pointsForTheFirstCopyOfEach")}</p>
            <dl className="yk-leaderboard-values">
              {COLLECTION_SCORE_RULES.map(rule => (
                <div key={rule.label} data-kind={rule.kind}>
                  <dt className="yk-leaderboard-rarity-label">
                    <LeaderboardRarityBadge rarity={rule.label.split(" ")[0]} />
                    {(rule.kind === "infinity" || rule.kind === "shiny") && (
                      <>
                        <LeaderboardStatIcon kind={rule.kind} />
                        <span>
                          {rule.kind === "infinity" ? "Infinity" : "Shiny"}
                        </span>
                      </>
                    )}
                  </dt>
                  <dd>{number(rule.points)}</dd>
                </div>
              ))}
            </dl>
            <details open>
              <summary>{tPr4("socialUi.duplicatesEvolution")}</summary>
              <p>{tPr4("socialUi.sRSSRAndLRTotalsIncludeEvery")}</p>
              <p>{tPr4("socialUi.firstCopy100Copies2520")}</p>
              <p>{tPr4("socialUi.infinityValuesReflectTheFusionCostPlus")}</p>
              <p>{tPr4("socialUi.forExampleFiveCopiesOfTheSame")}</p>
            </details>
            <details>
              <summary>{tPr4("socialUi.fairPlayPrivacy")}</summary>
              <p>{tPr4("socialUi.onlyCardsCurrentlyOwnedCountTradesAnd")}</p>
              <p>{tPr4("socialUi.noBonusesForKarasAccountAgeCustom")}</p>
              <p>{tPr4("socialUi.evolvingIntoAVariantYouAlreadyOwn")}</p>
            </details>
            {mine && (
              <details>
                <summary>{tPr4("socialUi.yourScoreBreakdown")}</summary>
                {mine.breakdown.length ? (
                  <dl className="yk-leaderboard-values">
                    {mine.breakdown.map(row => (
                      <div key={`${row.rarity}-${row.variant}`}>
                        <dt>
                          {row.rarity}
                          {row.variant === "standard"
                            ? ""
                            : row.variant === "infinity"
                              ? " Infinity"
                              : " Shiny"}
                          <small>
                            {tPr4("socialUi.variants", {
                              count: row.uniqueVariants
                            })}{" "}
                            · {tPr4("socialUi.copies", { count: row.copies })} ·{" "}
                            {tPr4("socialUi.duplicatePoints", {
                              count: row.duplicatePoints
                            })}
                          </small>
                        </dt>
                        <dd>{number(row.points)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p>{tPr4("socialUi.yourScoreBreakdownWillAppearAfterYou")}</p>
                )}
              </details>
            )}
          </section>
        </aside>
      </div>
      {playerPreview.preview}
    </Root>
  );
}
