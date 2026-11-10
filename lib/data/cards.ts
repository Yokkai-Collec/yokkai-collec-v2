import { readRequest, resumePages, type PageCheckpoint } from "@/lib/data/read-request";
import { createClient } from "@/utils/supabase/client";
import { cardSearchTerms } from "@/lib/ui/card-search";
import type { CollectionSort } from "@/lib/ui/collection-sort";
import { createPlayerSnapshotCache, PLAYER_SNAPSHOT_TTL, publishPlayerSnapshotInvalidation, subscribePlayerSnapshotInvalidation, type PlayerSnapshotScope } from "@/lib/data/player-state";

export type Rarity = "C" | "R" | "SR" | "SSR" | "LR";
// One value, several values, or "" for no filter. Several values travel as a
// JSON array in the same RPC parameter (see public.card_filter_values).
export type CardFilter = string | readonly string[];
export function cardFilterParam(value: CardFilter = ""): string {
  if (typeof value === "string") return value;
  return value.length > 1 ? JSON.stringify(value) : (value[0] ?? "");
}
export type Category = string;
export type Card = { id: string; name: string; category: Category; anime?: string; liveFranchise?: boolean; rarity: Rarity; image: string; shiny?: boolean; wishlisted?: boolean; binders?: import("@/lib/ui/binder-identity").CardBinder[] };
export type CataloguePage = { cards: Card[]; total: number };
type CatalogueSearchPage = { items: Card[]; total: number };
export type LicenseCatalogueTotal = { license: string; total: number; binderKey?: string; origin?: "series" | "source" };
export type PaniniAlbumProgress = LicenseCatalogueTotal & {
  image?: string;
  owned: number;
  percent: number;
  favorite: boolean;
};
export type PaniniAlbumPage = {
  items: PaniniAlbumProgress[];
  total: number;
  favoriteConflicts?: import("@/lib/data/binders").FavoriteConflict[];
  mappingVersion?: string;
};
export async function withAlbumCovers(page: PaniniAlbumPage | null, owner?: string): Promise<PaniniAlbumPage> {
  const base = page ?? { items: [], total: 0 };
  try {
    const { withCollectionCovers } = await import("@/lib/data/collection-covers");
    return { ...base, items: await withCollectionCovers(base.items, item => item.binderKey ?? item.license, owner) };
  } catch {
    return base;
  }
}
export type PaniniAlbumCard = Card & { owned: boolean };
export type PaniniAlbumCardPage = {
  items: PaniniAlbumCard[];
  total: number;
  binderTotal?: number;
  binderOwned?: number;
};
export type CollectedCard = Card & { instanceId: string; obtainedAt: string; shiny: boolean; isEvolved: boolean; isFirstOwner: boolean; locked?: boolean; folderId: string | null; catalogueImage: string; customImageUrl: string | null; destructionValue?: number };
export type Folder = { id: string; name: string; cardIds?: string[] };
export type ActiveAuctionCard = { instanceId: string; auctionId: string; endsAt: string };
export type PackStatus = {
  available: number;
  maximum: number;
  nextPackAt: number | null;
  reserve?: number;
  bonus?: number;
};
export type DecisionPackStatus = {
  available: boolean; nextPackAt: number; pending: (CollectedCard & { discarded?: boolean })[];
  // Optional while older deployments and isolated previews still return timers.
  remaining?: number; maximum?: number; resetAt?: number; resetTimeZone?: "Europe/Paris";
};
export type DecisionPackChoice = CollectedCard & { karasReward: number };
type GameInfo = {
  user: { id: string; name: string }; categories: Category[]; rarities: Rarity[];
  dropRates: { rarity: Rarity; percent: number }[]; decisionDropRates?: { rarity: Rarity; percent: number }[]; shinyRate: number; karasBalance: number;
};
type CardRow = { id: string; nom: string; categorie: string; franchise?: string | null; rarete_base: Rarity; image_url: string };
type OwnedRow = { id: string; date_obtention: string; is_shiny: boolean; is_evolved: boolean; is_first_owner: boolean; is_locked: boolean; folder_id: string | null; custom_image_url: string | null; cards: CardRow };
const cardFields = "id,nom,categorie,franchise,rarete_base,image_url";
const rank: Record<Rarity, number> = { C: 0, R: 1, SR: 2, SSR: 3, LR: 4 };
const PAGE_SIZE = 500;
const FRANCHISE_BATCH = 200;

