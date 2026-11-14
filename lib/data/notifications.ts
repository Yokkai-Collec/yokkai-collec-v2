import { readRequest } from "@/lib/data/read-request";
import { createClient } from "@/utils/supabase/client";

export type KnownNotificationType =
  | "wishlist_card_on_auction"
  | "friend_request"
  | "friend_request_accepted"
  | "outbid"
  | "trade_offer_received"
  | "trade_counter_offer_received"
  | "trade_offer_accepted"
  | "trade_offer_declined"
  | "trade_offer_cancelled"
  | "auction_won"
  | "auction_sold"
  | "auction_chat_mention"
  | "achievement_completed"
  | "catalogue_achievement_completed"
  | "mission_completed"
  | "private_message_received"
  | "wall_post_reply"
  | "wall_reply_received"
  | "wall_post_mention"
  | "wall_reply_mention";
export type AppNotification = {
  id: string;
  type: KnownNotificationType | (string & {});
  referenceId: string;
  readAt: string | null;
  createdAt: string;
  cardName: string | null;
  actorPseudo: string | null;
  achievementName: string | null;
  achievementFamily?: string;
  achievementTarget?: number;
  achievementCategory?: string | null;
  missionMetric?: string;
  missionTarget?: number;
  missionPeriod?: "daily" | "weekly";
  missionPoints?: number;
  missionReward?: number;
  postOwnerId?: string;
  postId?: string;
  replyId?: string;
  karaAmount?: number | null;
};
export type NotificationFeed = {
  items: AppNotification[];
  progressUnread: number | null;
};
export class NotificationRequestError extends Error {
  code?: string;
  details?: string;
  hint?: string;
  constructor(
    message: string,
    error: { code?: string; details?: string; hint?: string; message?: string }
  ) {
    super(message, { cause: error });
    this.name = "NotificationRequestError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}
let client: ReturnType<typeof createClient> | undefined;
const db = () => (client ??= createClient());
export async function getNotifications(): Promise<NotificationFeed> {
  const request = (withProgress: boolean) =>
    readRequest(signal =>
      db()
        .rpc(
          "list_notifications",
          withProgress ? { p_limit: 30, p_include_progress: true } : { p_limit: 30 }
        )
        .abortSignal(signal)
    );
  const { data, error } = await request(true);
  // Keep the bell available during a staggered app and database rollout.
  if (error?.code === "PGRST202") {
    const legacy = await request(false);
    if (!legacy.error)
      return { items: legacy.data as AppNotification[], progressUnread: null };
    throw new NotificationRequestError("Couldn't load notifications.", legacy.error);
  }
  if (error)
    throw new NotificationRequestError("Couldn't load notifications.", error);
  return data as NotificationFeed;
}
export async function markNotificationRead(id?: string) {
  const { error } = await db().rpc("mark_notification_read", {
    p_notification_id: id ?? null
  });
  if (error)
    throw new NotificationRequestError(
      "Couldn't mark this notification as read.",
      error
    );
}

export async function markProgressNotificationsRead() {
  const { error } = await db().rpc("mark_progress_notifications_read");
  if (error)
    throw new NotificationRequestError(
      "Couldn't mark progress notifications as read.",
      error
    );
}

// Realtime only wakes up the protected notification read. Never render a socket payload as trusted data.
export function subscribeNotifications(refresh: () => void): () => void {
  const client = db();
  let active = true;
  let channel: ReturnType<typeof client.channel> | undefined;
  if (!client.auth?.getUser || !client.channel) return () => {};
  void client.auth
    .getUser()
    .then(({ data, error }) => {
      if (!active || error || !data.user) return;
      const changed = (payload: { new: Record<string, unknown> }) => {
        if (!active) return;
        refresh();
        if (payload.new.type === "private_message_received")
          window.dispatchEvent(new Event("private-message-received"));
      };
      channel = client
        .channel(`notifications:${data.user.id}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${data.user.id}`
          },
          changed
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${data.user.id}`
          },
          changed
        )
        .on("system", {}, payload => {
          if (active && payload.status === "ok") refresh();
        })
        .subscribe(status => {
          if (active && status === "SUBSCRIBED") refresh();
        });
    })
    .catch(() => {
      /* The existing visible polling remains the fallback. */
    });
  return () => {
    active = false;
    if (channel) void client.removeChannel(channel).catch(() => {});
  };
}
