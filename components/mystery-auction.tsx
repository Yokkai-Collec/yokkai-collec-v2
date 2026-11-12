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
import "@/styles/mystery-auction.css";

export function MysteryCardBack() {
  const t = useTranslations("mysteryAuction");
  return (
    <div role="img" aria-label={t("cardBack")} className="yk-mystery-back">
      <span aria-hidden="true">?</span>
    </div>
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

export function MysteryAuctionBanner({ home = false }: { home?: boolean }) {
  const t = useTranslations("mysteryAuction");
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
  const seconds =
    now == null
      ? undefined
      : Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  const countdown =
    seconds == null
      ? "—"
      : `${Math.floor(seconds / 3600)
          .toString()
          .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
          .toString()
          .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
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
