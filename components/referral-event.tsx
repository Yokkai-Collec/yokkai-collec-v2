"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
    <li className="yk-event-card">
      <div className="yk-event-cover">
        <span className="yk-event-referral-art" aria-hidden="true">
          ✦
        </span>
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
        <div className="yk-event-timing">
          <span>{t(upcoming ? "startsIn" : "endsIn")}</span>
          <Countdown end={upcoming ? event.startsAt : event.endsAt} now={now} />
        </div>
        <Link
          href="/referral-event"
          className="yk-button yk-button-secondary yk-event-action"
        >
          {t("viewEvent")}
        </Link>
      </div>
    </li>
  );
}

export function ReferralEventPanel({
  initialEvent
}: {
  initialEvent: ReferralEvent | null;
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
      <header className="yk-referral-event-hero">
        <div>
          <p className="eyebrow">
            {t(upcoming ? "upcoming" : ended ? "ended" : "limited")}
          </p>
          <h1 id="referral-event-title">{t("title")}</h1>
          <p>{t("intro")}</p>
        </div>
        <div className="yk-referral-event-timer">
          <span>{t(upcoming ? "startsIn" : "endsIn")}</span>
          <Countdown end={upcoming ? event.startsAt : event.endsAt} now={now} />
        </div>
      </header>
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
          <li key={tier.threshold} data-reached={tier.awarded}>
            <span className="yk-referral-event-tier-mark" aria-hidden="true">
              {tier.awarded ? "✓" : "✦"}
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
