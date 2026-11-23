// Social-only descriptors; keep the shared profile/card registry independent.
import { gameErrorKey as baseGameErrorKey } from "@/i18n/game-messages";
const codes = new Map<string, string>();
const englishMessages = new Map<string, string>();
for (const [message, key] of Object.entries({
  "This offer can't be sent because you're no longer friends.":
    "socialUi.thisOfferCanTBeSentBecauseYou",
  "The Karas amount is invalid.": "socialUi.theKarasAmountIsInvalid",
  "This offer can no longer receive a counteroffer.":
    "socialUi.thisOfferCanNoLongerReceiveACounteroffer",
  "This offer is no longer pending.": "socialUi.thisOfferIsNoLongerPending",
  "This offer couldn't be found.": "socialUi.thisOfferCouldnTBeFound",
  "Only the sender can cancel this offer.":
    "socialUi.onlyTheSenderCanCancelThisOffer",
  "This offer has already been accepted.":
    "socialUi.thisOfferHasAlreadyBeenAccepted",
  "This offer has already been declined.":
    "socialUi.thisOfferHasAlreadyBeenDeclined",
  "This offer has already been canceled.":
    "socialUi.thisOfferHasAlreadyBeenCanceled",
  "This offer already has a counteroffer.":
    "socialUi.thisOfferAlreadyHasACounteroffer",
  "You or your friend no longer have enough Karas to accept this trade.":
    "socialUi.youOrYourFriendNoLongerHaveEnough",
  "Couldn't process this trade. Please try again.":
    "socialUi.couldnTProcessThisTradePleaseTryAgain",
  "Sign in again to view your messages.":
    "socialUi.signInAgainToViewYourMessages",
  "This conversation is no longer available.":
    "socialUi.thisConversationIsNoLongerAvailable",
  "This message couldn't be sent. Close the conversation and try again.":
    "socialUi.thisMessageCouldnTBeSentCloseThe",
  "Messages are temporarily unavailable. Please try again.":
    "socialUi.messagesAreTemporarilyUnavailablePleaseTryAgain",
  "Couldn't send this request.": "socialUi.couldnTSendThisRequest",
  "Sign in again to load your feed.": "socialUi.signInAgainToLoadYourFeed",
  "This feed page is no longer available. Refresh your feed and try again.":
    "socialUi.thisFeedPageIsNoLongerAvailableRefresh",
  "Couldn't load your timeline. Please try again.":
    "socialUi.couldnTLoadYourTimelinePleaseTryAgain",
  "Your active auction limit has been reached. You can list 5 cards at once on Basic and 10 on Pro.":
    "socialUi.yourActiveAuctionLimitHasBeenReachedBasic",
  "This listing can't be canceled because a bid has already been placed.":
    "socialUi.thisListingCanTBeCanceledBecauseA",
  "This card is already listed in an auction.":
    "socialUi.thisCardIsAlreadyListedInAnAuction",
  "Couldn't load the market. Please try again.":
    "socialUi.couldnTLoadTheMarketPleaseTryAgain",
  "Couldn't load more friends. Please try again.":
    "socialUi.couldnTLoadMoreFriendsPleaseTryAgain",
  "Couldn't load friends.": "socialUi.couldnTLoadFriends",
  "Couldn't search.": "socialUi.couldnTSearch",
  "Couldn't remove this friend.": "socialUi.couldnTRemoveThisFriend",
  "Couldn't load more. Please try again.":
    "socialUi.couldnTLoadMorePleaseTryAgain",
  "Couldn't load trades.": "socialUi.couldnTLoadTrades",
  "Couldn't load this offer.": "socialUi.couldnTLoadThisOffer",
  "This card is no longer available to trade.":
    "socialUi.thisCardIsNoLongerAvailableToTrade",
  "Couldn't prepare the counteroffer.":
    "socialUi.couldnTPrepareTheCounteroffer",
  "This player isn't available to trade.":
    "socialUi.thisPlayerIsnTAvailableToTrade",
  "Couldn't send this offer. Please try again.":
    "socialUi.couldnTSendThisOfferPleaseTryAgain",
  "Couldn't cancel this offer.": "socialUi.couldnTCancelThisOffer",
  "Couldn't load messages. Please try again.":
    "socialUi.couldnTLoadMessagesPleaseTryAgain",
  "Couldn't load older messages.": "socialUi.couldnTLoadOlderMessages",
  "Couldn't send the message. Your draft has been kept.":
    "socialUi.couldnTSendTheMessageYourDraftHas",
  "Too many trade offers. Please try again later.": "socialUi.tradeRateLimit",
  "You have 20 pending offers. Cancel or resolve an offer before sending another.":
    "socialUi.tradePendingLimit",
  "You already have 5 pending offers for this player. Resolve one before sending another.":
    "socialUi.tradePairLimit"
}))
  englishMessages.set(message, key);
