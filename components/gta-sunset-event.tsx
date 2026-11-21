"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui";
import { useFormatter, useTranslations } from "next-intl";
import {
  EventBannerArrow,
  EventBannerClockIcon,
  EventBannerCountdown,
  EventBannerFrame
} from "@/components/event-banner";
import { YokaiCard } from "@/components/yokai-card";
import type { Card, CollectedCard } from "@/lib/data/cards";
import { SUNSET_BOOSTER_IMAGE } from "@/lib/ui/booster-opening-document";
import { createClient } from "@/utils/supabase/client";
import "@/styles/gta-sunset.css";

type SunsetStatus = "upcoming" | "live" | "ended";

type SunsetEvent = {
  serverNow: number;
  startsAt: string;
  endsAt: string;
  nextResetAt: string;
  lrRatePerCard?: number;
  featured: Card[];
  availableDays: string[];
  unlimited?: boolean;
  openedCards: CollectedCard[] | null;
};

function canEarnAnotherPack(event: SunsetEvent, status: SunsetStatus) {
  return (
    !event.unlimited &&
    status === "live" &&
    Date.parse(event.nextResetAt) < Date.parse(event.endsAt)
  );
}

export function useGtaSunsetEvent(enabled = true) {
  const [event, setEvent] = useState<SunsetEvent | null>(null);
  const [offset, setOffset] = useState(0);
  const [clock, setClock] = useState(0);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let request = 0;
    const load = async () => {
      const current = ++request;
      const { data, error } = await createClient().rpc("get_gta_sunset_event");
      if (!active || current !== request || error) return;
      const snapshot = data as SunsetEvent | null;
      const now = Date.now();
      setClock(now);
      setOffset(snapshot ? snapshot.serverNow - now : 0);
      setEvent(snapshot);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, refresh]);

  const nextReset = event?.nextResetAt;
  const endsAt = event?.endsAt;
  useEffect(() => {
    if (!nextReset || !endsAt || Date.parse(endsAt) <= Date.now() + offset)
      return;
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    const nextBoundary = Date.parse(nextReset) - Date.now() - offset;
    const reset = window.setTimeout(
      () => setRefresh(value => value + 1),
      Math.max(1000, nextBoundary + 250)
    );
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(reset);
    };
  }, [endsAt, nextReset, offset]);

  const now = clock + offset;
  const status: SunsetStatus | undefined = event
    ? now < Date.parse(event.startsAt)
      ? "upcoming"
      : now < Date.parse(event.endsAt)
        ? "live"
        : "ended"
    : undefined;
  return {
    event,
    now,
    status,
    recordOpening(packDay: string, cards: CollectedCard[]) {
      setEvent(current =>
        current
          ? {
              ...current,
              availableDays: current.availableDays.filter(
                day => day !== packDay
              ),
              openedCards: cards
            }
          : current
      );
      setRefresh(value => value + 1);
    },
    reload() {
      setRefresh(value => value + 1);
    }
  };
}

export function GtaSunsetHomeBanner() {
  const t = useTranslations("gtaSunset");
  const { event, now, status } = useGtaSunsetEvent();

  if (!event || !status) return null;

  const hasPacks = event.availableDays.length > 0;
  if (status === "ended" && !hasPacks) return null;

  const nextPack = canEarnAnotherPack(event, status);
  const upcoming = status === "upcoming";
  const deadline = upcoming
    ? event.startsAt
    : nextPack
      ? event.nextResetAt
      : event.endsAt;

  return (
    <Link className="yk-home-sunset-banner" href="/boosters#gta-sunset">
      <Image
        className="yk-home-sunset-pack"
        src={SUNSET_BOOSTER_IMAGE}
        width={36}
        height={64}
        alt=""
      />
      <span className="yk-home-sunset-copy">
        <strong>{t("title")}</strong>
        <span>
          {status === "ended"
            ? event.unlimited
              ? t("unlimitedPacks")
              : t("availablePacks", { count: event.availableDays.length })
            : t("homeDescription")}
        </span>
      </span>
      <SunsetFeaturedCards
        cards={event.featured}
        className="yk-home-sunset-cards"
      />
      {hasPacks ? (
        <span className="yk-home-sunset-action">
          {t(status === "ended" ? "homeOpenRemaining" : "homeOpen")}
        </span>
      ) : (
        <span className="yk-home-sunset-time">
          <EventBannerClockIcon />
          {t(
            upcoming ? "startsIn" : nextPack ? "homeNextBooster" : "endsIn"
          )}{" "}
          <EventBannerCountdown end={deadline} now={now} />
        </span>
      )}
      <EventBannerArrow />
    </Link>
  );
}

