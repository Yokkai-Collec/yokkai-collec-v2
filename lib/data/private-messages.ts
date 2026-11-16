import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";

export type PrivateMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  text: string;
  createdAt: string;
  gifUrl?: string | null;
  hasImage?: boolean;
  // Hidden for everyone by an admin (#379): no text or GIF left.
  moderated?: boolean;
};
export type MessageCursor = { at: string; id: string };
export type PrivateMessagePage = {
  viewerId: string;
  readThroughId?: string | null;
  items: PrivateMessage[];
  next: MessageCursor | null;
};
export function isPrivateMessageGif(url: string): boolean {
  return url.length <= 2048 && /^https:\/\/(media[0-9]*|i)\.giphy\.com\/media\/[A-Za-z0-9/_.-]+\.gif(\?[A-Za-z0-9_=&%.-]+)?$/.test(url);
}
export type PrivateMessagesAdapter = {
  markRead?: (friendId: string, lastMessageId: string) => Promise<void>;
  list: (friendId: string, cursor?: MessageCursor) => Promise<PrivateMessagePage>;
  send: (friendId: string, text: string, id: string, gifUrl?: string | null, image?: File) => Promise<PrivateMessage>;
};
export class PrivateMessagesError extends Error {
  constructor(message: string, readonly unavailable = false) {
    super(message);
    this.name = "PrivateMessagesError";
  }
}
const errors: Record<string, string> = {
  AUTH_REQUIRED: "Sign in again to view your messages.",
  MESSAGES_UNAVAILABLE: "This conversation is no longer available.",
  MESSAGE_INVALID: "Write a message between 1 and 2,000 characters.",
  MESSAGE_GIF_INVALID: "Choose a GIF from the GIPHY picker.",
  GIF_RATING_REJECTED: "Choose a GIF from the GIPHY picker.",
  MESSAGE_IMAGE_INVALID: "JPG, PNG, WebP, or GIF, up to 6 MB.",
  MESSAGE_RATE_LIMITED: "Please wait a moment before sending another message.",
  MESSAGE_CONFLICT: "This message couldn't be sent. Close the conversation and try again."
};
function fail(error: { message: string }): never {
  throw new PrivateMessagesError(
    errors[error.message] ?? "Messages are temporarily unavailable. Please try again.",
    error.message === "MESSAGES_UNAVAILABLE" || error.message === "AUTH_REQUIRED"
  );
}
export const livePrivateMessages: PrivateMessagesAdapter = {
  markRead: async (friendId, lastMessageId) => {
    // Acknowledgement is idempotent and monotonic, unlike sending a message.
    // Bound a stalled request; a later poll can safely acknowledge it again.
    const { error } = await createClient().rpc("mark_private_messages_read", {
      p_friend_id: friendId, p_last_message_id: lastMessageId
    }).abortSignal(AbortSignal.timeout(15_000));
    if (error) fail(error);
    const { invalidateSocialUnread } = await import("@/lib/data/social-unread");
    invalidateSocialUnread();
  },
  list: async (friendId, cursor) => {
    const { data, error } = await readRequest(signal =>
      createClient().rpc("get_private_messages", {
        p_friend_id: friendId,
        p_before: cursor?.at ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: 40
      }).abortSignal(signal)
    );
    if (error) fail(error);
    return data as PrivateMessagePage;
  },
  send: async (friendId, text, id, gifUrl, image) => {
    const { data, error } = image
      ? await (await import("@/lib/data/private-message-image")).sendPrivateMessageImage(friendId, text, id, image)
      : await createClient().rpc("send_private_message_gif", {
          p_friend_id: friendId, p_body: text, p_id: id, p_gif_url: gifUrl ?? null
        });
    if (error) fail(error);
    return data as PrivateMessage;
  }
};
