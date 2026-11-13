import type { PageCursor, RpcPage } from "@/lib/data/demand-pages";
import { createClient } from "@/utils/supabase/client";
import { readRpcPages } from "@/lib/data/rpc-pages.mjs";
import tradeLimitsEnglish from "@/messages/trade-limits/en.json";
import tradeLimitsFrench from "@/messages/trade-limits/fr.json";
import type { OwnedTradeVariant } from "@/lib/ui/trade-ownership";
import {
  invalidatePlayerSnapshots,
  withLiveCardFranchises,
  type CollectedCard
} from "@/lib/data/cards";

export type TradeContext = {
  friend: { id: string; pseudo: string; avatarUrl?: string | null };
  balance: number;
  ownCards: CollectedCard[];
  friendCards: CollectedCard[];
  ownedVariants?: OwnedTradeVariant[];
};
export type TradeOffer = {
  id: string;
  fromUser: string | null;
  toUser: string | null;
  fromPseudo: string;
  fromAvatarUrl?: string | null;
  toPseudo: string;
  toAvatarUrl?: string | null;
  incoming: boolean;
  offeredCards: CollectedCard[];
  offeredKaras: number;
  requestedCards: CollectedCard[];
  requestedKaras: number;
  status:
    | "pending"
    | "accepted"
    | "declined"
    | "countered"
    | "cancelled"
    | "quarantined";
  parentOfferId: string | null;
  createdAt: string;
};
export type TradeOfferTab = "received" | "sent" | "history";
export function filterTradeOffers(
  offers: readonly TradeOffer[],
  tab: TradeOfferTab
) {
  return offers.filter(offer =>
    tab === "history"
      ? offer.status !== "pending" && offer.status !== "quarantined"
      : (offer.status === "pending" || offer.status === "quarantined") &&
        offer.incoming === (tab === "received")
  );
}
export async function loadTradeContextIfCurrent<T>(
  load: (friendId: string) => Promise<T>,
  friendId: string,
  requestId: number,
  current: () => { friendId: string; requestId: number },
  prepared?: { friendId: string; value: Promise<T> }
) {
  const context = await (prepared?.friendId === friendId ? prepared.value : load(friendId));
  const latest = current();
  return latest.friendId === friendId && latest.requestId === requestId
    ? context
    : undefined;
}
export function hasNewAcceptedTrade(
  previous: readonly TradeOffer[],
  next: readonly TradeOffer[]
) {
  const statuses = new Map(previous.map(offer => [offer.id, offer.status]));
  return next.some(
    offer =>
      offer.status === "accepted" &&
      ["pending", "quarantined"].includes(statuses.get(offer.id) ?? "")
  );
}
export function tradeSubmission(input: {
  friendId: string;
  offered: ReadonlySet<string>;
  offeredKaras: string;
  requested: ReadonlySet<string>;
  requestedKaras: string;
  parent: string | null;
}) {
  return {
    toUser: input.friendId,
    offeredCardIds: [...input.offered],
    offeredKaras: Number(input.offeredKaras) || 0,
    requestedCardIds: [...input.requested],
    requestedKaras: Number(input.requestedKaras) || 0,
    parentOfferId: input.parent
  };
}
export function tryStartTradeSubmission(
  lock: { current: boolean },
  hasContent: boolean
) {
  if (lock.current || !hasContent) return false;
  lock.current = true;
  return true;
}
export async function runTradeCancellation(
  lock: { current: boolean },
  cancel: (id: string) => Promise<unknown>,
  id: string
) {
  if (lock.current) return false;
  lock.current = true;
  try {
    await cancel(id);
    return true;
  } finally {
    lock.current = false;
  }
}
export function counterTradeDraft(
  offer: Pick<
    TradeOffer,
    "offeredCards" | "offeredKaras" | "requestedCards" | "requestedKaras"
  >,
  context: Pick<TradeContext, "ownCards" | "friendCards">
) {
  const ownIds = new Set(context.ownCards.map(card => card.instanceId));
  const friendIds = new Set(context.friendCards.map(card => card.instanceId));
  const offered = new Set(
    offer.requestedCards
      .map(card => card.instanceId)
      .filter(id => ownIds.has(id))
  );
  const requested = new Set(
    offer.offeredCards
      .map(card => card.instanceId)
      .filter(id => friendIds.has(id))
  );
  return {
    offered,
    requested,
    offeredKaras: String(offer.requestedKaras),
    requestedKaras: String(offer.offeredKaras),
    removed:
      offer.requestedCards.length +
      offer.offeredCards.length -
      offered.size -
      requested.size
  };
}
export function tradeOfferIsActionable(
  id: string,
  offers: readonly Pick<TradeOffer, "id" | "status">[]
) {
  return offers.some(offer => offer.id === id && offer.status === "pending");
}
export function tradeStatusPresentation(status?: string): {
  label: string;
  tone: "gold" | "success" | "danger" | "info" | "neutral";
} {
  switch (status) {
    case "pending":
      return { label: "Pending", tone: "gold" };
    case "quarantined":
      return { label: "Under review", tone: "info" };
    case "accepted":
      return { label: "Accepted", tone: "success" };
    case "declined":
      return { label: "Declined", tone: "danger" };
    case "countered":
      return { label: "Countered", tone: "info" };
    case "cancelled":
      return { label: "Canceled", tone: "neutral" };
    default:
      return { label: "Unavailable", tone: "neutral" };
  }
}
export function resolveTradeReview(
  id: string | undefined,
  offers: readonly TradeOffer[]
) {
  return id ? offers.find(offer => offer.id === id) : undefined;
}
export function tradeErrorMessage(code: string) {
  if (code === "ECONOMIC_MAINTENANCE") return code;
  if (Object.prototype.hasOwnProperty.call(tradeLimitsEnglish, code)) {
    // Errors arise after a client action; the document locale is already fixed
    // by the existing locale/feature flag. No new locale state or flag is added.
    const catalog =
      typeof document !== "undefined" && document.documentElement.lang === "fr"
        ? tradeLimitsFrench
        : tradeLimitsEnglish;
    return catalog[code as keyof typeof tradeLimitsEnglish];
  }
  const messages: Record<string, string> = {
    FRIENDS_ONLY: "This offer can't be sent because you're no longer friends.",
    INVALID_TRADE_KARAS: "The Karas amount is invalid.",
    EMPTY_TRADE: "Add at least one card or some Karas.",
    DUPLICATE_TRADE_CARD: "Each card copy can only appear once.",
    TRADE_CARD_UNAVAILABLE: "A selected card is no longer available.",
    TRADE_CARD_FROZEN: "A selected card is now listed for sale.",
    CARD_LOCKED: "A selected card is now locked.",
    TRADE_NOT_COUNTERABLE: "This offer can no longer receive a counteroffer.",
    TRADE_NOT_PENDING: "This offer is no longer pending.",
    TRADE_NOT_FOUND: "This offer couldn't be found.",
    TRADE_NOT_AUTHOR: "Only the sender can cancel this offer.",
    TRADE_ALREADY_ACCEPTED: "This offer has already been accepted.",
    TRADE_ALREADY_DECLINED: "This offer has already been declined.",
    TRADE_ALREADY_CANCELLED: "This offer has already been canceled.",
    TRADE_ALREADY_COUNTERED: "This offer already has a counteroffer.",
    TRADE_INSUFFICIENT_KARAS:
      "You or your friend no longer have enough Karas to accept this trade."
  };
  return messages[code] ?? "Couldn't process this trade. Please try again.";
}
let client: ReturnType<typeof createClient> | undefined;
const db = () => (client ??= createClient());
async function call<T>(
  name: string,
  args?: Record<string, unknown>,
  paged: boolean | { cursor: PageCursor } = false
): Promise<T> {
  const result = paged
    ? await readRpcPages(
        db().rpc.bind(db()),
        name,
        typeof paged === "object" ? { ...paged, maxPages: 1 } : undefined
      )
    : await db().rpc(name, args);
  const { data, error } = result;
  if (error) throw new Error(tradeErrorMessage(error.message ?? ""), {cause: {i18nKey: ({TRADE_OFFER_RATE_LIMITED: "socialUi.tradeRateLimit", TRADE_PENDING_LIMIT: "socialUi.tradePendingLimit", TRADE_PAIR_LIMIT: "socialUi.tradePairLimit"} as Record<string, string>)[error.message ?? ""]}});
  return (
    typeof paged === "object"
      ? {
          items: data,
          nextCursor: "nextCursor" in result ? result.nextCursor : null
        }
      : data
  ) as T;
}
export const getTradeContext = async (friendId: string) => {
  const context = await call<TradeContext>("get_trade_context", {
    p_friend_id: friendId
  });
  // Enrich both sides in one batch instead of two sequential waterfalls.
  const cards = await withLiveCardFranchises([...context.ownCards, ...context.friendCards]);
  const ownCards = cards.slice(0, context.ownCards.length);
  const friendCards = cards.slice(context.ownCards.length);
  return { ...context, ownCards, friendCards };
};
async function enrichTradeOffers(offers: TradeOffer[]) {
  const cards = await withLiveCardFranchises(
    offers.flatMap(offer => [...offer.offeredCards, ...offer.requestedCards])
  );
  let offset = 0;
  return offers.map(offer => {
    const offeredCards = cards.slice(
      offset,
      (offset += offer.offeredCards.length)
    );
    const requestedCards = cards.slice(
      offset,
      (offset += offer.requestedCards.length)
    );
    return {
      ...offer,
      fromPseudo: offer.fromPseudo || "Deleted player",
      toPseudo: offer.toPseudo || "Deleted player",
      offeredCards,
      requestedCards
    };
  });
}
export const listTradeOffers = async () =>
  enrichTradeOffers(
    await call<TradeOffer[]>("list_trade_offers", undefined, true)
  );