for (const [code, key] of Object.entries({
  TRADE_OFFER_RATE_LIMITED: "socialUi.tradeRateLimit",
  TRADE_PENDING_LIMIT: "socialUi.tradePendingLimit",
  TRADE_PAIR_LIMIT: "socialUi.tradePairLimit"
}))
  codes.set(code, key);
for (const [message, key] of Object.entries({
  "Couldn't load this auction.": "socialUi.marketUnavailable",
  "Couldn't update your watchlist.": "socialUi.watchlistFailed",
  "Couldn't load your balance. Please try again later.":
    "socialUi.balanceUnavailable",
  "Couldn't load your collection. Please try again later.":
    "socialUi.collectionUnavailable"
}))
  englishMessages.set(message, key);
englishMessages.set(
  "Couldn't load your feed. Please try again.",
  "socialUi.feedLoadFailed"
);
englishMessages.set(
  "Couldn't load the leaderboard. Please try again.",
  "socialUi.leaderboardRequestFailed"
);
englishMessages.set(
  "Couldn't load the referral leaderboard. Please try again.",
  "socialUi.referralLeaderboardRequestFailed"
);
for (const [message, key] of Object.entries({
  "Add at least one card or some Karas.": "socialUi.emptyTrade",
  "Each card copy can only appear once.": "socialUi.duplicateTradeCard",
  "A selected card is no longer available.": "socialUi.tradeCardUnavailable",
  "A selected card is now listed for sale.": "socialUi.tradeCardListed",
  "A selected card is now locked.": "socialUi.tradeCardLocked",
  "You're already friends or have a pending request with this player.":
    "socialUi.friendshipExists",
  "Write a message between 1 and 2,000 characters.": "socialUi.messageLength",
  "Choose a GIF from the GIPHY picker.": "socialUi.messageGif",
  "Please wait a moment before sending another message.":
    "socialUi.messageCooldown"
}))
  englishMessages.set(message, key);
englishMessages.set(
  "This offer is no longer available.",
  "socialTrades.unavailableOffer"
);
englishMessages.set(
  "The trade was updated, but the latest offers could not be refreshed. Reopen the trade to retry.",
  "socialTrades.refreshFailed"
);

const keys = new Set([...codes.values(), ...englishMessages.values()]);
export function socialErrorKey(
  error: unknown,
  fallback = "cardErrors.couldntReachGameDataPleaseTryAgainIn"
) {
  const inherited = baseGameErrorKey(error, "");
  if (inherited) return inherited;
  if (typeof error === "string")
    return keys.has(error)
      ? error
      : (englishMessages.get(error) ?? codes.get(error) ?? fallback);
  if (error && typeof error === "object") {
    const value = error as {
      message?: unknown;
      code?: unknown;
      cause?: { i18nKey?: unknown };
    };
    const key = value.cause?.i18nKey;
    if (typeof key === "string" && keys.has(key)) return key;
    if (typeof value.message === "string")
      return (
        codes.get(value.message) ??
        englishMessages.get(value.message) ??
        (typeof value.code === "string" ? codes.get(value.code) : undefined) ??
        fallback
      );
  }
  return fallback;
}
