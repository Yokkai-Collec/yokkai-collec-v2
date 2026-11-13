"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  getMysteryAuctionEvent,
  type MysteryAuctionEvent
} from "@/lib/data/market";
import { YokaiCard } from "@/components/yokai-card";
import { Karas } from "@/components/ui";
import { CardShell } from "@/components/card-shell";
import { packCountdown } from "@/lib/ui/pack-countdown";
import "@/styles/mystery-auction.css";

export function MysteryCardBack() {
  const t = useTranslations("mysteryAuction");
  return (
    <div role="img" aria-label={t("cardBack")} className="yk-mystery-back">
      <span aria-hidden="true">?</span>
    </div>
  );
}

export function MysteryEventHeader({
  remaining,
  finished,
  hidden,
  bids
}: {
  remaining: string;
  finished?: boolean;
  hidden?: boolean;
  bids: number;
}) {
  const t = useTranslations("mysteryAuction");
  const tp = useTranslations("profileUi");
  return (
    <header className="yk-mystery-event-header">
      <Link href="/events" className="yk-mystery-event-back">
        ← {t("backToEvents")}
      </Link>
      <div className="yk-mystery-event-heading">
        <div className="yk-mystery-event-intro">
          <p className="yk-mystery-event-eyebrow">
            <span aria-hidden="true">◉</span>
            {t("weeklyEvent")}
          </p>
          <h1>{t("title")}</h1>
          <p className="yk-mystery-event-subtitle">{t("eventIntro")}</p>
        </div>
        <div className="yk-mystery-event-clock">
          <span className="yk-mystery-event-state">
            {t(finished ? (hidden ? "revealing" : "eventEnded") : "liveEvent")}
          </span>
          <span className="yk-mystery-event-clock-label">
            {t(finished ? "reveal" : "revealIn")}
          </span>
          <strong role="timer" aria-live="off">
            {finished ? "00:00:00" : remaining}
          </strong>
          <span className="yk-mystery-event-bids">
            {tp("bidCount", { count: bids })}
          </span>
        </div>
      </div>
      <ul className="yk-mystery-event-facts">
        <li>{t("durationFact")}</li>
        <li>{t("catalogueFact")}</li>
        <li>{t("normalFact")}</li>
      </ul>
    </header>
  );
}

export function MysteryAuctionTile({
  auction,
  label
}: {
  auction: { id: string; amount: number; remaining: string };
  label: string;
}) {
  const t = useTranslations("mysteryAuction");
  return (
    <li className="yk-market-tile">
      <CardShell>
        <Link
          href={`/market/${auction.id}`}
          className="yk-market-tile-link"
          aria-label={label}
        >
          <MysteryCardBack />
        </Link>
      </CardShell>
      <div className="yk-market-tile-meta">
        <span className="yk-market-seller">{t("title")}</span>
        <div className="yk-market-tile-line">
          <span className="yk-market-timer">{auction.remaining}</span>
          <Karas amount={auction.amount} className="yk-market-price" />
        </div>
      </div>
    </li>
  );
}

export function useMysteryAuctionEvent() {
  const [event, setEvent] = useState<MysteryAuctionEvent>();
  const [now, setNow] = useState<number>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.hidden) return;
      void getMysteryAuctionEvent().then(
        data => {
          if (active) {
            setEvent(data);
            setFailed(false);
          }
        },
        () => {
          if (active) setFailed(true);
        }
      );
    };
    refresh();
    const poll = window.setInterval(refresh, 15000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const visible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return { event, now, failed };
}

export function MysteryAuctionBanner({ home = false }: { home?: boolean }) {
  const t = useTranslations("mysteryAuction");
  const { event, now, failed } = useMysteryAuctionEvent();
  if (home && (!event || !event.isWednesday)) return null;
  if (!event)
    return (
      <p role="status" className="text-sm text-ink-3">
        {t(failed ? "unavailable" : "loading")}
      </p>
    );
  const auction = event.auction;
  const live = auction?.status === "active";
  const deadline = live ? auction.endsAt : event.nextStartsAt;
  const countdown =
    now == null ? "—" : packCountdown(Date.parse(deadline), now, true);
  return (
    <section className="yk-mystery-banner" aria-label={t("title")}>
      <div className="yk-mystery-banner-art">
        {auction?.card ? <YokaiCard {...auction.card} /> : <MysteryCardBack />}
      </div>
      <div className="yk-mystery-banner-copy">
        <h2 className="font-display text-xl">{t("title")}</h2>
        <p className="text-sm text-ink-2">
          {t(live ? "description" : "nextEvent")}
        </p>
        {auction?.card && (
          <p className="font-semibold">
            {t("revealed", { name: auction.card.name })}
          </p>
        )}
        <p className="text-sm text-ink-2">
          {t(live ? "endsIn" : "startsIn", { countdown })}
        </p>
        {auction && (
          <>
            <Karas amount={auction.amount} />
            <p className="text-sm text-ink-2">
              {t("leader", { name: auction.winner ?? t("noBids") })}
            </p>
            <Link
              className="inline-flex min-h-11 items-center font-semibold text-accent-gold underline underline-offset-4"
              href={`/market/${auction.id}`}
            >
              {t(live ? "view" : "viewResult")}
            </Link>
          </>
        )}
        {failed && (
          <p role="status" className="text-sm text-ink-3">
            {t("unavailable")}
          </p>
        )}
      </div>
    </section>
  );
}
