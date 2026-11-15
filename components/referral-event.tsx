"use client";

import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";
import type { ReferralEvent } from "@/lib/referrals/event";
import {
  EventBannerFrame,
  EventBannerArt,
  EventBannerCountdown,
  EventBannerClockIcon,
  EventBannerArrow
} from "@/components/event-banner";
import "@/styles/referral-event.css";
import { CardShell } from "@/components/card-shell";
import { ReferralEventArtwork } from "@/components/event-scene";

export function useReferralEvent(initial?: ReferralEvent | null) {
  const [event, setEvent] = useState(initial ?? null);
  const [now, setNow] = useState(initial ? Date.parse(initial.serverNow) : 0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let clock = {
      server: initial ? Date.parse(initial.serverNow) : 0,
      local: performance.now()
    };
    const refresh = async () => {
      try {
        const { data, error } = await createClient().rpc("get_referral_event");
        if (!active) return;
        if (error) {
          setFailed(true);
          return;
        }
        const next = data as ReferralEvent | null;
        setEvent(next);
        setFailed(false);
        clock = {
          server: next ? Date.parse(next.serverNow) : 0,
          local: performance.now()
        };
        setNow(clock.server);
      } catch {
        if (active) setFailed(true);
      }
    };
    if (initial === undefined) void refresh();
    const polling = setInterval(() => void refresh(), 60_000);
    const ticking = setInterval(
      () => setNow(clock.server + performance.now() - clock.local),
      1000
    );
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(polling);
      clearInterval(ticking);
      window.removeEventListener("focus", refresh);
    };
  }, [initial]);
  return { event, now, failed };
}

function Countdown({ end, now }: { end: string; now: number }) {
  const t = useTranslations("referralEvent");
  const seconds = Math.max(0, Math.ceil((Date.parse(end) - now) / 1000));
  return (
    <span className="yk-referral-event-clock">
      {t("countdown", {
        days: Math.floor(seconds / 86400),
        hours: Math.floor(seconds / 3600) % 24,
        minutes: Math.floor(seconds / 60) % 60,
        seconds: seconds % 60
      })}
    </span>
  );
}

export function ReferralEventPromotion() {
  const t = useTranslations("referralEvent");
  const { event, now, failed } = useReferralEvent();
  if (
    !event ||
    failed ||
    now < Date.parse(event.startsAt) ||
    now >= Date.parse(event.endsAt)
  )
    return null;
  return (
    <Link href="/referral-event" className="yk-referral-event-promotion">
      <span className="yk-referral-event-seal" aria-hidden="true">
        <RecruiterEmblem />
      </span>
      <span>
        <strong>{t("title")}</strong>
        <span>{t("promotion")}</span>
      </span>
      <span className="yk-referral-event-promotion-time">
        <Countdown end={event.endsAt} now={now} />
        <span aria-hidden="true">↗</span>
      </span>
    </Link>
  );
}

function RecruiterEmblem() {
  const chrome = useId();
  return (
    <span className="yk-recruiter-emblem" aria-hidden="true">
      <svg viewBox="0 0 120 120" fill="none">
        <defs>
          <linearGradient
            id={chrome}
            x1="18"
            y1="5"
            x2="100"
            y2="112"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#f3f8ff" />
            <stop offset=".2" stopColor="#a8c7f5" />
            <stop offset=".4" stopColor="#4a648b" />
            <stop offset=".58" stopColor="#e3edff" />
            <stop offset=".78" stopColor="#829fcd" />
            <stop offset="1" stopColor="#d5e5ff" />
          </linearGradient>
        </defs>
        <path
          className="yk-recruiter-emblem-rim"
          fill={`url(#${chrome})`}
          d="M60 6 99 21v40c0 25-19 43-39 53C40 104 21 86 21 61V21Z"
        />
        <path
          d="m60 15 30 13v33c0 19-14 34-30 43-16-9-30-24-30-43V28Z"
          fill="#0a1424"
          stroke="#d2e2ff"
          strokeOpacity=".55"
        />
        <path
          d="m60 23 22 10v27c0 14-9 26-22 34-13-8-22-20-22-34V33Z"
          fill="#8dadff08"
          stroke="#8dadff"
          strokeOpacity=".3"
        />
        <g
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="60" cy="45" r="6" />
          <path d="M49 67v-4a11 11 0 0 1 22 0v4M45 45a4.5 4.5 0 1 0 0 9m-3 12v-3a8 8 0 0 1 6-8M75 45a4.5 4.5 0 1 1 0 9m3 12v-3a8 8 0 0 0-6-8m-17 26 4 4 7-8" />
        </g>
      </svg>
    </span>
  );
}
function RecruiterArtwork() {
  return (
    <span className="yk-recruiter-artwork" aria-hidden="true">
      <CardShell>
        <ReferralEventArtwork />
      </CardShell>
    </span>
  );
}

export function ReferralEventHubCard({
  event,
  now
}: {
  event: ReferralEvent;
  now: number;
}) {
  const t = useTranslations("referralEvent"),
    te = useTranslations("events");
  const status =
    now < Date.parse(event.startsAt)
      ? "upcoming"
      : now < Date.parse(event.endsAt)
        ? "live"
        : "ended";
  return (
    <li className="yk-event-card" data-event="referral">
      <EventBannerFrame href="/referral-event" label={t("viewEvent")}>
        <div className="yk-event-banner-content">
          <span className="yk-event-frequency">{t("limited")}</span>
          <h3>{t("title")}</h3>
          <p className="yk-event-description">{t("bannerDescription")}</p>
        </div>
        <EventBannerArt kind="referral" />
        <div className="yk-event-banner-footer">
          <span className="yk-event-status" data-status={status}>
            {te(status)}
          </span>
          <span className="yk-event-banner-separator" aria-hidden="true" />
          <span className="yk-event-banner-time">
            <EventBannerClockIcon />
            <EventBannerCountdown
              end={status === "upcoming" ? event.startsAt : event.endsAt}
              now={now}
            />
          </span>
          <EventBannerArrow />
        </div>
      </EventBannerFrame>
    </li>
  );
}

