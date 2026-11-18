"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getMysteryAuctionEvent,
  type MysteryAuctionEvent
} from "@/lib/data/market";
import { YokaiCard } from "@/components/yokai-card";
import { Karas } from "@/components/ui";
import { CardShell } from "@/components/card-shell";
import { packCountdown } from "@/lib/ui/pack-countdown";
import "@/styles/mystery-auction.css";
import { MysteryCardBack } from "@/components/event-scene";
export { EventCardShowcase, MysteryCardBack } from "@/components/event-scene";

export function MysteryEventHeader({
  auctionId,
  finished,
  progressive = false
}: {
  auctionId?: string;
  finished?: boolean;
  progressive?: boolean;
}) {
  const t = useTranslations("mysteryAuction");
  return (
    <header className="yk-mystery-event-header">
      <Link href="/events" className="yk-mystery-event-back">
        ← {t("backToEvents")}
      </Link>
      <div className="yk-mystery-event-heading">
        <div className="yk-mystery-event-intro">
          <p className="yk-mystery-event-eyebrow">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="5" y="3" width="14" height="18" rx="3" />
              <path d="M9 8h6M9 12h6M9 16h3" />
            </svg>
            {t("dailyEvent")}
          </p>
          <h1>{t("title")}</h1>
          <p className="yk-mystery-event-subtitle">
            {t(
              finished
                ? "endedIntro"
                : progressive
                  ? "eventIntro"
                  : "legacyIntro"
            )}
          </p>
        </div>
      </div>
      {finished && <MysteryNextEdition auctionId={auctionId} />}
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
            setEvent(data ?? undefined);
            setNow(Date.now());
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

// Follow only the latest result that was observed during its reveal break.
// Opening an older archive directly must never redirect away from its result.
export function MysteryNextEdition({ auctionId }: { auctionId?: string }) {
  const t = useTranslations("mysteryAuction");
  const router = useRouter();
  const following = useRef(false);
  const { event, now, failed } = useMysteryAuctionEvent();
  const latest = event?.auction;
  const live =
    latest?.status === "active" &&
    now != null &&
    Date.parse(latest.endsAt) > now;
  useEffect(() => {
    if (auctionId && latest?.id === auctionId) following.current = true;
    else if (following.current && live && latest?.id)
      router.replace(`/market/${latest.id}`, { scroll: false });
  }, [auctionId, latest?.id, live, router]);
  if (live || (latest && auctionId && latest.id !== auctionId)) return null;
  const deadline = event ? Date.parse(event.nextStartsAt) : NaN;
  const countdown =
    now != null && Number.isFinite(deadline)
      ? packCountdown(deadline, now, true)
      : "—";
  return (
    <section className="yk-mystery-next" aria-label={t("nextEditionLabel")}>
      <span>{t("nextEditionLabel")}</span>
      <time role="timer" aria-live="off" dateTime={event?.nextStartsAt}>
        {countdown}
      </time>
      {failed && <p role="status">{t("unavailable")}</p>}
    </section>
  );
}

export function MysteryAuctionBanner({ home = false }: { home?: boolean }) {
  const t = useTranslations("mysteryAuction");
  const { event, now, failed } = useMysteryAuctionEvent();
  if (home && !event) return null;
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
