"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  MysteryCardBack,
  useMysteryAuctionEvent
} from "@/components/mystery-auction";
import { YokaiCard } from "@/components/yokai-card";
import { Karas } from "@/components/ui";
import { packCountdown } from "@/lib/ui/pack-countdown";
import "@/styles/events.css";
import {
  ReferralEventHubCard,
  useReferralEvent
} from "@/components/referral-event";

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
      <p className="yk-events-intro">{t("description")}</p>
      <nav className="yk-events-filters" aria-label={t("filters")}>
        {(["all", "live", "upcoming"] as const).map(value => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {t(value)}
          </button>
        ))}
      </nav>
      <section aria-labelledby="events-list-title">
        <div className="yk-events-section-head">
          <h2 id="events-list-title">{t("explore")}</h2>
          <span>
            {t("count", { count: Number(visible) + Number(referralVisible) })}
          </span>
        </div>
        {visible || referralVisible ? (
          <ul className="yk-events-grid">
            {visible && (
              <li className="yk-event-card">
                <div className="yk-event-cover">
                  <div className="yk-event-art">
                    {auction?.card ? (
                      <YokaiCard {...auction.card} />
                    ) : (
                      <MysteryCardBack />
                    )}
                  </div>
                  <span className="yk-event-frequency">{t("weekly")}</span>
                </div>
                <div className="yk-event-body">
                  <div className="yk-event-kind">
                    <span>{t("auction")}</span>
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
                    <strong>{countdown}</strong>
                  </div>
                  <div className="yk-event-price">
                    <span>{t(live ? "currentPrice" : "startingPrice")}</span>
                    <Karas amount={live ? auction.amount : 50} />
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
                  {auction && (
                    <Link
                      href={`/market/${auction.id}`}
                      className="yk-button yk-button-secondary yk-event-action"
                    >
                      {t(live ? "join" : "result")}
                    </Link>
                  )}
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
