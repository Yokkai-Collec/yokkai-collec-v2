"use client";

import { cardRarityLabel } from "@/lib/ui/card-rarity-label";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Karas, StatusPill } from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import { groupCollection } from "@/lib/ui/collection-groups";
import { tradeStatusPresentation, type TradeOffer } from "@/lib/data/trades";
import type { CollectedCard } from "@/lib/data/cards";

function Lot({
  title,
  cards,
  karas
}: {
  title: string;
  cards: CollectedCard[];
  karas: number;
}) {
  const t = useTranslations("conversationTrade");
  return (
    <section className="yk-conversation-trade-lot">
      <h4>{title}</h4>
      {cards.length ? (
        <div className="yk-conversation-trade-cards">
          {groupCollection(cards).map(group => {
            const card =
              group.cards.find(copy => copy.customImageUrl) ??
              group.representative;
            return (
              <div
                key={group.key}
                className="yk-conversation-trade-card"
                data-rarity={card.rarity}
              >
                <div className="yk-conversation-trade-art">
                  <YokaiCard
                    {...card}
                    image={card.customImageUrl ?? card.image}
                    fallbackImage={card.catalogueImage}
                    animated={false}
                    imageSizes="120px"
                  />
                </div>
                <div className="yk-conversation-trade-card-info">
                  <strong>
                    {card.name}
                    {card.shiny || card.isEvolved
                      ? ` · ${cardRarityLabel(card.rarity, card.shiny, card.isEvolved)}`
                      : ""}
                    {group.cards.length > 1 ? ` ×${group.cards.length}` : ""}
                  </strong>
                  {card.customImageUrl && <small>{t("customImage")}</small>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p>{t("noCards")}</p>
      )}
      <Karas amount={karas} />
    </section>
  );
}

export function ConversationTrade({
  offer,
  viewerId,
  busy,
  onRespond
}: {
  offer: TradeOffer;
  viewerId: string;
  busy: boolean;
  onRespond: (id: string, action: "accept" | "decline") => void;
}) {
  const t = useTranslations("conversationTrade");
  const format = useFormatter();
  const [confirming, setConfirming] = useState(false);
  const own = offer.fromUser === viewerId;
  const incoming = offer.toUser === viewerId;
  const actionable = incoming && offer.status === "pending";
  const presentation = tradeStatusPresentation(offer.status);
  return (
    <article
      className={`yk-conversation-trade${own ? " is-own" : ""}`}
      data-trade-id={offer.id}
      aria-label={t(own ? "sent" : "received")}
    >
      <header>
        <strong>{t(offer.parentOfferId ? "counter" : "offer")}</strong>
        <StatusPill tone={presentation.tone}>
          {t(
            `status.${["pending", "accepted", "declined", "cancelled", "expired", "countered", "quarantined"].includes(offer.status) ? offer.status : "unavailable"}`
          )}
        </StatusPill>
      </header>
      <p>
        {own
          ? t("sentTo", { name: offer.toPseudo })
          : t("receivedFrom", { name: offer.fromPseudo })}
      </p>
      {offer.status === "quarantined" && <p>{t("quarantineNotice")}</p>}
      <div className="yk-conversation-trade-lots">
        <Lot
          title={t("give")}
          cards={own ? offer.offeredCards : offer.requestedCards}
          karas={own ? offer.offeredKaras : offer.requestedKaras}
        />
        <Lot
          title={t("receive")}
          cards={own ? offer.requestedCards : offer.offeredCards}
          karas={own ? offer.requestedKaras : offer.offeredKaras}
        />
      </div>
      {actionable &&
        (confirming ? (
          <div
            className="yk-conversation-trade-confirm"
            role="group"
            aria-label={t("confirmLabel")}
          >
            <strong>{t("irreversible")}</strong>
            <p>{t("notice")}</p>
            <div>
              <Button
                className="yk-trade-accept"
                disabled={busy}
                onClick={() => onRespond(offer.id, "accept")}
              >
                {busy ? t("accepting") : t("confirm")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                {t("back")}
              </Button>
            </div>
          </div>
        ) : (
          <footer>
            <Button
              className="yk-trade-accept"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              {t("accept")}
            </Button>
            <Button
              className="yk-trade-decline"
              variant="secondary"
              disabled={busy}
              onClick={() => onRespond(offer.id, "decline")}
            >
              {t("decline")}
            </Button>
          </footer>
        ))}
      {own && offer.status === "pending" && (
        <p className="yk-conversation-trade-waiting">
          {t("waiting", { name: offer.toPseudo })}
        </p>
      )}
      <time dateTime={offer.createdAt}>
        {format.dateTime(new Date(offer.createdAt), {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        })}
      </time>
    </article>
  );
}
