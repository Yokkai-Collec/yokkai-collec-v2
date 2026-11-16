import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { cookies } from "next/headers";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import { createClient } from "@/utils/supabase/server";
import type { CollectionLeaderboard } from "@/lib/leaderboard/shared";
import "@/styles/home-leaderboard.css";

const number = (value: number) => value.toLocaleString("en-US");

export async function HomeLeaderboard({ userId }: { userId: string }) {
  const t = await getTranslations("homeLeaderboard");
  let ranking: CollectionLeaderboard;
  try {
    const client = createClient(await cookies());
    const { data, error } = await client
      .rpc("get_collection_leaderboard", {
        p_offset: 0,
        p_limit: 6
      })
      .abortSignal(AbortSignal.timeout(12000));
    if (error || !data) throw new Error("LEADERBOARD_UNAVAILABLE");
    ranking = data as CollectionLeaderboard;
  } catch {
    return (
      <p role="status" className="yk-home-empty">
        {t("unavailable")} <Link href="/leaderboard">{t("retry")}</Link>
      </p>
    );
  }

  const mine = ranking.mine;
  return (
    <div className="yk-home-ranking">
      <p className="yk-home-ranking-intro">
        {t("intro", { infinity: "Infinity", shiny: "Shiny" })}
      </p>
      {ranking.entries.length ? (
        <ol className="yk-home-ranking-podium" aria-label={t("podium")}>
          {ranking.entries.slice(0, 3).map((entry, index) => (
            <li
              key={entry.userId}
              data-slot={index + 1}
              data-rank={entry.position <= 3 ? entry.position : undefined}
              className={entry.userId === userId ? "is-you" : undefined}
            >
              <span className="yk-home-ranking-sparks" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map(spark => (
                  <i key={spark} />
                ))}
              </span>
              <span
                className="yk-home-ranking-rank"
                aria-label={t("rank", { position: entry.position })}
              >
                #{number(entry.position)}
              </span>
              <Link
                className="yk-home-ranking-player"
                href={`/profile/${encodeURIComponent(entry.pseudo)}`}
              >
                <span className="yk-home-ranking-avatar">
                  {entry.position === 1 && (
                    <svg
                      className="yk-home-ranking-crown"
                      viewBox="0 0 32 28"
                      aria-hidden="true"
                      fill="none"
                    >
                      <path
                        d="m4 9 6.5 5L16 4l5.5 10L28 9l-3 13H7L4 9Z"
                        fill="currentColor"
                        stroke="#ffe6a7"
                        strokeWidth="1.1"
                        strokeLinejoin="round"
                      />
                      <path d="M7 23h18v3H7z" fill="currentColor" />
                      <circle cx="16" cy="3.5" r="2.2" fill="#ffe6a7" />
                      <circle cx="3.5" cy="8.5" r="1.8" fill="#ffe6a7" />
                      <circle cx="28.5" cy="8.5" r="1.8" fill="#ffe6a7" />
                      <path d="m16 15 2 3-2 3-2-3 2-3Z" fill="#6d501b" />
                    </svg>
                  )}
                  <StyledPlayerAvatar
                    cosmetics={ranking.profileStyles?.[entry.userId]}
                    name={entry.pseudo}
                    image={entry.avatarUrl ?? undefined}
                    size={64}
                  />
                </span>
                <span>
                  <strong>
                    <StyledPlayerName
                      name={entry.pseudo}
                      playerId={entry.userId}
                      cosmetics={ranking.profileStyles?.[entry.userId]}
                    />
                  </strong>
                  {entry.userId === userId && <small>{t("you")}</small>}
                </span>
              </Link>
              <span className="yk-home-ranking-points">
                <strong>{number(entry.score)}</strong>
                <small>{t("points", { count: entry.score })}</small>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="yk-home-empty">{t("empty")}</p>
      )}
      {ranking.entries.length > 3 && (
        <ol
          className="yk-home-ranking-list"
          start={4}
          aria-label={t("moreCollectors")}
        >
          {ranking.entries.slice(3).map(entry => (
            <li
              key={entry.userId}
              className={entry.userId === userId ? "is-you" : undefined}
            >
              <span
                className="yk-home-ranking-rank"
                aria-label={t("rank", { position: entry.position })}
              >
                #{number(entry.position)}
              </span>
              <Link
                className="yk-home-ranking-player"
                href={`/profile/${encodeURIComponent(entry.pseudo)}`}
              >
                <StyledPlayerAvatar
                  cosmetics={ranking.profileStyles?.[entry.userId]}
                  name={entry.pseudo}
                  image={entry.avatarUrl ?? undefined}
                  size={36}
                />
                <span>
                  <strong>
                    <StyledPlayerName
                      name={entry.pseudo}
                      playerId={entry.userId}
                      cosmetics={ranking.profileStyles?.[entry.userId]}
                    />
                  </strong>
                  {entry.userId === userId && <small>{t("you")}</small>}
                </span>
              </Link>
              <span className="yk-home-ranking-points">
                <strong>{number(entry.score)}</strong>
                <small>{t("points", { count: entry.score })}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="yk-home-ranking-mine">
        <span>
          {t("yourCollection")}{" "}
          <strong>
            {number(mine.score)} {t("points", { count: mine.score })}
          </strong>
        </span>
        <span>
          {!mine.isPublic
            ? t("private")
            : mine.position
              ? t("position", {
                  position: number(mine.position),
                  total: number(ranking.rankedPlayers)
                })
              : t("unranked")}
        </span>
      </div>
    </div>
  );
}