function failure(error: { message?: string; code?: string }) {
  const keys: Record<string, string> = {
  "42501": "cardErrors.yourDataIsTemporarilyUnavailableRefreshThePage",
  "AUTH_REQUIRED": "cardErrors.authRequired",
  "PROFILE_MISSING": "cardErrors.profileMissing",
  "PACK_NOT_READY": "cardErrors.packNotReady",
  "INVALID_PACK_COUNT": "cardErrors.invalidPackCount",
  "INSUFFICIENT_PACKS": "cardErrors.insufficientPacks",
  "CATALOGUE_INCOMPLETE": "cardErrors.catalogueIncomplete",
  "THREE_DISTINCT_LR_COPIES_REQUIRED": "cardErrors.threeDistinctLrCopiesRequired",
  "FIVE_DISTINCT_LR_COPIES_REQUIRED": "cardErrors.threeDistinctLrCopiesRequired",
  "INVALID_LR_COPIES": "cardErrors.invalidLrCopies",
  "FIVE_DISTINCT_SSR_COPIES_REQUIRED": "cardErrors.fiveDistinctSsrCopiesRequired",
  "INVALID_SSR_COPIES": "cardErrors.invalidSsrCopies",
  "SSR_CARD_NOT_OWNED": "cardErrors.ssrCardNotOwned",
  "NOT_ENOUGH_SSR_COPIES": "cardErrors.notEnoughSsrCopies",
  "DECISION_PACK_NOT_READY": "cardErrors.decisionPackNotReady",
  "DECISION_PACK_NOT_PENDING": "cardErrors.decisionPackNotPending",
  "DECISION_CHOICE_UNAVAILABLE": "cardErrors.decisionChoiceUnavailable",
  "DECISION_LAST_CHOICE": "cardErrors.decisionLastChoice",
  "CARD_NOT_OWNED": "cardErrors.cardNotOwned",
  "CARD_FROZEN": "cardErrors.cardFrozen",
  "CARD_LOCKED": "cardErrors.cardLocked",
  "INVALID_CARD_SELECTION": "cardErrors.invalidCardSelection",
  "LICENSE_FOLDER_NAME_TAKEN": "licenseFolders.nameTaken",
  "LICENSE_FOLDER_NAME_INVALID": "licenseFolders.invalidName",
  "LICENSE_FOLDER_LIMIT": "licenseFolders.folderLimit",
  "LICENSE_FOLDER_NOT_FOUND": "licenseFolders.notFound",
  "FOLDER_NAME_TAKEN": "cardErrors.folderNameTaken",
  "FOLDER_NOT_FOUND": "cardErrors.folderNotFound",
  "PGRST301": "cardErrors.authRequired",
  "PRO_REQUIRED": "cardErrors.thisFeatureIsAvailableToProMembersOnly",
  "INVALID_IMGUR_URL": "cardErrors.enterAValidImgurLinkStartingWithHttps",
  "CUSTOM_IMAGE_TOO_LARGE": "cardErrors.customImageTooLarge"
};
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "Sign in to view your collection and packs.",
    PROFILE_MISSING: "Your profile couldn't be found. The game couldn't be loaded.",
    PACK_NOT_READY: "No packs available right now.",
    INVALID_PACK_COUNT: "Choose 1, 5, or 10 Regular Packs.",
    INSUFFICIENT_PACKS: "You don't have enough packs for this batch. Choose a smaller quantity.",
    CATALOGUE_INCOMPLETE: "The catalog isn't ready yet. Please try again later.",
    THREE_DISTINCT_LR_COPIES_REQUIRED: "Choose exactly three different copies of the same LR card.",
    FIVE_DISTINCT_LR_COPIES_REQUIRED: "Choose exactly three different copies of the same LR card.",
    INVALID_LR_COPIES: "Only three identical LR copies can evolve. Already evolved cards are excluded.",
    FIVE_DISTINCT_SSR_COPIES_REQUIRED: "Choose exactly five different copies of the same standard SSR card.",
    INVALID_SSR_COPIES: "Choose five identical standard SSR copies.",
    SSR_CARD_NOT_OWNED: "This SSR copy is no longer in your collection.",
    NOT_ENOUGH_SSR_COPIES: "You need five identical SSR copies for this evolution.",
    DECISION_PACK_NOT_READY: "Your daily Decision Pack isn't available yet.",
    DECISION_PACK_NOT_PENDING: "This Decision Pack is no longer available.",
    DECISION_CHOICE_UNAVAILABLE: "This Decision Pack card is no longer available.",
    DECISION_LAST_CHOICE: "You must keep the last card.",
    CARD_NOT_OWNED: "This card is no longer in your collection.",
    CARD_FROZEN: "This card is listed in an auction and can't be destroyed.",
    CARD_LOCKED: "This card is locked. Unlock it before doing this.",
    INVALID_CARD_SELECTION: "Invalid card selection. Select between 1 and 500 copies.",
    FOLDER_NAME_TAKEN: "A folder with this name already exists.",
    FOLDER_NOT_FOUND: "This folder no longer exists.",
    CUSTOM_IMAGE_TOO_LARGE: "This image is too heavy (8 MB max). Choose a lighter one.",
  };
  if (error.message === "ECONOMIC_MAINTENANCE") return new Error(error.message, { cause: { i18nKey: "cardErrors.economicMaintenance" } });
  if (error.message === "PRO_REQUIRED") return new Error("This feature is available to Pro members only.", { cause: { i18nKey: keys[error.message ?? ""] ?? keys[error.code ?? ""] ?? "cardErrors.couldntReachGameDataPleaseTryAgainIn" } });
  if (error.message === "INVALID_IMGUR_URL") return new Error("Enter a valid Imgur link starting with https://i.imgur.com/ or https://imgur.com/.", { cause: { i18nKey: keys[error.message ?? ""] ?? keys[error.code ?? ""] ?? "cardErrors.couldntReachGameDataPleaseTryAgainIn" } });
  if (error.message && messages[error.message]) return new Error(messages[error.message], { cause: { i18nKey: keys[error.message ?? ""] ?? keys[error.code ?? ""] ?? "cardErrors.couldntReachGameDataPleaseTryAgainIn" } });
  if (error.code === "PGRST301") return new Error(messages.AUTH_REQUIRED, { cause: { i18nKey: keys[error.message ?? ""] ?? keys[error.code ?? ""] ?? "cardErrors.couldntReachGameDataPleaseTryAgainIn" } });
  if (error.code === "42501") return new Error("Your data is temporarily unavailable. Refresh the page or sign in again.", { cause: { i18nKey: keys[error.message ?? ""] ?? keys[error.code ?? ""] ?? "cardErrors.couldntReachGameDataPleaseTryAgainIn" } });
  return new Error("Couldn't reach game data. Please try again in a moment.", { cause: { i18nKey: keys[error.message ?? ""] ?? keys[error.code ?? ""] ?? "cardErrors.couldntReachGameDataPleaseTryAgainIn" } });
}

