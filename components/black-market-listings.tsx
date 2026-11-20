"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { MarketView, presentAuction } from "@/components/community-views";
import {
  EventBannerClockIcon,
  EventBannerCountdown
} from "@/components/event-banner";
import { CardShell } from "@/components/card-shell";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { GRID_CARD_IMAGE_SIZES, YokaiCard } from "@/components/yokai-card";
import { Button, Karas, NotificationBellIcon } from "@/components/ui";
import type {
  BlackMarketActivity,
  BlackMarketEvent
} from "@/components/black-market";
import type { Card } from "@/lib/data/cards";
import type { AuctionDetail } from "@/lib/data/market";

function BidScope({
  personal,
  onChange,
  allLabel,
  personalLabel
}: {
  personal: boolean;
  onChange: (value: boolean) => void;
  allLabel: string;
  personalLabel?: string;
}) {
  const t = useTranslations("blackMarket");
  return (
    <div
      className="yk-tabs yk-black-market-bid-scope"
      role="group"
      aria-label={t("bidScope")}
    >
      <button
        className="yk-tab"
        type="button"
        aria-pressed={!personal}
        onClick={() => onChange(false)}
      >
        {allLabel}
      </button>
      <button
        className="yk-tab"
        type="button"
        aria-pressed={personal}
        onClick={() => onChange(true)}
      >
        {personalLabel ?? t("myBids")}
      </button>
    </div>
  );
}

