"use client";
import { useSyncExternalStore } from "react";
import { i18nEnabled } from "@/i18n/locale";
const subscribeToHydration = () => () => {};
import { socialErrorKey as gameErrorKey } from "@/i18n/social-messages";
import { useTranslations, useFormatter } from "next-intl";

import { cardRarityLabel } from "@/lib/ui/card-rarity-label";
import { startVisiblePolling } from "@/lib/ui/visible-polling";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Chip,
  Feedback,
  Karas,
  Modal,
  StatusPill,
  Skeleton,
  Tabs
} from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import { CardFranchise } from "@/components/card-franchise";
import { TradeCollectionBrowser } from "@/components/trade-collection-browser";
import {
  getFriendships,
  getFriendshipsPage,
  groupFriendships,
  friendshipItems,
  type FriendUser
} from "@/lib/data/friends";
import {
  cancelTradeOffer,
  counterTradeDraft,
  createTradeOffer,
  filterTradeOffers,
  getTradeContext,
  hasNewAcceptedTrade,
  listTradeOffers,
  listTradeOffersPage,
  loadTradeContextIfCurrent,
  respondTradeOffer,
  resolveTradeReview,
  runTradeCancellation,
  tradeStatusPresentation,
  tradeOfferIsActionable,
  tradeSubmission,
  tryStartTradeSubmission,
  type TradeContext,
  type TradeOffer
} from "@/lib/data/trades";
import {
  invalidatePlayerSnapshots,
  type CollectedCard,
  type Rarity
} from "@/lib/data/cards";
import {
  groupCollection,
  pruneUnavailableSelection,
  selectGroupQuantity,
  type CollectionGroup
} from "@/lib/ui/collection-groups";
import {
  tradeOwnershipIndex,
  type OwnedTradeVariant
} from "@/lib/ui/trade-ownership";

import { createDemandPager } from "@/lib/data/demand-pages";

const rarityText: Record<Rarity, string> = {
  C: "text-rarity-c",
  R: "text-rarity-r",
  SR: "text-rarity-sr",
  SSR: "text-rarity-ssr",
  LR: "text-rarity-lr"
};

