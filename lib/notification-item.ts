import type { useTranslations } from "next-intl";
import type { AppNotification } from "@/lib/data/notifications";

export type NotificationItem = {
  id: string;
  title: string;
  text: string;
  time: string;
  read: boolean;
  href?: string;
  kind:
    | "wishlist"
    | "outbid"
    | "trade"
    | "trade-counter"
    | "trade-accepted"
    | "trade-declined"
    | "trade-cancelled"
    | "pack"
    | "won"
    | "sold"
    | "mention"
    | "message"
    | "reply"
    | "friend"
    | "mission";
};
export function notificationItem(
  notification: AppNotification,
  t: ReturnType<typeof useTranslations<"topbar">>,
  time?: string,
  achievementT?: ReturnType<typeof useTranslations<"achievementUi">>
): NotificationItem {
  const common = {
    id: notification.id,
    time: time ?? new Date(notification.createdAt).toLocaleString("en-US"),
    read: !!notification.readAt
  };
  if (notification.type === "wall_reply_received")
    return {
      ...common,
      title: t("notificationCommentReplyTitle"),
      text: t("notificationCommentReplyText", {
        actorPseudo: notification.actorPseudo ?? t("notificationFriendFallback")
      }),
      href: notification.postOwnerId
        ? `/profile/${encodeURIComponent(notification.postOwnerId)}?tab=wall&post=${encodeURIComponent(notification.postId ?? "")}&reply=${encodeURIComponent(notification.replyId ?? "")}`
        : "/social",
      kind: "reply"
    };
  if (notification.type === "wall_post_reply")
    return {
      ...common,
      title: t("notificationReplyTitle"),
      text: t("notificationReplyText", {
        actorPseudo: notification.actorPseudo ?? t("notificationFriendFallback")
      }),
      href: "/profile?tab=wall",
      kind: "reply"
    };
  if (notification.type === "private_message_received")
    return {
      ...common,
      title: t("notificationMessageTitle"),
      text: t("notificationMessageText", {
        actorPseudo: notification.actorPseudo ?? t("notificationFriendFallback")
      }),
      href: `/friends?message=${encodeURIComponent(notification.referenceId)}`,
      kind: "message"
    };
  if (notification.type === "friend_request_accepted")
    return {
      ...common,
      title: t("notificationFriendAcceptedTitle"),
      text: t("notificationFriendAcceptedText", {
        actorPseudo: notification.actorPseudo ?? t("notificationDeletedPlayer")
      }),
      href: notification.actorPseudo
        ? `/profile/${encodeURIComponent(notification.referenceId)}`
        : "/friends",
      kind: "friend"
    };
  if (notification.type === "friend_request")
    return {
      ...common,
      title: t("notificationFriendTitle"),
      text: t("notificationFriendText", {
        actorPseudo: notification.actorPseudo ?? t("notificationDeletedPlayer")
      }),
      href: "/friends",
      kind: "friend"
    };
  if (
    notification.type === "mystery_auction_started" ||
    notification.type === "mystery_auction_result"
  )
    return {
      ...common,
      title: t("notificationMysteryTitle"),
      text:
        notification.type === "mystery_auction_started"
          ? t("notificationMysteryStarted")
          : t("notificationMysteryResult", {
              cardName: notification.cardName ?? t("notificationCardFallback")
            }),
      href: `/market/${notification.referenceId}`,
      kind: "pack"
    };
  if (notification.type === "outbid")
    return {
      ...common,
      title: t("notificationOutbidTitle"),
      text: t("notificationOutbidText", {
        cardName: notification.cardName ?? t("notificationCardFallback")
      }),
      href: `/market/${notification.referenceId}`,
      kind: "outbid"
    };
  if (notification.type === "trade_offer_received")
    return {
      ...common,
      title: t("notificationOfferTitle"),
      text: t("notificationOfferText", {
        actorPseudo: notification.actorPseudo ?? t("notificationDeletedPlayer")
      }),
      href: `/trades?offre=${notification.referenceId}`,
      kind: "trade"
    };
  if (notification.type === "trade_counter_offer_received")
    return {
      ...common,
      title: t("notificationCounterTitle"),
      text: t("notificationCounterText", {
        actorPseudo: notification.actorPseudo ?? t("notificationDeletedPlayer")
      }),
      href: `/trades?offre=${notification.referenceId}`,
      kind: "trade-counter"
    };
  if (notification.type === "trade_offer_accepted")
    return {
      ...common,
      title: t("notificationAcceptedTitle"),
      text: t("notificationAcceptedText", {
        actorPseudo: notification.actorPseudo ?? t("notificationDeletedPlayer")
      }),
      href: `/trades?offre=${notification.referenceId}`,
      kind: "trade-accepted"
    };
  if (notification.type === "trade_offer_declined")
    return {
      ...common,
      title: t("notificationDeclinedTitle"),
      text: t("notificationDeclinedText", {
        actorPseudo: notification.actorPseudo ?? t("notificationDeletedPlayer")
      }),
      href: `/trades?offre=${notification.referenceId}`,
      kind: "trade-declined"
    };
  if (notification.type === "trade_offer_cancelled")
    return {
      ...common,
      title: t("notificationCancelledTitle"),
      text: t("notificationCancelledText", {
        actorPseudo: notification.actorPseudo ?? t("notificationDeletedPlayer")
      }),
      href: `/trades?offre=${notification.referenceId}`,
      kind: "trade-cancelled"
    };
  if (notification.type === "auction_won")
    return {
      ...common,
      title: t("notificationWonTitle"),
      text: t("notificationWonText", {
        cardName: notification.cardName ?? t("notificationCardFallback")
      }),
      href: `/market/${notification.referenceId}`,
      kind: "won"
    };
  if (notification.type === "auction_sold")
    return {
      ...common,
      title: t("notificationSoldTitle"),
      text: t("notificationSoldText", {
        cardName: notification.cardName ?? t("notificationCharacterFallback"),
        karaAmount: notification.karaAmount ?? 0
      }),
      href: `/market/${notification.referenceId}`,
      kind: "sold"
    };
  if (notification.type === "auction_chat_mention")
    return {
      ...common,
      title: t("notificationMentionTitle"),
      text: t("notificationMentionText", {
        actorPseudo: notification.actorPseudo ?? t("notificationDeletedPlayer"),
        cardName: notification.cardName ?? t("notificationAuctionFallback")
      }),
      href: `/market/${notification.referenceId}#chat-enchere`,
      kind: "mention"
    };
  if (notification.type === "achievement_completed") {
    const achievementKey = `title${(notification.referenceId ?? "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`;
    return {
      ...common,
      title: t("notificationAchievementTitle"),
      text: t("notificationAchievementText", {
        achievementName: achievementT?.has(achievementKey)
          ? achievementT(achievementKey)
          : (notification.achievementName ??
            t("notificationAchievementFallback"))
      }),
      href: `/achievements#${notification.referenceId}`,
      kind: "mission"
    };
  }
  if (notification.type === "wishlist_card_on_auction")
    return {
      ...common,
      title: t("notificationWishlistTitle"),
      text: t("notificationWishlistText", {
        cardName: notification.cardName ?? t("notificationWishlistCardFallback")
      }),
      href: `/market/${notification.referenceId}`,
      kind: "wishlist"
    };
  return {
    ...common,
    title: t("notificationActivityTitle"),
    text: t("notificationActivityText"),
    kind: "mission"
  };
}
