"use client";

import { useEffect, useRef, useState } from "react";
import {
  listTradeOffers,
  respondTradeOfferWithStatus
} from "@/lib/data/trades";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";
import { startVisiblePolling } from "@/lib/ui/visible-polling";
import {
  createConversationTradeFeed,
  type ConversationTradeAdapter,
  type ConversationTradeState
} from "@/lib/ui/conversation-trades";

const liveTrades: ConversationTradeAdapter = {
  listOffers: listTradeOffers,
  respond: respondTradeOfferWithStatus
};
export function useConversationTrades(
  viewerId: string | undefined,
  friendId: string,
  enabled: boolean,
  adapter = liveTrades
) {
  const key = `${viewerId ?? ""}:${friendId}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    state: ConversationTradeState;
  }>();
  const feed = useRef<ReturnType<typeof createConversationTradeFeed> | null>(
    null
  );
  useEffect(() => {
    if (!viewerId || !enabled) return;
    const controller = createConversationTradeFeed({
      adapter,
      viewerId,
      friendId,
      onChange: state => setSnapshot({ key, state }),
      onAccepted: () => invalidatePlayerSnapshots(["collection", "balance"])
    });
    feed.current = controller;
    const stop = startVisiblePolling(() => void controller.refresh(), 5_000);
    const refresh = () => {
      if (!document.hidden) void controller.refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      controller.stop();
      stop();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      if (feed.current === controller) feed.current = null;
    };
  }, [viewerId, friendId, enabled, adapter, key]);
  const state = enabled && snapshot?.key === key ? snapshot.state : undefined;
  return {
    offers: state?.offers ?? [],
    loading: enabled && (!state || state.loading),
    busyId: state?.busyId ?? null,
    error: state?.actionError || state?.readError || "",
    refresh: () => feed.current?.refresh(),
    retry: () => feed.current?.retry(),
    respond: (id: string, action: "accept" | "decline") =>
      feed.current?.respond(id, action)
  };
}
