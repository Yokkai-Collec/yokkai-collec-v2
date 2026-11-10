"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useFormatter, useTranslations } from "next-intl";
import { YokaiCard } from "@/components/yokai-card";
import type { CatalogueCardAdapter } from "@/components/community-views";
import type { Card } from "@/lib/data/cards";
import type { ProfileDetails } from "@/lib/data/profile";
import { showcaseScrollRef } from "@/lib/ui/profile-style";

const CardDetails = dynamic(() =>
  import("@/components/community-views").then(
    module => module.CatalogueCardModal
  )
);

export function ProfileRecentCards({
  activity,
  allowed,
  failed,
  adapter
}: {
  activity?: ProfileDetails["activity"];
  allowed: boolean;
  failed: boolean;
  adapter?: CatalogueCardAdapter;
}) {
  const t = useTranslations("profileUi");
  const cardText = useTranslations("collectionUi");
  const format = useFormatter();
  const rail = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<Card | null>(null);
  const cards = useMemo(
    () =>
      allowed
        ? (activity ?? [])
            .filter(item => item.kind === "obtained" || item.kind === "bought")
            .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
            .slice(0, 12)
            .map(item => ({
              ...item,
              acquisitionSource:
                item.kind === "bought"
                  ? ("auction" as const)
                  : item.acquisitionSource
            }))
        : [],
    [activity, allowed]
  );
  const scroll = (direction: number) => {
    const element = rail.current;
    element?.scrollBy({
      left: direction * element.clientWidth * 0.75,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth"
    });
  };
  return (
    <div
      className="yk-profile-recent-content"
      aria-labelledby="profile-recent-title"
    >
      <div className="yk-profile-recent-heading">
        <div>
          <h2 id="profile-recent-title">{t("recentCardsTitle")}</h2>
          <p>{t("recentCardsSubtitle")}</p>
        </div>
        {cards.length > 1 && (
          <div className="yk-profile-recent-controls">
            <button
              type="button"
              aria-label={t("recentCardsPrevious")}
              onClick={() => scroll(-1)}
            >
              ←
            </button>
            <button
              type="button"
              aria-label={t("recentCardsNext")}
              onClick={() => scroll(1)}
            >
              →
            </button>
          </div>
        )}
      </div>
      {cards.length ? (
        <div
          className="yk-profile-recent-rail"
          ref={element => {
            rail.current = element;
            return showcaseScrollRef(element);
          }}
        >
          {cards.map(item => (
            <div className="yk-profile-recent-item" key={item.id}>
              <button
                type="button"
                className="yk-profile-recent-card"
                aria-label={cardText("viewCard", { name: item.card.name })}
                aria-haspopup="dialog"
                onClick={() => setSelected(item.card)}
              >
                <YokaiCard
                  {...item.card}
                  imageSizes="(max-width: 640px) 140px, 180px"
                />
              </button>
              <div className="yk-profile-recent-caption">
                <span
                  className="yk-profile-recent-source"
                  data-source={item.acquisitionSource ?? "unknown"}
                  title={t(
                    item.acquisitionSource === "auction"
                      ? "recentSourceAuction"
                      : item.acquisitionSource === "trade"
                        ? "recentSourceTrade"
                        : item.acquisitionSource === "pack"
                          ? "recentSourcePack"
                          : "recentSourceUnknown"
                  )}
                  role="img"
                  aria-label={t(
                    item.acquisitionSource === "auction"
                      ? "recentSourceAuction"
                      : item.acquisitionSource === "trade"
                        ? "recentSourceTrade"
                        : item.acquisitionSource === "pack"
                          ? "recentSourcePack"
                          : "recentSourceUnknown"
                  )}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {item.acquisitionSource === "auction" ? (
                      <path d="m14 3 7 7-4 4-7-7 4-4ZM12 9l-8 8a2.12 2.12 0 0 0 3 3l8-8M14 20h7M13 23h9" />
                    ) : item.acquisitionSource === "trade" ? (
                      <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />
                    ) : item.acquisitionSource === "pack" ? (
                      <>
                        <path d="M6 3h12v18H6zM6 7h12M6 17h12" />
                        <path d="m12 9 1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
                      </>
                    ) : (
                      <>
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 11v6M12 7h.01" />
                      </>
                    )}
                  </svg>
                </span>
                <time dateTime={item.at}>
                  {format.dateTime(new Date(item.at), {
                    day: "numeric",
                    month: "short"
                  })}
                </time>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="yk-profile-recent-empty" role="status">
          {t(
            !allowed
              ? "recentCardsPrivate"
              : failed
                ? "recentCardsFailed"
                : !activity
                  ? "recentCardsLoading"
                  : "recentCardsEmpty"
          )}
        </p>
      )}
      {selected && (
        <CardDetails
          selected={selected}
          adapter={adapter}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
