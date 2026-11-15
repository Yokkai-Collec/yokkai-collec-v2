"use client";
import { useTranslations, useFormatter } from "next-intl";

import { socialErrorKey as gameErrorKey } from "@/i18n/social-messages";
import Link from "next/link";
import { RankingTrend } from "@/components/ranking-progress";
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
import { getReferralLeaderboard } from "@/lib/leaderboard/client";
import type { ReferralLeaderboard } from "@/lib/leaderboard/shared";

type Request = { offset: number; query: string; friendsOnly: boolean };

export function ReferralLeaderboardView({
  userId,
  embedded = false,
  navigation
}: {
  userId: string;
  embedded?: boolean;
  navigation?: ReactNode;
}) {
  const tPr4 = useTranslations();
  const fmt = useFormatter();
  const number = fmt.number;
  const [data, setData] = useState<ReferralLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [friendsOnly, setFriendsOnly] = useState(embedded);
  const request = useRef(0);
  const lastRequest = useRef<Request>({
    offset: 0,
    query: "",
    friendsOnly: embedded
  });
  const load = useCallback(async (options: Request) => {
    const current = ++request.current;
    lastRequest.current = options;
    setLoading(true);
    setError("");
    try {
      let next = await getReferralLeaderboard(
        options.offset,
        options.query,
        options.friendsOnly
      );
      if (
        options.offset > 0 &&
        !next.entries.length &&
        current === request.current
      ) {
        lastRequest.current = { ...options, offset: 0 };
        next = await getReferralLeaderboard(
          0,
          options.query,
          options.friendsOnly
        );
      }
      if (current === request.current) setData(next);
    } catch (reason) {
      if (current === request.current)
        setError(gameErrorKey(reason, "socialUi.referralLeaderboardFailed"));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    const current = ++request.current;
    lastRequest.current = { offset: 0, query: "", friendsOnly: embedded };
    void getReferralLeaderboard(0, "", embedded)
      .then(next => {
        if (active && current === request.current) setData(next);
      })
      .catch(reason => {
        if (active && current === request.current)
          setError(gameErrorKey(reason, "socialUi.referralLeaderboardFailed"));
      })
      .finally(() => {
        if (active && current === request.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, embedded]);
  const Root = embedded ? "section" : "main";
  const Heading = embedded ? "h2" : "h1";
  const Subheading = embedded ? "h3" : "h2";
  const mine = data?.mine;
  return (
    <Root
      id={embedded ? undefined : "main-content"}
      className={`yk-leaderboard${embedded ? " yk-leaderboard-social" : ""}`}
      aria-labelledby="referral-leaderboard-title"
    >
      <header className="yk-leaderboard-heading">
        <div>
          <p className="eyebrow">{tPr4("socialUi.growTheCommunity")}</p>
          <Heading className="yk-title" id="referral-leaderboard-title">
            {tPr4("socialUi.referralLeaderboard")}
          </Heading>
          <p>{tPr4("socialUi.bringFriendsClimbTogether")}</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void load(lastRequest.current)}
          disabled={loading}
        >
          {tPr4("socialUi.refreshRankings")}
        </Button>
      </header>
      {navigation}
      <section
        className="yk-leaderboard-mine yk-community-progress yk-ranking-summary-referrals"
        aria-label={tPr4("socialUi.yourReferralRank")}
      >
        <div className="yk-leaderboard-emblem">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="9" cy="7" r="3" />
            <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3" />
          </svg>
        </div>
        <div className="yk-leaderboard-personal">
          <span className="eyebrow">
            {tPr4("socialUi.yourVerifiedReferrals")}
          </span>
          <strong>
            {mine ? number(mine.verifiedReferrals) : "—"}
            <small>
              {" "}
              {tPr4("socialUi.referralNoun", {
                count: mine?.verifiedReferrals ?? 0
              })}
            </small>
          </strong>
          <div className="yk-personal-rank">
            <p>
              {!mine
                ? error
                  ? tPr4("socialUi.yourReferralRankIsCurrentlyUnavailable")
                  : tPr4("socialUi.loadingYourReferralRank")
                : !mine.isPublic
                  ? tPr4("socialUi.privateProfileYourReferralCountIsVisible")
                  : mine.position
                    ? tPr4("socialUi.referralRank", {
                        position: mine.position,
                        count: data!.rankedPlayers
                      })
                    : tPr4("socialUi.yourFirstVerifiedReferralPutsYouOn")}
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
          <Link href="/settings#referrals">
            {mine && !mine.isPublic
              ? tPr4("socialUi.manageProfilePrivacyReferralLink")
              : tPr4("socialUi.getYourReferralLink")}
          </Link>
        </div>
      </section>
      <div className="yk-leaderboard-layout">
        <section
          className="yk-leaderboard-board"
          aria-labelledby="referrers-title"
          aria-busy={loading}
        >
          <div className="yk-leaderboard-section-heading">
            <Subheading id="referrers-title">
              {friendsOnly
                ? tPr4("socialUi.friendsReferralLeaderboard")
                : tPr4("socialUi.top100Referrers")}
            </Subheading>
            <span>{tPr4("socialUi.verifiedReferrals")}</span>
          </div>
          <p className="yk-leaderboard-note">
            {friendsOnly
              ? tPr4("socialUi.youAndYourFriendsOrderedByGlobal2")
              : tPr4("socialUi.mostVerifiedReferralsFirstEqualCountsShare")}
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
            <label htmlFor="referral-player-search">
              {tPr4("socialUi.findAReferrer")}
            </label>
            <div>
              <input
                id="referral-player-search"
                type="search"
                maxLength={64}
                value={query}
                placeholder={tPr4("socialUi.searchByUsername")}
                aria-describedby="referral-search-help"
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
            <p id="referral-search-help">
              {friendsOnly
                ? tPr4("socialUi.searchYourRankedFriendsByUsername")
                : tPr4("socialUi.searchAllRankedReferrersIncludingOutsideThe")}
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
            <>
              <p className="yk-leaderboard-loading" role="status">
                {tPr4("socialUi.updatingReferralRankings")}
              </p>
              <div className="yk-leaderboard-skeleton" aria-hidden="true">
                {[1, 2, 3, 4, 5].map(i => (
                  <span key={i} />
                ))}
              </div>
            </>
          )}
          {data && !loading && !error && (
            <>
              <p className="yk-leaderboard-results" role="status">
                {tPr4("socialUi.referralResults", {
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
                aria-label={tPr4("socialUi.playersRankedByVerifiedReferrals")}
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
                        <span className="yk-leaderboard-variants">
                          {entry.position <= 3
                            ? tPr4("socialUi.topReferrer")
                            : tPr4("socialUi.communityReferrer")}
                        </span>
                      </span>
                    </Link>
                    <span className="yk-leaderboard-points">
                      <strong>{number(entry.verifiedReferrals)}</strong>
                      <small>
                        {tPr4("socialUi.referralNoun", {
                          count: entry.verifiedReferrals
                        })}
                      </small>
                    </span>
                  </li>
                ))}
              </ol>
              {!data.entries.length && (
                <p className="yk-leaderboard-message">
                  {data.query
                    ? tPr4("socialUi.noRankedReferrersFoundTryAnotherUsername")
                    : data.friendsOnly
                      ? tPr4("socialUi.noRankedFriendsYetInviteFriendsTo")
                      : tPr4("socialUi.noRankedReferrersYetShareYourLink")}
                </p>
              )}
              {data.total > data.limit && (
                <nav
                  aria-label={tPr4("socialUi.leaderboardPages")}
                  className="yk-leaderboard-pagination"
                >
                  <Button
                    variant="secondary"
                    disabled={data.offset === 0}
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
                    disabled={data.offset + data.limit >= data.total}
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
        <aside
          className="yk-leaderboard-rules"
          aria-labelledby="referral-rules-title"
        >
          <div className="yk-leaderboard-section-heading">
            <Subheading id="referral-rules-title">
              {tPr4("socialUi.howReferralRankingWorks")}
            </Subheading>
          </div>
          <p>{tPr4("socialUi.oneVerifiedReferralOneCountTheMore")}</p>
          <details open>
            <summary>{tPr4("socialUi.whatCounts")}</summary>
            <p>{tPr4("socialUi.aFriendMustJoinThroughYourReferral")}</p>
            <p>{tPr4("socialUi.eachFriendCountsOnceDeletedAndBanned")}</p>
            {mine && (
              <p>
                {tPr4("socialUi.countedReferrals", {
                  count: mine.verifiedReferrals
                })}
              </p>
            )}
          </details>
          <details open>
            <summary>{tPr4("socialUi.ranksPrivacy")}</summary>
            <p>{tPr4("socialUi.equalCountsShareARank12")}</p>
            <p>{tPr4("socialUi.onlyPublicActiveReferrersAreRankedPrivate")}</p>
            <p>{tPr4("socialUi.onlyTheTotalIsPublicYourReferral")}</p>
          </details>
        </aside>
      </div>
    </Root>
  );
}