function cardFromRow(row: CardRow): Card {
  return { id: row.id, name: row.nom, category: row.categorie, anime: row.franchise || undefined, rarity: row.rarete_base, image: row.image_url };
}

export async function withLiveCardFranchises<T extends Card>(cards: T[], bounded = false): Promise<T[]> {
  if (!cards.length) return cards;
  const ids = [...new Set(cards.filter(card => card.liveFranchise !== true).map(card => card.id))];
  if (!ids.length) {
    const current = cards.map(card => ({ ...card, anime: card.anime?.trim() || undefined }));
    return typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true"
      ? (await import("@/lib/data/binders")).withBinderMetadata(current) : current;
  }
  // Batched: the gateway rejects GET URLs above ~25 KB (≈700 uuids) with a bare 400.
  const batches = Array.from({ length: Math.ceil(ids.length / FRANCHISE_BATCH) }, (_, i) => ids.slice(i * FRANCHISE_BATCH, (i + 1) * FRANCHISE_BATCH));
  const results = await Promise.all(batches.map(batch => { const query = db().from("cards").select("id,franchise").in("id", batch); return bounded ? readRequest(signal => query.abortSignal(signal)) : query; }));
  const failed = results.find(result => result.error);
  if (failed?.error) throw failure(failed.error);
  const rows = results.flatMap(result => result.data as {id:string;franchise:string|null}[]);
  const franchises = new Map(rows.map(row => [row.id, row.franchise?.trim() || undefined]));
  const current = cards.map(card => ({ ...card, anime: card.liveFranchise === true ? card.anime?.trim() || undefined : franchises.get(card.id) }));
  return typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true"
    ? (await import("@/lib/data/binders")).withBinderMetadata(current) : current;
}

async function withPackDestructionValues<T extends Card & {instanceId:string}>(cards:T[], bounded = false):Promise<(T & {destructionValue:number})[]> {
  if(!cards.length)return [];
  const query=db().rpc("get_pack_destruction_values",{p_instance_ids:cards.map(card=>card.instanceId)});
  const {data,error}=await (bounded ? readRequest(signal => query.abortSignal(signal)) : query);
  if(error)throw failure(error);
  const values=data as Record<string,number>;
  return cards.map(card=>{
    const destructionValue=values[card.instanceId];
    if(!Number.isInteger(destructionValue))throw failure({message:"DESTRUCTION_VALUE_MISSING"});
    return {...card,destructionValue};
  });
}

