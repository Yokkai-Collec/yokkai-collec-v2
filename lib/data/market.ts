import { createClient } from "@/utils/supabase/client";
import { readRpcPages } from "@/lib/data/rpc-pages.mjs";
import {
  invalidatePlayerSnapshots,
  withLiveCardFranchises,
  type Card
} from "@/lib/data/cards";

export type AuctionData = {
  isMystery?: boolean;
  mysteryHidden?: boolean;
  id: string;
  card: Card & { shiny?: boolean; isEvolved?: boolean; catalogueImage?: string };
  amount: number;
  endsAt: string;
  status: "active" | "sold" | "expired";
  seller: string;
  sellerId: string | null;
  sellerAvatarUrl?: string | null;
  buyerId?: string | null;
  // Present (possibly null) only once the history migration is applied.
  buyer?: string | null;
  hasBid?: boolean;
  popularity?: number;
  bids: number;
  watched: boolean;
  ownedCount?: number;
};
export type AuctionDetail = AuctionData & {
  winner?: string | null;
  balance: number;
  history: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    amount: number;
    createdAt: string;
    mine: boolean;
  }[];
};
type AuctionPayload<T extends AuctionData> = Omit<T, "card"> & { card: T["card"] | null };
export type AuctionChatMessage = {
  profileStyle?: PlayerCosmetics;
  id: string;
  userId: string;
  pseudo: string;
  avatarUrl?: string | null;
  message: string;
  gifUrl?: string | null;
  createdAt: string;
  mine: boolean;
};
export type AuctionChatParticipant = {
  profileStyle?: PlayerCosmetics;
  userId: string;
  pseudo: string;
  avatarUrl?: string | null;
  mine: boolean;
};
export type AuctionChat = {
  canPost: boolean;
  participants: AuctionChatParticipant[];
  messages: AuctionChatMessage[];
};
export function auctionReconciliationScopes(
  previous: readonly AuctionData[],
  next: readonly AuctionData[],
  viewer?: string
) {
  if (!viewer) return [];
  const current = new Map(next.map(auction => [auction.id, auction]));
  const scopes = new Set<"balance" | "collection">();
  for (const before of previous) {
    if (before.status !== "active") continue;
    const after = current.get(before.id);
    if (before.buyerId === viewer && (!after || after.buyerId !== viewer))
      scopes.add("balance");
    if (!after || after.status === "active") continue;
    if (after.sellerId === viewer) scopes.add("balance");
    if (after.status === "sold" && after.buyerId === viewer)
      scopes.add("collection");
  }
  return [...scopes];
}
let client: ReturnType<typeof createClient> | undefined;
const db = () => (client ??= createClient());
async function call<T>(
  name: string,
  args?: Record<string, unknown>,
  paged = false
): Promise<T> {
  const result = paged
    ? await readRpcPages(db().rpc.bind(db()), name)
    : await db().rpc(name, args);
  const { data, error } = result;
  if (error) {
    if (error.message === "ECONOMIC_MAINTENANCE") throw new Error(error.message, { cause: { i18nKey: "cardErrors.economicMaintenance" } });
    const details = "details" in error ? error.details : undefined;
    if (error.message === "AUCTION_LIMIT_REACHED")
      throw new Error(
        "Your active auction limit has been reached. Basic members can list 3 cards at once; Pro members can list 6."
      );
    if (error.message === "CHAT_RATE_LIMITED") {
      const seconds = Number(details);
      throw Object.assign(
        new Error("Slow down. Please try again in a few seconds."),
        {
          retryAfterSeconds:
            Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 3
        }
      );
    }
    if (
      error.message === "CHAT_MENTION_INVALID" &&
      details === "max_mentions=3"
    )
      throw new Error("You can mention up to 3 different people per message.");
    const messages: Record<string, string> = {
      AUCTION_CLOSED: "This auction has ended.",
      AUCTION_NOT_OWNER: "Only the seller can cancel this listing.",
      AUCTION_HAS_BIDS:
        "This listing can't be canceled because a bid has already been placed.",
      SELLER_CANNOT_BID: "You can't bid on your own listing.",
      BID_TOO_LOW: "Your bid must be at least 10 Karas above the current bid.",
      INSUFFICIENT_KARAS: "You don't have enough Karas.",
      CARD_FROZEN: "This card is already listed in an auction.",
      CARD_NOT_OWNED: "This card is no longer in your collection.",
      AUCTION_NOT_FOUND: "This auction couldn't be found.",
      CHAT_BIDDERS_ONLY: "You must place a bid to join the chat.",
      CHAT_PARTICIPANTS_ONLY: "Only the seller and bidders can join the chat.",
      CHAT_MESSAGE_INVALID: "Messages must contain 1–500 characters.",
      CHAT_GIF_INVALID: "This GIF is invalid.",
      GIF_RATING_REJECTED: "This GIF is invalid.",
      CHAT_MENTION_INVALID:
        "You can only mention the seller or a player who has already bid."
    };
    throw new Error(
      messages[error.message ?? ""] ??
        "Couldn't reach the market. Please try again."
    );
  }
  return data as T;
}
async function enrichAuctions(auctions: AuctionPayload<AuctionData>[], sort = true) {
  if (sort)
    auctions.sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
  const cards = await withLiveCardFranchises(
    auctions.flatMap(auction => auction.card ? [auction.card] : [])
  );
  let index = 0;
  return auctions.map(auction => ({
    ...auction,
    mysteryHidden: !!auction.isMystery && !auction.card,
    seller: auction.seller || "Deleted player",
    card: auction.card ? cards[index++] : mysteryCard
  }));
}
export const getAuctions = async () =>
  enrichAuctions(await call<AuctionData[]>("list_auctions", undefined, true));
