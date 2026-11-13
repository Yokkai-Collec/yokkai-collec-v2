"use client";

import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";
import type { ReferralEvent } from "@/lib/referrals/event";
import "@/styles/referral-event.css";

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
        ✦
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
  const gold = useId();
  return (
    <span className="yk-recruiter-emblem" aria-hidden="true">
      <svg viewBox="0 0 120 120" fill="none">
        <defs>
          <linearGradient
            id={gold}
            x1="15"
            y1="8"
            x2="100"
            y2="115"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#79603b" />
            <stop offset=".25" stopColor="#f1dfb6" />
            <stop offset=".48" stopColor="#9b7b47" />
            <stop offset=".72" stopColor="#d9c08b" />
            <stop offset="1" stopColor="#665033" />
          </linearGradient>
        </defs>
        <path
          className="yk-recruiter-emblem-rim"
          fill={`url(#${gold})`}
          d="M60 3 75 10 92 13 103 28 113 43 112 60 113 77 103 92 88 103 72 108 60 117 44 110 28 106 17 92 7 77 8 60 7 43 17 28 32 17 48 12Z"
        />
        <circle
          cx="60"
          cy="60"
          r="46"
          fill="#10151f"
          stroke="currentColor"
          strokeOpacity=".3"
        />
        <circle
          cx="60"
          cy="60"
          r="40"
          stroke="currentColor"
          strokeOpacity=".5"
          strokeDasharray="1 6"
        />
        <path
          className="yk-recruiter-emblem-shield"
          d="m60 28 25 10-3 29c-2 12-12 21-22 27-10-6-20-15-22-27l-3-29Z"
        />
        <path
          d="m60 15 2.5 5 5.5.8-4 3.8 1 5.4-5-2.5-5 2.5 1-5.4-4-3.8 5.5-.8Z"
          fill="currentColor"
        />
        <g
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="60" cy="49" r="6" />
          <path d="M49 71v-4a11 11 0 0 1 22 0v4" />
          <path d="M45 49a4.5 4.5 0 1 0 0 9m-3 12v-3a8 8 0 0 1 6-8M75 49a4.5 4.5 0 1 1 0 9m3 12v-3a8 8 0 0 0-6-8" />
          <path d="m55 81 4 4 7-8" />
        </g>
        <path
          d="M25 76q-9-16-3-29M95 76q9-16 3-29"
          stroke="currentColor"
          strokeOpacity=".6"
          strokeWidth="2"
        />
      </svg>
    </span>
  );
}

function RecruiterConstellation() {
  return (
    <span className="yk-recruiter-constellation" aria-hidden="true">
      <svg className="yk-recruiter-stars" viewBox="0 0 320 260" fill="none">
        <path
          d="m15 76 49-32 44 18 67-44 58 27 52-15M40 240l34-45 52 21 64-29 59 23 51-42M64 44l10 151M233 45l16 165"
          stroke="currentColor"
          strokeOpacity=".18"
        />
        {[
          [15, 76],
          [64, 44],
          [108, 62],
          [175, 18],
          [233, 45],
          [285, 30],
          [40, 240],
          [74, 195],
          [126, 216],
          [190, 187],
          [249, 210],
          [300, 168]
        ].map(([cx, cy], index) => (
          <circle
            key={index}
            cx={cx}
            cy={cy}
            r={index % 3 === 0 ? 2.5 : 1.5}
            fill="currentColor"
          />
        ))}
      </svg>
      <RecruiterEmblem />
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
  const t = useTranslations("referralEvent");
  const upcoming = now < Date.parse(event.startsAt);
  const ended = now >= Date.parse(event.endsAt);
  return (
    <li className="yk-event-card" data-event="referral">
      <div className="yk-event-cover">
        <span className="yk-event-orbit" aria-hidden="true" />
        <div className="yk-event-referral-art">
          <RecruiterConstellation />
        </div>
        <span className="yk-event-frequency">{t("limited")}</span>
      </div>
      <div className="yk-event-body">
        <div className="yk-event-kind">
          <span>{t("badge")}</span>
          <span className={!upcoming && !ended ? "is-live" : undefined}>
            {t(upcoming ? "upcoming" : ended ? "ended" : "limited")}
          </span>
        </div>
        <h3>{t("title")}</h3>
        <p className="yk-event-description">{t("promotion")}</p>
        <div className="yk-event-stats">
          <div className="yk-event-timing">
            <span>{t(upcoming ? "startsIn" : "endsIn")}</span>
            <Countdown
              end={upcoming ? event.startsAt : event.endsAt}
              now={now}
            />
          </div>
          <div className="yk-event-price">
            <span>{t("rewardPool")}</span>
            <strong>
              {t("karas", {
                amount: event.tiers.reduce((sum, tier) => sum + tier.karas, 0)
              })}
            </strong>
          </div>
        </div>
        <Link
          href="/referral-event"
          className="yk-button yk-button-secondary yk-event-action"
        >
          {t("viewEvent")}
          <span aria-hidden="true">↗</span>
        </Link>
      </div>
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
      className="yk-referral-event"
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
        <div className="yk-referral-event-trophy">
          <span className="yk-referral-event-trophy-orbit" aria-hidden="true" />
          <RecruiterConstellation />
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