function SunsetFeaturedCards({
  cards,
  className
}: {
  cards: Card[];
  className: string;
}) {
  return (
    <div className={`yk-sunset-featured-cards ${className}`} aria-hidden="true">
      {cards.map(card => (
        <div key={card.id}>
          <YokaiCard {...card} animated={false} />
        </div>
      ))}
    </div>
  );
}

export function GtaSunsetHubCard({
  event,
  now,
  status
}: {
  event: SunsetEvent;
  now: number;
  status: SunsetStatus;
}) {
  const t = useTranslations("gtaSunset");
  const te = useTranslations("events");

  return (
    <li className="yk-event-card" data-event="gta-sunset">
      <EventBannerFrame href="/boosters#gta-sunset" label={t("viewBooster")}>
        <div className="yk-event-banner-content">
          <span className="yk-event-frequency">{t("limitedEdition")}</span>
          <h3>{t("title")}</h3>
          <p className="yk-event-description">{t("hubDescription")}</p>
        </div>
        <SunsetFeaturedCards
          cards={event.featured}
          className="yk-sunset-hub-art"
        />
        <div className="yk-event-banner-footer">
          <span className="yk-event-status" data-status={status}>
            {status === "ended" ? t("endedBadge") : te(status)}
          </span>
          {status !== "ended" && (
            <span className="yk-event-banner-time">
              <EventBannerClockIcon />
              <EventBannerCountdown
                end={status === "live" ? event.endsAt : event.startsAt}
                now={now}
              />
            </span>
          )}
          <EventBannerArrow />
        </div>
      </EventBannerFrame>
    </li>
  );
}

export function GtaSunsetBooster({
  snapshot,
  busy,
  onOpen
}: {
  snapshot: ReturnType<typeof useGtaSunsetEvent>;
  busy: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const t = useTranslations("gtaSunset");
  const format = useFormatter();
  const { event, now, status } = snapshot;

  if (!event || !status) return null;
  const { availableDays, unlimited } = event;
  const nextPackDay = availableDays[0];
  const canEarnMore = canEarnAnotherPack(event, status);
  const deadline =
    status === "upcoming"
      ? event.startsAt
      : canEarnMore
        ? event.nextResetAt
        : undefined;

  return (
    <article
      className="yk-pack-panel yk-sunset-pack-panel"
      aria-labelledby="gta-sunset-title"
      data-unavailable={!nextPackDay}
    >
      <div className="yk-pack-art-stage">
        <span className="yk-pack-aura" aria-hidden="true" />
        <span className="yk-pack-floor" aria-hidden="true" />
        <Image
          className="yk-pack-image"
          src={SUNSET_BOOSTER_IMAGE}
          width={941}
          height={1671}
          sizes="(max-width: 700px) 55vw, 340px"
          alt=""
        />
        <details
          className="yk-pack-info-trigger yk-sunset-pack-info"
          onKeyDown={event => {
            if (event.key !== "Escape" || !event.currentTarget.open) return;
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }}
        >
          <summary className="yk-pack-info" aria-label={t("viewRates")}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v6M12 7h.01" />
            </svg>
          </summary>
          <div className="yk-pack-info-popover">
            <p>{t("cardsPerPack")}</p>
            <dl className="yk-drop-rates">
              {event.featured.map(card => (
                <div key={card.id}>
                  <dt>
                    {card.name} · {card.rarity}
                  </dt>
                  <dd>
                    {format.number(event.lrRatePerCard ?? 0.05, {
                      style: "percent",
                      maximumFractionDigits: 1
                    })}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </details>
      </div>
      <div className="yk-pack-body">
        <h2 id="gta-sunset-title">{t("boosterTitle")}</h2>
        <div className="yk-pack-status">
          <p>{t("packSummary")}</p>
          <p className="yk-pack-reserve yk-sunset-pack-reserve" role="status">
            {unlimited
              ? t("unlimitedPacks")
              : t("availablePacks", { count: availableDays.length })}
          </p>
        </div>
        <Button
          className="w-full"
          disabled={!nextPackDay || busy}
          onClick={event => onOpen(event.currentTarget)}
        >
          {!nextPackDay && deadline ? (
            <>
              {t(status === "upcoming" ? "startsIn" : "nextBooster")}{" "}
              <EventBannerCountdown end={deadline} now={now} />
            </>
          ) : (
            t(busy ? "opening" : "open")
          )}
        </Button>
      </div>
    </article>
  );
}
