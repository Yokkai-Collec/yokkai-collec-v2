"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations, useFormatter } from "next-intl";

import { BinderCover } from "@/components/binder-cover";
import { CollectionCoverEditor } from "@/components/collection-cover-editor";
import { binderCover, binderHref } from "@/lib/ui/binder-discovery";
import "@/styles/binder-discovery.css";
import { BinderFavoriteReview } from "@/components/binder-favorite-review";
import { LicenseFolderManager } from "@/components/license-folders";

import { cardRarityLabel } from "@/lib/ui/card-rarity-label";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProAccess, ProFeatureNotice } from "@/components/pro-access";
import { useEffect, useMemo, useState } from "react";
import type {
  Card,
  CardFilter,
  CollectedCard,
  Folder,
  PaniniAlbumCardPage,
  PaniniAlbumPage,
  Rarity
} from "@/lib/data/cards";
import {
  Button,
  Chip,
  Feedback,
  Karas,
  Modal,
  Pagination,
  SelectionBar,
  SelectionModeButton
} from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import { CardShell } from "@/components/card-shell";
import { CollectionLoading } from "@/components/collection-loading";
import { CardShareButton, MyCardShares } from "@/components/card-sharing";
import { CardReportButton } from "@/components/card-report-button";
import { CatalogueCardModal } from "@/components/catalogue-card-modal";
import { BINDER_CARD_PAGE_SIZES, CARD_PAGE_SIZES } from "@/lib/ui/pagination";
import {
  COLLECTION_SORTS,
  isCollectionSort,
  type CollectionSort
} from "@/lib/ui/collection-sort";
import { toggleFilterValue } from "@/lib/ui/card-search";
import { filterCollection } from "@/lib/ui/collection-filter";
import {
  useCollectionGroupCopies,
  useCollectionPages,
  type CollectionPagesSource
} from "@/lib/ui/collection-pages";
import { FilterSection, RarityChips } from "@/components/collection-filters";
import { orderEvolutionCopies } from "@/lib/ui/evolution-images";
import { useCollectionSort } from "@/hooks/use-collection-sort";
import { addBinderToWishlist, getCardDiscovery } from "@/lib/data/wishlist";
import {
  collectionGroupKey,
  consumableCopies,
  consumptionPlan,
  groupCollection,
  type CollectionGroup
} from "@/lib/ui/collection-groups";
import type { FirstLrCopySource } from "@/lib/data/first-lr-copies";

// Optional display metadata, separate from the existing business types.
export type CollectionPresentation = {
  number?: string;
  isNew?: boolean;
  frozen?: { remaining: string };
  auctionId?: string;
  marketValue?: number | null;
  destructionValue?: number;
};
const rarityText = {
  C: "text-rarity-c",
  R: "text-rarity-r",
  SR: "text-rarity-sr",
  SSR: "text-rarity-ssr",
  LR: "text-rarity-lr"
};
// Karas credited by a single destruction, as already announced in the confirmation modal.
const DESTRUCTION_KARAS: Record<Rarity, number> = {
  C: 1,
  R: 2,
  SR: 3,
  SSR: 4,
  LR: 5
};
const COLLECTION_CARD_IMAGE_SIZES =
  "(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 190px";

function ProtectedIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g stroke="rgba(2,0,15,.95)" strokeWidth="5">
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <path d="M12 14v3" />
      </g>
      <g stroke="currentColor" strokeWidth="2">
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <path d="M12 14v3" />
      </g>
    </svg>
  );
}

function AuctionIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m14 5 5 5M12 7l5 5M3 21l8-8M6 18l-3-3M14 3l7 7-4 4-7-7 4-4Z" />
      <path d="M12 21h9" />
    </svg>
  );
}