// Memory-only caches avoid reloading the collection at every one-second UI tick.
const cache = createPlayerSnapshotCache();
const collectionPages = new Map<string, PageCheckpoint<OwnedRow>>();
let client: ReturnType<typeof createClient> | undefined;
function db() {
  if (!client) {
    client = createClient();
    let userId: string | undefined;
    client.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== userId) {
        userId = session?.user.id;
        cache.clear();
        collectionPages.clear();
      }
    });
  }
  return client;
}

// Local session read: getClaims calls /auth/v1/user on every poll when Auth signs
// with a symmetric secret (self-hosted). RLS still enforces ownership server-side.
async function playerId(bounded = false) {
  const { data, error } = bounded ? await readRequest(() => db().auth.getSession()) : await db().auth.getSession();
  const id = data?.session?.user.id;
  if (error || !id) throw failure({ message: "AUTH_REQUIRED" });
  return id;
}

async function assertPlayer(id: string, bounded = false) {
  if (await playerId(bounded) !== id) throw failure({ message: "AUTH_REQUIRED" });
}

function clearPlayerSnapshotCaches(scopes: readonly PlayerSnapshotScope[]) {
  for (const scope of scopes) cache.deleteScope(scope);
  if (scopes.includes("collection")) collectionPages.clear();
}

export function invalidatePlayerSnapshots(scopes: readonly PlayerSnapshotScope[]) {
  clearPlayerSnapshotCaches(scopes);
  publishPlayerSnapshotInvalidation(scopes);
}

subscribePlayerSnapshotInvalidation(clearPlayerSnapshotCaches);

export async function getAllCards(): Promise<Card[]> {
  const cards: Card[] = [];
  let cursor: string | undefined;
  while (true) {
    let query = db().from("cards").select(cardFields).order("id").limit(PAGE_SIZE);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw failure(error);
    if (!data?.length) break;
    const rows = data as CardRow[];
    cards.push(...rows.map(cardFromRow));
    cursor = rows[rows.length - 1].id;
  }
  return cards;
}

export async function getLicenseCatalogueTotals(): Promise<LicenseCatalogueTotal[]> {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true") {
    const { data, error } = await db().rpc("get_binder_catalogue_totals");
    if (error) throw failure(error);
    return (data ?? []) as LicenseCatalogueTotal[];
  }
  return cache.memo<LicenseCatalogueTotal[]>("catalogue:license-totals", 30_000, async () => {
    const totals = new Map<string, number>();
    let cursor: string | undefined;
    while (true) {
      let query = db().from("cards").select("id,franchise").order("id").limit(PAGE_SIZE);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await query;
      if (error) throw failure(error);
      if (!data?.length) break;
      const rows = data as { id: string; franchise: string | null }[];
      for (const row of rows) {
        const license = row.franchise?.trim();
        if (license) totals.set(license, (totals.get(license) ?? 0) + 1);
      }
      cursor = rows[rows.length - 1].id;
    }
    return [...totals].map(([license, total]) => ({ license, total }));
  });
}

export async function getPaniniAlbumsPage({
  query = "",
  category = "",
  favoritesOnly = false,
  page = 1,
  pageSize = 72
}: {
  query?: string;
  category?: CardFilter;
  favoritesOnly?: boolean;
  page?: number;
  pageSize?: number;
} = {}): Promise<PaniniAlbumPage> {
  const safePage = Math.max(1, Math.trunc(page));
  const safePageSize = Math.min(72, Math.max(1, Math.trunc(pageSize)));
  const stable = typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true";
  const { data, error } = await db().rpc(stable ? "get_binder_albums_page" : "get_panini_albums_page", stable ? {
    p_owner_id: null, p_query: query, p_category: cardFilterParam(category), p_favorites_only: favoritesOnly,
    p_offset: (safePage - 1) * safePageSize, p_limit: safePageSize
  } : {
    p_query: query,
    p_category: cardFilterParam(category),
    p_favorites_only: favoritesOnly,
    p_offset: (safePage - 1) * safePageSize,
    p_limit: safePageSize
  });
  if (error) throw failure(error);
  const result = data as PaniniAlbumPage | null;
  return withAlbumCovers({ items: result?.items ?? [], total: result?.total ?? 0,
    ...(stable ? { favoriteConflicts: result?.favoriteConflicts ?? [], mappingVersion: result?.mappingVersion } : {}) });
}

