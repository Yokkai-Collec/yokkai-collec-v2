"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMysteryAuctionEvent } from "@/components/mystery-auction";
import { YokaiCard } from "@/components/yokai-card";
import { Karas } from "@/components/ui";
import {
  ReferralEventHubCard,
  useReferralEvent
} from "@/components/referral-event";
import {
  EventBannerFrame,
  EventBannerArt,
  EventBannerCountdown,
  EventBannerClockIcon,
  EventBannerArrow,
  EventsEmptyArt
} from "@/components/event-banner";
import {
  BlackMarketHubCard,
  getBlackMarketHubTiming,
  useBlackMarketEvent
} from "@/components/black-market";
import {
  GtaSunsetHubCard,
  useGtaSunsetEvent
} from "@/components/gta-sunset-event";
import "@/styles/events.css";

export function EventsHub({ home = false }: { home?: boolean }) {
  const t = useTranslations("events"),
    tm = useTranslations("mysteryAuction"),
    tr = useTranslations("referralEvent");
  const { event, now, failed } = useMysteryAuctionEvent();
  const [filter, setFilter] = useState<"all" | "live" | "upcoming">("all");
  const auction = event?.auction,
    live = auction?.status === "active";
  const status = event ? (live ? "live" : "upcoming") : undefined;
  const visible = home ? !!live : filter === "all" || filter === status;
  const referral = useReferralEvent();
  const blackMarket = useBlackMarketEvent();
  const sunset = useGtaSunsetEvent(!home);
  const sunsetVisible =
    !!sunset.event && (filter === "all" || filter === sunset.status);
  const blackMarketTiming =
    blackMarket.event === undefined
      ? undefined
      : getBlackMarketHubTiming(blackMarket.event, blackMarket.now);
  const blackMarketLive = blackMarketTiming?.status === "live";
  const blackMarketVisible =
    !!blackMarketTiming &&
    (home
      ? blackMarketLive
      : filter === "all" || filter === blackMarketTiming.status);
  const referralStatus = referral.event
    ? referral.now < Date.parse(referral.event.startsAt)
      ? "upcoming"
      : referral.now < Date.parse(referral.event.endsAt)
        ? "live"
        : "ended"
    : undefined;
  const referralVisible =
    !!referral.event &&
    (home
      ? referralStatus === "live"
      : filter === "all" || filter === referralStatus);
  const deadline = live ? auction.endsAt : event?.nextStartsAt;
  const counts = {
    all:
      1 +
      Number(!!referral.event) +
      Number(!!blackMarketTiming) +
      Number(!!sunset.event),
    live:
      Number(!!live) +
      Number(referralStatus === "live") +
      Number(blackMarketLive) +
      Number(sunset.status === "live"),
    upcoming:
      Number(status === "upcoming") +
      Number(referralStatus === "upcoming") +
      Number(blackMarketTiming?.status === "upcoming") +
      Number(sunset.status === "upcoming")
  };
  if (home && !visible && !referralVisible && !blackMarketVisible) return null;
  if (home)
    return (
      <section className="yk-home-events-strip" aria-label={t("title")}>
        {[
          ...(blackMarketLive
            ? [
                {
                  kind: "black-market",
                  href: "/black-market",
                  title: t("blackMarket"),
                  end: blackMarketTiming.deadline,
                  clock: blackMarket.now,
                  image: "/assets/events/mystery-card.png"
                }
              ]
            : []),
          ...(live && auction
            ? [
                {
                  kind: "mystery",
                  href: `/market/${auction.id}`,
                  title: tm("title"),
                  end: auction.endsAt,
                  clock: now,
                  image: "/assets/events/mystery-card.png"
                }
              ]
            : []),
          ...(referralVisible && referral.event
            ? [
                {
                  kind: "referral",
                  href: "/referral-event",
                  title: tr("title"),
                  end: referral.event.endsAt,
                  clock: referral.now,
                  image: "/assets/events/referral-event.png"
                }
              ]
            : [])
        ].map(item => (
          <Link key={item.kind} href={item.href} data-event={item.kind}>
            <span className="yk-home-events-thumb">
              <Image src={item.image} alt="" fill sizes="72px" />
            </span>
            <span className="yk-home-events-copy">
              <strong>{item.title}</strong>
              <span className="yk-home-events-time">
                <span className="sr-only">{t("endsIn")}</span>
                <EventBannerClockIcon />
                <EventBannerCountdown end={item.end} now={item.clock} />
              </span>
            </span>
            <span className="yk-home-events-live">{t("live")}</span>
            <EventBannerArrow />
          </Link>
        ))}
      </section>
    );
  const hasEvents =
    visible || referralVisible || blackMarketVisible || sunsetVisible;
  return (
    <div className={`yk-events-hub${home ? " yk-home-events" : ""}`}>
      {!home && (
        <>
          <div className="yk-events-page-light" aria-hidden="true" />
          <header className="yk-events-header">
            <div>
              <p className="eyebrow">{t("overline")}</p>
              <h1 className="yk-title mt-3">{t("title")}</h1>
            </div>
            <div className="yk-events-toolbar">
              <nav className="yk-events-filters" aria-label={t("filters")}>
                {(["all", "live", "upcoming"] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {t(value)}
                    <span>{counts[value]}</span>
                  </button>
                ))}
              </nav>
            </div>
          </header>
        </>
      )}
      <section aria-labelledby="events-list-title">
        <h2 id="events-list-title" className="sr-only">
          {t("explore")}
        </h2>
        {hasEvents ? (
          <ul className="yk-events-grid">
            {sunsetVisible && sunset.event && sunset.status && (
              <GtaSunsetHubCard
                event={sunset.event}
                now={sunset.now}
                status={sunset.status}
              />
            )}
            {blackMarketVisible && (
              <BlackMarketHubCard
                event={blackMarket.event ?? null}
                now={blackMarket.now}
              />
            )}
            {visible && (
              <li className="yk-event-card" data-event="mystery">
                <EventBannerFrame
                  href={auction ? `/market/${auction.id}` : undefined}
                  label={t(live ? "join" : "result")}
                >
                  <div className="yk-event-banner-content">
                    <span className="yk-event-frequency">
                      {t("continuousLabel")}
                    </span>
                    <h3>{tm("title")}</h3>
                    <p className="yk-event-description">
                      {t("bannerMysteryDescription")}
                    </p>
                    {auction?.card ? (
                      <p className="yk-event-reveal">
                        {t("lastReveal", { name: auction.card.name })}
                      </p>
                    ) : (
                      live && (
                        <p className="yk-event-leader">
                          {tm("leader", {
                            name: auction.winner ?? tm("noBids")
                          })}
                        </p>
                      )
                    )}
                    {!event && (
                      <p role="status" className="yk-event-notice">
                        {tm(failed ? "unavailable" : "loading")}
                      </p>
                    )}
                  </div>
                  <Karas
                    amount={live ? auction.amount : 50}
                    className="yk-event-banner-price"
                  />
                  <EventBannerArt kind="mystery">
                    {auction?.card ? (
                      <YokaiCard {...auction.card} />
                    ) : undefined}
                  </EventBannerArt>
                  <div className="yk-event-banner-footer">
                    <span className="yk-event-status" data-status={status}>
                      {t(status ?? "loadingShort")}
                    </span>
                    <span
                      className="yk-event-banner-separator"
                      aria-hidden="true"
                    />
                    <span className="yk-event-banner-time">
                      <EventBannerClockIcon />
                      <EventBannerCountdown end={deadline} now={now} />
                    </span>
                    <EventBannerArrow />
                  </div>
                </EventBannerFrame>
              </li>
            )}
            {referralVisible && referral.event && (
              <ReferralEventHubCard event={referral.event} now={referral.now} />
            )}
          </ul>
        ) : (
          <div role="status" className="yk-events-empty">
            <EventsEmptyArt />
            <h3>
              {t(
                event
                  ? filter === "live"
                    ? "noLive"
                    : "noUpcoming"
                  : failed
                    ? "unavailable"
                    : "loading"
              )}
            </h3>
            <p>{t("emptyHint")}</p>
          </div>
        )}
      </section>
      {!home && filter === "all" && hasEvents && (
        <aside className="yk-events-empty yk-events-coming-soon">
          <EventsEmptyArt />
          <h3>{t("moreEventsTitle")}</h3>
          <p>{t("emptyHint")}</p>
        </aside>
      )}
    </div>
  );
}
