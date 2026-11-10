import { createClient } from "@/utils/supabase/client";
import { withLiveCardFranchises, type Card } from "@/lib/data/cards";

export type CardOwner = {
  id: string;
  pseudo: string;
  copies: number;
  isFriend: boolean;
};
export type CardDiscovery = {
  card: Card;
  marketValue: number | null;
  activeAuctionId: string | null;
  wishlisted: boolean;
  ownerCount: number;
  owners: CardOwner[];
};
export type WishlistCard = Card & { createdAt: string };
let client: ReturnType<typeof createClient> | undefined;
const db = () => (client ??= createClient());
async function call<T>(
  name: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { data, error } = await db().rpc(name, args);
  if (error) {
    const messages: Record<string, string> = {
      CARD_ALREADY_OWNED: "This card is already in your collection.",
      CARD_NOT_FOUND: "This card couldn't be found.",
      BINDER_KEY_REQUIRED: "This binder couldn't be found."
    };
    throw new Error(
      messages[error.message] ?? "The wishlist is temporarily unavailable."
    );
  }
  return data as T;
}
export const getCardDiscovery = async (
  cardId: string,
  offset = 0,
  limit = 12,
  shiny = false
) => {
  const discovery = await call<CardDiscovery>("get_card_discovery", {
    p_card_id: cardId,
    p_owner_offset: offset,
    p_owner_limit: limit,
    p_is_shiny: shiny
  });
  return {
    ...discovery,
    card: (await withLiveCardFranchises([discovery.card]))[0]
  };
};
export const toggleWishlist = (cardId: string) =>
  call<boolean>("toggle_wishlist", { p_card_id: cardId });
// Adds every card of the binder the player doesn't own; returns how many were added.
export const addBinderToWishlist = (binder: string) =>
  call<number>("add_binder_to_wishlist", { p_binder: binder });
export const getWishlist = async (identifier?: string) =>
  withLiveCardFranchises(
    await call<WishlistCard[]>("list_wishlist", {
      p_identifier: identifier ?? null
    })
  );