export async function getPaniniAlbumCardsPage({
  license,
  query = "",
  category = "",
  rarity = "",
  ownedOnly = false,
  page = 1,
  pageSize = 24,
  sort = "rarity"
}: {
  license: string;
  query?: string;
  category?: CardFilter;
  rarity?: CardFilter;
  ownedOnly?: boolean;
  page?: number;
  pageSize?: number;
  sort?: CollectionSort;
}): Promise<PaniniAlbumCardPage> {
  const rarityParam = cardFilterParam(rarity);
  const safePage = Math.max(1, Math.trunc(page));
  const safePageSize = Math.min(60, Math.max(1, Math.trunc(pageSize)));
  const stable = typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true";
  const { data, error } = await db().rpc(stable ? "get_binder_cards_page" : "get_panini_album_cards_page", stable ? {
    p_owner_id: null, p_binder_key: license, p_query: query, p_category: cardFilterParam(category),
    p_owned_only: ownedOnly, p_offset: (safePage - 1) * safePageSize, p_limit: safePageSize, p_rarity: rarityParam, p_sort: sort
  } : {
    p_license: license,
    p_query: query,
    p_category: cardFilterParam(category),
    p_owned_only: ownedOnly,
    p_offset: (safePage - 1) * safePageSize,
    p_limit: safePageSize,
    ...(rarityParam ? { p_rarity: rarityParam } : {})
  });
  if (error) throw failure(error);
  const result = data as PaniniAlbumCardPage | null;
  return { items: result?.items ?? [], total: result?.total ?? 0,
    ...(stable ? { binderTotal: result?.binderTotal, binderOwned: result?.binderOwned } : {}) };
}

export async function setPaniniAlbumFavorite(
  license: string,
  favorite: boolean
): Promise<void> {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true") {
    const { error } = await db().rpc("set_binder_favorite", { p_binder_key: license, p_favorite: favorite });
    if (error) throw failure(error);
    return;
  }
  const id = await playerId();
  const safeLicense = license.trim();
  if (!safeLicense || safeLicense.length > 200)
    throw new Error("This binder can't be added to favorites.");
  const request = favorite
    ? db()
        .from("panini_album_favorites")
        .insert({ user_id: id, license: safeLicense })
    : db()
        .from("panini_album_favorites")
        .delete()
        .eq("user_id", id)
        .eq("license", safeLicense);
  const { error } = await request;
  if (error) throw failure(error);
  await assertPlayer(id);
}

export async function searchCards(query: string, limit = 30): Promise<Card[]> {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true") return (await getCataloguePage({ query, pageSize: Math.min(60, Math.max(1, limit)) })).cards;
  const id = await playerId();
  const { data, error } = await db().rpc("search_cards", { p_query: query.trim(), p_limit: limit });
  if (error) throw failure(error);
  await assertPlayer(id);
  return (data as Card[]).map(card => ({ ...card }));
}

export async function getCataloguePage({ query = "", category = "", rarity = "", page = 1, pageSize = 24 }: {
  query?: string; category?: CardFilter; rarity?: CardFilter; page?: number; pageSize?: number;
} = {}): Promise<CataloguePage> {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true") {
    const safeSize = Math.min(60, Math.max(1, Math.trunc(pageSize)));
    // Catalogue queries match card names and attached licenses. Binder aliases
    // are discovery terms for albums, not licenses belonging to every card.
    const terms = cardSearchTerms(query);
    const rpc = terms.length ? "get_catalogue_cards_page" : "get_binder_catalogue_page";
    const { data, error } = await db().rpc(rpc, { p_query: terms.join(" "), p_category: cardFilterParam(category), p_rarity: cardFilterParam(rarity), p_offset: (Math.max(1, Math.trunc(page)) - 1) * safeSize, p_limit: safeSize, p_sort: "rarity" });
    if (error) throw failure(error);
    const result = data as CatalogueSearchPage | null;
    const { withBinderMetadata } = await import("@/lib/data/binders");
    return { cards: await withBinderMetadata(result?.items ?? []), total: result?.total ?? 0 };
  }
  const safePage = Math.max(1, Math.trunc(page));
  const safePageSize = Math.min(60, Math.max(1, Math.trunc(pageSize)));
  const from = (safePage - 1) * safePageSize;
  const terms=cardSearchTerms(query);
  if(terms.length){
    const {data,error}=await db().rpc("get_catalogue_cards_page",{
      p_query:terms.join(" "),p_category:cardFilterParam(category),p_rarity:cardFilterParam(rarity),
      p_offset:from,p_limit:safePageSize,p_sort:"rarity"
    });
    if(error)throw failure(error);
    const result=data as CatalogueSearchPage|null;
    return {cards:(result?.items??[]).map(card=>({...card})),total:result?.total??0};
  }
  async function readPage(count?:"exact") {
    let request=db().from("cards").select(cardFields,count?{count}:undefined);
    const categories=typeof category==="string"?(category?[category]:[]):category;
    const rarities=typeof rarity==="string"?(rarity?[rarity]:[]):rarity;
    if(categories.length===1)request=request.eq("categorie",categories[0]);
    else if(categories.length)request=request.in("categorie",[...categories]);
    if(rarities.length===1)request=request.eq("rarete_base",rarities[0]);
    else if(rarities.length)request=request.in("rarete_base",[...rarities]);
    const result=await request.order("rarete_base", { ascending: false }).order("nom").order("id").range(from,from+safePageSize-1);
    if(result.error)throw failure(result.error);
    return result;
  }
  let rows:CardRow[]|undefined;
  // Keep exact pagination; imports may update the total on the next 30-second refresh.
  const total=await cache.memo<number>(`catalogue:${JSON.stringify([terms,category,rarity])}`,30_000,async()=>{
    const result=await readPage("exact");rows=(result.data??[]) as CardRow[];return result.count??0;
  });
  rows??=((await readPage()).data??[]) as CardRow[];
  return {cards:rows.map(cardFromRow),total};
}