export const getAuction = async (id: string) => {
  const auction = await call<AuctionPayload<AuctionDetail>>("get_auction", {
    p_auction_id: id
  });
  return {
    ...auction,
    mysteryHidden: !!auction.isMystery && !auction.card,
    seller: auction.seller || "Deleted player",
    winner:
      auction.status === "sold"
        ? auction.winner || "Deleted player"
        : auction.winner,
    history: auction.history.map(bid => ({
      ...bid,
      name: bid.name || "Deleted player"
    })),
    card: auction.card ? (await withLiveCardFranchises([auction.card]))[0] : mysteryCard
  };
};
// Presentation placeholder only; the server returns JSON null until settlement.
const mysteryCard: Card = { id: "", name: "", category: "", rarity: "C", image: "", liveFranchise: true };
export type MysteryAuctionEvent = { nextStartsAt: string; isWednesday: boolean; auction: AuctionPayload<AuctionDetail> | null };
export const getMysteryAuctionEvent = () => call<MysteryAuctionEvent>("get_mystery_auction_event");
export async function createAuction(
  instanceId: string,
  startingPrice: number,
  durationMinutes: number
) {
  const result = await call<string>("create_auction", {
    p_card_instance_id: instanceId,
    p_starting_price: startingPrice,
    p_duration_minutes: durationMinutes
  });
  invalidatePlayerSnapshots(["collection"]);
  return result;
}
export async function cancelAuction(id: string) {
  await call<boolean>("cancel_auction", { p_auction_id: id });
  invalidatePlayerSnapshots(["collection"]);
}
export async function placeBid(id: string, amount: number) {
  const result = await call<{
    currentPrice: number;
    endsAt: string;
    balance: number;
  }>("place_bid", { p_auction_id: id, p_amount: amount });
  invalidatePlayerSnapshots(["balance"]);
  return result;
}
export const toggleWatch = (id: string) =>
  call<boolean>("toggle_auction_watch", { p_auction_id: id });
export const getAuctionChat = (id: string) =>
  call<AuctionChat>("get_auction_chat", { p_auction_id: id });
export const sendAuctionChatMessage = (
  id: string,
  message: string,
  gifUrl?: string
) =>
  call<AuctionChatMessage>("send_auction_chat_message", {
    p_auction_id: id,
    p_message: message,
    p_gif_url: gifUrl ?? null
  });
import type { PlayerCosmetics } from "@/components/styled-player-name";

export type MarketQuery = {
  query: string;
  rarity: string | readonly string[];
  category: string;
  sort: "end" | "asc" | "desc" | "popular";
  section: "active" | "mine" | "won" | "sold" | "all" | "sales" | "unsold";
};
export const MARKET_PAGE_SIZE = 100;
// ponytail: bounded prefixes cap the market at 1,000 matches; revisit if live volume exceeds this ceiling.
export const MARKET_MAX_ITEMS = 1000;
export type MarketPage = {
  items: AuctionData[];
  hasMore: boolean;
  categories?: string[];
  counts?: Record<"active" | "mine" | "won" | "sold" | "activeSales", number> &
    Partial<Record<"all" | "sales" | "unsold" | "salesKaras", number>>;
};
// The Home highlights global player interest without personal watch-list pins.
export async function browseHomeAuctions(): Promise<MarketPage> {
  const page = await call<MarketPage>("browse_auctions_page", {
    p_query: "",
    p_rarity: "",
    p_category: "",
    p_sort: "interest",
    p_section: "active",
    p_limit: 6
  });
  return { ...page, items: await enrichAuctions(page.items.filter(a => !a.isMystery), false) };
}
export async function browseAuctions(
  query: MarketQuery,
  limit = MARKET_PAGE_SIZE
): Promise<MarketPage> {
  const { data, error } = await db().rpc("browse_auctions_page", {
    p_limit: limit,
    p_query: query.query,
    // Same encoding as cardFilterParam: several values travel as a JSON array.
    p_rarity:
      typeof query.rarity === "string"
        ? query.rarity
        : query.rarity.length > 1
          ? JSON.stringify(query.rarity)
          : (query.rarity[0] ?? ""),
    p_category: query.category,
    p_sort: query.sort,
    p_section: query.section
  });
  if (error) {
    // Before the history migration: rebuild the new sections from the legacy ones.
    if (
      error.message === "INVALID_MARKET_FILTER" &&
      ["all", "sales", "unsold"].includes(query.section)
    ) {
      const pages = await Promise.all(
        (query.section === "all" ? (["mine", "won", "sold"] as const) : (["sold"] as const)).map(
          section => browseAuctions({ ...query, section }, limit)
        )
      );
      const items = pages.flatMap(page => page.items);
      return {
        ...pages[0],
        items:
          query.section === "all"
            ? items
            : items.filter(a =>
                query.section === "sales"
                  ? a.status === "sold"
                  : a.status !== "sold"
              ),
        hasMore: pages.some(page => page.hasMore),
        categories: [
          ...new Set(pages.flatMap(page => page.categories ?? []))
        ].sort()
      };
    }
    // Before migration keep the existing complete list and client filtering/sorting.
    if (["PGRST202", "42883"].includes(error.code ?? ""))
      return { items: await getAuctions(), hasMore: false };
    throw new Error("Couldn't load the market. Please try again.");
  }
  const page = data as MarketPage;
  return { ...page, items: await enrichAuctions(page.items, false) };
}