export async function listTradeOffersPage(
  cursor: PageCursor = null
): Promise<RpcPage<TradeOffer>> {
  const page = await call<RpcPage<TradeOffer>>("list_trade_offers", undefined, {
    cursor
  });
  return { ...page, items: await enrichTradeOffers(page.items) };
}
async function refreshTradeConnection() {
  if (typeof window === "undefined") return;
  await fetch("/api/security/network-observation", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(2000)
  }).catch(() => undefined);
}

export const createTradeOffer = async (input: {
  toUser: string;
  offeredCardIds: string[];
  offeredKaras: number;
  requestedCardIds: string[];
  requestedKaras: number;
  parentOfferId?: string | null;
}) => {
  await refreshTradeConnection();
  return call<string>("create_trade_offer", {
    p_to_user: input.toUser,
    p_offered_card_ids: input.offeredCardIds,
    p_offered_karas: input.offeredKaras,
    p_requested_card_ids: input.requestedCardIds,
    p_requested_karas: input.requestedKaras,
    p_parent_offer_id: input.parentOfferId ?? null
  });
};
export async function cancelTradeOffer(id: string) {
  const { data, error } = await db().rpc("cancel_trade_offer", {
    p_offer_id: id
  });
  if (error) {
    if (error.message === "TRADE_ALREADY_CANCELLED") return true;
    throw new Error(tradeErrorMessage(error.message));
  }
  return data as boolean;
}
export async function respondTradeOffer(
  id: string,
  action: "accept" | "decline"
) {
  if (action === "accept") await refreshTradeConnection();
  const accepted = await call<boolean>("respond_trade_offer", {
    p_offer_id: id,
    p_action: action
  });
  if (action === "accept" && accepted)
    invalidatePlayerSnapshots(["collection", "balance"]);
  return action === "decline" ? true : accepted;
}

export async function respondTradeOfferWithStatus(
  id: string,
  action: "accept" | "decline"
): Promise<boolean | "quarantined" | "cancelled"> {
  if (action === "accept") await refreshTradeConnection();
  const status = await call<string>("respond_trade_offer_with_status", {
    p_offer_id: id,
    p_action: action
  });
  if (status === "accepted") invalidatePlayerSnapshots(["collection", "balance"]);
  if (status === "quarantined" || status === "cancelled") return status;
  return status === "accepted" || status === "declined";
}