export async function getGameInfo(): Promise<GameInfo> {
  const id = await playerId(true);
  const info = await cache.memo<GameInfo>(`info:${id}`, PLAYER_SNAPSHOT_TTL.balance, async () => {
    const { data, error } = await readRequest(signal => db().rpc("get_game_info").abortSignal(signal));
    if (error) throw failure(error);
    return data as GameInfo;
  });
  await assertPlayer(id, true);
  return { ...info, user: { ...info.user }, categories: [...info.categories],
    rarities: [...info.rarities], dropRates: info.dropRates.map((rate) => ({ ...rate })),
    decisionDropRates: info.decisionDropRates?.map(rate => ({ ...rate })) };
}

export async function getUserCollection(includeBinderMetadata = true): Promise<CollectedCard[]> {
  const id = await playerId(true);
  const collection = await cache.memo<CollectedCard[]>(`collection:${id}`, PLAYER_SNAPSHOT_TTL.collection, async () => {
    const checkpoint = collectionPages.get(id) ?? { rows: [] };
    collectionPages.set(id, checkpoint);
    const rows = await resumePages(checkpoint, PAGE_SIZE, async cursor => {
      let query = db().from("user_cards").select(`id,date_obtention,is_shiny,is_evolved,is_first_owner,is_locked,folder_id,custom_image_url,cards!inner(${cardFields})`)
        .eq("user_id", id).order("id").limit(PAGE_SIZE);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await readRequest(signal => query.abortSignal(signal));
      if (error) throw failure(error);
      return (data ?? []) as unknown as OwnedRow[];
    });
    if (collectionPages.get(id) === checkpoint) collectionPages.delete(id);
    const cards = rows.map(row => ({ ...cardFromRow(row.cards), image: row.custom_image_url || row.cards.image_url,
      catalogueImage: row.cards.image_url, customImageUrl: row.custom_image_url, instanceId: row.id,
      obtainedAt: row.date_obtention, shiny: row.is_shiny, isEvolved: row.is_evolved,
      isFirstOwner: row.is_first_owner, locked: row.is_locked, folderId: row.folder_id }));
    return cards.sort((a, b) => rank[b.rarity] - rank[a.rarity] ||
      Date.parse(b.obtainedAt) - Date.parse(a.obtainedAt) || a.instanceId.localeCompare(b.instanceId));
  });
  await assertPlayer(id, true);
  const result = collection.map((card) => ({ ...card }));
  if (includeBinderMetadata && typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true") return (await import("@/lib/data/binders")).withBinderMetadata(result);
  return result;
}

export async function getActiveAuctionCards(sharePending = false): Promise<ActiveAuctionCard[]> {
  const id = await playerId(true);
  const { data, error } = await (sharePending ? cache.memo(`read:get_my_active_auction_cards:${id}`, 0, () => readRequest(signal => db().rpc("get_my_active_auction_cards").abortSignal(signal))) : readRequest(signal => db().rpc("get_my_active_auction_cards").abortSignal(signal)));
  if (error) throw failure(error);
  await assertPlayer(id, true);
  return (data as ActiveAuctionCard[]).map(auction => ({ ...auction }));
}

export async function getPackStatus(sharePending = false): Promise<PackStatus> {
  const id = await playerId(true);
  const { data, error } = await (sharePending ? cache.memo(`read:get_regular_pack_status:${id}`, 0, () => readRequest(signal => db().rpc("get_regular_pack_status").abortSignal(signal))) : readRequest(signal => db().rpc("get_regular_pack_status").abortSignal(signal)));
  if (error) throw failure(error);
  await assertPlayer(id, true);
  const status = data as PackStatus & { serverNow: number };
  // Display clock only: availability and consumption always use database time.
  return { available: status.available, maximum: status.maximum,
    nextPackAt: status.nextPackAt === null ? null : Date.now() + status.nextPackAt - status.serverNow,
    reserve: status.reserve, bonus: status.bonus };
}

export async function getDecisionPackStatus(includeCardDetails = true): Promise<DecisionPackStatus> {
  const id = await playerId(true);
  const read = async () => {
    const { data, error } = await readRequest(signal => db().rpc("get_decision_pack_status").abortSignal(signal));
    if (error) throw failure(error);
    return data as DecisionPackStatus & { serverNow: number };
  };
  const status = includeCardDetails ? await read() : await cache.memo(`read:decision:${id}`, 0, read);
  // Initial panels need only availability and pending.length. Opening retains
  // its existing enrichment path, without delaying either initial status.
  const pending = includeCardDetails ? await cache.memo(`read:decision-details:${id}`, 0, async () =>
    withPackDestructionValues(await withLiveCardFranchises(status.pending, true), true)) : status.pending;
  await assertPlayer(id, true);
  return { available: status.available,
    nextPackAt: Date.now() + status.nextPackAt - status.serverNow, pending,
    remaining: status.remaining, maximum: status.maximum,
    resetAt: status.resetAt, resetTimeZone: status.resetTimeZone };
}
export async function openBooster(): Promise<CollectedCard[]> {
  const id = await playerId();
  try {
    // One transaction; no direct writes or automatic retry on timeout.
    const { data, error } = await db().rpc("open_regular_pack");
    if (error) throw failure(error);
    await assertPlayer(id);
    const cards = data as CollectedCard[];
    const [franchised, valued] = await Promise.all([withLiveCardFranchises(cards), withPackDestructionValues(cards)]);
    return valued.map((card, index) => ({ ...card, anime: franchised[index].anime })).sort((a, b) => rank[a.rarity] - rank[b.rarity]);
  } finally {
    // The server may have committed even if the response was lost.
    invalidatePlayerSnapshots(["collection"]);
  }
}

export async function openBoosters(count: 1 | 5 | 10): Promise<CollectedCard[]> {
  if (![1, 5, 10].includes(count)) throw failure({ message: "INVALID_PACK_COUNT" });
  if (count === 1) return openBooster();
  const id = await playerId();
  try {
    // One bounded transaction, not a client loop; never retry a reward mutation.
    const { data, error } = await db().rpc("open_regular_packs", { p_count: count });
    if (error) throw failure(error);
    await assertPlayer(id);
    const cards = data as CollectedCard[];
    const [franchised, valued] = await Promise.all([withLiveCardFranchises(cards), withPackDestructionValues(cards)]);
    return valued.map((card, index) => ({ ...card, anime: franchised[index].anime })).sort((a, b) => rank[a.rarity] - rank[b.rarity]);
  } finally {
    // The whole batch may have committed even when its response was lost.
    invalidatePlayerSnapshots(["collection"]);
  }
}

export async function evolveSsrCard(instanceIds: string[]): Promise<CollectedCard> {
  const id = await playerId();
  try {
    const { data, error } = await db().rpc("evolve_ssr_card", { p_card_instance_ids: instanceIds });
    if (error) throw failure(error);
    await assertPlayer(id);
    return (await withLiveCardFranchises([data as CollectedCard]))[0];
  } finally {
    cache.delete(`collection:${id}`);
    collectionPages.delete(id);
  }
}

export async function evolveLrCard(instanceIds: string[]): Promise<CollectedCard> {
  const id = await playerId();
  try {
    const { data, error } = await db().rpc("evolve_lr_card", { p_card_instance_ids: instanceIds });
    if (error) throw failure(error);
    await assertPlayer(id);
    return (await withLiveCardFranchises([data as CollectedCard]))[0];
  } finally {
    cache.delete(`collection:${id}`);
    collectionPages.delete(id);
  }
}

export async function openDecisionPack(): Promise<DecisionPackStatus["pending"]> {
  const id = await playerId();
  const { data, error } = await db().rpc("open_decision_pack");
  if (error) throw failure(error);
  await assertPlayer(id);
  const cards = data as DecisionPackStatus["pending"];
  const [franchised, valued] = await Promise.all([withLiveCardFranchises(cards), withPackDestructionValues(cards)]);
  return valued.map((card, index) => ({ ...card, anime: franchised[index].anime }));
}

export async function keepDecisionPackCard(choiceId: string): Promise<DecisionPackChoice> {
  const id = await playerId();
  try {
    const { data, error } = await db().rpc("keep_decision_pack_card", { p_choice_id: choiceId });
    if (error) throw failure(error);
    await assertPlayer(id);
    return (await withLiveCardFranchises([data as DecisionPackChoice]))[0];
  } finally {
    // The automatically discarded Decision cards credit Karas too.
    invalidatePlayerSnapshots(["collection", "balance"]);
  }
}

export async function discardDecisionPack(): Promise<number> {
  const id = await playerId();
  try {
    const { data, error } = await db().rpc("discard_decision_pack");
    if (error) throw failure(error);
    await assertPlayer(id);
    return data as number;
  } finally {
    // The whole Decision Pack and its Karas reward commit atomically.
    invalidatePlayerSnapshots(["collection", "balance"]);
  }
}

export async function discardPackCard(instanceId: string, kind: "regular" | "decision"): Promise<number | null> {
  const id = await playerId();
  try {
    const rpc = kind === "regular" ? "discard_collection_card" : "discard_decision_pack_card";
    const args = kind === "regular" ? { p_card_instance_id: instanceId } : { p_choice_id: instanceId };
    const { data, error } = await db().rpc(rpc, args);
    if (error) throw failure(error);
    await assertPlayer(id);
    return kind === "regular" ? data as number : null;
  } finally {
    // Destruction and its Karas credit are committed together server-side.
    // Refresh both snapshots even if the RPC response itself was lost.
    cache.delete(`collection:${id}`);
    collectionPages.delete(id);
    cache.delete(`info:${id}`);
  }
}

export async function discardCollectionCards(instanceIds: string[]): Promise<number> {
  const id = await playerId();
  try {
    const { data, error } = await db().rpc("discard_collection_cards", {
      p_card_instance_ids: instanceIds
    });
    if (error) throw failure(error);
    await assertPlayer(id);
    return data as number;
  } finally {
    // The transaction can have committed even if the response was interrupted.
    cache.delete(`collection:${id}`);
    collectionPages.delete(id);
    cache.delete(`info:${id}`);
  }
}

export async function getFolders(sharePending = false): Promise<Folder[]> {
  const id = await playerId(true);
  const read = () => readRequest(signal => db().rpc("get_license_folders", {p_owner_id: null, p_binder_key: null, p_featured_only: false}).abortSignal(signal));
  const {data,error} = await (sharePending ? cache.memo(`read:folders:${id}`, 0, read) : read());
  if (error) throw failure(error);
  await assertPlayer(id,true);
  return ((data ?? []) as Folder[]).sort((a,b)=>a.name.localeCompare(b.name));
}

export async function createFolder(name: string): Promise<Folder> {
  const id = await playerId();
  const { data, error } = await db().rpc("create_folder", { p_name: name });
  if (error) throw failure(error);
  await assertPlayer(id);
  return data as Folder;
}

export async function deleteFolder(folderId: string): Promise<void> {
  const id = await playerId();
  const { error } = await db().rpc("delete_folder", { p_folder_id: folderId });
  if (error) throw failure(error);
  await assertPlayer(id); cache.delete(`collection:${id}`);
    collectionPages.delete(id);
}

export async function moveCardToFolder(instanceId: string, folderId: string | null): Promise<void> {
  const id = await playerId();
  const { error } = await db().rpc("move_card_to_folder", { p_card_instance_id: instanceId, p_folder_id: folderId });
  if (error) throw failure(error);
  await assertPlayer(id); cache.delete(`collection:${id}`);
    collectionPages.delete(id);
}

export async function moveCardsToFolder(instanceIds: string[], folderId: string | null): Promise<void> {
  const id = await playerId();
  const { error } = await db().rpc("move_cards_to_folder", { p_card_instance_ids: instanceIds, p_folder_id: folderId });
  if (error) throw failure(error);
  await assertPlayer(id); cache.delete(`collection:${id}`);
    collectionPages.delete(id);
}

export async function setCollectionCardLocked(instanceId: string, locked: boolean): Promise<void> {
  const { error } = await db().rpc("set_collection_card_locked", { p_card_instance_id: instanceId, p_locked: locked });
  if (error) throw failure(error);
  invalidatePlayerSnapshots(["collection"]);
}

// Custom art is saved by the server route only: it checks the file weight
// (8 MB max) before saving, and players cannot call the SQL function directly.
async function saveCustomImage(instanceId: string, imageUrl: string | null) {
  let response: Response;
  try {
    response = await fetch("/api/collection/custom-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId, url: imageUrl }),
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw failure({ message: "NETWORK" });
  }
  const body = (await response.json().catch(() => ({}))) as { card?: CollectedCard; error?: string };
  if (!response.ok || !body.card) throw failure({ message: body.error ?? "", code: response.status === 401 ? "PGRST301" : undefined });
  return body.card;
}

export async function setCardCustomImage(instanceId: string, imageUrl: string | null): Promise<CollectedCard> {
  const id = await playerId();
  try {
    const card = await saveCustomImage(instanceId, imageUrl);
    await assertPlayer(id);
    return (await withLiveCardFranchises([card]))[0];
  } finally { cache.delete(`collection:${id}`);
    collectionPages.delete(id); }
}