function TradeCardControls({
  group,
  ownedCount,
  selected,
  onChange
}: {
  group: CollectionGroup;
  ownedCount: number;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const t = useTranslations();
  const quantity = group.cards.filter(card =>
    selected.has(card.instanceId)
  ).length;
  return (
    <div
      className="yk-trade-picker-controls"
      data-selected={quantity > 0}
      data-group-key={group.key}
    >
      <div
        className="yk-trade-quantity"
        aria-label={t("socialUi.copiesOf", { name: group.representative.name })}
      >
        <button
          type="button"
          disabled={quantity === 0}
          aria-label={t("socialUi.removeCopy", {
            name: group.representative.name
          })}
          onClick={() =>
            onChange(selectGroupQuantity(selected, group.cards, quantity - 1))
          }
        >
          −
        </button>
        <output aria-live="polite">{quantity}</output>
        <button
          type="button"
          disabled={quantity === group.cards.length}
          aria-label={t("socialUi.addCopy", {
            name: group.representative.name
          })}
          onClick={() =>
            onChange(selectGroupQuantity(selected, group.cards, quantity + 1))
          }
        >
          +
        </button>
      </div>
      {(ownedCount > 0 || group.isFirstOwner) && (
        <div className="yk-trade-picker-badges">
          {ownedCount > 0 && (
            <span className="yk-trade-ownership is-owned">
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
                <path
                  d="m4 8 2.5 2.5L12 5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>
                {t("tradeDesign.alreadyOwned", { count: ownedCount })}
              </span>
            </span>
          )}
          {group.isFirstOwner && (
            <span className="yk-trade-first-owner">
              {t("tradeDesign.firstOwnerShort")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
function CardPicker({
  open,
  onClose,
  title,
  cards,
  ownedVariants,
  selected,
  onChange
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  cards: CollectedCard[];
  ownedVariants?: readonly OwnedTradeVariant[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const tPr4 = useTranslations();
  const ownership = useMemo(
    () => (ownedVariants ? tradeOwnershipIndex(ownedVariants) : undefined),
    [ownedVariants]
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      className="yk-trade-picker-modal yk-trade-collection-picker yk-friend-collection-modal yk-friend-card-grid-modal"
    >
      <TradeCollectionBrowser
        cards={cards}
        renderCardControls={group => (
          <TradeCardControls
            group={group}
            ownedCount={ownership?.variants.get(group.key) ?? 0}
            selected={selected}
            onChange={onChange}
          />
        )}
      />
      <footer className="yk-trade-picker-footer">
        <span>{tPr4("socialUi.selectedCopies", { count: selected.size })}</span>
        <Button onClick={onClose}>{tPr4("socialUi.confirmSelection")}</Button>
      </footer>
    </Modal>
  );
}

function OfferCards({ cards }: { cards: CollectedCard[] }) {
  return <ReviewCards cards={cards} />;
}
function ReviewCards({ cards }: { cards: CollectedCard[] }) {
  const tPr4 = useTranslations();
  return cards.length ? (
    <div className="yk-trade-lot-grid">
      <div className="yk-trade-review-cards">
        {groupCollection(cards).map(group => {
          const card =
            group.cards.find(copy => copy.customImageUrl) ??
            group.representative;
          return (
            <div
              key={group.key}
              className="yk-trade-card-row"
              data-rarity={card.rarity}
            >
              <div className="yk-trade-card-art">
                <YokaiCard
                  {...card}
                  image={card.customImageUrl ?? card.image}
                  fallbackImage={card.catalogueImage}
                  animated={false}
                  imageSizes="100vw"
                />
                {group.cards.length > 1 && <span>×{group.cards.length}</span>}
              </div>
              <div className="yk-trade-card-info">
                <span className={`yk-trade-rarity ${rarityText[card.rarity]}`}>
                  {cardRarityLabel(card.rarity, card.shiny, card.isEvolved)}
                </span>
                <strong>{card.name}</strong>
                <CardFranchise card={card} className="yk-trade-card-license" />
                {card.customImageUrl && (
                  <small>{tPr4("socialUi.customImage")}</small>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : (
    <p className="mt-3 text-xs text-ink-3">{tPr4("socialUi.noCards")}</p>
  );
}
type TradeTab = "compose" | "received" | "sent" | "history";

// Serialize refreshes around mutations. A read started before accept/cancel
// must never restore Pending after the server has committed the action.
function createTradeOfferReader(
  pager: ReturnType<typeof createDemandPager<TradeOffer>>
) {
  type Page = {
    items: TradeOffer[];
    nextCursor: Record<string, unknown> | null;
  };
  let revision = 0;
  let snapshot: Page = { items: [], nextCursor: null };
  let pending: { revision: number; promise: Promise<Page> } | undefined;
  function read(more = false): Promise<Page> {
    if (!more && pending?.revision === revision) return pending.promise;
    const epoch = revision;
    const previous = pending?.promise;
    const promise: Promise<Page> = (async () => {
      if (previous)
        await previous.then(
          () => undefined,
          () => undefined
        );
      try {
        const page = await (more ? pager.more() : pager.refresh());
        if (epoch === revision) snapshot = page;
        return snapshot;
      } catch (error) {
        if (epoch !== revision) return snapshot;
        throw error;
      }
    })().finally(() => {
      if (pending?.promise === promise) pending = undefined;
    });
    pending = { revision: epoch, promise };
    return promise;
  }
  return {
    read,
    invalidate: () => {
      revision++;
    },
    commit: (items: TradeOffer[]) => {
      revision++;
      snapshot = { ...snapshot, items };
    }
  };
}

function OfferList({
  offers,
  busy,
  onReview,
  onCancel,
  onAccept,
  onDecline,
  onCounter
}: {
  offers: TradeOffer[];
  busy?: boolean;
  onReview?: (offer: TradeOffer) => void;
  onCancel?: (offer: TradeOffer) => void;
  onAccept?: (offer: TradeOffer) => void;
  onDecline?: (offer: TradeOffer) => void;
  onCounter?: (offer: TradeOffer) => void;
}) {
  const tPr4 = useTranslations();
  const fmt = useFormatter();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );
  if (!offers.length)
    return (
      <div className="yk-social-empty">
        <span className="yk-social-empty-icon" aria-hidden="true">
          ⇄
        </span>
        <strong>{tPr4("socialUi.noTradeOffers")}</strong>
        <p>{tPr4("socialUi.tradeOffersForThisTabWillAppear")}</p>
      </div>
    );
  return (
    <div className="yk-trade-history">
      {offers.map(offer => (
        <article
          key={offer.id}
          className="yk-trade-offer"
          data-trade-status={offer.status}
        >
          <header>
            <Avatar
              name={
                offer.incoming
                  ? offer.fromUser === null
                    ? tPr4("profileUi.deletedPlayer")
                    : offer.fromPseudo
                  : offer.toUser === null
                    ? tPr4("profileUi.deletedPlayer")
                    : offer.toPseudo
              }
              image={
                (offer.incoming ? offer.fromAvatarUrl : offer.toAvatarUrl) ??
                undefined
              }
              size={36}
            />
            <div className="yk-trade-offer-person">
              <strong>
                {offer.incoming
                  ? offer.fromUser === null
                    ? tPr4("profileUi.deletedPlayer")
                    : offer.fromPseudo
                  : offer.toUser === null
                    ? tPr4("profileUi.deletedPlayer")
                    : offer.toPseudo}
              </strong>
              <p>
                {offer.incoming
                  ? tPr4("socialUi.offerReceived")
                  : tPr4("socialUi.offerSent")}{" "}
                ·{" "}
                {i18nEnabled()
                  ? hydrated
                    ? fmt.dateTime(new Date(offer.createdAt), {
                        year: "numeric",
                        month: "numeric",
                        day: "numeric",
                        hour: "numeric",
                        minute: "numeric",
                        second: "numeric",
                        timeZone:
                          Intl.DateTimeFormat().resolvedOptions().timeZone
                      })
                    : "—"
                  : new Date(offer.createdAt).toLocaleString("en-US")}
              </p>
            </div>
            <StatusPill tone={tradeStatusPresentation(offer.status).tone}>
              {tPr4(`socialUi.tradeStatus${offer.status}`)}
            </StatusPill>
          </header>
          <div className="yk-trade-offer-sides">
            <div className="is-offered">
              <div className="yk-trade-lot-heading">
                <span aria-hidden="true">↗</span>
                <strong>{tPr4("socialUi.youGive")}</strong>
                <small>
                  {tPr4("tradeDesign.cardCount", {
                    count: (offer.incoming
                      ? offer.requestedCards
                      : offer.offeredCards
                    ).length
                  })}
                </small>
              </div>
              <p className="yk-trade-lot-owner">
                {tPr4("socialUi.gives", {
                  name:
                    (offer.incoming ? offer.toUser : offer.fromUser) === null
                      ? tPr4("profileUi.deletedPlayer")
                      : offer.incoming
                        ? offer.toPseudo
                        : offer.fromPseudo
                })}
              </p>
              <OfferCards
                cards={
                  offer.incoming ? offer.requestedCards : offer.offeredCards
                }
              />
              <div className="yk-trade-lot-currency">
                <Karas
                  amount={
                    offer.incoming ? offer.requestedKaras : offer.offeredKaras
                  }
                />
              </div>
            </div>
            <div className="is-requested">
              <div className="yk-trade-lot-heading">
                <span aria-hidden="true">↙</span>
                <strong>{tPr4("socialUi.youReceive")}</strong>
                <small>
                  {tPr4("tradeDesign.cardCount", {
                    count: (offer.incoming
                      ? offer.offeredCards
                      : offer.requestedCards
                    ).length
                  })}
                </small>
              </div>
              <p className="yk-trade-lot-owner">
                {tPr4("socialUi.gives", {
                  name:
                    (offer.incoming ? offer.fromUser : offer.toUser) === null
                      ? tPr4("profileUi.deletedPlayer")
                      : offer.incoming
                        ? offer.fromPseudo
                        : offer.toPseudo
                })}
              </p>
              <OfferCards
                cards={
                  offer.incoming ? offer.offeredCards : offer.requestedCards
                }
              />
              <div className="yk-trade-lot-currency">
                <Karas
                  amount={
                    offer.incoming ? offer.offeredKaras : offer.requestedKaras
                  }
                />
              </div>
            </div>
          </div>
          {(onReview || onCancel || onAccept || onDecline || onCounter) && (
            <footer>
              {onAccept && offer.incoming && offer.status === "pending" ? (
                <>
                  <Button
                    className="yk-trade-accept"
                    disabled={busy}
                    aria-busy={busy || undefined}
                    onClick={() => onAccept(offer)}
                  >
                    {tPr4("profileUi.accept")}
                  </Button>
                  {onCounter && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onCounter(offer)}
                    >
                      {tPr4("socialUi.counteroffer")}
                    </Button>
                  )}
                  {onDecline && (
                    <Button
                      className="yk-trade-decline"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onDecline(offer)}
                    >
                      {tPr4("profileUi.decline")}
                    </Button>
                  )}
                </>
              ) : (
                onReview && (
                  <Button onClick={() => onReview(offer)}>
                    {tPr4("socialUi.reviewTrade")}
                  </Button>
                )
              )}
              {onCancel && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onCancel(offer)}
                >
                  {tPr4("socialUi.cancelOffer")}
                </Button>
              )}
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}

function TradeReview({
  offer,
  busy,
  onAccept,
  onDecline,
  onCounter,
  onCancel,
  onClose
}: {
  offer?: TradeOffer;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const tPr4 = useTranslations();
  const presentation = tradeStatusPresentation(offer?.status);
  const actionable = offer?.incoming && offer.status === "pending";
  const cancellable = offer && !offer.incoming && offer.status === "pending";
  return (
    <section className="yk-trade-review">
      <header>
        <p className="eyebrow">
          {offer
            ? tPr4("socialUi.tradeWith", {
                name: offer.incoming
                  ? offer.fromUser === null
                    ? tPr4("profileUi.deletedPlayer")
                    : offer.fromPseudo
                  : offer.toUser === null
                    ? tPr4("profileUi.deletedPlayer")
                    : offer.toPseudo
              })
            : tPr4("socialUi.offreIntrouvable")}
        </p>
        <StatusPill tone={presentation.tone}>
          {tPr4(`socialUi.tradeStatus${offer?.status ?? "unavailable"}`)}
        </StatusPill>
      </header>
      {offer ? (
        <>
          <p className="mt-4 text-sm text-ink-2">
            {offer.status === "accepted"
              ? tPr4("socialUi.thisTradeWasAcceptedHereSWhat")
              : offer.status === "declined"
                ? tPr4("socialUi.thisOfferWasDeclined")
                : offer.status === "countered"
                  ? tPr4("socialUi.aCounterofferReplacedThisOffer")
                  : offer.status === "cancelled"
                    ? tPr4("socialUi.thisOfferWasCanceled")
                    : offer.status === "pending"
                      ? tPr4("socialUi.reviewBothSidesBeforeResponding")
                      : tPr4("socialUi.thisOfferIsNoLongerAvailable")}
          </p>
          <div className="yk-trade-review-lots">
            <article className="is-offered">
              <h3>{tPr4("socialUi.whatYouGive")}</h3>
              <OfferCards
                cards={
                  offer.incoming ? offer.requestedCards : offer.offeredCards
                }
              />
              <Karas
                amount={
                  offer.incoming ? offer.requestedKaras : offer.offeredKaras
                }
              />
            </article>
            <article className="is-requested">
              <h3>{tPr4("socialUi.whatYouReceive")}</h3>
              <OfferCards
                cards={
                  offer.incoming ? offer.offeredCards : offer.requestedCards
                }
              />
              <Karas
                amount={
                  offer.incoming ? offer.offeredKaras : offer.requestedKaras
                }
              />
            </article>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-ink-2">
          {tPr4("socialUi.thisOfferCouldnTBeFoundOr")}
        </p>
      )}
      <footer>
        {actionable && (
          <>
            <Button
              className="yk-trade-accept"
              disabled={busy}
              onClick={onAccept}
            >
              {tPr4("profileUi.accept")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onCounter}>
              {tPr4("socialUi.counteroffer")}
            </Button>
            <Button
              className="yk-trade-decline"
              variant="secondary"
              disabled={busy}
              onClick={onDecline}
            >
              {tPr4("profileUi.decline")}
            </Button>
          </>
        )}
        {cancellable && (
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {tPr4("socialUi.cancelOffer")}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          {tPr4("collectionUi.close")}
        </Button>
      </footer>
    </section>
  );
}

export type TradesPanelAdapter = {
  friendships: typeof getFriendships;
  listOffers: typeof listTradeOffers;
  context: typeof getTradeContext;
  create: typeof createTradeOffer;
  cancel: typeof cancelTradeOffer;
  respond: typeof respondTradeOffer;
};
const defaultAdapter: TradesPanelAdapter = {
  friendships: getFriendships,
  listOffers: listTradeOffers,
  context: getTradeContext,
  create: createTradeOffer,
  cancel: cancelTradeOffer,
  respond: respondTradeOffer
};
// #388: offers are not a live chat; actions and accepted-trade invalidations
// cover the rest.
export const TRADE_POLL_INTERVAL_MS = 30_000;
export function TradesPanel({
  adapter = defaultAdapter,
  pollIntervalMs = TRADE_POLL_INTERVAL_MS,
  initialFriendId: requestedInitialFriendId,
  fixedFriendId,
  initialRequestedCardId,
  initialOfferId,
  onOfferSent
}: {
  adapter?: TradesPanelAdapter;
  pollIntervalMs?: number | null;
  initialFriendId?: string;
  fixedFriendId?: string;
  initialRequestedCardId?: string;
  initialOfferId?: string;
  onOfferSent?: () => void;
} = {}) {
  const t = useTranslations("socialTrades");
  const tPr4 = useTranslations();
  const initialFriendId = fixedFriendId ?? requestedInitialFriendId;
  const [resolvedFixedFriend, setResolvedFixedFriend] = useState<{
    input: string;
    id: string;
  }>();
  const fixedTargetId =
    fixedFriendId &&
    (resolvedFixedFriend?.input === fixedFriendId
      ? resolvedFixedFriend.id
      : fixedFriendId);
  const offerPager = useMemo(
    () =>
      createDemandPager(
        adapter === defaultAdapter
          ? listTradeOffersPage
          : async () => ({
              items: await adapter.listOffers(),
              nextCursor: null
            }),
        offer => offer.id
      ),
    [adapter]
  );
  const offerReader = useMemo(
    () => createTradeOfferReader(offerPager),
    [offerPager]
  );
  const friendPager = useMemo(
    () =>
      createDemandPager(
        adapter === defaultAdapter
          ? getFriendshipsPage
          : async () => ({
              items: friendshipItems(await adapter.friendships()),
              nextCursor: null
            }),
        item => item.friend.requestId ?? item.friend.id
      ),
    [adapter]
  );
  const [offersLoading, setOffersLoading] = useState(true);
  const [hasMoreOffers, setHasMoreOffers] = useState(false);
  const [hasMoreFriends, setHasMoreFriends] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  async function readOffers(more = false) {
    const page = await (more ? offerReader.read(true) : offerReader.read());
    setHasMoreOffers(!!page.nextCursor);
    return page.items;
  }
  async function readFriends(more = false) {
    if (fixedFriendId) return { friends: [], incoming: [], outgoing: [] };
    const page = await (more ? friendPager.more() : friendPager.refresh());
    setHasMoreFriends(!!page.nextCursor);
    return groupFriendships(page.items);
  }
  async function loadMore(kind: "friends" | "offers") {
    setLoadingMore(true);
    setError("");
    try {
      if (kind === "friends") setFriends((await readFriends(true)).friends);
      else {
        const next = await readOffers(true);
        offersRef.current = next;
        setOffers(next);
      }
    } catch (e) {
      setError(
        gameErrorKey(e, gameErrorKey("Couldn't load more. Please try again."))
      );
    } finally {
      setLoadingMore(false);
    }
  }
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [friendQuery, setFriendQuery] = useState("");
  const visibleFriends = friends.filter(friend =>
    friend.pseudo
      .toLocaleLowerCase("en-US")
      .includes(friendQuery.trim().toLocaleLowerCase("en-US"))
  );
  const [offers, setOffers] = useState<TradeOffer[]>([]);
  const [tab, setTab] = useState<TradeTab>(
    initialOfferId ? "received" : "compose"
  );
  const [context, setContext] = useState<TradeContext>();
  const [friendId, setFriendId] = useState("");
  const [offered, setOffered] = useState<Set<string>>(new Set());
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<"offered" | "requested">();
  const [selectionNotice, setSelectionNotice] = useState<{
    key: string;
    count: number;
  } | null>(null);
  const [sentNotice, setSentNotice] = useState("");
  const [offeredKaras, setOfferedKaras] = useState("0");
  const [requestedKaras, setRequestedKaras] = useState("0");
  const [parent, setParent] = useState<string | null>(null);
  const [pendingFriend, setPendingFriend] = useState<{
    id: string;
    parentId: string | null;
  }>();
  const [pendingCounter, setPendingCounter] = useState<TradeOffer>();
  const [reviewedId, setReviewedId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState<TradeOffer>();
  const [cancelling, setCancelling] = useState<TradeOffer>();
  const offersRef = useRef<TradeOffer[]>([]);
  const friendIdRef = useRef("");
  const contextRequest = useRef(0);
  const preparedContext = useRef<
    { friendId: string; value: Promise<TradeContext> } | undefined
  >(undefined);
  useEffect(() => {
    if (fixedTargetId || tab !== "compose" || friendQuery.trim().length < 2)
      return;
    const matches = friends.filter(friend =>
      friend.pseudo
        .toLocaleLowerCase("en-US")
        .includes(friendQuery.trim().toLocaleLowerCase("en-US"))
    );
    if (matches.length !== 1 || matches[0].id === friendIdRef.current) return;
    const timer = window.setTimeout(() => {
      const value = adapter.context(matches[0].id);
      preparedContext.current = { friendId: matches[0].id, value };
      void value.catch(() => {});
    }, 250);
    return () => {
      window.clearTimeout(timer);
      preparedContext.current = undefined;
    };
  }, [adapter, fixedTargetId, friendQuery, friends, tab]);

  const offeredRef = useRef(offered);
  const requestedRef = useRef(requested);
  const submissionLock = useRef(false);
  const cancellationLock = useRef(false);
  const responseLock = useRef(false);
  function updateOffered(next: Set<string>) {
    offeredRef.current = next;
    setOffered(next);
  }
  function updateRequested(next: Set<string>) {
    requestedRef.current = next;
    setRequested(next);
  }
  function commitOfferStatus(id: string, status: TradeOffer["status"]) {
    const next = offersRef.current.map(offer =>
      offer.id === id ? { ...offer, status } : offer
    );
    offerReader.commit(next);
    offersRef.current = next;
    setOffers(next);
  }
  async function reload() {
    const [relations, history] = await Promise.all([
      readFriends(),
      readOffers()
    ]);
    offersRef.current = history;
    setFriends(relations.friends);
    setOffers(history);
  }
  useEffect(() => {
    let active = true;
    let loading = true;
    // Offers must remain usable even if the independent friends lookup is slow.
    if (!fixedFriendId)
      void friendPager
        .refresh()
        .then(page => {
          if (!active) return;
          setFriends(groupFriendships(page.items).friends);
          setHasMoreFriends(!!page.nextCursor);
        })
        .catch(e => {
          if (active)
            setError(e instanceof Error ? e.message : "Couldn't load trades.");
        });
    void offerReader
      .read()
      .then(page => {
        if (!active) return;
        setHasMoreOffers(!!page.nextCursor);
        offersRef.current = page.items;
        setOffers(page.items);
      })
      .catch(e => {
        if (active)
          setError(e instanceof Error ? e.message : "Couldn't load trades.");
      })
      .finally(() => {
        loading = false;
        if (active) setOffersLoading(false);
      });
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const page = await offerReader.read();
        if (!active) return;
        const history = page.items;
        setHasMoreOffers(!!page.nextCursor);
        const accepted = hasNewAcceptedTrade(offersRef.current, history);
        offersRef.current = history;
        setOffers(history);
        setAccepting(current =>
          current && tradeOfferIsActionable(current.id, history)
            ? history.find(offer => offer.id === current.id)
            : undefined
        );
        if (accepted) invalidatePlayerSnapshots(["collection", "balance"]);
        const selectedFriend = friendIdRef.current;
        if (selectedFriend) {
          const request = ++contextRequest.current;
          const nextContext = await loadTradeContextIfCurrent(
            adapter.context,
            selectedFriend,
            request,
            () => ({
              friendId: friendIdRef.current,
              requestId: contextRequest.current
            })
          );
          if (active && nextContext) {
            const nextOffered = pruneUnavailableSelection(
              offeredRef.current,
              nextContext.ownCards
            );
            const nextRequested = pruneUnavailableSelection(
              requestedRef.current,
              nextContext.friendCards
            );
            const removed =
              nextOffered.removed.length + nextRequested.removed.length;
            if (nextOffered.removed.length) {
              offeredRef.current = nextOffered.selected;
              setOffered(nextOffered.selected);
            }
            if (nextRequested.removed.length) {
              requestedRef.current = nextRequested.selected;
              setRequested(nextRequested.selected);
            }
            if (removed)
              setSelectionNotice({
                key: "socialUi.selectionRemoved",
                count: removed
              });
            setContext(nextContext);
          }
        }
      } catch (reason) {
        if (process.env.NODE_ENV !== "production")
          console.error("[trades] automatic refresh failed", reason);
      } finally {
        loading = false;
      }
    };
    const stop = pollIntervalMs
      ? startVisiblePolling(() => void refresh(), pollIntervalMs)
      : undefined;
    return () => {
      active = false;
      stop?.();
    };
  }, [adapter, pollIntervalMs, offerReader, friendPager, fixedFriendId]);
  useEffect(() => {
    if (!initialOfferId) return;
    if (
      fixedFriendId &&
      !/^[0-9a-f-]{36}$/i.test(fixedFriendId) &&
      resolvedFixedFriend?.input !== fixedFriendId
    )
      return;
    let active = true;
    void (async () => {
      let page = await offerReader.read();
      while (
        !page.items.some(offer => offer.id === initialOfferId) &&
        page.nextCursor &&
        active
      )
        page = await offerReader.read(true);
      if (active) {
        offersRef.current = page.items;
        setOffers(page.items);
        setHasMoreOffers(!!page.nextCursor);
        const offer = page.items.find(item => item.id === initialOfferId);
        if (
          offer &&
          fixedTargetId &&
          offer.fromUser !== fixedTargetId &&
          offer.toUser !== fixedTargetId
        ) {
          setError("socialTrades.unavailableOffer");
          return;
        }
        // The outer dialog is already mounted before opening its review dialog.
        if (offer)
          setTab(
            offer.status === "pending"
              ? offer.incoming
                ? "received"
                : "sent"
              : "history"
          );
        setReviewedId(initialOfferId);
      }
    })().catch(e => {
      if (active)
        setError(gameErrorKey(e, gameErrorKey("Couldn't load this offer.")));
    });
    return () => {
      active = false;
    };
  }, [
    initialOfferId,
    offerReader,
    fixedFriendId,
    fixedTargetId,
    resolvedFixedFriend?.input,
    t
  ]);
  async function chooseFriend(
    id: string,
    parentId: string | null = null,
    requestedCardId?: string
  ) {
    if (fixedTargetId && id !== fixedTargetId) return;
    friendIdRef.current = id;
    setFriendId(id);
    setParent(parentId);
    updateRequested(new Set());
    setContext(undefined);
    setSelectionNotice(null);
    setError("");
    const request = ++contextRequest.current;
    try {
      const nextContext = await loadTradeContextIfCurrent(
        adapter.context,
        id,
        request,
        () => ({
          friendId: friendIdRef.current,
          requestId: contextRequest.current
        }),
        preparedContext.current
      );
      preparedContext.current = undefined;
      if (nextContext) {
        setContext(nextContext);
        if (requestedCardId) {
          if (
            nextContext.friendCards.some(
              card => card.instanceId === requestedCardId
            )
          )
            updateRequested(new Set([requestedCardId]));
          else setError("This card is no longer available to trade.");
        }
      }
    } catch (e) {
      if (friendIdRef.current === id && contextRequest.current === request)
        setError(gameErrorKey(e, gameErrorKey("Couldn't load trades.")));
    }
  }
  function requestFriendChange(id: string, parentId: string | null = null) {
    if (fixedTargetId && id !== fixedTargetId) return;
    if (id === friendId && parentId === parent) return;
    if (requested.size) {
      setPendingFriend({ id, parentId });
      return;
    }
    void chooseFriend(id, parentId);
  }
  async function composeCounter(offer: TradeOffer) {
    if (fixedTargetId && offer.fromUser !== fixedTargetId) return;
    if (
      !offer.fromUser ||
      !tradeOfferIsActionable(offer.id, offersRef.current)
    ) {
      setError("This offer is no longer pending.");
      return;
    }
    setBusy(true);
    setError("");
    const previousFriend = friendIdRef.current;
    friendIdRef.current = "";
    const request = ++contextRequest.current;
    try {
      const nextContext = await adapter.context(offer.fromUser);
      if (contextRequest.current !== request) return;
      if (
        !offer.fromUser ||
        !tradeOfferIsActionable(offer.id, offersRef.current)
      ) {
        friendIdRef.current = previousFriend;
        setError("This offer is no longer pending.");
        return;
      }
      const draft = counterTradeDraft(offer, nextContext);
      friendIdRef.current = offer.fromUser;
      setFriendId(offer.fromUser);
      setParent(offer.id);
      setContext(nextContext);
      updateOffered(draft.offered);
      updateRequested(draft.requested);
      setOfferedKaras(draft.offeredKaras);
      setRequestedKaras(draft.requestedKaras);
      setSelectionNotice(
        draft.removed
          ? { key: "socialUi.originalRemoved", count: draft.removed }
          : null
      );
      setReviewedId(undefined);
      setTab("compose");
    } catch (e) {
      if (contextRequest.current === request) {
        friendIdRef.current = previousFriend;
        setError(
          gameErrorKey(e, gameErrorKey("Couldn't prepare the counteroffer."))
        );
      }
    } finally {
      setBusy(false);
    }
  }
  function requestCounter(offer: TradeOffer) {
    if (hasContent) {
      setPendingCounter(offer);
      return;
    }
    void composeCounter(offer);
  }
  useEffect(() => {
    if (!initialFriendId) return;
    let active = true;
    void (async () => {
      let friend: FriendUser | undefined;
      if (/^[0-9a-f-]{36}$/i.test(initialFriendId)) {
        // get_trade_context authorizes the friendship on the server. No need
        // to download every friendship before a known friend's composer.
        friend = { id: initialFriendId.toLowerCase(), pseudo: "" };
      } else {
        let page = await friendPager.refresh();
        const normalized = initialFriendId.toLocaleLowerCase("en-US");
        const match = (item: FriendUser) =>
          item.id === initialFriendId ||
          item.pseudo.toLocaleLowerCase("en-US") === normalized;
        friend = groupFriendships(page.items).friends.find(match);
        while (!friend && page.nextCursor && active) {
          page = await friendPager.more();
          setFriends(groupFriendships(page.items).friends);
          setHasMoreFriends(!!page.nextCursor);
          friend = groupFriendships(page.items).friends.find(match);
        }
      }
      if (!active) return;
      if (!friend) {
        setError("This player isn't available to trade.");
        return;
      }
      if (fixedFriendId)
        setResolvedFixedFriend({ input: fixedFriendId, id: friend.id });
      friendIdRef.current = friend.id;
      setFriendId(friend.id);
      setParent(null);
      updateRequested(new Set());
      setContext(undefined);
      setError("");
      if (initialOfferId) return;
      const request = ++contextRequest.current;
      const nextContext = await loadTradeContextIfCurrent(
        adapter.context,
        friend.id,
        request,
        () => ({
          friendId: friendIdRef.current,
          requestId: contextRequest.current
        })
      );
      if (!active || !nextContext) return;
      setContext(nextContext);
      if (initialRequestedCardId) {
        if (
          nextContext.friendCards.some(
            card => card.instanceId === initialRequestedCardId
          )
        ) {
          requestedRef.current = new Set([initialRequestedCardId]);
          setRequested(new Set([initialRequestedCardId]));
        } else setError("This card is no longer available to trade.");
      }
    })().catch(reason => {
      if (active)
        setError(
          reason instanceof Error ? reason.message : "Couldn't load trades."
        );
    });
    return () => {
      active = false;
    };
  }, [
    adapter,
    friendPager,
    initialFriendId,
    initialRequestedCardId,
    fixedFriendId,
    initialOfferId
  ]);
  async function submit() {
    if (fixedFriendId && context?.friend.id !== fixedTargetId) return;
    if (!context || !tryStartTradeSubmission(submissionLock, hasContent))
      return;
    setBusy(true);
    setError("");
    setSentNotice("");
    offerReader.invalidate();
    try {
      await adapter.create(
        tradeSubmission({
          friendId: context.friend.id,
          offered,
          offeredKaras,
          requested,
          requestedKaras,
          parent
        })
      );
      offerReader.invalidate();
      await reload().then(undefined, () =>
        setError("socialTrades.refreshFailed")
      );
      updateOffered(new Set());
      updateRequested(new Set());
      setOfferedKaras("0");
      setRequestedKaras("0");
      setPicker(undefined);
      setSelectionNotice(null);
      setContext(undefined);
      friendIdRef.current = "";
      contextRequest.current++;
      setFriendId("");
      setParent(null);
      setSentNotice("socialUi.sentNotice");
      setTab("sent");

      onOfferSent?.();
    } catch (e) {
      setError(
        gameErrorKey(
          e,
          gameErrorKey("Couldn't send this offer. Please try again.")
        )
      );
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  }
  async function respond(id: string, action: "accept" | "decline") {
    if (
      responseLock.current ||
      !offersRef.current.some(
        offer => offer.id === id && offer.incoming && offer.status === "pending"
      )
    )
      return;
    responseLock.current = true;
    offerReader.invalidate();
    setBusy(true);
    setError("");
    try {
      const accepted = await adapter.respond(id, action);
      if (action === "accept" && !accepted)
        throw new Error("This offer is no longer available.");
      commitOfferStatus(id, action === "accept" ? "accepted" : "declined");
      setAccepting(undefined);
      try {
        await reload();
      } catch {
        setError("socialTrades.refreshFailed");
      }
    } catch (e) {
      setAccepting(undefined);
      setError(gameErrorKey(e, gameErrorKey("Couldn't complete this action.")));
      try {
        await reload();
      } catch {}
    } finally {
      responseLock.current = false;
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    if (cancellationLock.current) return;
    offerReader.invalidate();
    setBusy(true);
    setError("");
    try {
      await runTradeCancellation(cancellationLock, adapter.cancel, id);
      commitOfferStatus(id, "cancelled");
      setCancelling(undefined);
      try {
        await reload();
      } catch {
        setError("socialTrades.refreshFailed");
      }
    } catch (e) {
      setCancelling(undefined);
      setError(gameErrorKey(e, gameErrorKey("Couldn't cancel this offer.")));
      try {
        await reload();
      } catch {}
    } finally {
      cancellationLock.current = false;
      setBusy(false);
    }
  }
  const scopedOffers = fixedFriendId
    ? offers.filter(
        offer =>
          offer.fromUser === fixedTargetId || offer.toUser === fixedTargetId
      )
    : offers;
  const received = filterTradeOffers(scopedOffers, "received");
  const sent = filterTradeOffers(scopedOffers, "sent");
  const history = filterTradeOffers(scopedOffers, "history");
  const hasContent =
    offered.size > 0 ||
    requested.size > 0 ||
    Number(offeredKaras) > 0 ||
    Number(requestedKaras) > 0;
  const insufficient = !!context && Number(offeredKaras) > context.balance;
  const reviewedOffer = resolveTradeReview(reviewedId, offers);
  return (
    <div
      className="yk-social-stack yk-trades-workspace"
      data-fixed-trade-friend={fixedFriendId}
    >
      <section className="yk-social-panel yk-trades-panel">
        <header className="yk-trades-masthead">
          <span className="yk-trades-mark" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="26"
              height="26"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4" />
            </svg>
          </span>
          <div>
            <h2>{tPr4("tradeDesign.title")}</h2>
            <p>{tPr4("tradeDesign.subtitle")}</p>
          </div>
          <span
            className="yk-trades-secure"
            aria-label={tPr4("tradeDesign.secure")}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
              <path d="m8 12 3 3 5-6" />
            </svg>
            {tPr4("tradeDesign.secure")}
          </span>
        </header>
        <Tabs
          label={tPr4("socialUi.tradeNavigation")}
          value={tab}
          onChange={value => {
            setTab(value as TradeTab);
            if (value === "compose" && fixedTargetId && !context)
              void chooseFriend(fixedTargetId);
          }}
          items={[
            { id: "compose", label: tPr4("socialUi.proposer") },
            {
              id: "received",
              label: tPr4("socialUi.receivedTab", {
                count: received.length,
                more: hasMoreOffers ? "yes" : "no"
              })
            },
            {
              id: "sent",
              label: tPr4("socialUi.sentTab", {
                count: sent.length,
                more: hasMoreOffers ? "yes" : "no"
              })
            },
            { id: "history", label: tPr4("socialUi.history") }
          ]}
        />
        {tab === "compose" && (
          <div role="tabpanel" aria-label={tPr4("collectionUi.offerATrade")}>
            <div className="yk-trade-heading mt-6">
              <div>
                <p className="eyebrow">{tPr4("socialUi.newOffer")}</p>
                <h2 className="yk-section-title mt-2">
                  {fixedFriendId
                    ? tPr4("socialUi.yourTrade")
                    : tPr4("socialUi.chooseAFriend")}
                </h2>
              </div>
              {context && (
                <StatusPill tone="info">
                  {tPr4("socialUi.tradeWith", { name: context.friend.pseudo })}
                </StatusPill>
              )}
            </div>
            {!fixedFriendId && (
              <input
                type="search"
                aria-label={tPr4("socialUi.rechercherUnAmi")}
                placeholder={tPr4("socialUi.rechercherUnAmi2")}
                className="auth-input mt-4"
                value={friendQuery}
                onChange={event => setFriendQuery(event.target.value)}
              />
            )}
            {!fixedFriendId && friendQuery.trim() && !visibleFriends.length && (
              <p role="status" className="mt-4 text-sm text-ink-2">
                {tPr4("socialUi.aucunAmiCorrespondantParmiLesAmisCharg")}
              </p>
            )}
            {!fixedFriendId && !!visibleFriends.length && (
              <div
                className="yk-friend-choices"
                role="group"
                aria-label={tPr4("socialUi.chooseAFriend")}
              >
                {visibleFriends.map(friend => (
                  <Chip
                    key={friend.id}
                    active={friendId === friend.id}
                    className="min-h-11 pl-1.5 pr-4"
                    onClick={() => requestFriendChange(friend.id)}
                  >
                    <Avatar
                      name={friend.pseudo}
                      image={friend.avatarUrl ?? undefined}
                      online={friend.isOnline}
                      size={30}
                    />
                    <span className="yk-trade-friend-name">
                      {friend.pseudo}
                    </span>
                  </Chip>
                ))}
              </div>
            )}
            {!fixedFriendId && hasMoreFriends && (
              <Button
                variant="secondary"
                disabled={loadingMore}
                onClick={() => void loadMore("friends")}
              >
                {loadingMore
                  ? tPr4("packs.loading")
                  : tPr4("socialUi.loadMoreFriends")}
              </Button>
            )}
            {!fixedFriendId && !!friends.length && !hasMoreFriends && (
              <p role="status" className="sr-only">
                {tPr4("socialUi.allFriendsLoaded")}
              </p>
            )}
            {!fixedFriendId && !friends.length && (
              <div className="yk-social-empty is-compact">
                <strong>{tPr4("socialUi.noFriendsAvailable")}</strong>
                <span>{tPr4("socialUi.addAFriendFromTheFriendsPage")}</span>
              </div>
            )}
            {friendId && !context && !error && (
              <div className="yk-trade-columns mt-6" aria-busy="true">
                <Skeleton
                  label={tPr4("collectionUi.loadingYourCards")}
                  className="h-80 w-full rounded-panel"
                />
                <Skeleton
                  label={tPr4("collectionUi.loadingYourCards")}
                  className="h-80 w-full rounded-panel"
                />
              </div>
            )}
            {context && (
              <div className="yk-trade-composer">
                <div className="yk-trade-columns">
                  <section className="yk-trade-side is-offered">
                    <header>
                      <span className="yk-trade-side-index" aria-hidden="true">
                        ↗
                      </span>
                      <div>
                        <p>{tPr4("socialUi.youGive")}</p>
                        <small>
                          {tPr4("socialUi.ownSelection", {
                            count: offered.size
                          })}
                        </small>
                      </div>
                    </header>
                    <div
                      className="yk-trade-drop"
                      data-instance-ids={[...offered].join(",")}
                    >
                      <OfferCards
                        cards={context.ownCards.filter(card =>
                          offered.has(card.instanceId)
                        )}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => setPicker("offered")}
                    >
                      {tPr4("socialUi.addCardsFromMyCollection")}
                    </Button>
                    <label className="yk-trade-karas">
                      {tPr4("socialUi.karasToOffer")}
                      <Karas amount={context.balance} />
                      <input
                        type="number"
                        min="0"
                        max={context.balance}
                        aria-invalid={insufficient}
                        value={offeredKaras}
                        onChange={e => setOfferedKaras(e.target.value)}
                        className="auth-input"
                      />
                    </label>
                    {insufficient && (
                      <p role="alert" className="yk-inline-error">
                        {tPr4("socialUi.balanceShort", {
                          balance: context.balance
                        })}
                      </p>
                    )}
                  </section>
                  <section className="yk-trade-side is-requested">
                    <header>
                      <span className="yk-trade-side-index" aria-hidden="true">
                        ↙
                      </span>
                      <div>
                        <p>{tPr4("socialUi.youReceive")}</p>
                        <small>
                          {tPr4("socialUi.friendSelection", {
                            name: context.friend.pseudo,
                            count: requested.size
                          })}
                        </small>
                      </div>
                    </header>
                    <div
                      className="yk-trade-drop"
                      data-instance-ids={[...requested].join(",")}
                    >
                      <OfferCards
                        cards={context.friendCards.filter(card =>
                          requested.has(card.instanceId)
                        )}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => setPicker("requested")}
                    >
                      {tPr4("socialUi.browseFriend", {
                        name: context.friend.pseudo
                      })}
                    </Button>
                    <label className="yk-trade-karas">
                      {tPr4("socialUi.karasToRequest")}
                      <input
                        type="number"
                        min="0"
                        value={requestedKaras}
                        onChange={e => setRequestedKaras(e.target.value)}
                        className="auth-input"
                      />
                    </label>
                  </section>
                </div>
                {selectionNotice && (
                  <p role="alert" className="yk-social-alert mt-5">
                    {tPr4(selectionNotice.key, {
                      count: selectionNotice.count
                    })}
                  </p>
                )}
                <footer className="yk-trade-submit">
                  <p>{tPr4("socialUi.cardOwnershipWillBeCheckedAgainWhen")}</p>
                  <Button
                    aria-busy={busy || undefined}
                    disabled={busy || !hasContent || insufficient}
                    onClick={() => void submit()}
                  >
                    {busy
                      ? tPr4("collectionShared.sending")
                      : parent
                        ? tPr4("socialUi.sendCounteroffer")
                        : tPr4("socialUi.sendOffer")}
                  </Button>
                </footer>
              </div>
            )}
          </div>
        )}
        {tab !== "compose" && (
          <div
            role="tabpanel"
            aria-label={
              tab === "received"
                ? tPr4("socialUi.receivedOffers")
                : tab === "sent"
                  ? tPr4("socialUi.sentOffers")
                  : tPr4("socialUi.tradeHistory")
            }
          >
            {tab === "sent" && sentNotice && (
              <Feedback tone="success" title={tPr4("socialUi.offerSent")}>
                {tPr4(sentNotice)}
              </Feedback>
            )}
            <div className="yk-trade-history-head mt-6">
              <div>
                <p className="eyebrow">
                  {tab === "history"
                    ? tPr4("socialUi.history")
                    : tPr4("socialUi.active")}
                </p>
                <h2 className="yk-section-title mt-2">
                  {tab === "received"
                    ? tPr4("socialUi.receivedOffers")
                    : tab === "sent"
                      ? tPr4("socialUi.sentOffers")
                      : tPr4("socialUi.completedTrades")}
                </h2>
              </div>
            </div>
            {offersLoading ? (
              <p role="status">{t("loadingOffers")}</p>
            ) : (
              <OfferList
                offers={
                  tab === "received"
                    ? received
                    : tab === "sent"
                      ? sent
                      : history
                }
                busy={busy}
                onReview={offer => setReviewedId(offer.id)}
                onCancel={tab === "sent" ? setCancelling : undefined}
                onAccept={
                  tab === "received"
                    ? offer => void respond(offer.id, "accept")
                    : undefined
                }
                onDecline={
                  tab === "received"
                    ? offer => void respond(offer.id, "decline")
                    : undefined
                }
                onCounter={tab === "received" ? requestCounter : undefined}
              />
            )}
            {hasMoreOffers && (
              <Button
                variant="secondary"
                disabled={loadingMore}
                onClick={() => void loadMore("offers")}
              >
                {loadingMore
                  ? tPr4("packs.loading")
                  : tPr4("profileUi.loadMore")}
              </Button>
            )}
            {!hasMoreOffers && (
              <p role="status" className="sr-only">
                {tPr4("socialUi.allOffersLoaded")}
              </p>
            )}
          </div>
        )}
      </section>
      {error && (
        <p role="alert" className="yk-social-alert">
          {tPr4(gameErrorKey(error, "socialUi.couldnTLoadTrades"))}
        </p>
      )}
      <Modal
        open={!!reviewedId}
        onClose={() => setReviewedId(undefined)}
        title={tPr4("socialUi.reviewTrade")}
        className="yk-trade-review-modal"
      >
        <TradeReview
          offer={reviewedOffer}
          busy={busy}
          onClose={() => setReviewedId(undefined)}
          onAccept={() => reviewedOffer && setAccepting(reviewedOffer)}
          onDecline={() =>
            reviewedOffer && void respond(reviewedOffer.id, "decline")
          }
          onCounter={() => reviewedOffer && requestCounter(reviewedOffer)}
          onCancel={() => reviewedOffer && setCancelling(reviewedOffer)}
        />
        {error && (
          <p role="alert" className="yk-social-alert mt-4">
            {tPr4(gameErrorKey(error, "socialUi.couldnTLoadTrades"))}
          </p>
        )}
      </Modal>
      {context && (
        <>
          <CardPicker
            open={picker === "offered"}
            onClose={() => setPicker(undefined)}
            title={tPr4("socialUi.chooseFromYourCollection")}
            cards={context.ownCards}
            selected={offered}
            onChange={updateOffered}
          />
          <CardPicker
            open={picker === "requested"}
            onClose={() => setPicker(undefined)}
            title={tPr4("socialUi.chooseFriendCards", {
              name: context.friend.pseudo
            })}
            cards={context.friendCards}
            ownedVariants={context.ownedVariants ?? context.ownCards}
            selected={requested}
            onChange={updateRequested}
          />
        </>
      )}
      <Modal
        open={!!pendingFriend}
        onClose={() => setPendingFriend(undefined)}
        title={tPr4("socialUi.changeFriend")}
        className="max-w-lg"
      >
        <p className="text-sm leading-6 text-ink-2">
          {tPr4("socialUi.theRequestedCardsBelongToYourCurrent")}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setPendingFriend(undefined)}
          >
            {tPr4("packs.cancel")}
          </Button>
          <Button
            onClick={() => {
              const next = pendingFriend;
              setPendingFriend(undefined);
              if (next) void chooseFriend(next.id, next.parentId);
            }}
          >
            {tPr4("socialUi.changeFriend2")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!pendingCounter}
        onClose={() => setPendingCounter(undefined)}
        title={tPr4("socialUi.replaceDraft")}
        className="max-w-lg"
      >
        <p className="text-sm leading-6 text-ink-2">
          {tPr4("socialUi.preparingThisCounterofferWillReplaceTheFriend")}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setPendingCounter(undefined)}
          >
            {tPr4("socialUi.keepMyDraft")}
          </Button>
          <Button
            onClick={() => {
              const offer = pendingCounter;
              setPendingCounter(undefined);
              if (offer) void composeCounter(offer);
            }}
          >
            {tPr4("socialUi.replaceAndContinue")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!accepting}
        onClose={() => setAccepting(undefined)}
        title={tPr4("socialUi.thisCanTBeUndone")}
        className="yk-trade-review-modal yk-trade-accept-modal"
      >
        <p className="text-sm leading-6 text-ink-2">
          {tPr4("socialUi.acceptingWillTransferTheCardsAndKaras")}
        </p>
        {accepting && (
          <div className="yk-trade-confirm yk-trade-review-lots">
            <article className="is-offered">
              <h3>{tPr4("socialUi.youGive")}</h3>
              <OfferCards cards={accepting.requestedCards} />
              {accepting.requestedKaras > 0 && (
                <Karas amount={accepting.requestedKaras} />
              )}
            </article>
            <article className="is-requested">
              <h3>{tPr4("socialUi.youReceive")}</h3>
              <OfferCards cards={accepting.offeredCards} />
              {accepting.offeredKaras > 0 && (
                <Karas amount={accepting.offeredKaras} />
              )}
            </article>
          </div>
        )}
        <div className="yk-trade-confirm-actions">
          <Button variant="secondary" onClick={() => setAccepting(undefined)}>
            {tPr4("packs.cancel")}
          </Button>
          <Button
            className="yk-trade-accept"
            disabled={busy}
            onClick={() => accepting && void respond(accepting.id, "accept")}
          >
            {busy ? tPr4("socialUi.accepting") : tPr4("socialUi.confirmTrade")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!cancelling}
        onClose={() => setCancelling(undefined)}
        title={tPr4("socialUi.cancelThisOffer")}
        className="max-w-lg"
      >
        <p className="text-sm leading-6 text-ink-2">
          {tPr4("socialUi.thisOfferWillBeRemovedFromPending")}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setCancelling(undefined)}
          >
            {tPr4("socialUi.keepOffer")}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => cancelling && void cancel(cancelling.id)}
          >
            {busy ? tPr4("profileUi.canceling") : tPr4("socialUi.cancelOffer")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
