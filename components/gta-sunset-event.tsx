"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui";
import { BlackoutPreviewReserve } from "@/components/blackout-preview-shop";
import { useFormatter, useTranslations } from "next-intl";
import {
  EventBannerArrow,
  EventBannerClockIcon,
  EventBannerCountdown,
  EventBannerFrame
} from "@/components/event-banner";
import { YokaiCard } from "@/components/yokai-card";
import {
  BLACKOUT_EVENT_PATH,
  BLACKOUT_SLUG,
  blackFridayTerms,
  blackoutCards,
  blackoutPreviewEnabled
} from "@/lib/data/blackout-preview";
import type { Card, CollectedCard } from "@/lib/data/cards";
import {
  BLACKOUT_BOOSTER_IMAGE,
  SUNSET_BOOSTER_IMAGE
} from "@/lib/ui/booster-opening-document";
import { createClient } from "@/utils/supabase/client";
import "@/styles/gta-sunset.css";

export { BLACKOUT_SLUG, blackoutPreviewEnabled };

type EventEdition = "sunset" | "blackout";

function eventAppearance(edition: EventEdition) {
  return edition === "blackout"
    ? {
        slug: BLACKOUT_SLUG,
        image: BLACKOUT_BOOSTER_IMAGE,
        messages: "blackout" as const
      }
    : {
        slug: "gta-sunset",
        image: SUNSET_BOOSTER_IMAGE,
        messages: "gtaSunset" as const
      };
}

type SunsetStatus = "upcoming" | "live" | "ended";

type SunsetEvent = {
  serverNow: number;
  startsAt: string;
  endsAt: string;
  packsExpireAt?: string;
  nextResetAt: string | null;
  lrRatePerCard?: number;
  featured: Card[];
  availableDays: string[];
  unlimited?: boolean;
  openedCards: CollectedCard[] | null;
};

function nextSunsetCredit(event: SunsetEvent, status: SunsetStatus) {
  const next = event.nextResetAt;
  return !event.unlimited &&
    status === "live" &&
    next &&
    Date.parse(next) <= Date.parse(event.endsAt)
    ? next
    : null;
}

export function useGtaSunsetEvent(
  enabled = true,
  edition: EventEdition = "sunset"
) {
  const [event, setEvent] = useState<SunsetEvent | null>(() => {
    if (edition !== "blackout" || !enabled || !blackoutPreviewEnabled)
      return null;
    const now = Date.now();
    return {
      serverNow: now,
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 86_400_000).toISOString(),
      nextResetAt: null,
      availableDays: ["preview"],
      featured: blackoutCards,
      openedCards: null,
      unlimited: true
    };
  });
  const [offset, setOffset] = useState(0);
  const [clock, setClock] = useState(() => event?.serverNow ?? 0);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!enabled || edition === "blackout") return;
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
  }, [edition, enabled, refresh]);

  const nextBoundary = event
    ? [event.startsAt, event.endsAt, event.nextResetAt, event.packsExpireAt]
        .map(value => Date.parse(value ?? ""))
        .filter(deadline => deadline > event.serverNow)
        .reduce((earliest, deadline) => Math.min(earliest, deadline), Infinity)
    : Infinity;
  useEffect(() => {
    if (edition === "blackout" || !Number.isFinite(nextBoundary)) return;
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    const reset = window.setTimeout(
      () => {
        setClock(Date.now());
        setRefresh(value => value + 1);
      },
      Math.max(250, nextBoundary - Date.now() - offset + 250)
    );
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(reset);
    };
  }, [edition, nextBoundary, offset]);

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
    packsExpired: now >= Date.parse(event?.packsExpireAt ?? ""),
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

