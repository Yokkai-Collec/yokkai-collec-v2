import type { CollectedCard, Rarity } from "@/lib/data/cards";
import { matchesCardSearch } from "@/lib/ui/card-search";
import { sortCollection, type CollectionSort } from "@/lib/ui/collection-sort";

import { collectionGroupKey } from "@/lib/ui/collection-groups";

export type CollectionFilters = {
  query: string;
  folders?: { id: string; cardIds?: string[] }[];
  category: string[];
  rarity: Rarity[];
  shinyOnly: boolean;
  folder: string | "unfiled" | "";
  auctionOnly: boolean;
  lockedOnly: boolean;
  duplicatesOnly?: boolean;
  sort: CollectionSort;
};

// The collection screen's filters and order. get_collection_groups_page
// (#388) reproduces this exactly in SQL; keep both in step.
export function filterCollection(
  cards: CollectedCard[],
  filters: CollectionFilters,
  isFrozen: (instanceId: string) => boolean
): CollectedCard[] {
  const {
    query,
    category,
    rarity,
    shinyOnly,
    folder,
    auctionOnly,
    lockedOnly
  } = filters;
  const counts = new Map<string, number>();
  if (filters.duplicatesOnly)
    for (const card of cards) {
      const key = collectionGroupKey(card);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  return sortCollection(
    cards.filter(
      c =>
        // Keep the client fallback aligned with the catalogue: a query targets
        // a card name or its licence, never a broad category/binder label.
        // Server pages additionally match the catalogue's hidden licences.
        matchesCardSearch(query, [c.name, c.anime]) &&
        (!category.length || category.includes(c.category)) &&
        (!rarity.length || rarity.includes(c.rarity)) &&
        (!shinyOnly || c.shiny || c.isEvolved) &&
        (!folder ||
          (folder === "unfiled"
            ? !c.folderId &&
              !filters.folders?.some(f => f.cardIds?.includes(c.id))
            : c.folderId === folder ||
              !!filters.folders
                ?.find(f => f.id === folder)
                ?.cardIds?.includes(c.id))) &&
        (!auctionOnly || isFrozen(c.instanceId)) &&
        (!lockedOnly || !!c.locked) &&
        (!filters.duplicatesOnly ||
          (counts.get(collectionGroupKey(c)) ?? 0) > 1)
    ),
    filters.sort
  );
}
