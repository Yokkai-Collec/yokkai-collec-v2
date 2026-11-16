"use client";
import Link from "next/link";
import { StatusPill } from "@/components/ui";
import { useTranslations, useFormatter } from "next-intl";
import type { AuctionPresentation } from "@/components/community-views";
export default function AuctionOutcome({
  auction
}: {
  auction: AuctionPresentation;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const formatKaras = (amount: number) => format.number(amount) + " Karas";
  const won = auction.status === "won" || auction.status === "leading";
  const lost = auction.status === "lost" || auction.status === "outbid";
  if (won)
    return (
      <div role="status" className="yk-auction-outcome yk-outcome-won">
        <p className="yk-outcome-badge">{t("profileUi.auctionWon")}</p>
        <p className="mt-2 text-sm text-ink-2">
          {t("profileUi.cardJoinsCollection", {
            name: auction.card.name,
            amount: formatKaras(auction.amount)
          })}
        </p>
        <Link href="/collection" className="yk-button yk-button-secondary mt-4">
          {t("profileUi.viewMyCollection")}{" "}
        </Link>
      </div>
    );
  if (lost)
    return (
      <div role="status" className="yk-auction-outcome yk-outcome-lost">
        <p className="yk-outcome-badge">{t("profileUi.auctionLost")}</p>
        <p className="mt-2 text-sm text-ink-2">
          {auction.winner
            ? t("profileUi.wonAuctionBy", {
                name: auction.winner,
                amount: formatKaras(auction.amount)
              })
            : t("profileUi.anotherBidWon")}{" "}
          {t("profileUi.yourBidHasBeenRefunded")}{" "}
        </p>
        <Link href="/market" className="yk-button yk-button-secondary mt-4">
          {t("profileUi.backToMarket")}{" "}
        </Link>
      </div>
    );
  if (
    auction.status === "sold" ||
    (auction.status === "mine" && auction.winner)
  )
    return (
      <div role="status" className="yk-auction-outcome yk-outcome-won">
        <p className="yk-outcome-badge">{t("profileUi.cardSold")}</p>
        <p className="mt-2 text-sm text-ink-2">
          {t("profileUi.soldToPlayer", {
            name: auction.winner ?? t("profileUi.aPlayer"),
            amount: formatKaras(auction.amount)
          })}
        </p>
      </div>
    );
  if (auction.status === "unsold")
    return (
      <div role="status" className="yk-auction-outcome">
        <p className="yk-outcome-badge">{t("profileUi.noBids")}</p>
        <p className="mt-2 text-sm text-ink-2">
          {t("profileUi.auctionCardReturned")}{" "}
        </p>
      </div>
    );
  return (
    <div role="status" className="yk-auction-outcome">
      <p className="yk-outcome-badge">{t("profileUi.auctionEnded")}</p>
      <p className="mt-2 text-sm text-ink-2">
        {auction.winner
          ? t("profileUi.wonAuctionBy", {
              name: auction.winner,
              amount: formatKaras(auction.amount)
            })
          : t("profileUi.noBidsWerePlaced")}
      </p>
    </div>
  );
}

export function AuctionStatus({
  status
}: {
  status: NonNullable<AuctionPresentation["status"]>;
}) {
  const tStatus = useTranslations("profileUi");
  return (
    <StatusPill
      tone={
        status === "outbid" || status === "lost"
          ? "danger"
          : status === "leading" || status === "sold"
            ? "success"
            : status === "unsold"
              ? "neutral"
              : "gold"
      }
    >
      {tStatus(`auctionStatus${status}`)}
    </StatusPill>
  );
}