export function GtaSunsetHomeBanner({
  edition = "sunset"
}: { edition?: EventEdition } = {}) {
  const appearance = eventAppearance(edition);
  const t = useTranslations(appearance.messages);
  const { event, now, status, packsExpired } = useGtaSunsetEvent(true, edition);

  if (!event || !status || packsExpired) return null;

  const hasPacks = event.availableDays.length > 0;
  if (status === "ended" && !hasPacks) return null;

  const nextPack = nextSunsetCredit(event, status);
  const upcoming = status === "upcoming";
  const deadline = upcoming ? event.startsAt : (nextPack ?? event.endsAt);

  return (
    <Link
      className="yk-home-sunset-banner"
      data-pack-theme={edition}
      href={`/boosters#${appearance.slug}`}
    >
      <Image
        className="yk-home-sunset-pack"
        src={appearance.image}
        width={36}
        height={64}
        alt=""
      />
      <span className="yk-home-sunset-copy">
        <strong>{t("title")}</strong>
        <span>
          {status === "ended" && edition === "sunset"
            ? event.unlimited
              ? t("unlimitedPacks")
              : t("availablePacks", { count: event.availableDays.length })
            : t("homeDescription", { count: event.featured.length })}
        </span>
      </span>
      <SunsetFeaturedCards
        cards={event.featured.slice(0, 2)}
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
  status,
  edition = "sunset"
}: {
  edition?: EventEdition;
  event: SunsetEvent;
  now: number;
  status: SunsetStatus;
}) {
  const appearance = eventAppearance(edition);
  const t = useTranslations(appearance.messages);
  const te = useTranslations("events");

  return (
    <li className="yk-event-card" data-event={appearance.slug}>
      <EventBannerFrame
        href={
          edition === "blackout"
            ? BLACKOUT_EVENT_PATH
            : `/boosters#${appearance.slug}`
        }
        label={t(edition === "blackout" ? "viewEvent" : "viewBooster")}
      >
        <div className="yk-event-banner-content">
          <span className="yk-event-frequency">{t("limitedEdition")}</span>
          <h3>{t("title")}</h3>
          <p className="yk-event-description">
            {t("hubDescription", { count: event.featured.length })}
          </p>
        </div>
        <SunsetFeaturedCards
          cards={event.featured.slice(0, 2)}
          className="yk-sunset-hub-art"
        />
        <div className="yk-event-banner-footer">
          <span
            className="yk-event-status"
            data-status={edition === "blackout" ? undefined : status}
          >
            {edition === "blackout"
              ? t("preview")
              : status === "ended"
                ? t("endedBadge")
                : te(status)}
          </span>
          {edition === "sunset" && status !== "ended" && (
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
  onOpen,
  onRatesOpen,
  edition = "sunset"
}: {
  edition?: EventEdition;
  snapshot: ReturnType<typeof useGtaSunsetEvent>;
  busy: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
  onRatesOpen?: () => void;
}) {
  const appearance = eventAppearance(edition);
  const t = useTranslations(appearance.messages);
  const format = useFormatter();
  const { event, now, status } = snapshot;

  if (!event || !status) return null;
  const { availableDays, unlimited } = event;
  const nextPackDay = availableDays[0];
  const nextCredit = nextSunsetCredit(event, status);
  const deadline = status === "upcoming" ? event.startsAt : nextCredit;
  const isBlackout = edition === "blackout";
  const lrRatePerCard = isBlackout
    ? blackFridayTerms.lrRatePerPack / event.featured.length
    : (event.lrRatePerCard ?? 0.05);

  const rates = (
    <details
      className={
        isBlackout
          ? "yk-pack-info-trigger yk-sunset-pack-info yk-blackout-pack-info"
          : "yk-pack-info-trigger yk-sunset-pack-info"
      }
      onKeyDown={event => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
      onToggle={event => {
        if (!event.currentTarget.open) return;
        onRatesOpen?.();
        if (isBlackout)
          event.currentTarget
            .querySelector(".yk-pack-info-popover")
            ?.scrollIntoView({ block: "nearest" });
      }}
    >
      <summary className="yk-pack-info" aria-label={t("viewRates")}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7h.01" />
        </svg>
      </summary>
      <div className="yk-pack-info-popover">
        {isBlackout ? (
          <>
            <dl className="yk-pack-rate-summary">
              <div>
                <dt>{t("lrChancePerPack")}</dt>
                <dd>
                  {format.number(blackFridayTerms.lrRatePerPack, {
                    style: "percent",
                    maximumFractionDigits: 2
                  })}
                </dd>
              </div>
              <div>
                <dt>{t("lrChanceForOneCard")}</dt>
                <dd>
                  {format.number(lrRatePerCard, {
                    style: "percent",
                    maximumFractionDigits: 3
                  })}
                </dd>
              </div>
            </dl>
            <ul
              className="yk-blackout-rate-cards"
              role="list"
              aria-label={t("roster")}
            >
              {event.featured.map(card => (
                <li key={card.id}>{card.name.replace(/ \(Blackout\)$/, "")}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p>{t("cardsPerPack")}</p>
            <dl className="yk-drop-rates">
              {event.featured.map(card => (
                <div key={card.id}>
                  <dt>
                    {card.name} · {card.rarity}
                  </dt>
                  <dd>
                    {format.number(lrRatePerCard, {
                      style: "percent",
                      maximumFractionDigits: 2
                    })}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </details>
  );

  return (
    <article
      className="yk-pack-panel yk-sunset-pack-panel"
      aria-labelledby={`${appearance.slug}-title`}
      data-pack-theme={edition}
      data-unavailable={!nextPackDay}
    >
      <div className="yk-pack-art-stage">
        <span className="yk-pack-aura" aria-hidden="true" />
        <span className="yk-pack-floor" aria-hidden="true" />
        <Image
          className="yk-pack-image"
          src={appearance.image}
          width={941}
          height={1671}
          sizes="(max-width: 700px) 55vw, 340px"
          alt=""
        />
        {!isBlackout && rates}
      </div>
      {isBlackout && rates}
      <div className="yk-pack-body">
        <h2 id={`${appearance.slug}-title`}>{t("boosterTitle")}</h2>
        <div className="yk-pack-status">
          <p>{t("packSummary")}</p>
          {edition === "blackout" ? (
            <BlackoutPreviewReserve />
          ) : (
            <p className="yk-pack-reserve yk-sunset-pack-reserve" role="status">
              {unlimited
                ? t("unlimitedPacks")
                : t("availablePacks", { count: availableDays.length })}
            </p>
          )}
          {status === "ended" && nextPackDay && event.packsExpireAt && (
            <p>
              {t("expiresIn")}{" "}
              <EventBannerCountdown end={event.packsExpireAt} now={now} />
            </p>
          )}
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