function LastEdition({
  edition,
  personal,
  onScopeChange,
  matchesCard
}: {
  edition: NonNullable<BlackMarketActivity["lastEdition"]>;
  personal: boolean;
  onScopeChange: (value: boolean) => void;
  matchesCard: (card: Card) => boolean;
}) {
  const t = useTranslations("blackMarket");
  const catalogue = useTranslations("catalogueUi");
  const profile = useTranslations("profileUi");
  const format = useFormatter();
  const lots = edition.lots.filter(lot =>
    personal ? lot.bidStatus === "won" : lot.sold
  );
  const matchingLots = lots.filter(lot => matchesCard(lot.card));
  const singleResult = lots.length === 1;
  const date = format.dateTime(new Date(`${edition.openingDay}T12:00:00Z`), {
    dateStyle: "long",
    timeZone: "Europe/Paris"
  });
  return (
    <section
      className="yk-black-market-results"
      aria-labelledby="black-market-results-title"
    >
      <header>
        <div>
          <h2 id="black-market-results-title">{t("editionResults")}</h2>
          <time dateTime={edition.openingDay}>{date}</time>
        </div>
        <BidScope
          personal={personal}
          onChange={onScopeChange}
          allLabel={t("soldLots")}
          personalLabel={t("myWonCards")}
        />
      </header>
      {edition.settling && <p role="status">{t("resultsSettling")}</p>}
      {!matchingLots.length && !edition.settling && (
        <p>
          {lots.length
            ? catalogue("noCardsMatchTheseFilters")
            : t(personal ? "noWonCards" : "noSoldLots")}
        </p>
      )}
      <span id="black-market-winner-label" className="sr-only">
        {t("winner")}
      </span>
      {!!matchingLots.length && (
        <ul
          className="yk-card-grid yk-market-list yk-black-market-result-grid"
          data-single={singleResult || undefined}
        >
          {matchingLots.map(lot => (
            <li key={lot.id} className="yk-market-tile">
              <Link
                href={`/market/${lot.id}`}
                className="yk-black-market-result-link"
              >
                <CardShell interactive={false}>
                  <YokaiCard
                    {...lot.card}
                    animated={false}
                    imageSizes={GRID_CARD_IMAGE_SIZES}
                  />
                </CardShell>
              </Link>
              <div className="yk-market-tile-meta yk-black-market-result-meta">
                {singleResult && <h3>{lot.card.name}</h3>}
                {lot.winnerName ? (
                  <Link
                    href={`/profile/${encodeURIComponent(lot.winnerName)}`}
                    className="yk-market-seller yk-black-market-result-winner"
                    aria-describedby="black-market-winner-label"
                  >
                    <span aria-hidden="true">
                      <StyledPlayerAvatar
                        name={lot.winnerName}
                        image={lot.winnerAvatarUrl ?? undefined}
                        size={26}
                        cosmetics={
                          lot.winnerAvatarFrame
                            ? {
                                active: true,
                                style: { avatarFrame: lot.winnerAvatarFrame }
                              }
                            : undefined
                        }
                      />
                    </span>
                    <span>{lot.winnerName}</span>
                  </Link>
                ) : lot.winnerName === null ? (
                  <span className="yk-market-seller yk-black-market-result-winner">
                    {profile("deletedPlayer")}
                  </span>
                ) : null}
                <div
                  className="yk-market-tile-line yk-black-market-final-price"
                  data-large-price={lot.amount >= 1_000_000 || undefined}
                >
                  <span>{t("wonFor")}</span>
                  <Karas amount={lot.amount} className="yk-market-price" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function BlackMarketListings({
  auctions,
  upcomingCards,
  open,
  now,
  viewerId,
  activity,
  activityFailed,
  onReminderChange,
  notice,
  deadline,
  upcoming
}: {
  auctions?: AuctionDetail[];
  upcomingCards?: BlackMarketEvent["upcomingCards"];
  open: boolean;
  now?: number;
  viewerId?: string;
  activity?: BlackMarketActivity;
  activityFailed: boolean;
  onReminderChange?: (id: string, enabled: boolean) => Promise<void>;
  notice?: string;
  deadline?: string;
  upcoming: boolean;
}) {
  const t = useTranslations("blackMarket");
  const tm = useTranslations("market");
  const catalogue = useTranslations("catalogueUi");
  const [selectedEdition, setSelectedEdition] = useState<"current" | "last">(
    "current"
  );
  const [myBids, setMyBids] = useState(false);
  const [myWonCards, setMyWonCards] = useState(false);
  const [pendingReminder, setPendingReminder] = useState<string>();
  const [reminderFailed, setReminderFailed] = useState(false);
  const lastEdition = activity?.lastEdition;
  const hasCurrentEdition = open || upcoming;
  const hasEditionTabs = hasCurrentEdition && !!lastEdition;
  const showLastEdition =
    !!lastEdition && (!hasCurrentEdition || selectedEdition === "last");
  const showAuctions = open && !showLastEdition;
  const editionTab = showLastEdition ? "last" : "current";
  const editionTabs = [
    { id: "current", label: t(open ? "currentEdition" : "nextEdition") },
    { id: "last", label: t("lastResults") }
  ] as const;
  const active = showAuctions
    ? auctions
        ?.map(auction => presentAuction(auction, viewerId, now))
        .filter(auction => !auction.finished)
    : undefined;
  const visibleAuctions = myBids
    ? active?.filter(
        auction => auction.status === "leading" || auction.status === "outbid"
      )
    : active;
  const previewCards =
    showLastEdition && lastEdition
      ? lastEdition.lots
          .filter(lot => (myWonCards ? lot.bidStatus === "won" : lot.sold))
          .map(lot => lot.card)
      : (upcomingCards ?? []);
  async function changeReminder(cardId: string, enabled: boolean) {
    if (!onReminderChange || pendingReminder) return;
    setPendingReminder(cardId);
    setReminderFailed(false);
    try {
      await onReminderChange(cardId, enabled);
    } catch {
      setReminderFailed(true);
    } finally {
      setPendingReminder(undefined);
    }
  }
  function renderClosedCards(matchesCard: (card: Card) => boolean) {
    if (showLastEdition && lastEdition) {
      return (
        <LastEdition
          edition={lastEdition}
          personal={myWonCards}
          onScopeChange={setMyWonCards}
          matchesCard={matchesCard}
        />
      );
    }
    const matchingUpcoming = previewCards.filter(matchesCard);
    return (
      <section aria-labelledby="black-market-preview-title">
        <h2
          id="black-market-preview-title"
          className={
            hasEditionTabs ? "sr-only" : "yk-black-market-preview-title"
          }
        >
          {t("upcomingCards")}
        </h2>
        {reminderFailed && (
          <p role="alert" className="yk-black-market-section-notice">
            {t("reminderError")}
          </p>
        )}
        {matchingUpcoming.length ? (
          <ul className="yk-card-grid yk-market-list yk-black-market-compact-grid">
            {matchingUpcoming.map((card, index) => {
              const enabled =
                activity?.reminderCardIds.includes(card.id) ?? false;
              return (
                <li key={`${card.id}:${index}`} className="yk-market-tile">
                  <CardShell interactive={false}>
                    <YokaiCard
                      {...card}
                      animated={false}
                      className="yk-panini-missing-card"
                      imageSizes={GRID_CARD_IMAGE_SIZES}
                    />
                  </CardShell>
                  {onReminderChange && activity && (
                    <Button
                      variant={enabled ? "danger" : "secondary"}
                      className="yk-black-market-reminder"
                      aria-label={t("remindCard", { name: card.name })}
                      aria-pressed={enabled}
                      disabled={pendingReminder !== undefined}
                      onClick={() => void changeReminder(card.id, !enabled)}
                    >
                      <NotificationBellIcon size={16} filled={enabled} />
                      <span>
                        {t(
                          pendingReminder === card.id
                            ? "reminderSaving"
                            : enabled
                              ? "reminderOn"
                              : "remindMe"
                        )}
                      </span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p role="status" className="text-sm text-ink-2">
            {upcomingCards?.length
              ? catalogue("noCardsMatchTheseFilters")
              : t("noUpcomingCards")}
          </p>
        )}
      </section>
    );
  }
  const market = (
    <MarketView
      browseOnly
      sharedDeadline
      cardPreview={
        showAuctions
          ? undefined
          : { cards: previewCards, render: renderClosedCards }
      }
      browseHeading={
        <BidScope
          personal={myBids}
          onChange={setMyBids}
          allLabel={tm("labelBrowse")}
        />
      }
      browseEmpty={myBids ? t("noMyBids") : undefined}
      rarityOptions={["LR", "SSR"]}
      lists={
        visibleAuctions
          ? { active: visibleAuctions, mine: [], won: [], sold: [] }
          : undefined
      }
    />
  );
  return (
    <main
      id="main-content"
      className="yk-black-market"
      data-market-closed={!open || undefined}
    >
      <div className="yk-card-browse-page yk-black-market-content mx-auto">
        <Link href="/events" className="yk-black-market-back">
          <span aria-hidden="true">←</span> {t("back")}
        </Link>
        <header className="yk-black-market-hero">
          <h1>{t("title")}</h1>
          <p className="yk-black-market-intro">{t("tagline")}</p>
          {deadline && (
            <div className="yk-black-market-edition-clock">
              <EventBannerClockIcon />
              <span>{t(upcoming ? "opensIn" : "endsIn")}</span>
              <EventBannerCountdown end={deadline} now={now} />
            </div>
          )}
        </header>
        <div className="yk-black-market-board">
          {notice && (
            <p role="status" className="mb-4 text-sm text-ink-2">
              {notice}
            </p>
          )}
          {activityFailed && !open && (
            <p role="status" className="yk-black-market-section-notice">
              {t("activityUnavailable")}
            </p>
          )}
          {hasEditionTabs ? (
            <>
              <div
                className="yk-tabs yk-black-market-edition-tabs"
                role="tablist"
                aria-label={t("editionTabs")}
                onKeyDown={event => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key
                    )
                  )
                    return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "current"
                      : event.key === "End"
                        ? "last"
                        : editionTab === "current"
                          ? "last"
                          : "current";
                  setSelectedEdition(next);
                  event.currentTarget
                    .querySelector<HTMLButtonElement>(
                      `#black-market-edition-tab-${next}`
                    )
                    ?.focus();
                }}
              >
                {editionTabs.map(({ id, label }) => (
                  <button
                    key={id}
                    id={`black-market-edition-tab-${id}`}
                    type="button"
                    role="tab"
                    className="yk-tab"
                    aria-selected={editionTab === id}
                    aria-controls={`black-market-edition-panel-${id}`}
                    tabIndex={editionTab === id ? 0 : -1}
                    onClick={() => setSelectedEdition(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {editionTabs.map(({ id }) => (
                <div
                  key={id}
                  id={`black-market-edition-panel-${id}`}
                  role="tabpanel"
                  aria-labelledby={`black-market-edition-tab-${id}`}
                  hidden={editionTab !== id}
                >
                  {editionTab === id && market}
                </div>
              ))}
            </>
          ) : (
            (hasCurrentEdition || lastEdition) && market
          )}
        </div>
      </div>
    </main>
  );
}
