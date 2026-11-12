import type {
  respondTradeOfferWithStatus,
  TradeOffer
} from "@/lib/data/trades";
import type { PrivateMessage } from "@/lib/data/private-messages";

export type ConversationTradeAdapter = {
  listOffers: () => Promise<TradeOffer[]>;
  respond: typeof respondTradeOfferWithStatus;
};
export type ConversationTradeState = {
  offers: TradeOffer[];
  loading: boolean;
  busyId: string | null;
  readError: string;
  actionError: string;
};

export function conversationOffers(
  offers: readonly TradeOffer[],
  viewerId: string,
  friendId: string
) {
  if (!viewerId || !friendId || viewerId === friendId) return [];
  return [
    ...new Map(
      offers
        .filter(
          offer =>
            (offer.fromUser === viewerId && offer.toUser === friendId) ||
            (offer.fromUser === friendId && offer.toUser === viewerId)
        )
        .map(offer => [
          offer.id,
          { ...offer, incoming: offer.toUser === viewerId }
        ])
    ).values()
  ].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
}

export type ConversationEntry =
  | { kind: "message"; id: string; createdAt: string; message: PrivateMessage }
  | { kind: "trade"; id: string; createdAt: string; offer: TradeOffer };

export function conversationTimeline(
  messages: readonly PrivateMessage[],
  offers: readonly TradeOffer[],
  tradeLimit: number
): ConversationEntry[] {
  const entries: ConversationEntry[] = [
    ...messages.map(message => ({
      kind: "message" as const,
      id: `message:${message.id}`,
      createdAt: message.createdAt,
      message
    })),
    ...offers.slice(-Math.max(1, tradeLimit)).map(offer => ({
      kind: "trade" as const,
      id: `trade:${offer.id}`,
      createdAt: offer.createdAt,
      offer
    }))
  ];
  return entries.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
}

// One reader and one mutation at a time. The existing RPCs remain authoritative:
// no message text or client-provided "incoming" flag can authorize a trade.
export function createConversationTradeFeed({
  adapter,
  viewerId,
  friendId,
  onChange,
  onAccepted = () => {}
}: {
  adapter: ConversationTradeAdapter;
  viewerId: string;
  friendId: string;
  onChange: (state: ConversationTradeState) => void;
  onAccepted?: () => void;
}) {
  let active = true;
  let revision = 0;
  let queued = false;
  let reading: Promise<void> | null = null;
  let state: ConversationTradeState = {
    offers: [],
    loading: true,
    busyId: null,
    readError: "",
    actionError: ""
  };
  const publish = (patch: Partial<ConversationTradeState>) => {
    if (!active) return;
    state = { ...state, ...patch };
    onChange(state);
  };
  const refresh = (): Promise<void> => {
    if (!active) return Promise.resolve();
    if (reading) {
      queued = true;
      return reading;
    }
    reading = (async () => {
      do {
        queued = false;
        const requestRevision = revision;
        try {
          const offers = conversationOffers(
            await adapter.listOffers(),
            viewerId,
            friendId
          );
          if (!active || requestRevision !== revision) continue;
          if (
            offers.some(
              offer =>
                offer.status === "accepted" &&
                state.offers.some(
                  previous =>
                    previous.id === offer.id &&
                    ["pending", "quarantined"].includes(previous.status)
                )
            )
          )
            onAccepted();
          publish({ offers, loading: false, readError: "" });
        } catch {
          if (requestRevision === revision)
            publish({
              loading: false,
              readError:
                "Couldn't refresh trades. Your messages are still available."
            });
        }
      } while (active && queued);
    })().finally(() => {
      reading = null;
    });
    return reading;
  };
  return {
    refresh,
    retry: () => {
      publish({ actionError: "" });
      return refresh();
    },
    stop: () => {
      active = false;
      revision++;
    },
    async respond(id: string, action: "accept" | "decline") {
      if (!active || state.busyId || !["accept", "decline"].includes(action))
        return false;
      const offer = state.offers.find(item => item.id === id);
      if (
        !offer ||
        offer.status !== "pending" ||
        offer.toUser !== viewerId ||
        offer.fromUser !== friendId
      )
        return false;
      revision++;
      publish({ busyId: id, actionError: "" });
      let succeeded = false;
      try {
        const result = await adapter.respond(id, action);
        succeeded = Boolean(result);
        if (!active) return succeeded;
        if (!succeeded)
          throw Error(
            "This offer is no longer available. Its status has been refreshed."
          );
        revision++;
        publish({
          offers: state.offers.map(item =>
            item.id === id
              ? {
                  ...item,
                  status:
                    typeof result === "string"
                      ? result
                      : action === "accept"
                        ? "accepted"
                        : "declined"
                }
              : item
          )
        });
        if (action === "accept" && result === true) onAccepted();
      } catch (reason) {
        publish({
          actionError:
            reason instanceof Error
              ? reason.message
              : "Couldn't update this trade. Please try again."
        });
      } finally {
        if (active) {
          revision++;
          await refresh();
          publish({ busyId: null });
        }
      }
      return succeeded;
    }
  };
}