function FirstLrCopyMeta({ instanceIds }: { instanceIds: readonly string[] }) {
  const t = useTranslations("collectionShared");
  const key = instanceIds.join(",");
  const [sources, setSources] = useState<
    Record<string, FirstLrCopySource | undefined>
  >({});
  const source = sources[key];
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void import("@/lib/data/first-lr-copies")
      .then(store => {
        if (cancelled) return;
        const ids = [...new Set(key.split(","))];
        const publish = () => {
          if (!cancelled) {
            setSources(current => ({
              ...current,
              [key]: store.firstLrCopySource(ids)
            }));
          }
        };
        unsubscribe = store.subscribeFirstLrCopies(ids, publish);
        publish();
        store.requestFirstLrCopies(ids);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [key]);
  if (!source) return null;
  return (
    <div className="yk-collection-card-meta">
      <p className="text-[11px] font-semibold text-rarity-lr">
        {t("firstLrBadge")}
      </p>
    </div>
  );
}

export function CollectionView({
  cards,
  loading = false,
  loadError,
  onRetryLoad,
  categories,
  presentation = {},
  readOnly = false,
  previewOnly = false,
  adminRemoval = false,
  tradeHref,
  renderCardControls,
  folders = [],
  detailOnly = false,
  initialSelectedId = null,
  onDetailClose,
  onCreateFolder,
  onDeleteFolder,
  onMoveCard,
  onMoveCards,
  onSetLocked,
  onCreateAuction,
  onEvolve,
  onSetCustomImage,
  onDiscard,
  onDiscardMany,
  onCardsRemoved,
  loadPaniniAlbums,
  loadPaniniAlbumCards,
  onSetPaniniAlbumFavorite,
  onResolveBinderFavorite,
  loadCardDiscovery = getCardDiscovery,
  pageHeading,
  pages
}: {
  cards: CollectedCard[];
  // #388: when set, read one page of groups from the server instead of
  // filtering `cards` (which is then empty).
  pages?: CollectionPagesSource;
  loading?: boolean;
  loadError?: string;
  onRetryLoad?: () => void;
  categories: string[];
  presentation?: Record<string, CollectionPresentation>;
  totals?: Partial<Record<Rarity, number>>;
  readOnly?: boolean;
  previewOnly?: boolean;
  adminRemoval?: boolean;
  tradeHref?: (card: CollectedCard) => string;
  // Optional trade controls sit beside the standard card button, never inside it.
  renderCardControls?: (group: CollectionGroup) => React.ReactNode;
  folders?: Folder[];
  detailOnly?: boolean;
  initialSelectedId?: string | null;
  onDetailClose?: () => void;
  onCreateFolder?: (name: string) => Promise<void>;
  onDeleteFolder?: (folderId: string) => Promise<void>;
  onMoveCard?: (instanceId: string, folderId: string | null) => Promise<void>;
  onMoveCards?: (
    instanceIds: string[],
    folderId: string | null
  ) => Promise<void>;
  onSetLocked?: (instanceId: string, locked: boolean) => Promise<void>;
  onCreateAuction?: (
    instanceId: string,
    startingPrice: number,
    durationMinutes: number
  ) => Promise<void>;
  onEvolve?: (instanceIds: string[]) => Promise<CollectedCard>;
  onSetCustomImage?: (
    instanceId: string,
    imageUrl: string | null
  ) => Promise<void>;
  onDiscard?: (instanceId: string) => Promise<void>;
  onDiscardMany?: (instanceIds: string[]) => Promise<void>;
  onCardsRemoved?: (instanceIds: string[]) => void;
  loadPaniniAlbums?: (options: {
    query?: string;
    category?: CardFilter;
    favoritesOnly?: boolean;
    page?: number;
    pageSize?: number;
  }) => Promise<PaniniAlbumPage>;
  loadPaniniAlbumCards?: (options: {
    license: string;
    query?: string;
    category?: CardFilter;
    rarity?: CardFilter;
    ownedOnly?: boolean;
    page?: number;
    pageSize?: number;
    sort?: CollectionSort;
  }) => Promise<PaniniAlbumCardPage>;
  onSetPaniniAlbumFavorite?: (
    license: string,
    favorite: boolean
  ) => Promise<void>;
  onResolveBinderFavorite?: (license: string, keys: string[]) => Promise<void>;
  pageHeading?: React.ReactNode;
  loadCardDiscovery?: (
    cardId: string
  ) => Promise<{ marketValue: number | null }>;
}) {
  const tError = useTranslations();
  const tc = useTranslations("collectionUi");
  const tf = useTranslations("licenseFolders");
  const format = useFormatter();
  const formatDate = (value: string, long = false) =>
    format.dateTime(new Date(value), {
      dateStyle: long ? "long" : "medium",
      timeZone: Intl.DateTimeFormat("en-US").resolvedOptions().timeZone
    });
  const pathname = usePathname();
  const displayStorageKey = `yokkai:collection-display:${pathname ?? "/collection"}`;
  const [displayedCopies, setDisplayedCopies] = useState<
    Record<string, string>
  >({});
  useEffect(() => {
    const frame = window.setTimeout(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem(displayStorageKey) ?? "{}"
        );
        if (saved && typeof saved === "object" && !Array.isArray(saved))
          setDisplayedCopies(
            Object.fromEntries(
              Object.entries(saved).filter(([, id]) => typeof id === "string")
            ) as Record<string, string>
          );
      } catch {
        /* Storage may be unavailable; selection still works for this visit. */
      }
    });
    return () => window.clearTimeout(frame);
  }, [displayStorageKey]);
  function viewCopy(card: CollectedCard) {
    setSelectedId(card.instanceId);
    setPinned(card);
    const next = {
      ...displayedCopies,
      [collectionGroupKey(card)]: card.instanceId
    };
    setDisplayedCopies(next);
    try {
      localStorage.setItem(displayStorageKey, JSON.stringify(next));
    } catch {}
  }
  const proAccess = useProAccess();
  const localPreview = previewOnly && process.env.NODE_ENV === "development";
  const pro = proAccess || localPreview;
  const profileIdentifier = pathname?.startsWith("/profile/")
    ? decodeURIComponent(pathname.slice("/profile/".length))
    : undefined;
  const resolvedTradeHref =
    tradeHref ??
    (readOnly && profileIdentifier
      ? (card: CollectedCard) =>
          `/trades?ami=${encodeURIComponent(profileIdentifier)}&carte=${encodeURIComponent(card.instanceId)}`
      : undefined);
  const [category, setCategory] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState<Rarity[]>([]);
  const [shinyOnly, setShinyOnly] = useState(false);
  const [folder, setFolder] = useState<string | "unfiled" | "">("");
  const [auctionOnly, setAuctionOnly] = useState(false);
  const [lockedOnly, setLockedOnly] = useState(false);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useCollectionSort();
  const [pageSize, setPageSize] = useState<number>(CARD_PAGE_SIZES[0]);
  const [folderName, setFolderName] = useState("");
  const [showFolderCreator, setShowFolderCreator] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [removingFolder, setRemovingFolder] = useState<Folder | null>(null);
  const [folderDeleteFailed, setFolderDeleteFailed] = useState(false);
  const [auctionPrice, setAuctionPrice] = useState("10");
  const [auctionDuration, setAuctionDuration] = useState("60");
  const [auctionBusy, setAuctionBusy] = useState(false);
  const [auctionOpen, setAuctionOpen] = useState(false);
  const [auctionDone, setAuctionDone] = useState(false);
  const [auctionError, setAuctionError] = useState("");
  const [auctionSuggestion, setAuctionSuggestion] = useState<number | null>(
    null
  );
  const [auctionSuggestionBusy, setAuctionSuggestionBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId
  );
  const [evolving, setEvolving] = useState(false);
  const [evolveConfirm, setEvolveConfirm] = useState(false);
  const [evolutionSelection, setEvolutionSelection] = useState<Set<string>>(
    new Set()
  );
  const [evolutionError, setEvolutionError] = useState("");
  const [evolutionImageSourceId, setEvolutionImageSourceId] = useState<
    string | null
  >(null);
  const [customImageUrl, setCustomImageUrl] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState("");
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [discardQuantity, setDiscardQuantity] = useState(1);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [discardError, setDiscardError] = useState("");
  const [bulkDiscardBusy, setBulkDiscardBusy] = useState(false);
  const [bulkDiscardConfirm, setBulkDiscardConfirm] = useState(false);
  const [bulkDiscardError, setBulkDiscardError] = useState("");
  const [bulkFolderTarget, setBulkFolderTarget] = useState("");
  const [bulkFolderBusy, setBulkFolderBusy] = useState(false);
  const [bulkFolderError, setBulkFolderError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "panini">("grid");
  const [selectedLicense, setSelectedLicense] = useState<string | null>(null);
  const [linkedBinderName, setLinkedBinderName] = useState("");
  const td = useTranslations("binderDiscovery");
  useEffect(() => {
    if (readOnly) return;
    const sync = (initial = false) => {
      const p = new URLSearchParams(window.location.search);
      if (p.get("view") === "binders") {
        setViewMode("panini");
        setSelectedLicense(p.get("binder"));
        setLinkedBinderName(p.get("name") ?? "");
      } else if (!initial) {
        setViewMode(current => (current === "panini" ? "grid" : current));
        setSelectedLicense(null);
      }
    };
    sync(true);
    const onBack = () => sync();
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, [readOnly]);
  function navigateBinder(binder?: { binderKey?: string; license: string }) {
    setViewMode("panini");
    setSelectedLicense(binder ? (binder.binderKey ?? binder.license) : null);
    setLinkedBinderName(binder?.license ?? "");
    setSelecting(false);
    setSelection(new Set());
    if (!readOnly && !localPreview)
      window.history.pushState(null, "", binderHref(binder));
  }
  const [binderWishlist, setBinderWishlist] = useState<{
    busy?: boolean;
    message?: string;
    messageCount?: number;
    error?: boolean;
  }>({});
  const [albumSearchBeforeOpen, setAlbumSearchBeforeOpen] = useState("");
  const [paniniAlbumPage, setPaniniAlbumPage] = useState(1);
  const [paniniPage, setPaniniPage] = useState(1);
  const [paniniPageSize, setPaniniPageSize] = useState<number>(
    BINDER_CARD_PAGE_SIZES[0]
  );
  const [hideMissingCards, setHideMissingCards] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedMissingCard, setSelectedMissingCard] = useState<Card | null>(
    null
  );
  const [paniniAlbums, setPaniniAlbums] = useState<PaniniAlbumPage>({
    items: [],
    total: 0
  });
  const [paniniCards, setPaniniCards] = useState<PaniniAlbumCardPage>({
    items: [],
    total: 0
  });
  const [paniniBusy, setPaniniBusy] = useState(false);
  const [paniniError, setPaniniError] = useState("");
  const [favoriteError, setFavoriteError] = useState("");
  const [paniniAlbumRefresh, setPaniniAlbumRefresh] = useState(0);
  const [favoriteLicenseBusy, setFavoriteLicenseBusy] = useState<string | null>(
    null
  );
  // Server pages: the evolved copy is shown before the next page read.
  const [pinned, setPinned] = useState<CollectedCard | null>(null);
  const remote = useCollectionPages(pages, {
    filters: {
      query,
      category,
      rarity,
      shinyOnly,
      folder,
      auctionOnly,
      lockedOnly,
      duplicatesOnly,
      sort
    },
    page,
    pageSize,
    ownedCardIds:
      viewMode === "panini" ? paniniCards.items.map(card => card.id) : [],
    license: viewMode === "panini" ? selectedLicense : null
  });
  const seenCards = useMemo(
    () =>
      remote
        ? [
            ...remote.known.values(),
            ...(pinned && !remote.known.has(pinned.instanceId) ? [pinned] : [])
          ]
        : cards,
    [remote, pinned, cards]
  );
  const selected = seenCards.find(c => c.instanceId === selectedId);
  const groupCopies = useCollectionGroupCopies(
    pages,
    pages && selected ? collectionGroupKey(selected) : null
  );
  const sourceCards = useMemo(() => {
    if (!remote) return cards;
    const byId = new Map(seenCards.map(card => [card.instanceId, card]));
    for (const copy of groupCopies) byId.set(copy.instanceId, copy);
    return [...byId.values()];
  }, [remote, cards, seenCards, groupCopies]);
  const selectedMeta = selected ? presentation[selected.instanceId] : undefined;
  const filtered = useMemo(
    () =>
      filterCollection(
        remote ? [] : cards,
        {
          query,
          category,
          rarity,
          shinyOnly,
          folder,
          folders,
          auctionOnly,
          lockedOnly,
          duplicatesOnly,
          sort
        },
        instanceId => !!presentation[instanceId]?.frozen
      ),
    [
      auctionOnly,
      lockedOnly,
      duplicatesOnly,
      cards,
      remote,
      category,
      folder,
      folders,
      presentation,
      query,
      rarity,
      shinyOnly,
      sort
    ]
  );
  // Server groups keep the whole group's first-owner history.
  const remoteGroups = useMemo(
    () =>
      remote?.page?.groups.map(group => ({
        ...groupCollection(group.copies, displayedCopies)[0],
        isFirstOwner: group.firstOwner
      })) ?? [],
    [remote?.page, displayedCopies]
  );
  const groups = groupCollection(filtered, displayedCopies);
  const shownGroups = remote ? remoteGroups : groups;
  const matchingGroups = remote ? (remote.page?.total ?? 0) : groups.length;
  const ownedCopies = remote ? (remote.counts?.copies ?? 0) : cards.length;
  const paniniAlbumPageCount = Math.max(1, Math.ceil(paniniAlbums.total / 72));
  const activePaniniAlbumPage = Math.min(paniniAlbumPage, paniniAlbumPageCount);
  const ownedByCardId = useMemo(() => {
    const owned = new Map<string, CollectedCard>();
    for (const card of remote ? remote.ownedCopies : cards) {
      if (!owned.has(card.id)) owned.set(card.id, card);
    }
    return owned;
  }, [cards, remote]);
  const selectedLicenseOwned = remote
    ? remote.licenseCopies
    : selectedLicense
      ? cards.filter(card => {
          const specialCategory = [
            "ARTIST",
            "BRAINROT",
            "DISNEY CHANNEL",
            "FILM",
            "INTERNET PERSONALITY",
            "KDRAMA",
            "KPOP",
            "MEME",
            "VOCALOID",
            "WWE"
          ].includes(card.category.trim().toUpperCase());
          return specialCategory
            ? card.category.trim().toUpperCase() ===
                selectedLicense.toUpperCase()
            : card.anime?.trim() === selectedLicense;
        }).length
      : 0;
  const selectedAlbum = paniniAlbums.items.find(
    album => (album.binderKey ?? album.license) === selectedLicense
  );
  const selectedAlbumName =
    selectedAlbum?.license ??
    (selectedLicense && linkedBinderName ? linkedBinderName : undefined) ??
    (selectedLicense?.match(/^(series|source):/)
      ? tc("binder")
      : selectedLicense);
  const paniniPageCount = Math.max(
    1,
    Math.ceil(paniniCards.total / paniniPageSize)
  );
  const activePaniniPage = Math.min(paniniPage, paniniPageCount);

  useEffect(() => {
    if (viewMode !== "panini" || selectedLicense || !loadPaniniAlbums) return;
    let active = true;
    const timer = window.setTimeout(
      () => {
        setPaniniBusy(true);
        setPaniniError("");
        void loadPaniniAlbums({
          query,
          category,
          favoritesOnly,
          page: activePaniniAlbumPage,
          pageSize: 72
        })
          .then(
            result => {
              if (active) setPaniniAlbums(result);
            },
            error => {
              if (active)
                setPaniniError(
                  error instanceof Error
                    ? gameErrorKey(error)
                    : "collectionUi.couldntLoadBinders"
                );
            }
          )
          .finally(() => {
            if (active) setPaniniBusy(false);
          });
      },
      query.trim() ? 250 : 0
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    activePaniniAlbumPage,
    category,
    favoritesOnly,
    loadPaniniAlbums,
    paniniAlbumRefresh,
    query,
    selectedLicense,
    viewMode
  ]);

  const togglePaniniAlbumFavorite = async (
    license: string,
    favorite: boolean
  ) => {
    if (!onSetPaniniAlbumFavorite || favoriteLicenseBusy) return;
    setFavoriteLicenseBusy(license);
    setFavoriteError("");
    setPaniniAlbums(current => ({
      ...current,
      items: current.items.map(item =>
        (item.binderKey ?? item.license) === license
          ? { ...item, favorite }
          : item
      )
    }));
    try {
      await onSetPaniniAlbumFavorite(license, favorite);
      setPaniniAlbumPage(1);
      setPaniniAlbumRefresh(current => current + 1);
    } catch (error) {
      setPaniniAlbums(current => ({
        ...current,
        items: current.items.map(item =>
          (item.binderKey ?? item.license) === license
            ? { ...item, favorite: !favorite }
            : item
        )
      }));
      setFavoriteError(
        error instanceof Error
          ? gameErrorKey(error)
          : "collectionUi.couldntUpdateThisFavorite"
      );
    } finally {
      setFavoriteLicenseBusy(null);
    }
  };

  useEffect(() => {
    if (viewMode !== "panini" || !selectedLicense || !loadPaniniAlbumCards)
      return;
    let active = true;
    const timer = window.setTimeout(
      () => {
        setPaniniBusy(true);
        setPaniniError("");
        void loadPaniniAlbumCards({
          license: selectedLicense,
          query,
          category,
          rarity,
          ownedOnly: hideMissingCards,
          page: activePaniniPage,
          pageSize: paniniPageSize,
          sort
        })
          .then(
            result => {
              if (active) setPaniniCards(result);
            },
            error => {
              if (active)
                setPaniniError(
                  error instanceof Error
                    ? gameErrorKey(error)
                    : "collectionUi.couldntLoadThisBindersCards"
                );
            }
          )
          .finally(() => {
            if (active) setPaniniBusy(false);
          });
      },
      query.trim() ? 250 : 0
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    activePaniniPage,
    category,
    hideMissingCards,
    loadPaniniAlbumCards,
    paniniPageSize,
    query,
    rarity,
    sort,
    selectedLicense,
    viewMode
  ]);
  const pageCount = Math.max(1, Math.ceil(matchingGroups / pageSize));
  const activePage = Math.min(page, pageCount);
  const visibleGroups = remote
    ? shownGroups
    : groups.slice((activePage - 1) * pageSize, activePage * pageSize);
  const selectedCards = sourceCards.filter(
    c =>
      selection.has(c.instanceId) &&
      !c.locked &&
      !presentation[c.instanceId]?.frozen
  );
  const selectedGroup = selected
    ? groupCollection(
        sourceCards.filter(
          card => collectionGroupKey(card) === collectionGroupKey(selected)
        )
      )[0]
    : undefined;
  const selectedGroupFrozen =
    selectedGroup?.cards.some(
      card => !!presentation[card.instanceId]?.frozen
    ) ?? false;
  const isFrozen = (instanceId: string) =>
    adminRemoval
      ? false
      : !!presentation[instanceId]?.frozen ||
        !!sourceCards.find(card => card.instanceId === instanceId)?.locked;
  const destructibleCards = consumableCopies(
    selectedGroup?.cards ?? [],
    isFrozen
  ).slice(0, onDiscardMany ? undefined : 1);
  const discardCards = consumptionPlan(
    selectedGroup?.cards ?? [],
    Math.min(discardQuantity, destructibleCards.length),
    isFrozen
  ).slice(0, onDiscardMany ? undefined : 1);
  const discardValue = discardCards.reduce(
    (sum, card) =>
      sum +
      (presentation[card.instanceId]?.destructionValue ??
        DESTRUCTION_KARAS[card.rarity]),
    0
  );
  const canEvolve =
    !!selected &&
    (selected.rarity === "SSR" || selected.rarity === "LR") &&
    (selected.rarity === "LR" || !selected.shiny) &&
    !selected.isEvolved;
  const evolvableCards =
    selected && canEvolve
      ? consumableCopies(
          sourceCards.filter(
            c =>
              c.id === selected.id &&
              c.rarity === selected.rarity &&
              (c.rarity === "LR" || !c.shiny) &&
              !c.isEvolved
          ),
          isFrozen
        )
      : [];
  const evolutionCards = orderEvolutionCopies(
    evolvableCards.filter(card => evolutionSelection.has(card.instanceId)),
    evolutionImageSourceId
  );
  const evolutionShiny =
    selected?.rarity === "LR" && evolutionCards.some(card => card.shiny);
  const shinyConsumed = evolutionCards.filter(card => card.shiny).length;
  const evolutionImageCards = evolutionCards.filter(
    card => card.customImageUrl
  );
  const evolutionImageSource = evolutionImageCards[0];
  const evolvableCopies = evolvableCards.length;
  const evolutionRequired = selected?.rarity === "LR" ? 3 : 5;
  const selectedValue =
    selectedCards.length > 0
      ? selectedCards.reduce(
          (sum, card) =>
            sum +
            (presentation[card.instanceId]?.destructionValue ??
              DESTRUCTION_KARAS[card.rarity]),
          0
        )
      : undefined;
  function closeDetail() {
    setSelectedId(null);
    setPinned(null);
    onDetailClose?.();
  }
  function toggleGroup(groupCards: CollectedCard[]) {
    setSelection(current => {
      const next = new Set(current);
      const eligible = groupCards.filter(
        card => !card.locked && !presentation[card.instanceId]?.frozen
      );
      const all =
        eligible.length > 0 &&
        eligible.every(card => next.has(card.instanceId));
      for (const card of eligible) {
        if (all) next.delete(card.instanceId);
        else next.add(card.instanceId);
      }
      return next;
    });
  }
  function toggleEvolutionCard(instanceId: string) {
    setEvolutionSelection(current => {
      const next = new Set(current);
      if (next.has(instanceId)) next.delete(instanceId);
      else if (next.size < evolutionRequired) next.add(instanceId);
      return next;
    });
  }
  async function evolveSelected() {
    if (
      !selected ||
      !onEvolve ||
      evolving ||
      evolutionCards.length !== evolutionRequired
    )
      return;
    setEvolving(true);
    setEvolutionError("");
    try {
      const evolved = await onEvolve(
        evolutionCards.map(card => card.instanceId)
      );
      onCardsRemoved?.(evolutionCards.map(card => card.instanceId));
      setEvolveConfirm(false);
      viewCopy(evolved);
    } catch (error) {
      setEvolutionError(
        error instanceof Error
          ? gameErrorKey(error)
          : "collectionUi.couldntEvolveThisCard"
      );
    } finally {
      setEvolving(false);
    }
  }
  async function addFolder() {
    if (!onCreateFolder || !folderName.trim() || folderBusy) return;
    setFolderBusy(true);
    setFolderError("");
    try {
      await onCreateFolder(folderName.trim());
      setFolderName("");
      setShowFolderCreator(false);
    } catch (error) {
      setFolderError(
        error instanceof Error
          ? gameErrorKey(error)
          : "collectionUi.couldntCreateThisFolder"
      );
    } finally {
      setFolderBusy(false);
    }
  }
  async function auctionSelected() {
    if (!selected || !onCreateAuction || auctionBusy || selectedGroupFrozen)
      return;
    setAuctionBusy(true);
    setAuctionError("");
    try {
      await onCreateAuction(
        selected.instanceId,
        Number(auctionPrice),
        Number(auctionDuration)
      );
      setAuctionDone(true);
    } catch (error) {
      setAuctionError(
        error instanceof Error
          ? gameErrorKey(error)
          : "collectionUi.couldntCreateThisAuction"
      );
    } finally {
      setAuctionBusy(false);
    }
  }
  async function openAuction() {
    if (!selected || selectedGroupFrozen) return;
    setAuctionPrice("10");
    setAuctionError("");
    setAuctionDone(false);
    setAuctionSuggestion(null);
    setAuctionSuggestionBusy(true);
    setAuctionOpen(true);
    try {
      const discovery = localPreview
        ? { marketValue: null }
        : await loadCardDiscovery(selected.id);
      const value = discovery.marketValue;
      setAuctionSuggestion(
        value != null && Number.isFinite(value) && value > 0
          ? Math.round(value)
          : null
      );
    } catch {
      setAuctionSuggestion(null);
    } finally {
      setAuctionSuggestionBusy(false);
    }
  }
  function closeAuction() {
    if (auctionBusy) return;
    setAuctionOpen(false);
    setAuctionError("");
    setAuctionSuggestion(null);
    setAuctionSuggestionBusy(false);
    if (auctionDone) {
      setAuctionDone(false);
      closeDetail();
    }
  }
  async function saveCustomImage(imageUrl: string | null) {
    if (!selected || !onSetCustomImage || imageBusy) return;
    if (imageUrl && !pro) {
      setImageError("collectionUi.thisFeatureIsAvailableToProMembersOnly");
      return;
    }
    setImageBusy(true);
    setImageError("");
    try {
      await onSetCustomImage(selected.instanceId, imageUrl);
      setCustomImageUrl("");
    } catch (error) {
      setImageError(
        error instanceof Error
          ? gameErrorKey(error)
          : "collectionUi.couldntCustomizeThisImage"
      );
    } finally {
      setImageBusy(false);
    }
  }
  async function toggleSelectedLock() {
    if (!selected || !onSetLocked || lockBusy || selectedMeta?.frozen) return;
    setLockBusy(true);
    setLockError("");
    try {
      await onSetLocked(selected.instanceId, !selected.locked);
    } catch (error) {
      setLockError(
        error instanceof Error
          ? gameErrorKey(error)
          : "collectionUi.couldntChangeThisCardsLock"
      );
    } finally {
      setLockBusy(false);
    }
  }
  async function discardSelected() {
    if (
      !selected ||
      !discardCards.length ||
      discardBusy ||
      (!onDiscardMany && !onDiscard)
    )
      return;
    setDiscardBusy(true);
    setDiscardError("");
    try {
      if (onDiscardMany)
        await onDiscardMany(discardCards.map(card => card.instanceId));
      else if (discardCards.length === 1 && onDiscard)
        await onDiscard(discardCards[0].instanceId);
      onCardsRemoved?.(discardCards.map(card => card.instanceId));
      setDiscardConfirm(false);
      closeDetail();
    } catch (error) {
      setDiscardError(
        error instanceof Error
          ? gameErrorKey(error)
          : "collectionUi.couldntDestroyThisCard"
      );
    } finally {
      setDiscardBusy(false);
    }
  }
  async function discardSelection() {
    if (!onDiscardMany || !selectedCards.length || bulkDiscardBusy) return;
    setBulkDiscardBusy(true);
    setBulkDiscardError("");
    try {
      await onDiscardMany(selectedCards.map(card => card.instanceId));
      setBulkDiscardConfirm(false);
      setSelection(new Set());
      setSelecting(false);
    } catch (error) {
      setBulkDiscardError(
        error instanceof Error
          ? gameErrorKey(error)
          : "collectionUi.couldntDestroyTheSelectedCards"
      );
    } finally {
      setBulkDiscardBusy(false);
    }
  }
  async function moveSelection() {
    if (
      !onMoveCards ||
      !selectedCards.length ||
      !bulkFolderTarget ||
      bulkFolderBusy
    )
      return;
    setBulkFolderBusy(true);
    setBulkFolderError("");
    try {
      await onMoveCards(
        selectedCards.map(card => card.instanceId),
        bulkFolderTarget === "unfiled" ? null : bulkFolderTarget
      );
      setSelection(new Set());
      setSelecting(false);
      setBulkFolderTarget("");
    } catch (error) {
      setBulkFolderError(
        error instanceof Error
          ? gameErrorKey(error)
          : "collectionUi.couldntMoveTheSelectedCards"
      );
    } finally {
      setBulkFolderBusy(false);
    }
  }
  const resetFilters = () => {
    setQuery("");
    setRarity([]);
    setCategory([]);
    setShinyOnly(false);
    setFolder("");
    setAuctionOnly(false);
    setLockedOnly(false);
    setDuplicatesOnly(false);
    setPage(1);
    setPaniniPage(1);
  };
  const filters = (
    <>
      <button
        type="button"
        className="yk-filter-reset"
        disabled={
          !(
            query ||
            rarity.length ||
            category.length ||
            shinyOnly ||
            folder ||
            auctionOnly ||
            lockedOnly ||
            duplicatesOnly
          )
        }
        onClick={resetFilters}
      >
        <svg
          aria-hidden="true"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
        </svg>
        {tc("resetFilters")}
      </button>
      <div className="yk-filter-search">
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <label className="sr-only" htmlFor="collection-query">
          {tc("searchCollection")}
        </label>
        <input
          id="collection-query"
          type="search"
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder={tc("search")}
        />
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={shinyOnly}
        className="yk-shiny-toggle"
        onClick={() => {
          setShinyOnly(current => !current);
          setPage(1);
        }}
      >
        <span>{tc("shinyEvolved")}</span>
        <i />
      </button>
      {viewMode !== "panini" && (
        <button
          type="button"
          role="switch"
          className="yk-shiny-toggle"
          aria-checked={duplicatesOnly}
          onClick={() => {
            setDuplicatesOnly(current => !current);
            setPage(1);
          }}
        >
          <span>{tc("duplicatesOnly")}</span>
          <i />
        </button>
      )}
      <FilterSection
        title={tc("rarity")}
        count={rarity.length}
        sectionId="rarity"
      >
        <RarityChips
          selected={rarity}
          count={r =>
            remote
              ? (remote.counts?.rarities[r] ?? 0)
              : groupCollection(cards.filter(c => c.rarity === r)).length
          }
          onToggle={r => {
            setRarity(current => toggleFilterValue(current, r));
            setPage(1);
            setPaniniPage(1);
          }}
        />
      </FilterSection>
      <FilterSection
        title={tc("category")}
        count={category.length}
        sectionId="category"
      >
        {categories.map(item => (
          <button
            type="button"
            key={item}
            className="yk-filter-option"
            aria-pressed={category.includes(item)}
            onClick={() => {
              setCategory(current => toggleFilterValue(current, item));
              setPage(1);
              setPaniniAlbumPage(1);
              setPaniniPage(1);
            }}
          >
            <span className="yk-filter-check" />
            <span>{item}</span>
            <strong>
              {remote
                ? (remote.counts?.categories[item] ?? 0)
                : groupCollection(cards.filter(card => card.category === item))
                    .length}
            </strong>
          </button>
        ))}
      </FilterSection>
      {!readOnly && (
        <FilterSection
          title={tc("status")}
          count={Number(auctionOnly) + Number(lockedOnly)}
          sectionId="status"
        >
          <button
            type="button"
            className="yk-filter-option yk-filter-option-icon"
            aria-pressed={auctionOnly}
            onClick={() => {
              setAuctionOnly(current => !current);
              setPage(1);
            }}
          >
            <span className="yk-filter-check" />
            <AuctionIcon />
            <span>{tc("inAuctions")}</span>
            <strong>
              {remote
                ? (remote.counts?.frozen ?? 0)
                : groupCollection(
                    cards.filter(card => presentation[card.instanceId]?.frozen)
                  ).length}
            </strong>
          </button>
          <button
            type="button"
            className="yk-filter-option yk-filter-option-icon"
            aria-pressed={lockedOnly}
            onClick={() => {
              setLockedOnly(current => !current);
              setPage(1);
            }}
          >
            <span className="yk-filter-check" />
            <ProtectedIcon />
            <span>{tc("lockedCards")}</span>
            <strong>
              {remote
                ? (remote.counts?.locked ?? 0)
                : groupCollection(cards.filter(card => card.locked)).length}
            </strong>
          </button>
        </FilterSection>
      )}
      {!readOnly && (
        <FilterSection
          title={tc("folder")}
          count={folder ? 1 : 0}
          sectionId="folder"
        >
          <button
            type="button"
            className="yk-filter-option"
            aria-pressed={folder === "unfiled"}
            onClick={() => {
              setFolder(current => (current === "unfiled" ? "" : "unfiled"));
              setPage(1);
            }}
          >
            <span className="yk-filter-check" />
            <span>{tc("noFolder")}</span>
            <strong>
              {remote
                ? (remote.counts?.unfiled ?? 0)
                : groupCollection(
                    cards.filter(
                      card =>
                        !card.folderId &&
                        !folders.some(f => f.cardIds?.includes(card.id))
                    )
                  ).length}
            </strong>
          </button>
          {folders.map(item => (
            <button
              type="button"
              key={item.id}
              className="yk-filter-option"
              aria-pressed={folder === item.id}
              onClick={() => {
                setFolder(current => (current === item.id ? "" : item.id));
                setPage(1);
              }}
            >
              <span className="yk-filter-check" />
              <span>{item.name}</span>
              <strong>
                {remote
                  ? (remote.counts?.folders[item.id] ?? 0)
                  : groupCollection(
                      cards.filter(
                        card =>
                          card.folderId === item.id ||
                          item.cardIds?.includes(card.id)
                      )
                    ).length}
              </strong>
            </button>
          ))}
          {onCreateFolder && <LicenseFolderManager compact />}
          {onCreateFolder && (
            <button
              type="button"
              className="yk-folder-create-toggle"
              aria-expanded={showFolderCreator}
              onClick={() => {
                setShowFolderCreator(current => !current);
                setFolderError("");
              }}
            >
              {tc("newFolder")}
            </button>
          )}
          {onCreateFolder && showFolderCreator && (
            <div className="yk-folder-create">
              <input
                autoFocus
                value={folderName}
                maxLength={40}
                onChange={event => setFolderName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addFolder();
                  }
                  if (event.key === "Escape") {
                    setShowFolderCreator(false);
                    setFolderName("");
                  }
                }}
                placeholder={tc("newFolderLabel")}
                aria-label={tc("newFolderName")}
              />
              <Button
                variant="secondary"
                disabled={folderBusy || !folderName.trim()}
                onClick={() => void addFolder()}
              >
                {folderBusy ? tc("creating") : tc("create")}
              </Button>
            </div>
          )}
          {onDeleteFolder && folder && folder !== "unfiled" && (
            <button
              type="button"
              className="yk-folder-delete"
              onClick={() => {
                setFolderDeleteFailed(false);
                setRemovingFolder(
                  folders.find(item => item.id === folder) ?? null
                );
              }}
            >
              {tc("deleteThisFolder")}
            </button>
          )}
          {folderError && (
            <p role="alert" className="text-xs text-danger">
              {tError(gameErrorKey(folderError))}
            </p>
          )}
        </FilterSection>
      )}
    </>
  );
  const collectionTabs = (
    <nav className="yk-collection-tabs" aria-label={td("views")}>
      <button
        type="button"
        aria-pressed={viewMode !== "panini"}
        onClick={() => {
          setViewMode("grid");
          setSelectedLicense(null);
          setSelecting(false);
          setSelection(new Set());
          if (!readOnly && !localPreview)
            window.history.pushState(null, "", "/collection");
        }}
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <rect x="4" y="5" width="12" height="16" rx="2" />
          <path d="m9 3 10 1 1 14" />
        </svg>
        {td("cardsTab")}
      </button>
      <button
        type="button"
        className="yk-panini-mode"
        aria-pressed={viewMode === "panini"}
        onClick={() => {
          setBinderWishlist({});
          navigateBinder();
        }}
      >
        {" "}
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z" />
          <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22V5.5Z" />
        </svg>
        {td("bindersTab")}
      </button>
    </nav>
  );
  const toolbar = (
    <div className="yk-collection-toolbar">
      <button
        type="button"
        className="yk-mobile-filter-trigger"
        aria-expanded={filtersOpen}
        aria-controls="collection-filters"
        onClick={() => setFiltersOpen(true)}
      >
        <svg
          aria-hidden="true"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        {tc("filters")}
        {query ||
        rarity.length ||
        category.length ||
        shinyOnly ||
        folder ||
        auctionOnly ||
        lockedOnly ||
        duplicatesOnly ? (
          <span>•</span>
        ) : null}
      </button>
      <div className="yk-collection-toolbar-actions">
        {!readOnly && <MyCardShares />}
        <label className="yk-sort-control">
          <span>{tc("sortBy")}</span>
          <strong aria-hidden="true">{tc("sortLabel", { sort })}</strong>
          <svg
            aria-hidden="true"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="m7 10 5 5 5-5" />
          </svg>
          <select
            aria-label={tc("sortCollection")}
            value={sort}
            onChange={e => {
              if (isCollectionSort(e.target.value)) {
                setSort(e.target.value);
                setPage(1);
                setPaniniPage(1);
              }
            }}
          >
            {COLLECTION_SORTS.map(option => (
              <option key={option.value} value={option.value}>
                {tc("sortLabel", { sort: option.value })}
              </option>
            ))}
          </select>
        </label>
        {!readOnly && (
          <SelectionModeButton
            active={selecting}
            onClick={() => {
              setSelecting(!selecting);
              setSelection(new Set());
            }}
          />
        )}
      </div>
      {!renderCardControls && collectionTabs}
    </div>
  );
  return (
    <section
      aria-label={detailOnly ? tc("cardDetails") : tc("cardCollection")}
      className={
        detailOnly ? undefined : `yk-collection ${selecting ? "pb-28" : ""}`
      }
    >
      {!detailOnly && (
        <>
          {filtersOpen && (
            <button
              type="button"
              className="yk-filter-backdrop"
              aria-label={tc("closeFilters")}
              onClick={() => setFiltersOpen(false)}
            />
          )}
          {pageHeading && (
            <header className="yk-market-heading">
              {pageHeading}
              {toolbar}
            </header>
          )}

          <div className="yk-collection-layout">
            <aside
              id="collection-filters"
              className={`yk-collection-sidebar ${filtersOpen ? "yk-sidebar-open" : ""}`}
              aria-label={tc("collectionFilters")}
            >
              <div className="yk-sidebar-mobile-head">
                <strong>{tc("filters")}</strong>
                <button
                  type="button"
                  aria-label={tc("closeFilters")}
                  onClick={() => setFiltersOpen(false)}
                >
                  ×
                </button>
              </div>
              {filters}
            </aside>
            <div className="yk-collection-main">
              {!pageHeading && toolbar}
              {viewMode === "panini" ? (
                <section
                  className="yk-panini"
                  aria-label={tc("licenseBinders")}
                >
                  {selectedLicense ? (
                    <>
                      <div className="yk-panini-album-head">
                        <button
                          type="button"
                          className="yk-panini-back"
                          onClick={() => {
                            navigateBinder();
                            setBinderWishlist({});
                            setQuery(albumSearchBeforeOpen);
                            setPaniniPage(1);
                          }}
                        >
                          {tc("allBinders")}
                        </button>
                        <div>
                          <p className="yk-section-title">{tc("binder")}</p>
                          <h2>{selectedAlbumName}</h2>
                        </div>
                        <p>
                          {selectedAlbum?.owned ??
                            paniniCards.binderOwned ??
                            selectedLicenseOwned}{" "}
                          /{" "}
                          {format.number(
                            selectedAlbum?.total ??
                              paniniCards.binderTotal ??
                              paniniCards.total
                          )}{" "}
                          {(selectedAlbum?.total ??
                            paniniCards.binderTotal ??
                            paniniCards.total) === 1
                            ? tc("countPluralOneCardOtherCards", {
                                count:
                                  selectedAlbum?.total ??
                                  paniniCards.binderTotal ??
                                  paniniCards.total
                              })
                            : tc("countPluralOneCardOtherCards", {
                                count:
                                  selectedAlbum?.total ??
                                  paniniCards.binderTotal ??
                                  paniniCards.total
                              })}
                        </p>
                      </div>
                      <div className="yk-panini-controls">
                        <label className="yk-panini-search">
                          <span className="sr-only">
                            {tc("searchCardsInThisLicense")}
                          </span>
                          <svg
                            aria-hidden="true"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          >
                            <circle cx="11" cy="11" r="7" />
                            <path d="m20 20-4-4" />
                          </svg>
                          <input
                            type="search"
                            value={query}
                            onChange={event => {
                              setQuery(event.target.value);
                              setPaniniPage(1);
                            }}
                            placeholder={tc("searchCards")}
                          />
                        </label>
                        <button
                          type="button"
                          className="yk-panini-owned-toggle"
                          aria-pressed={hideMissingCards}
                          onClick={() => {
                            setHideMissingCards(current => !current);
                            setPaniniPage(1);
                          }}
                        >
                          <span aria-hidden="true">
                            {hideMissingCards ? "✓" : "○"}
                          </span>
                          {hideMissingCards
                            ? tc("showMissingCards")
                            : tc("hideMissingCards")}
                        </button>
                        {!readOnly && (
                          <button
                            type="button"
                            className="yk-panini-owned-toggle"
                            disabled={binderWishlist.busy}
                            onClick={async () => {
                              setBinderWishlist({ busy: true });
                              try {
                                const added =
                                  await addBinderToWishlist(selectedLicense);
                                setBinderWishlist({
                                  message: added
                                    ? "collectionUi.wishlistAdded"
                                    : "collectionUi.everyMissingCardIsAlreadyInYourWishlist",
                                  messageCount: added
                                });
                              } catch (error) {
                                setBinderWishlist({
                                  error: true,
                                  message:
                                    error instanceof Error
                                      ? error.message
                                      : "collectionUi.couldntUpdateYourWishlist"
                                });
                              }
                            }}
                          >
                            <span aria-hidden="true">♡</span>
                            {binderWishlist.busy
                              ? tc("adding")
                              : tc("addMissingCardsToWishlist")}
                          </button>
                        )}
                        {!readOnly && !previewOnly && (
                          <CollectionCoverEditor
                            targetKey={selectedLicense}
                            name={selectedAlbumName ?? ""}
                            onSaved={() => setPaniniAlbumRefresh(n => n + 1)}
                          />
                        )}
                        {!readOnly && !previewOnly && (
                          <LicenseFolderManager
                            key={selectedLicense}
                            binderKey={selectedLicense}
                            binderName={selectedAlbumName ?? ""}
                          />
                        )}
                      </div>
                      {binderWishlist.message && (
                        <p
                          role={binderWishlist.error ? "alert" : "status"}
                          className={`mb-4 text-sm ${binderWishlist.error ? "text-danger" : "text-ink-2"}`}
                        >
                          {binderWishlist.error
                            ? tError(gameErrorKey(binderWishlist.message))
                            : tError(binderWishlist.message, {
                                count: binderWishlist.messageCount ?? 0
                              })}
                        </p>
                      )}
                      {paniniError && (
                        <div className="yk-panini-empty" role="alert">
                          <strong>{tc("couldntLoad")}</strong>
                          <p>{tError(gameErrorKey(paniniError))}</p>
                        </div>
                      )}
                      {paniniBusy && (
                        <div className="yk-panini-empty" role="status">
                          <strong>{tc("loadingBinder")}</strong>
                        </div>
                      )}
                      {!paniniBusy &&
                        !paniniError &&
                        paniniCards.total === 0 && (
                          <div className="yk-panini-empty">
                            <strong>{tc("noCardsFound")}</strong>
                            <p>{tc("tryAnotherCharacterName")}</p>
                          </div>
                        )}
                      <ul
                        id="binder-cards-list"
                        tabIndex={0}
                        className="yk-panini-slots"
                        aria-label={tc("cardsFrom", {
                          license: selectedAlbumName ?? ""
                        })}
                      >
                        {paniniCards.items.map(card => {
                          const owned = ownedByCardId.get(card.id);
                          return (
                            <li key={card.id}>
                              {owned ? (
                                <button
                                  type="button"
                                  className="yk-panini-owned"
                                  onClick={() => viewCopy(owned)}
                                  aria-label={tc("viewCard", {
                                    name: owned.name
                                  })}
                                >
                                  <CardShell>
                                    <YokaiCard
                                      {...owned}
                                      image={owned.image}
                                      {...presentation[owned.instanceId]}
                                      imageSizes={COLLECTION_CARD_IMAGE_SIZES}
                                    />
                                  </CardShell>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="yk-panini-missing"
                                  onClick={() => setSelectedMissingCard(card)}
                                  aria-label={tc("cardNotOwned", {
                                    name: card.name
                                  })}
                                  aria-haspopup="dialog"
                                >
                                  <CardShell interactive={false}>
                                    <YokaiCard
                                      {...card}
                                      animated={false}
                                      className="yk-panini-missing-card"
                                      imageSizes={COLLECTION_CARD_IMAGE_SIZES}
                                    />
                                  </CardShell>
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {paniniCards.total > 0 && (
                        <div className="yk-collection-pagination yk-panini-pagination">
                          <Pagination
                            page={activePaniniPage}
                            pageCount={paniniPageCount}
                            onPageChange={setPaniniPage}
                            scrollTargetId="binder-cards-list"
                          />
                          <label>
                            {tc("cardsPerPage")}
                            <select
                              value={paniniPageSize}
                              onChange={event => {
                                setPaniniPageSize(Number(event.target.value));
                                setPaniniPage(1);
                              }}
                            >
                              {BINDER_CARD_PAGE_SIZES.map(size => (
                                <option key={size} value={size}>
                                  {size}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="yk-panini-heading">
                        <div>
                          <p className="yk-section-title">{tc("binder")}</p>
                          <h2>{tc("myLicenseBinders")}</h2>
                          {!readOnly && (
                            <p className="yk-binder-subtitle">
                              {td("popularityOrder")}
                            </p>
                          )}
                        </div>
                        <p>
                          {format.number(paniniAlbums.total)}{" "}
                          {paniniAlbums.total === 1
                            ? tc("countPluralOneLicenseOtherLicenses", {
                                count: paniniAlbums.total
                              })
                            : tc("countPluralOneLicenseOtherLicenses", {
                                count: paniniAlbums.total
                              })}{" "}
                          {tc("shown")}
                        </p>
                      </div>
                      <div className="yk-panini-album-filters">
                        <label className="yk-panini-search">
                          <span className="sr-only">
                            {tc("searchLicenses")}
                          </span>
                          <svg
                            aria-hidden="true"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          >
                            <circle cx="11" cy="11" r="7" />
                            <path d="m20 20-4-4" />
                          </svg>
                          <input
                            type="search"
                            value={query}
                            onChange={event => {
                              setQuery(event.target.value);
                              setPaniniAlbumPage(1);
                            }}
                            placeholder={tc("searchLicensesLabel")}
                          />
                        </label>
                        {onSetPaniniAlbumFavorite && (
                          <button
                            type="button"
                            className="yk-panini-owned-toggle"
                            aria-pressed={favoritesOnly}
                            onClick={() => {
                              setFavoritesOnly(current => !current);
                              setPaniniAlbumPage(1);
                            }}
                          >
                            <span aria-hidden="true">
                              {favoritesOnly ? "✓" : "○"}
                            </span>
                            {tc("favoritesOnly")}
                          </button>
                        )}
                      </div>
                      {paniniError && (
                        <div className="yk-panini-empty" role="alert">
                          <strong>{tc("couldntLoad")}</strong>
                          <p>{tError(gameErrorKey(paniniError))}</p>
                        </div>
                      )}
                      {paniniBusy && (
                        <div className="yk-panini-empty" role="status">
                          <strong>{tc("loadingBinders")}</strong>
                        </div>
                      )}
                      {!readOnly &&
                        !!paniniAlbums.favoriteConflicts?.length && (
                          <BinderFavoriteReview
                            conflicts={paniniAlbums.favoriteConflicts}
                            resolve={async (license, keys) => {
                              if (onResolveBinderFavorite)
                                await onResolveBinderFavorite(license, keys);
                              else
                                await (
                                  await import("@/lib/data/binders")
                                ).resolveBinderFavorite(license, keys);
                              setPaniniAlbums(current => ({
                                ...current,
                                favoriteConflicts:
                                  current.favoriteConflicts?.filter(
                                    conflict => conflict.license !== license
                                  )
                              }));
                              setPaniniAlbumPage(1);
                              setPaniniAlbumRefresh(current => current + 1);
                            }}
                          />
                        )}
                      {favoriteError && (
                        <div className="yk-panini-favorite-error" role="alert">
                          {tError(gameErrorKey(favoriteError))}
                        </div>
                      )}
                      {!paniniBusy &&
                      !paniniError &&
                      paniniAlbums.total === 0 ? (
                        <div className="yk-panini-empty">
                          <strong>{tc("noLicensesFound")}</strong>
                          <p>{tc("tryAnotherNameInTheSearchBar")}</p>
                        </div>
                      ) : !paniniBusy && !paniniError ? (
                        <ul
                          id="binder-albums-list"
                          tabIndex={0}
                          className="yk-panini-grid"
                        >
                          {paniniAlbums.items.map(item => (
                            <li
                              key={item.binderKey ?? item.license}
                              className={
                                item.favorite
                                  ? "yk-panini-album-item is-favorite"
                                  : "yk-panini-album-item"
                              }
                            >
                              <button
                                type="button"
                                className="yk-panini-album-open"
                                onClick={() => {
                                  setAlbumSearchBeforeOpen(query);
                                  setBinderWishlist({});
                                  navigateBinder(item);
                                  setQuery("");
                                  setPaniniPage(1);
                                }}
                                aria-label={tc("viewLicense", {
                                  license: item.license,
                                  owned: format.number(item.owned),
                                  total: format.number(item.total),
                                  count: item.total
                                })}
                              >
                                <BinderCover
                                  image={binderCover(item, cards)}
                                  license={item.license}
                                />
                                <span className="yk-panini-details">
                                  <strong
                                    data-long-title={
                                      Array.from(item.license).length > 32
                                    }
                                  >
                                    {item.license}
                                  </strong>
                                  <span className="yk-panini-count">
                                    <span className="yk-panini-count-values">
                                      <b>{format.number(item.owned)}</b>
                                      <span className="yk-panini-count-separator">
                                        /
                                      </span>
                                      <span>{format.number(item.total)}</span>
                                    </span>
                                    <span className="yk-panini-count-label">
                                      {tc("countPluralOneCardOtherCards", {
                                        count: item.total
                                      })}
                                    </span>
                                  </span>

                                  <span className="yk-panini-progress">
                                    <i style={{ width: `${item.percent}%` }} />
                                  </span>
                                  <small>
                                    {item.percent}
                                    {tc("complete")}
                                  </small>
                                </span>
                              </button>
                              {onSetPaniniAlbumFavorite && (
                                <button
                                  type="button"
                                  className="yk-panini-favorite"
                                  aria-label={tc("favoriteAria", {
                                    favorite: String(item.favorite),
                                    license: item.license
                                  })}
                                  aria-pressed={item.favorite}
                                  disabled={favoriteLicenseBusy !== null}
                                  onPointerDown={event =>
                                    event.stopPropagation()
                                  }
                                  onClick={event => {
                                    event.stopPropagation();
                                    void togglePaniniAlbumFavorite(
                                      item.binderKey ?? item.license,
                                      !item.favorite
                                    );
                                  }}
                                >
                                  <svg
                                    aria-hidden="true"
                                    width="19"
                                    height="19"
                                    viewBox="0 0 24 24"
                                    fill={
                                      item.favorite ? "currentColor" : "none"
                                    }
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                  >
                                    <path d="m12 2.8 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 16.83l-5.5 2.89 1.05-6.12L3.1 9.27l6.15-.9L12 2.8Z" />
                                  </svg>
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {paniniAlbums.total > 0 && (
                        <div className="yk-collection-pagination yk-panini-pagination">
                          <Pagination
                            page={activePaniniAlbumPage}
                            pageCount={paniniAlbumPageCount}
                            onPageChange={setPaniniAlbumPage}
                            scrollTargetId="binder-albums-list"
                          />
                          <span className="yk-panini-page-limit">
                            {tc("text72BindersPerPage")}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </section>
              ) : (remote ? remote.error : loadError) && ownedCopies === 0 ? (
                <div
                  role="alert"
                  className="rounded-panel border border-danger/40 px-6 py-12 text-center"
                >
                  <p className="font-display text-xl">
                    {tc("yourCardsCouldntLoad")}
                  </p>
                  <p className="mt-3 text-sm text-ink-2">
                    {tError(gameErrorKey(loadError))}
                  </p>
                  {onRetryLoad && (
                    <Button
                      className="mt-6"
                      variant="secondary"
                      onClick={onRetryLoad}
                    >
                      {tc("tryAgain")}
                    </Button>
                  )}
                </div>
              ) : (remote ? remote.loading : loading) && ownedCopies === 0 ? (
                <CollectionLoading />
              ) : matchingGroups === 0 ? (
                <div className="rounded-panel border border-dashed border-veil-strong px-6 py-16 text-center">
                  <p className="font-display text-xl">
                    {ownedCopies === 0
                      ? tc("yourCollectionIsEmptyOpenYourFirstPack")
                      : tc("noCardsMatchTheseFilters")}
                  </p>
                  {ownedCopies === 0 ? (
                    <Link
                      href="/boosters"
                      className="yk-button yk-button-primary mt-6"
                    >
                      {tc("openMyFirstPack")}
                    </Link>
                  ) : (
                    <p className="mt-3 text-sm text-ink-2">
                      {tc("tryAnotherRarityOrCategory")}
                    </p>
                  )}
                </div>
              ) : null}
              {viewMode !== "panini" && ownedCopies > 0 && loadError && (
                <p role="alert" className="mb-4 text-sm text-danger-ink">
                  {tc("couldntRefreshYourCardsYourLastLoadedCollection")}{" "}
                  {onRetryLoad && (
                    <button
                      type="button"
                      className="underline"
                      onClick={onRetryLoad}
                    >
                      {tc("tryAgain")}
                    </button>
                  )}
                </p>
              )}
              {viewMode !== "panini" && (
                <ul
                  id="collection-cards-list"
                  tabIndex={0}
                  className={`yk-card-grid yk-collection-grid`}
                  aria-label={tc("ownedCardGroups")}
                >
                  {visibleGroups.map(group => {
                    const card = group.representative;
                    const meta = presentation[card.instanceId];
                    const eligible = group.cards.filter(
                      copy =>
                        !copy.locked && !presentation[copy.instanceId]?.frozen
                    );
                    const checked =
                      eligible.length > 0 &&
                      eligible.every(copy => selection.has(copy.instanceId));
                    const partial =
                      !checked &&
                      eligible.some(copy => selection.has(copy.instanceId));
                    const frozenCount = group.cards.filter(
                      copy => presentation[copy.instanceId]?.frozen
                    ).length;
                    const lockedCount = group.cards.filter(
                      copy => copy.locked
                    ).length;
                    return (
                      <li key={group.key} className="min-w-0">
                        <button
                          type="button"
                          disabled={selecting && eligible.length === 0}
                          className={`yk-collection-card ${selecting && (checked || partial) ? "yk-selected-card" : ""}`}
                          aria-label={tc("groupAria", {
                            action: selecting ? "select" : "view",
                            name: card.name,
                            rarity: card.rarity,
                            count: group.cards.length
                          })}
                          aria-pressed={selecting ? checked : undefined}
                          aria-haspopup={selecting ? undefined : "dialog"}
                          onClick={() =>
                            selecting
                              ? toggleGroup(group.cards)
                              : viewCopy(card)
                          }
                        >
                          <CardShell interactive={false}>
                            <YokaiCard
                              {...card}
                              copyInstanceIds={group.cards.map(
                                copy => copy.instanceId
                              )}
                              image={card.image}
                              {...meta}
                              animated={!readOnly}
                              imageSizes={COLLECTION_CARD_IMAGE_SIZES}
                              rarityAccessory={
                                group.cards.length > 1 && (
                                  <span className="yk-collection-copy-count">
                                    ×{group.cards.length}
                                  </span>
                                )
                              }
                            />
                          </CardShell>
                          {selecting && eligible.length > 0 && (
                            <span
                              className={`yk-selection-check ${checked || partial ? "yk-checked" : ""}`}
                            >
                              {checked ? "✓" : partial ? "−" : ""}
                            </span>
                          )}
                          {group.cards.some(
                            copy => presentation[copy.instanceId]?.isNew
                          ) && (
                            <span className="absolute top-3 left-3 rounded-badge bg-accent-gold px-2 py-1 text-[10px] font-bold text-void">
                              {tc("new")}
                            </span>
                          )}
                          {lockedCount > 0 && (
                            <span
                              className="yk-group-locked"
                              aria-label={tc("protectedCard")}
                              title={tc("protectedCard")}
                            >
                              <ProtectedIcon size={16} />
                            </span>
                          )}
                          {lockedCount === 0 && frozenCount > 0 && (
                            <span className="yk-group-frozen">
                              {frozenCount}
                              {tc("inAuction")}
                            </span>
                          )}
                        </button>
                        {!renderCardControls && (
                          <FirstLrCopyMeta
                            instanceIds={group.cards.map(
                              copy => copy.instanceId
                            )}
                          />
                        )}
                        {renderCardControls?.(group)}
                      </li>
                    );
                  })}
                </ul>
              )}
              {viewMode !== "panini" && matchingGroups > 0 && (
                <div className="yk-collection-pagination">
                  <Pagination
                    page={activePage}
                    pageCount={pageCount}
                    onPageChange={setPage}
                    scrollTargetId="collection-cards-list"
                  />
                  <label>
                    {tc("cardsPerPage")}
                    <select
                      value={pageSize}
                      onChange={event => {
                        setPageSize(Number(event.target.value));
                        setPage(1);
                      }}
                    >
                      {CARD_PAGE_SIZES.map(size => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {selecting && (
                <SelectionBar
                  itemLabel="exemplaire"
                  count={selectedCards.length}
                  value={selectedValue}
                  busy={bulkDiscardBusy || bulkFolderBusy}
                  error={bulkFolderError || bulkDiscardError}
                  actions={
                    onMoveCards ? (
                      <div className="yk-selection-folder">
                        <label htmlFor="selection-folder" className="sr-only">
                          {tc("destinationFolder")}
                        </label>
                        <select
                          id="selection-folder"
                          value={bulkFolderTarget}
                          disabled={bulkFolderBusy || bulkDiscardBusy}
                          onChange={event => {
                            setBulkFolderTarget(event.target.value);
                            setBulkFolderError("");
                          }}
                        >
                          <option value="">{tc("chooseAFolder")}</option>
                          <option value="unfiled">{tc("noFolder")}</option>
                          {folders.map(item => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="secondary"
                          disabled={
                            !selectedCards.length ||
                            !bulkFolderTarget ||
                            bulkFolderBusy ||
                            bulkDiscardBusy
                          }
                          onClick={() => void moveSelection()}
                        >
                          {bulkFolderBusy ? tc("moving") : tc("move")}
                        </Button>
                      </div>
                    ) : undefined
                  }
                  onAll={() =>
                    // Adds the current page only; other pages keep their picks.
                    setSelection(
                      current =>
                        new Set([
                          ...current,
                          ...visibleGroups
                            .flatMap(group => group.cards)
                            .filter(
                              c =>
                                !c.locked && !presentation[c.instanceId]?.frozen
                            )
                            .map(c => c.instanceId)
                        ])
                    )
                  }
                  onNone={() => setSelection(new Set())}
                  onDestroy={() => {
                    setBulkDiscardError("");
                    setBulkFolderError("");
                    setBulkDiscardConfirm(true);
                  }}
                  onClose={() => {
                    setSelecting(false);
                    setSelection(new Set());
                    setBulkFolderTarget("");
                    setBulkFolderError("");
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}
      <Modal
        open={!!selected && !discardConfirm && !auctionOpen && !evolveConfirm}
        onClose={closeDetail}
        title={tc("cardDetails")}
        className="yk-card-detail-modal"
      >
        {selected && (
          <div className="yk-detail-grid">
            <div className="yk-detail-side">
              <div className="yk-detail-art">
                <YokaiCard
                  {...selected}
                  image={selected.image}
                  {...selectedMeta}
                  fallbackImage={selected.catalogueImage}
                />
              </div>
              {!readOnly && onMoveCard && (
                <div className="yk-detail-folder">
                  <label
                    htmlFor="detail-card-folder"
                    className="yk-section-title"
                  >
                    {tc("folder")}
                  </label>
                  <select
                    id="detail-card-folder"
                    value={selected.folderId ?? ""}
                    onChange={event =>
                      void onMoveCard(
                        selected.instanceId,
                        event.target.value || null
                      )
                    }
                  >
                    <option value="">{tc("noFolder")}</option>
                    {folders.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="yk-detail-info">
              <header className="yk-detail-header">
                <div className="yk-detail-heading">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-sm font-bold tracking-widest ${rarityText[selected.rarity]}`}
                    >
                      {cardRarityLabel(
                        selected.rarity,
                        selected.shiny,
                        selected.isEvolved
                      )}
                    </span>
                  </div>
                  <div className="yk-detail-title-row">
                    <h3 className="font-display text-[28px] leading-tight">
                      {selected.name}
                    </h3>
                    {!readOnly && onSetLocked && (
                      <button
                        type="button"
                        className="yk-detail-lock-toggle"
                        aria-label={
                          selected.locked ? tc("unlockCard") : tc("lockCard")
                        }
                        aria-pressed={!!selected.locked}
                        title={
                          selected.locked
                            ? tc("lockedCantBeDestroyedOrTraded")
                            : tc("lockThisCard")
                        }
                        disabled={lockBusy || !!selectedMeta?.frozen}
                        onClick={() => void toggleSelectedLock()}
                      >
                        <ProtectedIcon size={17} />
                      </button>
                    )}
                  </div>
                  {lockError && (
                    <p role="alert" className="mt-2 text-xs text-danger">
                      {tError(gameErrorKey(lockError))}
                    </p>
                  )}
                </div>
                <div className="yk-detail-utility-actions">
                  {localPreview ? (
                    <p
                      className="text-xs text-ink-3"
                      title={tc("sharingAndReportingAreUnavailableInThisLocal")}
                    >
                      {tc("localDemo")}
                    </p>
                  ) : (
                    <>
                      {!readOnly && (
                        <CardShareButton
                          key={selected.instanceId}
                          instanceId={selected.instanceId}
                          name={selected.name}
                          iconOnly
                        />
                      )}
                      <CardReportButton
                        cardId={selected.id}
                        cardName={selected.name}
                        iconOnly
                      />
                    </>
                  )}
                </div>
              </header>
              {(selectedGroup?.cards.length ?? 0) > 1 && (
                <div className="yk-copy-picker">
                  <span className="yk-section-title">
                    {tc("displayedCopy")}
                  </span>
                  <div>
                    {selectedGroup?.cards.map((card, index) => (
                      <button
                        type="button"
                        key={card.instanceId}
                        aria-label={tc("copyProtected", {
                          index: index + 1,
                          locked: String(!!card.locked),
                          shiny: String(card.shiny)
                        })}
                        aria-pressed={card.instanceId === selected.instanceId}
                        onClick={() => viewCopy(card)}
                      >
                        <span>
                          {index + 1}
                          {card.shiny && <span aria-hidden="true"> ✧</span>}
                          {card.customImageUrl ? " ✦" : ""}
                        </span>
                        {card.locked ? (
                          <ProtectedIcon size={12} />
                        ) : presentation[card.instanceId]?.frozen ? (
                          " ⏳"
                        ) : (
                          ""
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <dl className="yk-detail-facts">
                <div>
                  <dt>{tc("category")}</dt>
                  <dd>{selected.category}</dd>
                </div>
                <div>
                  <dt>{tc("obtainedOn")}</dt>
                  <dd>{formatDate(selected.obtainedAt, true)}</dd>
                </div>
                <div>
                  <dt>{tc("copies")}</dt>
                  <dd>{selectedGroup?.cards.length ?? 1}</dd>
                </div>
                {selectedMeta?.marketValue != null && (
                  <div>
                    <dt>{tc("marketValue")}</dt>
                    <dd>
                      <Karas amount={selectedMeta.marketValue} />
                    </dd>
                  </div>
                )}
              </dl>

              {selectedGroupFrozen &&
                (adminRemoval ? (
                  <Feedback tone="error" title={tc("cardCurrentlyAtAuction")}>
                    Administrative removal will also cancel the listing and
                    automatically refund the highest bidder.
                  </Feedback>
                ) : (
                  <Feedback tone="error" title={tc("cardFrozenWhileInAuction")}>
                    {tc("thisCardCantBeListedAgainOrDestroyed")}
                  </Feedback>
                ))}
              {resolvedTradeHref && !selected.locked && (
                <Link
                  className="yk-button yk-button-primary mt-6 flex w-full justify-center"
                  href={resolvedTradeHref(selected)}
                >
                  {tc("offerATrade")}
                </Link>
              )}
              {!readOnly && (onCreateAuction || canEvolve) && (
                <div className="yk-detail-actions">
                  {onCreateAuction && (
                    <Button
                      className="w-full"
                      disabled={selected.locked || selectedGroupFrozen}
                      onClick={() => void openAuction()}
                    >
                      {selected.locked
                        ? tc("cardLocked")
                        : selectedGroupFrozen
                          ? tc("cardFrozenWhileInAuction")
                          : tc("listForAuction")}
                    </Button>
                  )}
                  {canEvolve && (
                    <div className="yk-detail-evolve">
                      <div className="yk-detail-progress-copy">
                        <strong>{tc("evolutionProgress")}</strong>
                        <span>
                          {evolvableCopies}/{evolutionRequired}
                          {tc("copiesLeadingSpace")}
                        </span>
                      </div>
                      <div
                        className="yk-detail-progress"
                        role="progressbar"
                        aria-label={
                          selected.rarity === "LR"
                            ? tc("progressTowardLrEvolution")
                            : tc("progressTowardSsrEvolution")
                        }
                        aria-valuemin={0}
                        aria-valuemax={evolutionRequired}
                        aria-valuenow={Math.min(
                          evolvableCopies,
                          evolutionRequired
                        )}
                      >
                        <span
                          style={{
                            width: `${(Math.min(evolvableCopies, evolutionRequired) / evolutionRequired) * 100}%`
                          }}
                        />
                      </div>
                      <Button
                        variant="secondary"
                        disabled={
                          evolvableCopies < evolutionRequired ||
                          evolving ||
                          !onEvolve
                        }
                        onClick={() => {
                          setEvolutionSelection(
                            new Set(
                              orderEvolutionCopies(
                                evolvableCards,
                                selected.instanceId
                              )
                                .slice(0, evolutionRequired)
                                .map(card => card.instanceId)
                            )
                          );
                          setEvolutionImageSourceId(selected.instanceId);
                          setEvolutionError("");
                          setEvolveConfirm(true);
                        }}
                      >
                        {tc("evolveTarget", {
                          rarity: selected?.rarity ?? "SSR"
                        })}
                      </Button>
                    </div>
                  )}
                  {evolutionError && (
                    <p role="alert" className="text-xs text-danger">
                      {tError(gameErrorKey(evolutionError))}
                    </p>
                  )}
                </div>
              )}
              {!readOnly && onSetCustomImage && (
                <details className="yk-detail-image">
                  <summary>
                    {tc("customizeImage")}
                    <svg
                      aria-hidden="true"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="m7 10 5 5 5-5" />
                    </svg>
                  </summary>
                  <div className="yk-detail-image-content">
                    <div className="yk-detail-image-row">
                      <input
                        id="detail-custom-image"
                        type="url"
                        disabled={!pro || imageBusy}
                        value={customImageUrl}
                        onChange={event => {
                          setCustomImageUrl(event.target.value);
                          setImageError("");
                        }}
                        placeholder="https://i.imgur.com/image.jpg"
                        aria-label={tc("customImgurOrPinterestImageLink")}
                        className="auth-input"
                      />
                      <Button
                        variant="secondary"
                        disabled={!pro || imageBusy || !customImageUrl.trim()}
                        onClick={() =>
                          void saveCustomImage(customImageUrl.trim())
                        }
                      >
                        {imageBusy ? tc("saving") : tc("apply")}
                      </Button>
                    </div>
                    {!pro && (
                      <ProFeatureNotice feature={tc("customCardArtwork")} />
                    )}
                    <p className="yk-detail-hint">
                      {tc("linkHttpsIImgurComHttpsImgurCom")}
                      {selected.customImageUrl && (
                        <>
                          {" "}
                          ·{" "}
                          <button
                            type="button"
                            className="yk-detail-link"
                            disabled={imageBusy}
                            onClick={() => void saveCustomImage(null)}
                          >
                            {tc("restoreOriginalImage")}
                          </button>
                        </>
                      )}
                    </p>
                    {imageError && (
                      <p role="alert" className="mt-2 text-xs text-danger">
                        {tError(gameErrorKey(imageError))}
                      </p>
                    )}
                  </div>
                </details>
              )}
              {(!readOnly || adminRemoval) && (onDiscardMany || onDiscard) && (
                <div className="yk-detail-danger">
                  <Button
                    variant="danger"
                    disabled={discardBusy || destructibleCards.length === 0}
                    onClick={() => {
                      setDiscardQuantity(1);
                      setDiscardError("");
                      setDiscardConfirm(true);
                    }}
                  >
                    {adminRemoval
                      ? "Remove from collection"
                      : tc("destroyCopies")}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={evolveConfirm && !!selected}
        onClose={() => {
          if (!evolving) {
            setEvolveConfirm(false);
            setEvolutionError("");
          }
        }}
        title={
          selected?.rarity === "LR"
            ? tc("confirmLrEvolution")
            : tc("confirmSsrEvolution")
        }
        className={`yk-evolution-modal ${selected?.rarity === "LR" ? "yk-evolution-modal-lr" : ""}`}
      >
        {selected && (
          <>
            <div className="yk-evolution-body">
              <section
                className="yk-evolution-result"
                aria-label={tc("evolutionResult")}
              >
                <div className="yk-evolution-result-art" aria-hidden="true">
                  <YokaiCard
                    {...selected}
                    image={
                      evolutionImageSource?.customImageUrl ||
                      selected.catalogueImage ||
                      selected.image
                    }
                    fallbackImage={selected.catalogueImage}
                    shiny={selected.rarity === "SSR" || evolutionShiny}
                    isEvolved
                    animated={false}
                  />
                </div>
                <div className="yk-evolution-result-info">
                  <p className="yk-evolution-eyebrow">{tc("theNextForm")}</p>
                  <h3>{selected.name}</h3>
                  <span className="yk-evolution-result-rarity">
                    {tc("evolutionPrefix", {
                      rarity: selected?.rarity ?? "SSR"
                    })}
                    {tc("fusionResult", {
                      rarity: selected.rarity,
                      shiny: String(evolutionShiny)
                    })}
                  </span>
                  <p>
                    {tc("fusionCombine", {
                      count: evolutionRequired,
                      rarity: selected.rarity
                    })}
                  </p>
                  <p className="yk-evolution-image-kept">
                    {evolutionImageSource
                      ? tc("evolutionImageKept", {
                          rarity: selected?.rarity ?? "SSR"
                        })
                      : tc("theOriginalImageWillBeUsed")}
                  </p>
                  <div
                    className="yk-evolution-recipe"
                    aria-label={tc("evolutionRecipe", {
                      count: evolutionRequired,
                      rarity: selected?.rarity ?? "SSR"
                    })}
                  >
                    <span>
                      {evolutionRequired}
                      {tc("copiesLeadingSpace")}
                    </span>
                    <span aria-hidden="true">→</span>
                    <strong>
                      {tc("evolutionResultLabel", {
                        rarity: selected?.rarity ?? "SSR"
                      })}
                    </strong>
                  </div>
                </div>
              </section>
              <div className="yk-evolution-selection-heading">
                <div>
                  <h3>{tc("chooseYourCopies")}</h3>
                  <p>
                    {tc("chooseExactly")}
                    {evolutionRequired}
                    {tc("evolutionCustomCarry", {
                      rarity: selected?.rarity ?? "SSR"
                    })}
                  </p>
                </div>
                <span
                  className="yk-evolution-counter"
                  role="status"
                  aria-live="polite"
                >
                  {evolutionCards.length}
                  <span>/ {evolutionRequired}</span>
                </span>
              </div>
              <ul
                className="yk-evolution-copies"
                aria-label={tc("copiesToConsume")}
              >
                {evolvableCards.map(card => {
                  const index =
                    selectedGroup?.cards.findIndex(
                      copy => copy.instanceId === card.instanceId
                    ) ?? -1;
                  const checked = evolutionSelection.has(card.instanceId);
                  return (
                    <li key={card.instanceId}>
                      <button
                        type="button"
                        className="yk-evolution-copy"
                        aria-pressed={checked}
                        aria-label={tc("copyObtained", {
                          index: index + 1,
                          date: formatDate(card.obtainedAt, true),
                          custom: String(!!card.customImageUrl),
                          shiny: String(card.shiny)
                        })}
                        disabled={evolving}
                        onClick={() => toggleEvolutionCard(card.instanceId)}
                      >
                        <span
                          className="yk-evolution-copy-art"
                          aria-hidden="true"
                        >
                          <YokaiCard {...card} animated={false} />
                          <span className="yk-evolution-copy-check">
                            {checked ? "✓" : "+"}
                          </span>
                        </span>
                        <strong>
                          {tc("copy")}
                          {String(index + 1).padStart(2, "0")}
                          {card.shiny && <span aria-hidden="true"> ✧</span>}
                        </strong>
                        <span className="yk-evolution-copy-state">
                          {checked ? tc("selected") : tc("select")}
                        </span>
                        <span className="yk-evolution-copy-date">
                          {formatDate(card.obtainedAt, true)}
                        </span>
                        <span className="yk-evolution-copy-folder">
                          {folders.find(folder => folder.id === card.folderId)
                            ?.name ?? tc("noFolder")}
                        </span>
                        <span
                          className={`yk-evolution-copy-image ${card.customImageUrl ? "has-custom-image" : ""}`}
                        >
                          {tc("image")}{" "}
                          {card.customImageUrl
                            ? tc("customCanBeKept")
                            : tc("original")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {evolutionImageCards.length > 1 && (
                <fieldset
                  className="yk-evolution-image-choice"
                  disabled={evolving}
                >
                  <legend>{tc("chooseTheCustomImageToKeep")}</legend>
                  <p>{tc("onlyOneImageIsCarriedOverThePreview")}</p>
                  <div>
                    {evolutionImageCards.map(card => (
                      <label key={card.instanceId}>
                        <input
                          type="radio"
                          name="evolution-image"
                          value={card.instanceId}
                          checked={
                            evolutionImageSource?.instanceId === card.instanceId
                          }
                          onChange={() =>
                            setEvolutionImageSourceId(card.instanceId)
                          }
                        />
                        {tc("copyLabel")}{" "}
                        {String(
                          selectedGroup!.cards.findIndex(
                            copy => copy.instanceId === card.instanceId
                          ) + 1
                        ).padStart(2, "0")}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <p className="yk-evolution-notice" role="status">
                {tc("fusionConsumption", {
                  count: evolutionRequired,
                  rarity: selected.rarity,
                  shiny: String(evolutionShiny)
                })}
              </p>
            </div>
            <div className="yk-evolution-footer">
              {selected.rarity === "LR" && shinyConsumed > 0 && (
                <p className="text-xs text-warning" role="alert">
                  {tc("shinySacrifice", { count: shinyConsumed })}
                </p>
              )}
              {evolutionError && (
                <p role="alert" className="text-sm text-danger">
                  {tError(gameErrorKey(evolutionError))}
                </p>
              )}
              <div className="yk-evolution-actions">
                <span className="yk-evolution-footer-summary">
                  {evolutionCards.length === evolutionRequired
                    ? tc("readyToEvolve")
                    : tc("selectMoreCopies", {
                        count: evolutionRequired - evolutionCards.length
                      })}
                </span>
                <Button
                  variant="secondary"
                  disabled={evolving}
                  onClick={() => setEvolveConfirm(false)}
                >
                  {tc("cancel")}
                </Button>
                <Button
                  disabled={
                    evolving || evolutionCards.length !== evolutionRequired
                  }
                  onClick={() => void evolveSelected()}
                  className="yk-evolution-submit"
                >
                  {evolving
                    ? tc("evolving")
                    : tc("fusionConfirm", {
                        rarity: selected.rarity,
                        shiny: String(evolutionShiny)
                      })}
                </Button>
              </div>
            </div>
          </>
        )}
      </Modal>
      {!readOnly && (
        <Modal
          open={bulkDiscardConfirm}
          onClose={() => {
            if (!bulkDiscardBusy) setBulkDiscardConfirm(false);
          }}
          title={tc("destroySelectedCards")}
        >
          <p className="text-sm leading-6 text-ink-2">
            {tc("destroy")}{" "}
            <strong className="text-ink">
              {format.number(selectedCards.length)}{" "}
              {selectedCards.length === 1
                ? tc("countPluralOneCopyOtherCopies", {
                    count: selectedCards.length
                  })
                : tc("countPluralOneCopyOtherCopies", {
                    count: selectedCards.length
                  })}
            </strong>{" "}
            {tc("for")}{" "}
            <strong className="text-karas">{selectedValue ?? "…"} Karas</strong>{" "}
            {tc("thisCantBeUndone")}
          </p>
          {bulkDiscardError && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {tError(gameErrorKey(bulkDiscardError))}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              disabled={bulkDiscardBusy}
              onClick={() => setBulkDiscardConfirm(false)}
            >
              {tc("cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={bulkDiscardBusy || selectedValue == null}
              onClick={() => void discardSelection()}
            >
              {bulkDiscardBusy ? tc("destroying") : tc("confirmDestruction")}
            </Button>
          </div>
        </Modal>
      )}
      <Modal
        open={discardConfirm && !!selected}
        onClose={() => {
          if (!discardBusy) {
            setDiscardConfirm(false);
            setDiscardError("");
          }
        }}
        title={adminRemoval ? "Remove this card?" : tc("destroyCopiesLabel")}
      >
        {selected && (
          <>
            {adminRemoval ? (
              <p className="text-sm leading-6 text-ink-2">
                Permanently remove this copy of{" "}
                <strong className="text-ink">{selected.name}</strong> from the
                player’s collection? No Karas will be credited. This action is
                irreversible.
              </p>
            ) : (
              <>
                <p className="text-sm leading-6 text-ink-2">
                  {tc("chooseHowManyCopiesOf")}{" "}
                  <strong className="text-ink">{selected.name}</strong>{" "}
                  {tc("toDestroyCopiesWithNoCustomImageAre")}
                </p>
                <div className="yk-quantity-picker">
                  <button
                    type="button"
                    aria-label={tc("destroyOneFewerCopy")}
                    disabled={discardQuantity <= 1 || discardBusy}
                    onClick={() =>
                      setDiscardQuantity(value => Math.max(1, value - 1))
                    }
                  >
                    −
                  </button>
                  <output aria-live="polite">{discardQuantity}</output>
                  <button
                    type="button"
                    aria-label={tc("destroyOneMoreCopy")}
                    disabled={
                      discardQuantity >= destructibleCards.length || discardBusy
                    }
                    onClick={() =>
                      setDiscardQuantity(value =>
                        Math.min(destructibleCards.length, value + 1)
                      )
                    }
                  >
                    +
                  </button>
                  <button
                    type="button"
                    disabled={
                      discardBusy ||
                      discardQuantity === destructibleCards.length
                    }
                    onClick={() => setDiscardQuantity(destructibleCards.length)}
                  >
                    {tc("destroyAll")}
                  </button>
                </div>
                <p className="mt-4 text-sm text-ink-2">
                  {tc("youllDestroy")}{" "}
                  <strong className="text-ink">
                    {format.number(discardCards.length)}{" "}
                    {discardCards.length === 1
                      ? tc("countPluralOneCopyOtherCopies", {
                          count: discardCards.length
                        })
                      : tc("countPluralOneCopyOtherCopies", {
                          count: discardCards.length
                        })}
                  </strong>{" "}
                  {tc("andReceive")}{" "}
                  <strong className="text-karas">
                    {discardValue == null
                      ? undefined
                      : format.number(discardValue)}{" "}
                    Karas
                  </strong>
                  .
                </p>
              </>
            )}
            {destructibleCards.length < (selectedGroup?.cards.length ?? 0) && (
              <p className="mt-2 text-xs text-ink-3">
                {tc("excludedCopiesInAuctions")}{" "}
                {(selectedGroup?.cards.length ?? 0) - destructibleCards.length}.
              </p>
            )}
            {discardError && (
              <p role="alert" className="mt-4 text-sm text-danger">
                {tError(gameErrorKey(discardError))}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                disabled={discardBusy}
                onClick={() => setDiscardConfirm(false)}
              >
                {tc("cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={discardBusy || discardCards.length === 0}
                onClick={() => void discardSelected()}
              >
                {discardBusy
                  ? adminRemoval
                    ? "Removing…"
                    : tc("destroying")
                  : adminRemoval
                    ? "Remove card"
                    : tc("destroyCount", { count: discardCards.length })}
              </Button>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={auctionOpen && !!selected}
        onClose={closeAuction}
        title={
          auctionDone
            ? localPreview
              ? tc("demoAuctionCreated")
              : tc("cardListedForAuction")
            : tc("listForAuction")
        }
        className="yk-auction-modal"
      >
        {selected &&
          (auctionDone ? (
            <>
              <Feedback
                tone="success"
                title={
                  localPreview
                    ? tc("demoAuctionCreated")
                    : tc("cardListedForAuctionLockedUntilTheAuction")
                }
              >
                {localPreview
                  ? tc("thisListingIsSimulatedNothingWasPublishedTo")
                  : tc("itsNowListedOnTheMarket")}
              </Feedback>
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <Button variant="secondary" onClick={closeAuction}>
                  {tc("close")}
                </Button>
                {!localPreview && (
                  <Link href="/market" className="yk-button yk-button-primary">
                    {tc("viewMarket")}
                  </Link>
                )}
              </div>
            </>
          ) : (
            <form
              onSubmit={event => {
                event.preventDefault();
                if (Number(auctionPrice) >= 10) void auctionSelected();
              }}
            >
              <div className="yk-auction-modal-grid">
                <div className="yk-auction-modal-art">
                  <YokaiCard
                    {...selected}
                    image={selected.image}
                    fallbackImage={selected.catalogueImage}
                  />
                </div>
                <div className="min-w-0">
                  <p
                    className={`text-sm font-bold tracking-widest ${rarityText[selected.rarity]}`}
                  >
                    {selected.rarity}
                    {selected.shiny ? " ✦" : ""}
                  </p>
                  <h3 className="mt-1 font-display text-2xl leading-tight">
                    {selected.name}
                  </h3>
                  <label
                    className="mt-5 block text-xs font-semibold tracking-wider text-ink-3 uppercase"
                    htmlFor="auction-price"
                  >
                    {tc("startingBid")}
                  </label>
                  <input
                    id="auction-price"
                    type="number"
                    inputMode="numeric"
                    min="10"
                    value={auctionPrice}
                    onChange={e => setAuctionPrice(e.target.value)}
                    aria-invalid={Number(auctionPrice) < 10 || undefined}
                    className="auth-input mt-2"
                  />
                  <p
                    className={`mt-2 text-xs ${Number(auctionPrice) < 10 ? "text-danger-ink" : "text-ink-3"}`}
                  >
                    {tc("minimum10Karas")}
                  </p>
                  {auctionSuggestionBusy ? (
                    <p className="mt-3 text-xs text-ink-3">
                      {tc("lookingUpMarketValue")}
                    </p>
                  ) : auctionSuggestion != null ? (
                    <div className="yk-auction-suggestion">
                      <span>
                        {tc("suggested")}
                        <Karas amount={auctionSuggestion} />
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAuctionPrice(String(auctionSuggestion))
                        }
                      >
                        {tc("useThisValue")}
                      </button>
                    </div>
                  ) : null}
                  <fieldset className="mt-5">
                    <legend className="mb-2 text-xs font-semibold tracking-wider text-ink-3 uppercase">
                      {tc("duration")}
                    </legend>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        ["15", "15 min"],
                        ["30", "30 min"],
                        ["60", "1 h"],
                        ["240", "4 h"],
                        ["720", "12 h"],
                        ["1440", "24 h"]
                      ].map(([value, label]) => (
                        <Chip
                          key={value}
                          active={auctionDuration === value}
                          className="justify-center"
                          onClick={() => setAuctionDuration(value)}
                        >
                          {label}
                        </Chip>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </div>
              <ul className="yk-auction-modal-notes">
                <li>{tc("thisCardWillBeLockedUntilTheAuction")}</li>
                {selected.customImageUrl && (
                  <li>{tc("thisCardsCustomImageWillBeReset")}</li>
                )}
              </ul>
              {auctionError && (
                <p role="alert" className="mt-4 text-sm text-danger">
                  {tError(gameErrorKey(auctionError))}
                </p>
              )}
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <Button
                  variant="secondary"
                  disabled={auctionBusy}
                  onClick={closeAuction}
                >
                  {tc("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={auctionBusy || Number(auctionPrice) < 10}
                  aria-busy={auctionBusy || undefined}
                >
                  {auctionBusy ? tc("listing") : tc("listForAuction")}
                </Button>
              </div>
            </form>
          ))}
      </Modal>
      <CatalogueCardModal
        selected={selectedMissingCard}
        onClose={() => setSelectedMissingCard(null)}
      />
      <Modal
        open={!!removingFolder}
        title={tf("deleteTitle")}
        onClose={() => {
          if (!folderBusy) setRemovingFolder(null);
        }}
      >
        <p>{tf("deleteHint", { name: removingFolder?.name ?? "" })}</p>
        {folderDeleteFailed && (
          <p role="alert" className="text-danger">
            {tf("error")}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button
            variant="secondary"
            disabled={folderBusy}
            onClick={() => setRemovingFolder(null)}
          >
            {tf("cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={folderBusy}
            aria-busy={folderBusy || undefined}
            onClick={async () => {
              if (!removingFolder || !onDeleteFolder || folderBusy) return;
              setFolderBusy(true);
              setFolderDeleteFailed(false);
              try {
                await onDeleteFolder(removingFolder.id);
                setFolder("");
                setRemovingFolder(null);
              } catch {
                setFolderDeleteFailed(true);
              } finally {
                setFolderBusy(false);
              }
            }}
          >
            {tf("delete")}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
