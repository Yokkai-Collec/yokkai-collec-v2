"use client";
import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { CardShell } from "@/components/card-shell";
import {
  MysteryCardBack,
  ReferralEventArtwork
} from "@/components/event-scene";

export function EventBannerFrame({
  href,
  label,
  children
}: {
  href?: string;
  label: string;
  children: ReactNode;
}) {
  return href ? (
    <Link href={href} aria-label={label} className="yk-event-banner-link">
      {children}
    </Link>
  ) : (
    <div className="yk-event-banner-link">{children}</div>
  );
}

export function EventBannerArt({
  kind,
  children
}: {
  kind: "mystery" | "referral";
  children?: ReactNode;
}) {
  return (
    <div className="yk-event-banner-art" data-kind={kind} aria-hidden="true">
      <svg className="yk-event-banner-light" viewBox="0 0 320 300" fill="none">
        <path
          d="M-20 230C32 130 280 87 310 151S120 291 38 251 189 171 338 116"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M-30 249C97 283 302 67 345 98"
          stroke="currentColor"
          strokeOpacity=".5"
        />
      </svg>
      <div className="yk-event-banner-portrait">
        <CardShell>
          {children ??
            (kind === "mystery" ? (
              <MysteryCardBack />
            ) : (
              <ReferralEventArtwork />
            ))}
        </CardShell>
      </div>
      <i className="yk-event-banner-spark yk-event-banner-spark-one" />
      <i className="yk-event-banner-spark yk-event-banner-spark-two" />
    </div>
  );
}

export function EventBannerCountdown({
  end,
  now
}: {
  end?: string;
  now?: number;
}) {
  const t = useTranslations("events");
  if (!end || !now || !Number.isFinite(Date.parse(end))) return <span>—</span>;
  const seconds = Math.max(0, Math.ceil((Date.parse(end) - now) / 1000));
  return (
    <span role="timer" aria-live="off">
      {t(seconds >= 86400 ? "countdownDays" : "countdownHours", {
        days: Math.floor(seconds / 86400),
        hours: String(Math.floor(seconds / 3600) % 24).padStart(2, "0"),
        minutes: String(Math.floor(seconds / 60) % 60).padStart(2, "0"),
        seconds: String(seconds % 60).padStart(2, "0")
      })}
    </span>
  );
}

export function EventBannerClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5v5l3.5 2" />
    </svg>
  );
}
export function EventBannerArrow() {
  return (
    <span className="yk-event-banner-arrow" aria-hidden="true">
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <path d="m7 4 6 6-6 6" />
      </svg>
    </span>
  );
}

export function EventsEmptyArt() {
  return (
    <div className="yk-events-empty-art" aria-hidden="true">
      <i />
      <i />
      <i />
      <svg viewBox="0 0 300 140" fill="none">
        <path
          d="M5 96C10 35 275 0 290 55S24 154 12 110"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}
