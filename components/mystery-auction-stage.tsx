"use client";

import { useTranslations } from "next-intl";
import type { Card } from "@/lib/data/cards";
import { YokaiCard } from "@/components/yokai-card";
import {
  MysteryEventHeader,
  MysteryCardBack,
  EventCardShowcase
} from "@/components/mystery-auction";

export function MysteryAuctionStage({
  card,
  hidden,
  finished
}: {
  card: Card;
  hidden?: boolean;
  finished?: boolean;
}) {
  return (
    <>
      <MysteryEventHeader finished={finished} />
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
    <p className="yk-auction-hint">
      {t("leader", { name: winner ?? t("noBids") })}
    </p>
  );
}