export function ReferralEventPanel({
  initialEvent,
  invite
}: {
  initialEvent: ReferralEvent | null;
  invite?: ReactNode;
}) {
  const t = useTranslations("referralEvent");
  const fmt = useFormatter();
  const { event, now, failed } = useReferralEvent(initialEvent);
  if (!event)
    return (
      <section className="yk-referral-event">
        <h1>{t("title")}</h1>
        <p>{t("noEvent")}</p>
      </section>
    );
  const upcoming = now < Date.parse(event.startsAt);
  const ended = now >= Date.parse(event.endsAt);
  const next = event.tiers.find(tier => tier.threshold > event.validCount);
  const maximum = next?.threshold ?? event.tiers.at(-1)?.threshold ?? 20;
  return (
    <section
      className="yk-referral-event yk-referral-event-detail"
      aria-labelledby="referral-event-title"
    >
      <Link href="/events" className="yk-referral-event-back">
        ← {t("backToEvents")}
      </Link>
      <header className="yk-referral-event-hero">
        <div className="yk-referral-event-intro">
          <p className="eyebrow">
            {t(upcoming ? "upcoming" : ended ? "ended" : "limited")}
          </p>
          <h1 id="referral-event-title">{t("title")}</h1>
          <p>{t("intro")}</p>
          <div className="yk-referral-event-timer">
            <span>{t(upcoming ? "startsIn" : "endsIn")}</span>
            <Countdown
              end={upcoming ? event.startsAt : event.endsAt}
              now={now}
            />
          </div>
        </div>
        <div
          className="yk-referral-event-trophy"
          data-goal={event.tiers.find(tier => tier.badge)?.threshold}
        >
          <RecruiterArtwork />
          <strong>{t("badge")}</strong>
          <span>{t("badgeAt", { count: 20 })}</span>
        </div>
      </header>
      <p className="yk-referral-event-reward-total">
        {t("totalRewards", {
          amount: event.tiers.reduce((total, tier) => total + tier.karas, 0)
        })}
      </p>
      {invite}
      {failed && <p role="status">{t("refreshError")}</p>}
      <div className="yk-referral-event-progress">
        <div>
          <strong>{fmt.number(event.validCount)}</strong>
          <span>{t("validReferrals", { count: event.validCount })}</span>
        </div>
        <p>
          {next
            ? t("nextTier", {
                count: Math.max(0, next.threshold - event.validCount),
                karas: next.karas
              })
            : t("allReached")}
        </p>
        <progress
          aria-label={t("progressLabel", {
            count: event.validCount,
            target: maximum
          })}
          max={maximum}
          value={Math.min(event.validCount, maximum)}
        />
      </div>
      <ol className="yk-referral-event-tiers">
        {event.tiers.map(tier => (
          <li
            key={tier.threshold}
            data-reached={tier.awarded}
            data-next={tier.threshold === next?.threshold}
            data-badge={tier.badge}
          >
            <span className="yk-referral-event-tier-mark" aria-hidden="true">
              {tier.awarded
                ? "✓"
                : tier.threshold === next?.threshold
                  ? "↗"
                  : "◇"}
            </span>
            <span className="yk-referral-event-tier-number" aria-hidden="true">
              {String(tier.threshold).padStart(2, "0")}
            </span>
            <h2>{t("tier", { count: tier.threshold })}</h2>
            <strong>{t("karas", { amount: tier.karas })}</strong>
            {tier.badge && (
              <span className="yk-recruiter-badge">{t("badge")}</span>
            )}
            <span>
              {t(
                tier.awarded
                  ? "awarded"
                  : event.validCount >= tier.threshold
                    ? "processing"
                    : "locked"
              )}
            </span>
          </li>
        ))}
      </ol>
      <div className="yk-referral-event-details">
        <section>
          <h2>{t("howTitle")}</h2>
          <p>{t("validExplanation")}</p>
          <p>{t("graceExplanation")}</p>
          <p>{t("automatic")}</p>
        </section>
        <section>
          <h2>{t("pendingTitle", { count: event.pending.length })}</h2>
          {event.pending.length ? (
            <ul className="yk-referral-event-pending">
              {event.pending.map((pseudo, index) => (
                <li key={index}>{pseudo}</li>
              ))}
            </ul>
          ) : (
            <p>{t("noPending")}</p>
          )}
        </section>
      </div>
    </section>
  );
}

export function RecruiterBadge({ userId }: { userId: string }) {
  const t = useTranslations("referralEvent");
  const [events, setEvents] = useState<{ eventId: string }[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await createClient().rpc(
          "get_referral_event_badges",
          { p_user: userId }
        );
        if (active)
          setEvents(error ? [] : ((data ?? []) as { eventId: string }[]));
      } catch {
        if (active) setEvents([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);
  return events.map(event => (
    <Link
      href="/referral-event"
      key={event.eventId}
      className="yk-recruiter-badge"
      title={t("badgeDescription")}
    >
      <span aria-hidden="true">✦ </span>
      {t("badge")}
    </Link>
  ));
}
