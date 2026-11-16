"use client";
import { formatLicenseName } from "@/lib/ui/license-name";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  getPaniniAlbumsPage,
  type PaniniAlbumProgress
} from "@/lib/data/cards";
import { binderHighlights, binderHref } from "@/lib/ui/binder-discovery";
import type { RankObservation } from "@/lib/leaderboard/progress";
import { personalRankGoal } from "@/lib/leaderboard/progress";

function historyOffset(node: HTMLDetailsElement) {
  const bounds = node.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 64);
  return (
    Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16)) -
    bounds.left
  );
}

export function RankingTrend({
  history,
  compact = false,
  inCard = false,
  initialState
}: {
  history?: RankObservation;
  compact?: boolean;
  inCard?: boolean;
  initialState?: "pending" | "unranked" | "private";
}) {
  const t = useTranslations("rankingProgress"),
    fmt = useFormatter();
  const [offset, setOffset] = useState(0);
  const historyControl = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!inCard) return;
    const reposition = () => {
      if (historyControl.current?.open)
        setOffset(historyOffset(historyControl.current));
    };
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [inCard]);
  if (!history) {
    if (!initialState) return null;
    return (
      <span
        className="yk-ranking-trend"
        data-direction={initialState === "pending" ? "new" : initialState}
      >
        <span aria-hidden="true">·</span>
        {t(
          initialState === "unranked"
            ? "notRanked"
            : initialState === "private"
              ? "privateRank"
              : "initialRank"
        )}
      </span>
    );
  }
  const date = (day: string) =>
    fmt.dateTime(new Date(day + "T12:00:00Z"), {
      day: "numeric",
      month: "short",
      timeZone: "UTC"
    });
  const label =
    history.delta === null
      ? t(initialState ? "initialRank" : "trackingStarts")
      : history.delta === 0
        ? t("unchanged")
        : t(history.delta > 0 ? "up" : "down", {
            count: Math.abs(history.delta)
          });
  const title = history.since
    ? t("since", { date: date(history.since) })
    : t("trackingStarts");
  const direction =
    history.delta === null
      ? "new"
      : history.delta > 0
        ? "up"
        : history.delta < 0
          ? "down"
          : "same";
  const badge = (
    <span className="yk-ranking-trend" data-direction={direction} title={title}>
      <span aria-hidden="true">
        {direction === "up" ? "↑" : direction === "down" ? "↓" : "·"}
      </span>
      {label}
    </span>
  );
  if (inCard) {
    if (history.observations.length < 2) return badge;
    return (
      <details
        className="yk-ranking-personal-trend"
        ref={historyControl}
        onToggle={event => {
          if (event.currentTarget.open)
            setOffset(historyOffset(event.currentTarget));
        }}
        onKeyDown={event => {
          if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
            event.stopPropagation();
          }
        }}
      >
        <summary aria-label={t("historyAction", { change: label })}>
          {badge}
        </summary>
        <div className="yk-ranking-personal-history" style={{ left: offset }}>
          {history.since && <p>{title}</p>}
          <ol>
            {history.observations.map(point => (
              <li key={point.day}>
                <time dateTime={point.day}>{date(point.day)}</time>
                <span>{t("rank", { position: point.position })}</span>
              </li>
            ))}
          </ol>
        </div>
      </details>
    );
  }
  if (compact) return history.delta === null && !initialState ? null : badge;
  return (
    <div className="yk-ranking-history">
      {badge}
      {history.since && <span>{title}</span>}
      {history.observations.length > 1 && (
        <details>
          <summary>{t("history")}</summary>
          <ol>
            {history.observations.map(point => (
              <li key={point.day}>
                <time dateTime={point.day}>{date(point.day)}</time>
                <span>{t("rank", { position: point.position })}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export function RankingGoal({
  kind,
  userId,
  mine,
  entries,
  binder
}: {
  kind: "collection" | "likes" | "licenses";
  userId: string;
  mine?: {
    isPublic: boolean;
    position: number | null;
    value?: number;
    score?: number;
  };
  entries: { userId: string; pseudo: string; value?: number; score?: number }[];
  binder?: { license: string; total: number } | null;
}) {
  const t = useTranslations("rankingProgress");
  const [album, setAlbum] = useState<PaniniAlbumProgress | null>(null);
  useEffect(() => {
    if (kind !== "licenses" || binder) return;
    let active = true;
    void getPaniniAlbumsPage({ page: 1, pageSize: 72 })
      .then(page => {
        if (active)
          setAlbum(
            binderHighlights(
              page.items.filter(a => a.owned < a.total && a.total > 0),
              1
            )[0] ?? null
          );
      })
      .catch(() => {
        if (active) setAlbum(null);
      });
    return () => {
      active = false;
    };
  }, [kind, binder, userId]);
  if (!mine) return null;
  let text: string, href: string | undefined;
  if (kind === "licenses") {
    if (binder)
      text = t(mine.value! >= binder.total ? "completed" : "finishLicense", {
        count: Math.max(0, binder.total - (mine.value ?? 0)),
        license: formatLicenseName(binder.license)
      });
    else if (album) {
      text = t("finishLicense", {
        count: album.total - album.owned,
        license: formatLicenseName(album.license)
      });
      href = binderHref(album);
    } else {
      text = t("pickBinder");
      href = "/collection?view=binders";
    }
  } else {
    const goal = personalRankGoal(kind, userId, mine, entries);
    text =
      goal.type === "leader"
        ? t("leader")
        : goal.type === "firstLike"
          ? t("firstLike")
          : goal.type === "progress"
            ? t("keepGrowing")
            : goal.type === "target"
              ? t(kind === "likes" ? "likesTarget" : "pointsTarget", {
                  count: goal.count,
                  player: goal.pseudo
                })
              : t("startCollection");
  }
  return (
    <div className="yk-ranking-goal">
      <span className="yk-ranking-goal-icon" aria-hidden="true">
        ◎
      </span>
      <div>
        <strong>{t("goal")}</strong>
        <p>{text}</p>
        {href && (
          <Link href={href}>
            {t("openBinders")} <span aria-hidden="true">↗</span>
          </Link>
        )}
      </div>
    </div>
  );
}
