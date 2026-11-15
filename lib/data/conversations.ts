import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import type { FriendUser } from "@/lib/data/friends";
import type { MessageCursor } from "@/lib/data/private-messages";

export type ConversationSummary = {
  friend: FriendUser;
  lastAt: string;
  own: boolean;
  preview: string;
  kind: "text" | "gif" | "image" | "moderated";
};
export type ConversationPage = {
  viewerId: string;
  items: ConversationSummary[];
  next: MessageCursor | null;
};
export async function getPrivateConversations(cursor?: MessageCursor): Promise<ConversationPage> {
  const { data, error } = await readRequest(signal =>
    createClient().rpc("get_private_conversations", {
      p_before: cursor?.at ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: 30
    }).abortSignal(signal)
  );
  if (error) throw new Error("CONVERSATIONS_UNAVAILABLE");
  return data as ConversationPage;
}
