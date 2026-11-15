"use client";
import { useState } from "react";
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
import "@/styles/events.css";

export function EventsHub() {
  const t = useTranslations("events"),
    tm = useTranslations("mysteryAuction");
  const { event, now, failed } = useMysteryAuctionEvent();
  const [filter, setFilter] = useState<"all" | "live" | "upcoming">("all");
  const auction = event?.auction,
    live = auction?.status === "active";
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
  return (
    <div className="yk-events-hub">
      <svg
        className="yk-events-page-light"
        viewBox="0 0 1200 500"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M350 260C730 0 960 180 1250 20M450 320C880 270 1060 190 1260 125"
          stroke="#438eff"
          strokeWidth="20"
          strokeOpacity=".1"
        />
        <path
          d="M350 260C730 0 960 180 1250 20M450 320C880 270 1060 190 1260 125"
          stroke="#529bff"
          strokeWidth="1.2"
        />
        <path
          d="M600 180C850 80 1150 180 1290 70"
          stroke="#d9edff"
          strokeWidth="1.8"
        />
      </svg>
      <header className="yk-events-header">
        <p className="yk-events-overline">{t("title")}</p>
        <h1>{t("title")}</h1>
        <p className="yk-events-intro">{t("lead")}</p>
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
                <EventBannerFrame
                  href={auction ? `/market/${auction.id}` : undefined}
                  label={t(live ? "join" : "result")}
                >
                  <div className="yk-event-banner-content">
                    <span className="yk-event-frequency">
                      {t("weeklyLabel")}
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
                  <span className="yk-event-banner-price">
                    <Karas amount={live ? auction.amount : 50} />
                  </span>
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
      {filter === "all" && (visible || referralVisible) && (
        <aside className="yk-events-empty yk-events-coming-soon">
          <EventsEmptyArt />
          <h3>{t("moreEventsTitle")}</h3>
          <p>{t("emptyHint")}</p>
        </aside>
      )}
    </div>
  );
}
