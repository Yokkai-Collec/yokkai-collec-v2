"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  MysteryCardBack,
  useMysteryAuctionEvent
} from "@/components/mystery-auction";
import { EclipseScene } from "@/components/event-scene";
import { YokaiCard } from "@/components/yokai-card";
import { Karas } from "@/components/ui";
import { packCountdown } from "@/lib/ui/pack-countdown";
import {
  ReferralEventHubCard,
  useReferralEvent
} from "@/components/referral-event";
import "@/styles/events.css";

export function EventsHub() {
  const t = useTranslations("events");
  const tm = useTranslations("mysteryAuction");
  const { event, now, failed } = useMysteryAuctionEvent();
  const [filter, setFilter] = useState<"all" | "live" | "upcoming">("all");
  const auction = event?.auction;
  const live = auction?.status === "active";
  const status = event ? (live ? "live" : "upcoming") : undefined;
  const visible = filter === "all" || filter === status;
  const referral = useReferralEvent();
  const referralStatus = referral.event
    ? referral.now < Date.parse(referral.event.startsAt)
      ? "upcoming"
      : referral.now < Date.parse(referral.event.endsAt)
        ? "live"
        : "ended"
    : undefined;
  const referralVisible =
    !!referral.event && (filter === "all" || filter === referralStatus);
  const deadline = live ? auction.endsAt : event?.nextStartsAt;
  const countdown =
    deadline && now != null
      ? packCountdown(Date.parse(deadline), now, true)
      : "—";
  return (
    <div className="yk-events-hub">
      <header className="yk-events-header">
        <div>
          <p className="yk-events-overline">{t("overline")}</p>
          <h1>
            {t("title")}
            <span aria-hidden="true">/</span>
          </h1>
        </div>
        <p className="yk-events-intro">{t("description")}</p>
      </header>
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
              {value === "live" && (live || referralStatus === "live") && (
                <i aria-hidden="true" />
              )}
            </button>
          ))}
        </nav>
        <span className="yk-events-count">
          {t("count", { count: Number(visible) + Number(referralVisible) })}
        </span>
      </div>
      <section aria-labelledby="events-list-title">
        <h2 id="events-list-title" className="sr-only">
          {t("explore")}
        </h2>
        {visible || referralVisible ? (
          <ul className="yk-events-grid">
            {visible && (
              <li className="yk-event-card" data-event="mystery">
                <div className="yk-event-cover">
                  <EclipseScene revealed={!!auction?.card}>
                    {auction?.card ? (
                      <YokaiCard {...auction.card} />
                    ) : (
                      <MysteryCardBack />
                    )}
                  </EclipseScene>
                  <span className="yk-event-art-label" aria-hidden="true">
                    {auction?.card ? auction.card.rarity : tm("hiddenCard")}
                  </span>
                </div>
                <div className="yk-event-body">
                  <div className="yk-event-kind">
                    <span>{t("weekly")}</span>
                    {status && (
                      <span className={live ? "is-live" : undefined}>
                        {t(status)}
                      </span>
                    )}
                  </div>
                  <h3>{tm("title")}</h3>
                  <p className="yk-event-description">
                    {t("mysteryDescription")}
                  </p>
                  {auction?.card && (
                    <p className="yk-event-reveal">
                      {t("lastReveal", { name: auction.card.name })}
                    </p>
                  )}
                  <div className="yk-event-timing">
                    <span>{t(live ? "endsIn" : "nextEdition")}</span>
                    <strong
                      role="timer"
                      aria-live="off"
                      aria-label={countdown}
                      className="yk-event-clock"
                    >
                      {countdown === "—"
                        ? countdown
                        : countdown.split(":").map((value, index) => (
                            <span key={index}>
                              <b>{value}</b>
                              <small>
                                {tm(
                                  (["hours", "minutes", "seconds"] as const)[
                                    index
                                  ] ?? "seconds"
                                )}
                              </small>
                            </span>
                          ))}
                    </strong>
                  </div>
                  {live && (
                    <p className="yk-event-leader">
                      {tm("leader", { name: auction.winner ?? tm("noBids") })}
                    </p>
                  )}
                  {!event && (
                    <p role="status" className="yk-event-notice">
                      {tm(failed ? "unavailable" : "loading")}
                    </p>
                  )}
                  <div className="yk-event-footer">
                    <div className="yk-event-price">
                      <span>{t(live ? "currentPrice" : "startingPrice")}</span>
                      <Karas amount={live ? auction.amount : 50} />
                    </div>
                    {auction && (
                      <Link
                        href={`/market/${auction.id}`}
                        className="yk-button yk-event-action"
                      >
                        {t(live ? "join" : "result")}
                        <span aria-hidden="true">↗</span>
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            )}
            {referralVisible && referral.event && (
              <ReferralEventHubCard event={referral.event} now={referral.now} />
            )}
          </ul>
        ) : (
          <p role="status" className="yk-events-empty">
            {t(
              event
                ? filter === "live"
                  ? "noLive"
                  : "noUpcoming"
                : failed
                  ? "unavailable"
                  : "loading"
            )}
          </p>
        )}
      </section>
      <p className="yk-events-footnote">{t("hubNote")}</p>
    </div>
  );
}
