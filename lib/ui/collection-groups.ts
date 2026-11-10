import type { CollectedCard } from "@/lib/data/cards";

export type CollectionGroup = {
  key: string;
  cards: CollectedCard[];
  representative: CollectedCard;
  firstObtainedAt: string;
  isFirstOwner: boolean;
};

export const collectionGroupKey = (
  card: Pick<CollectedCard, "id" | "rarity" | "shiny"> & { isEvolved?: boolean }
) =>
  `${card.id}:${card.rarity}:${card.isEvolved ? "evolved" : card.shiny && card.rarity !== "LR" ? "shiny" : "normal"}`;

const newestFirst = (a: CollectedCard, b: CollectedCard) =>
  Date.parse(b.obtainedAt) - Date.parse(a.obtainedAt) ||
  a.instanceId.localeCompare(b.instanceId);

export function groupCollection(
  cards: CollectedCard[],
  preferred: Readonly<Record<string, string>> = {}
): CollectionGroup[] {
  const groups = new Map<string, CollectedCard[]>();
  for (const card of cards) {
    const key = collectionGroupKey(card);
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  return [...groups].map(([key, copies]) => {
    const ordered = [...copies].sort(newestFirst);
    return {
      key,
      cards: ordered,
      representative:
        ordered.find(card => card.instanceId === preferred[key]) ??
        (preferred[key] ? ordered.find(card => card.shiny) : undefined) ??
        ordered.find(card => card.customImageUrl) ??
        ordered[0],
      firstObtainedAt: ordered[ordered.length - 1].obtainedAt,
      isFirstOwner: ordered.some(
        card => card.rarity === "LR" && card.isFirstOwner
      )
    };
  });
}

// Destructive actions keep custom art when there are enough ordinary copies.
export function preservationOrder(cards: CollectedCard[]): CollectedCard[] {
  return [...cards].sort(
    (a, b) =>
      Number(a.shiny) - Number(b.shiny) ||
      Number(!!a.customImageUrl) - Number(!!b.customImageUrl) ||
      Date.parse(a.obtainedAt) - Date.parse(b.obtainedAt) ||
      a.instanceId.localeCompare(b.instanceId)
  );
}

export function consumableCopies(
  cards: CollectedCard[],
  isFrozen: (instanceId: string) => boolean
): CollectedCard[] {
  return preservationOrder(cards.filter(card => !isFrozen(card.instanceId)));
}

export function consumptionPlan(
  cards: CollectedCard[],
  quantity: number,
  isFrozen: (instanceId: string) => boolean
): CollectedCard[] {
  return consumableCopies(cards, isFrozen).slice(0, Math.max(0, quantity));
}

export function selectGroupQuantity(
  current: ReadonlySet<string>,
  cards: CollectedCard[],
  quantity: number
): Set<string> {
  const groupIds = new Set(cards.map(card => card.instanceId));
  const next = new Set([...current].filter(id => !groupIds.has(id)));
  for (const card of consumptionPlan(cards, quantity, () => false))
    next.add(card.instanceId);
  return next;
}

export function pruneUnavailableSelection(
  current: ReadonlySet<string>,
  cards: CollectedCard[]
) {
  const available = new Set(cards.map(card => card.instanceId));
  const selected = new Set([...current].filter(id => available.has(id)));
  return { selected, removed: [...current].filter(id => !available.has(id)) };
}
