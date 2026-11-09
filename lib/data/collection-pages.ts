import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import type { CollectedCard } from "@/lib/data/cards";
import type { CollectionFilters } from "@/lib/ui/collection-filter";

// #388: the collection screen reads one page of groups instead of every copy.
// Each read resolves to null while the migration is not applied, so the
// caller keeps the previous full load.
export type ServerCopy = CollectedCard & { frozen: boolean };
export type CollectionPageGroup = {
  key: string;
  copies: ServerCopy[];
  firstOwner: boolean;
};
export type CollectionPage = {
  total: number;
  offset: number;
  groups: CollectionPageGroup[];
  next: string | null;
};
export type CollectionCounts = {
  copies: number;
  groups: number;
  rarities: Record<string, number>;
  categories: Record<string, number>;
  frozen: number;
  locked: number;
  unfiled: number;
  folders: Record<string, number>;
};

type RawCopy = Omit<ServerCopy, "anime"> & { anime: string | null };
const copy = (raw: RawCopy): ServerCopy => ({
  ...raw,
  anime: raw.anime || undefined
});
const missing = (error: { code?: string }) =>
  error.code === "PGRST202" || error.code === "42883";

async function rpc<T>(name: string, args?: Record<string, unknown>) {
  const { data, error } = await readRequest(signal =>
    createClient().rpc(name, args).abortSignal(signal)
  );
  if (error && missing(error)) return null;
  if (error) throw new Error(error.message);
  return data as T;
}

export async function getCollectionGroupsPage(
  filters: CollectionFilters,
  position: { after?: string | null; offset?: number; limit: number }
): Promise<CollectionPage | null> {
  const page = await rpc<
    Omit<CollectionPage, "groups"> & {
      groups: (Omit<CollectionPageGroup, "copies"> & { copies: RawCopy[] })[];
    }
  >("get_collection_groups_page", {
    p_query: filters.query,
    p_categories: filters.category.length ? filters.category : null,
    p_rarities: filters.rarity.length ? filters.rarity : null,
    p_shiny_only: filters.shinyOnly,
    p_folder: filters.folder || null,
    p_auction_only: filters.auctionOnly,
    p_locked_only: filters.lockedOnly,
    ...(filters.duplicatesOnly ? { p_duplicates_only: true } : {}),
    p_sort: filters.sort,
    p_after: position.after ?? null,
    p_offset: position.offset ?? 0,
    p_limit: position.limit
  });
  return (
    page && {
      ...page,
      groups: page.groups.map(group => ({
        ...group,
        copies: group.copies.map(copy)
      }))
    }
  );
}

export const getCollectionCounts = () =>
  rpc<CollectionCounts>("get_collection_counts");

export async function getCollectionGroupCopies(key: string) {
  const copies = await rpc<RawCopy[]>("get_collection_group_copies", {
    p_key: key
  });
  return copies && copies.map(copy);
}

export async function getCollectionOwnedCopies(cardIds: string[]) {
  const copies = await rpc<RawCopy[]>("get_collection_owned_copies", {
    p_card_ids: cardIds
  });
  return copies && copies.map(copy);
}

export const getCollectionLicenseCopies = (license: string) =>
  rpc<number>("get_collection_license_copies", { p_license: license });

export type CollectionPagesAdapter = {
  page: typeof getCollectionGroupsPage;
  counts: typeof getCollectionCounts;
  groupCopies: typeof getCollectionGroupCopies;
  ownedCopies: typeof getCollectionOwnedCopies;
  licenseCopies: typeof getCollectionLicenseCopies;
};
export const liveCollectionPages: CollectionPagesAdapter = {
  page: getCollectionGroupsPage,
  counts: getCollectionCounts,
  groupCopies: getCollectionGroupCopies,
  ownedCopies: getCollectionOwnedCopies,
  licenseCopies: getCollectionLicenseCopies
};
