import type { AuctionData, AuctionDetail } from "@/lib/data/market";
import type { AuctionPresentation } from "@/components/community-views";

const remaining = (endsAt: string, now = Date.now()) => {
  const seconds = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000));
  return {
    seconds,
    text: `${Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
  };
};
export function presentAuction(
  raw: AuctionData | AuctionDetail,
  viewer?: string,
  now?: number
): AuctionPresentation {
  const left = remaining(raw.endsAt, now);
  const finished = raw.status !== "active" || left.seconds === 0;
  const detail = raw as AuctionDetail;
  const baseBid = raw.isBlackMarket ? detail.bidIncrement : undefined;
  const bidIncrement =
    baseBid && left.seconds <= 180
      ? (detail.lateBidIncrement ?? baseBid * 2)
      : baseBid;
  const minimumBid =
    baseBid && !raw.buyerId ? baseBid : raw.amount + (bidIncrement ?? 10);
  const bidder = !!raw.hasBid || !!detail.history?.some(b => b.mine);
  const status =
    raw.status === "sold"
      ? raw.buyerId === viewer
        ? "won"
        : raw.sellerId === viewer
          ? "sold"
          : bidder
            ? "lost"
            : undefined
      : raw.status === "expired"
        ? raw.sellerId === viewer
          ? "unsold"
          : bidder
            ? "lost"
            : undefined
        : raw.sellerId === viewer
          ? "mine"
          : raw.buyerId === viewer
            ? "leading"
            : bidder
              ? "outbid"
              : undefined;
  return {
    id: raw.id,
    isBlackMarket: raw.isBlackMarket,
    isMystery: raw.isMystery,
    mysteryHidden: raw.mysteryHidden,
    mysteryLrChance: raw.mysteryLrChance,
    mysteryMisses: raw.mysteryMisses,
    ...(raw.ownedCount !== undefined ? { ownedCount: raw.ownedCount } : {}),
    card: { ...raw.card, image: raw.card.catalogueImage ?? raw.card.image },
    amount: raw.amount,
    remaining: left.text,
    remainingSeconds: left.seconds,
    seller: raw.seller || "Deleted player",
    sellerId: raw.sellerId,
    sellerAvatarUrl: raw.sellerAvatarUrl,
    bids: raw.bids ?? detail.history?.length ?? 0,
    popularity: raw.popularity,
    status,
    finished,
    endsAt: raw.endsAt,
    buyer:
      raw.status === "sold" && raw.buyer !== undefined
        ? raw.buyer || "Deleted player"
        : undefined,
    winner: detail.winner ?? undefined,
    balance: detail.balance,
    nextBid: !finished && raw.sellerId !== viewer ? minimumBid : undefined,
    minimumBid,
    bidIncrement: raw.buyerId ? (bidIncrement ?? undefined) : undefined,
    wishlist: raw.watched,
    antiSnipeMessage:
      !raw.isMystery && !raw.isBlackMarket && left.seconds < 300 && !finished
        ? "Each bid adds one minute to the end time."
        : undefined,
    history: detail.history?.map(b => ({
      id: b.id,
      name: b.name,
      avatarUrl: b.avatarUrl,
      amount: b.amount,
      createdAt: b.createdAt,
      time: new Date(b.createdAt).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit"
      }),
      mine: b.mine
    }))
  };
}

export function buildAuctionLists(market: AuctionData[], viewer: string) {
  return {
    active: market
      .filter(a => a.status === "active")
      .map(a => presentAuction(a, viewer)),
    mine: market
      .filter(a => a.status === "active" && (a.sellerId === viewer || a.hasBid))
      .map(a => presentAuction(a, viewer)),
    won: market
      .filter(a => a.status === "sold" && a.buyerId === viewer)
      .map(a => presentAuction(a, viewer)),
    sold: market
      .filter(a => a.status !== "active" && a.sellerId === viewer)
      .map(a => presentAuction(a, viewer))
  };
}
