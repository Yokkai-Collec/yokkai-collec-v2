"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { Card } from "@/lib/data/cards";
import { YokaiCard } from "@/components/yokai-card";
import {
  MysteryEventHeader,
  MysteryCardBack,
  EventCardShowcase
} from "@/components/mystery-auction";

export function MysteryAuctionStage({
  auctionId,
  card,
  hidden,
  chance,
  misses,
  finished
}: {
  auctionId?: string;
  card: Card;
  hidden?: boolean;
  chance?: number | null;
  misses?: number | null;
  finished?: boolean;
}) {
  const t = useTranslations("mysteryAuction");
  const format = useFormatter();
  return (
    <>
      <MysteryEventHeader
        auctionId={auctionId}
        finished={finished}
        progressive={chance != null}
      />
      {chance != null && (
        <section className="yk-mystery-odds" aria-label={t("lrChanceLabel")}>
          <div className="yk-mystery-odds-heading">
            <span>{t(finished ? "lrChanceAtDraw" : "lrChanceLabel")}</span>
            <strong>
              {format.number(chance, {
                style: "percent",
                maximumFractionDigits: 2
              })}
            </strong>
          </div>
          <meter
            min={0}
            max={1}
            value={chance}
            aria-label={t("lrChanceLabel")}
          />
          <p>{t("lrStreak", { count: misses ?? 0 })}</p>
          <details>
            <summary>{t("lrRulesTitle")}</summary>
            <p>{t("lrRules")}</p>
          </details>
        </section>
      )}
      <div className="yk-auction-art">
        <EventCardShowcase revealed={!hidden}>
          {hidden ? <MysteryCardBack /> : <YokaiCard {...card} />}
        </EventCardShowcase>
      </div>
    </>
  );
}

export function MysteryAuctionLeader({ winner }: { winner?: string | null }) {
  const t = useTranslations("mysteryAuction");
  return (
    <p className="yk-auction-hint yk-mystery-leader">
      {t("leader", { name: winner ?? t("noBids") })}
    </p>
  );
}
