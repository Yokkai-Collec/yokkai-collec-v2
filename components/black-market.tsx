"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";
import type { AuctionDetail } from "@/lib/data/market";
import type { AvatarFrame } from "@/lib/ui/profile-style";
import {
  EventBannerArrow,
  EventBannerClockIcon,
  EventBannerCountdown
} from "@/components/event-banner";
import { YokaiCard, type YokaiCardProps } from "@/components/yokai-card";
import "@/styles/black-market.css";

export type BlackMarketEvent = {
  auctions: AuctionDetail[];
  upcomingCards?: AuctionDetail["card"][];
  startsAt?: string | null;
  endsAt?: string | null;
};
export type BlackMarketActivity = {
  reminderCardIds: string[];
  lastEdition: {
    openingDay: string;
    endsAt: string;
    settling: boolean;
    lots: {
      id: string;
      card: AuctionDetail["card"];
      amount: number;
      sold: boolean;
      bidStatus: "won" | null;
      winnerName?: string | null;
      winnerAvatarUrl?: string | null;
      winnerAvatarFrame?: AvatarFrame | null;
    }[];
  } | null;
};
const BlackMarketListings = dynamic(
  () => import("@/components/black-market-listings")
);
const blackMarketShowcaseCards: YokaiCardProps[] = [
  {
    name: "Levi",
    anime: "Attack on Titan",
    image: "/assets/landing/levi.webp",
    category: "ANIME/MANGA",
    rarity: "LR"
  },
  {
    name: "Satoru Gojo",
    anime: "Jujutsu Kaisen",
    image: "/assets/landing/gojou.webp",
    category: "ANIME/MANGA",
    rarity: "LR"
  },
  {
    name: "Monkey D. Luffy",
    anime: "One Piece",
    image: "/assets/landing/luffy.webp",
    category: "ANIME/MANGA",
    rarity: "LR"
  }
];

export function useBlackMarketEvent(enabled = true, includeActivity = false) {
  const [event, setEvent] = useState<BlackMarketEvent | null>();
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState<number>();
  const [activity, setActivity] = useState<BlackMarketActivity>();
  const [activityFailed, setActivityFailed] = useState(false);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let requestId = 0;
    let boundaryTimer: number | undefined;
    const refresh = async () => {
      if (document.hidden) return;
      const id = ++requestId;
      try {
        const db = createClient();
        const [{ data, error }, playerActivity] = await Promise.all([
          db.rpc("get_black_market_event"),
          includeActivity ? db.rpc("get_black_market_activity") : null
        ]);
        if (!active || id !== requestId) return;
        if (playerActivity) {
          setActivityFailed(!!playerActivity.error);
          if (!playerActivity.error) {
            setActivity(playerActivity.data as BlackMarketActivity);
          }
        }
        if (error) {
          setFailed(true);
          return;
        }
        const loaded = data as BlackMarketEvent | null;
        const fetchedAt = Date.now();
        setEvent(loaded);
        setFailed(false);
        setNow(fetchedAt);
        window.clearTimeout(boundaryTimer);
        const nextBoundary = [
          loaded?.startsAt,
          loaded?.endsAt,
          ...(loaded?.auctions.map(auction => auction.endsAt) ?? [])
        ]
          .map(value => Date.parse(value ?? ""))
          .filter(value => value > fetchedAt)
          .reduce((earliest, value) => Math.min(earliest, value), Infinity);
        if (nextBoundary - fetchedAt < 15000) {
          boundaryTimer = window.setTimeout(
            () => void refresh(),
            nextBoundary - fetchedAt + 200
          );
        }
      } catch {
        if (active && id === requestId) {
          setFailed(true);
          if (includeActivity) setActivityFailed(true);
        }
      }
    };
    refreshRef.current = refresh;
    void refresh();
    const poll = window.setInterval(() => void refresh(), 15000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      refreshRef.current = null;
      window.clearInterval(poll);
      window.clearInterval(tick);
      window.clearTimeout(boundaryTimer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, includeActivity]);
  return {
    event,
    failed,
    now,
    activity,
    activityFailed,
    refresh: () => refreshRef.current?.()
  };
}

export function BlackMarketHubCard({
  event,
  now
}: {
  event: BlackMarketEvent | null;
  now?: number;
}) {
  const t = useTranslations("blackMarket");
  const te = useTranslations("events");
  const upcoming = !!event?.startsAt && (now ?? 0) < Date.parse(event.startsAt);
  const deadline = upcoming
    ? event.startsAt
    : (event?.endsAt ?? event?.auctions[0]?.endsAt);
  const closed = !deadline || (now ?? 0) >= Date.parse(deadline);
  const status = upcoming ? "upcoming" : closed ? "closed" : "live";
  return (
    <li className="yk-black-market-event-row" data-event="black-market">
      <Link href="/black-market" className="yk-black-market-event-link">
        <div className="yk-black-market-event-body">
          <div className="yk-black-market-event-cards" aria-hidden="true">
            {blackMarketShowcaseCards.map(card => (
              <YokaiCard key={card.name} {...card} />
            ))}
          </div>
          <div className="yk-black-market-event-title">
            <h3>{t("title")}</h3>
            <p>{t("tagline")}</p>
          </div>
        </div>
        <div className="yk-event-banner-footer">
          <span className="yk-event-status" data-status={status}>
            {status === "closed" ? t("closed") : te(status)}
          </span>
          <span className="yk-event-banner-separator" aria-hidden="true" />
          <span className="yk-event-banner-time">
            <EventBannerClockIcon />
            {deadline && !closed ? (
              <>
                <span className="sr-only">
                  {t(upcoming ? "opensIn" : "endsIn")}
                </span>
                <EventBannerCountdown end={deadline} now={now} />
              </>
            ) : (
              t("noDate")
            )}
          </span>
          <EventBannerArrow />
        </div>
      </Link>
    </li>
  );
}

export function BlackMarketPanel({
  preview,
  previewNow,
  viewerId
}: {
  preview?: BlackMarketEvent;
  previewNow?: number;
  viewerId?: string;
}) {
  const t = useTranslations("blackMarket");
  const live = useBlackMarketEvent(!preview, true);
  const event = preview ?? live.event;
  const now = live.now ?? previewNow;
  const startsAt = event?.startsAt ?? undefined;
  const endsAt = event?.endsAt ?? undefined;
  const upcoming = !!startsAt && (now ?? 0) < Date.parse(startsAt);
  const closed = !!endsAt && now != null && now >= Date.parse(endsAt);
  const open = !upcoming && !closed && !!(startsAt || event?.auctions.length);
  return (
    <BlackMarketListings
      auctions={open ? event?.auctions : undefined}
      upcomingCards={upcoming ? event?.upcomingCards : undefined}
      open={open}
      now={now}
      viewerId={viewerId}
      activity={live.activity}
      activityFailed={live.activityFailed}
      onReminderChange={
        !preview
          ? async (cardId, enabled) => {
              const { error } = await createClient().rpc(
                "set_black_market_reminder",
                {
                  p_card_id: cardId,
                  p_enabled: enabled
                }
              );
              if (error) throw error;
              await live.refresh();
            }
          : undefined
      }
      deadline={upcoming ? startsAt : closed ? undefined : endsAt}
      upcoming={upcoming}
      notice={
        live.failed && !preview
          ? t("unavailable")
          : event === undefined
            ? t("loading")
            : !upcoming && !open
              ? t("noEdition")
              : undefined
      }
    />
  );
}
