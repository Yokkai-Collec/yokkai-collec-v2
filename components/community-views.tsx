"use client";
import { EmojiReactionPicker } from "@/components/emoji-reaction-picker";
import { reactionEmoji } from "@/lib/ui/reaction-emojis";
import { insertMessageEmoji } from "@/lib/ui/message-emoji";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import type { PlayerPreviewAdapter } from "@/components/player-profile-preview";
import { AuctionMessageText } from "@/components/auction-message-text";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations, useFormatter, useLocale } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { animation } from "@/lib/ui/animations";
import {
  getCataloguePage,
  getGameInfo,
  getUserCollection,
  invalidatePlayerSnapshots,
  type Card,
  type CollectedCard,
  type Rarity
} from "@/lib/data/cards";
import { useNotificationItems, Topbar } from "@/components/topbar";
import {
  Avatar,
  Button,
  Karas,
  Modal,
  Pagination,
  StatusPill
} from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import { CardShell } from "@/components/card-shell";
import { CardReportButton } from "@/components/card-report-button";
import { GifPicker, type GifChoice } from "@/components/gif-picker";
import { CARD_PAGE_SIZES } from "@/lib/ui/pagination";
import { startVisiblePolling } from "@/lib/ui/visible-polling";
import {
  marketLabelKeys as labelKeys,
  marketEmptyStates as marketEmptyStateKeys
} from "@/lib/ui/market-labels";
import { useMarketSort } from "@/lib/ui/market-sort";
import {
  auctionReconciliationScopes,
  cancelAuction,
  getAuction,
  getAuctionChat,
  browseAuctions,
  MARKET_PAGE_SIZE,
  MARKET_MAX_ITEMS,
  type MarketQuery,
  type MarketPage,
  placeBid,
  sendAuctionChatMessage,
  toggleWatch,
  type AuctionData,
  type AuctionDetail
} from "@/lib/data/market";
import { subscribePlayerSnapshotInvalidation } from "@/lib/data/player-state";
import { TradesPanel } from "@/components/trades";
import { type ModerationAdapter } from "@/lib/data/moderation";
import { PlayerModeration } from "@/components/player-moderation";
import { FriendsPanel } from "@/components/friends";
import dynamic from "next/dynamic";
import {
  getCardDiscovery as liveGetCardDiscovery,
  getWishlist,
  toggleWishlist as liveToggleWishlist,
  type CardDiscovery,
  type CardOwner,
  type WishlistCard
} from "@/lib/data/wishlist";
import { markNotificationRead } from "@/lib/data/notifications";
import { useNotificationFeed } from "@/hooks/use-notification-feed";
import { matchesCardSearch, toggleFilterValue } from "@/lib/ui/card-search";
import {
  FilterGroup,
  FilterSection as CatalogueFilterSection,
  RarityChips
} from "@/components/collection-filters";

const ProfileExperience = dynamic(
  () => import("@/components/profile").then(module => module.ProfileExperience),
  {
    loading: function ProfileLoading() {
      const tLoading = useTranslations("profileUi");
      return <p role="status">{tLoading("loadingProfile")}</p>;
    }
  }
);

export type CommunityScreen =
  | "profile"
  | "friends"
  | "feed"
  | "market"
  | "auction"
  | "trades"
  | "search"
  | "wishlist";
const headings = {
  profile: ["Collector", "My profile"],
  friends: ["Between collectors", "Social"],
  market: ["The auction house", "Market"],
  auction: ["Market · Auction", "Auction details"],
  trades: ["Between collectors", "Trades"],
  search: ["Every card in the game", "Catalog"],
  wishlist: ["Cards you're looking for", "My wishlist"]
};
function Unavailable({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="yk-empty-state">
      <span
        aria-hidden="true"
        className="font-display text-3xl text-accent-gold"
      >
        ✦
      </span>
      <p className="mt-4 max-w-md text-sm leading-6 text-ink-2">{children}</p>
    </div>
  );
}

const catalogueRarityText: Record<Rarity, string> = {
  C: "text-rarity-c",
  R: "text-rarity-r",
  SR: "text-rarity-sr",
  SSR: "text-rarity-ssr",
  LR: "text-rarity-lr"
};
function CardOwnerList({
  title,
  owners
}: {
  title: string;
  owners: CardOwner[];
}) {
  const tv = useTranslations("catalogueUi");
  const format = useFormatter();
  return (
    <div className="yk-catalogue-owner-group">
      <h4>{title}</h4>
      {owners.length ? (
        <ul>
          {owners.map(owner => (
            <li key={owner.id}>
              <Link href={`/profile/${owner.id}`} title={owner.pseudo}>
                <span className="yk-catalogue-owner-name">{owner.pseudo}</span>
                <span className="yk-catalogue-owner-copies">
                  {format.number(owner.copies)}{" "}
                  {owner.copies === 1
                    ? tv("countPluralOneCopyOtherCopies", {
                        count: owner.copies
                      })
                    : tv("countPluralOneCopyOtherCopies", {
                        count: owner.copies
                      })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>{tv("none")}</p>
      )}
    </div>
  );
}
export type CatalogueCardAdapter = {
  get: typeof liveGetCardDiscovery;
  toggle: typeof liveToggleWishlist;
  report?: (
    cardId: string,
    reason: import("@/lib/data/card-reports").CardReportReason
  ) => Promise<void>;
};
export function CatalogueCardModal({
  selected,
  onClose,
  onWishlistChange,
  adapter
}: {
  selected: Card | null;
  onClose: () => void;
  onWishlistChange?: (cardId: string, wishlisted: boolean) => void;
  adapter?: CatalogueCardAdapter;
}) {
  const tError = useTranslations();
  const tv = useTranslations("catalogueUi");
  const getCardDiscovery = adapter?.get ?? liveGetCardDiscovery;
  const toggleWishlist = adapter?.toggle ?? liveToggleWishlist;
  const [discovery, setDiscovery] = useState<{
    key: string;
    detail?: CardDiscovery;
    error?: string;
  }>();
  const [busy, setBusy] = useState(false);
  const selectionKey = selected
    ? `${selected.id}:${selected.shiny ? "shiny" : "normal"}`
    : undefined;
  const detail =
    selectionKey && discovery?.key === selectionKey
      ? discovery.detail
      : undefined;
  const error =
    selectionKey && discovery?.key === selectionKey
      ? discovery.error
      : undefined;
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const cardId = selected.id;
    const key = selectionKey!;
    void getCardDiscovery(cardId, 0, 12, !!selected.shiny).then(
      value => {
        if (active) setDiscovery({ key, detail: value });
      },
      e => {
        if (active)
          setDiscovery({
            key,
            error:
              e instanceof Error
                ? gameErrorKey(e)
                : "catalogueUi.detailsUnavailable"
          });
      }
    );
    return () => {
      active = false;
    };
  }, [selected, selectionKey, getCardDiscovery]);
  async function toggle() {
    if (!selected || busy) return;
    const key = selectionKey!;
    setBusy(true);
    setDiscovery(current =>
      current?.key === key ? { ...current, error: undefined } : current
    );
    try {
      const wishlisted = await toggleWishlist(selected.id);
      setDiscovery(current =>
        current?.key === key && current.detail
          ? { ...current, detail: { ...current.detail, wishlisted } }
          : current
      );
      onWishlistChange?.(selected.id, wishlisted);
    } catch (e) {
      setDiscovery({
        key,
        detail,
        error:
          e instanceof Error
            ? gameErrorKey(e)
            : "catalogueUi.couldntCompleteThisAction"
      });
    } finally {
      setBusy(false);
    }
  }
  async function moreOwners() {
    if (!selected || !detail) return;
    const key = selectionKey!;
    try {
      const next = await getCardDiscovery(
        selected.id,
        detail.owners.length,
        12,
        !!selected.shiny
      );
      setDiscovery({
        key,
        detail: { ...next, owners: [...detail.owners, ...next.owners] }
      });
    } catch (e) {
      setDiscovery({
        key,
        detail,
        error:
          e instanceof Error ? gameErrorKey(e) : "catalogueUi.ownersUnavailable"
      });
    }
  }
  const friendOwners = detail?.owners.filter(owner => owner.isFriend) ?? [];
  const otherOwners = detail?.owners.filter(owner => !owner.isFriend) ?? [];
  return (
    <Modal
      open={!!selected}
      onClose={onClose}
      title={selected?.name ?? tv("cardDetails")}
      className="yk-catalogue-detail-modal"
    >
      {selected && (
        <div className="yk-detail-grid">
          <div className="yk-detail-art">
            <YokaiCard {...selected} />
          </div>
          <div className="flex min-w-0 flex-col">
            <p className="text-sm text-ink-2">
              {selected.category} · {selected.rarity}
            </p>
            {selected.anime && (
              <p className="mt-2 text-sm text-ink-3">{selected.anime}</p>
            )}
            <p className="mt-7 text-xs text-ink-3">{tv("marketValue")}</p>
            {detail?.marketValue != null ? (
              <Karas
                amount={Math.round(detail.marketValue)}
                className="mt-2 text-xl"
              />
            ) : (
              <p className="mt-2 text-sm text-ink-3">{tv("noSalesRecorded")}</p>
            )}
            {detail?.activeAuctionId ? (
              <Link
                className="yk-button mt-5 flex w-full justify-center"
                href={`/market/${detail.activeAuctionId}`}
              >
                {tv("viewAuction")}
              </Link>
            ) : null}
            <Button
              variant="secondary"
              disabled={!detail || busy}
              className="mt-3 w-full"
              onClick={() => void toggle()}
            >
              {detail?.wishlisted
                ? tv("removeFromMyWishlist")
                : tv("addToMyWishlist")}
            </Button>
            <CardReportButton
              cardId={selected.id}
              cardName={selected.name}
              className="mt-3 w-full"
              sendReport={adapter?.report}
            />
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {tError(gameErrorKey(error))}
              </p>
            )}
            <section className="yk-catalogue-owners">
              <h3 className="font-display text-sm">
                {tv("currentOwners")}
                {detail ? `(${detail.ownerCount})` : ""}
              </h3>
              {detail?.owners.length ? (
                <div className="yk-catalogue-owner-columns">
                  <CardOwnerList title={tv("friends")} owners={friendOwners} />
                  <CardOwnerList
                    title={tv("otherPlayers")}
                    owners={otherOwners}
                  />
                </div>
              ) : detail ? (
                <p>{tv("noCurrentOwners")}</p>
              ) : (
                <p>{tv("loading")}</p>
              )}
              {detail && detail.owners.length < detail.ownerCount ? (
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={() => void moreOwners()}
                >
                  {tv("showMore")}
                </Button>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}
// View models receive display values from their eventual API adapters. No prices,
// minimum bids, durations, balances or auction rules are computed in these views.
export type AuctionPresentation = {
  id: string;
  ownedCount?: number;
  card: Card;
  amount: number;
  remaining: string;
  remainingSeconds: number;
  seller: string;
  sellerId?: string | null;
  sellerAvatarUrl?: string | null;
  bids: number;
  popularity?: number;
  status?: "leading" | "outbid" | "mine" | "won" | "lost" | "sold" | "unsold";
  wishlist?: boolean;
  finished?: boolean;
  endsAt?: string;
  buyer?: string;
  winner?: string;
  marketValue?: number;
  balance?: number;
  nextBid?: number;
  minimumBid?: number;
  progress?: number;
  antiSnipeMessage?: string;
  extended?: boolean;
  history?: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    time: string;
    createdAt?: string;
    amount: number;
    mine?: boolean;
  }[];
};
function AuctionStatus({
  status
}: {
  status: NonNullable<AuctionPresentation["status"]>;
}) {
  const tStatus = useTranslations("profileUi");
  return (
    <StatusPill
      tone={
        status === "outbid" || status === "lost"
          ? "danger"
          : status === "leading" || status === "sold"
            ? "success"
            : status === "unsold"
              ? "neutral"
              : "gold"
      }
    >
      {tStatus(`auctionStatus${status}`)}
    </StatusPill>
  );
}
const urgencyClass = (seconds: number) =>
  seconds < 300
    ? "yk-urgency-critical"
    : seconds < 3600
      ? "yk-urgency-soon"
      : "";
const formatEndDate = (endsAt?: string, locale = "en-US") =>
  endsAt
    ? new Date(endsAt).toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        year: "numeric"
      })
    : "";
function HourglassIcon() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" />
    </svg>
  );
}
function WatchButton({
  watched,
  onToggle,
  className = ""
}: {
  watched?: boolean;
  onToggle?: () => Promise<void>;
  className?: string;
}) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={!!watched}
      disabled={!onToggle || busy}
      aria-label={
        watched ? t("profileUi.unwatchAuction") : t("profileUi.watchAuction")
      }
      className={`yk-watch-button ${watched ? "yk-watching" : ""} ${className}`}
      onClick={async () => {
        if (!onToggle || busy) return;
        setBusy(true);
        try {
          await onToggle();
        } finally {
          setBusy(false);
        }
      }}
    >
      <svg
        aria-hidden="true"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill={watched ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      >
        <path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10Z" />
      </svg>
      <span className="yk-watch-label">
        {watched ? t("profileUi.watching") : t("profileUi.watch")}
      </span>
    </button>
  );
}
function AuctionTile({ auction: a }: { auction: AuctionPresentation }) {
  const tm = useTranslations("market");
  const locale = useLocale();
  const format = useFormatter();
  const formatKaras = (amount: number) => format.number(amount) + " Karas";
  const outcome =
    a.finished &&
    (a.status === "won" || a.status === "sold" || a.status === "unsold")
      ? a.status
      : undefined;
  const ended = formatEndDate(a.endsAt, locale);
  const label = tm("viewAuction", {
    name: a.card.name,
    details:
      outcome === "won"
        ? tm("wonDetails", { amount: formatKaras(a.amount), date: ended })
        : outcome === "sold"
          ? tm(a.buyer ? "soldBuyerDetails" : "soldDetails", {
              amount: formatKaras(a.amount),
              buyer: a.buyer ?? "",
              date: ended
            })
          : outcome === "unsold"
            ? tm("unsoldDetails", { date: ended })
            : tm(a.finished ? "endedDetails" : "liveDetails", {
                amount: formatKaras(a.amount),
                remaining: a.remaining
              })
  });
  return (
    <li
      className={
        outcome ? "yk-market-tile yk-market-tile-ended" : "yk-market-tile"
      }
    >
      <CardShell>
        <Link
          href={`/market/${a.id}`}
          className="yk-market-tile-link"
          aria-label={label}
        >
          <YokaiCard {...a.card} imageSizes="100vw" />
        </Link>
      </CardShell>
      <Link
        href={`/market/${a.id}`}
        className="yk-market-tile-link"
        tabIndex={-1}
        aria-label={label}
      >
        <div className="yk-market-tile-meta">
          {outcome ? (
            <span className="yk-market-outcome truncate">
              {outcome === "won"
                ? tm("boughtFrom", { name: a.seller })
                : outcome === "unsold"
                  ? tm("returned")
                  : a.buyer
                    ? tm("soldTo", { name: a.buyer })
                    : tm("sold")}
            </span>
          ) : (
            <span className="yk-market-seller">
              <Avatar
                name={a.seller}
                image={a.sellerAvatarUrl ?? undefined}
                size={26}
              />
              <span className="truncate">{a.seller}</span>
            </span>
          )}
          {(a.ownedCount ?? 0) > 0 && (
            <span className="yk-market-owned">
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
                <path
                  d="m3 8 3 3 7-7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {tm("alreadyOwned", { count: a.ownedCount! })}
            </span>
          )}
          <div className="yk-market-tile-line">
            <span
              className={`yk-market-timer ${a.finished ? "" : urgencyClass(a.remainingSeconds)}`}
            >
              <HourglassIcon />
              {outcome ? ended : a.finished ? tm("ended") : a.remaining}
            </span>
            <span className="yk-market-tile-state">
              {a.status && <AuctionStatus status={a.status} />}
            </span>
            {outcome !== "unsold" && (
              <Karas amount={a.amount} className="yk-market-price" />
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

const marketEmptyStates = marketEmptyStateKeys;
type MineTab = keyof typeof marketEmptyStates;
const mineTabs = [
  ["all", "All"],
  ["mine", "Active"],
  ["won", "Won"],
  ["sales", "Sold"],
  ["unsold", "Unsold"]
] as const;

export type MarketSort = "end" | "asc" | "desc" | "popular";
export function compareMarketAuctions(
  a: AuctionPresentation,
  b: AuctionPresentation,
  sort: MarketSort
) {
  // Personal watchlist comes first; keep the selected sort inside each group.
  const watchedFirst = Number(!!b.wishlist) - Number(!!a.wishlist);
  if (watchedFirst) return watchedFirst;
  // "end": live auctions first (ending soonest), then history by most recent end.
  const endTime = (x: AuctionPresentation) => Date.parse(x.endsAt ?? "") || 0;
  return sort === "asc"
    ? a.amount - b.amount
    : sort === "desc"
      ? b.amount - a.amount
      : sort === "popular"
        ? (b.popularity ?? 0) - (a.popularity ?? 0) ||
          a.remainingSeconds - b.remainingSeconds ||
          a.id.localeCompare(b.id)
        : Number(!!a.finished) - Number(!!b.finished) ||
          (a.finished
            ? endTime(b) - endTime(a)
            : a.remainingSeconds - b.remainingSeconds);
}
export function MarketView({
  initialSection = "browse",
  pageHeading,
  lists,
  activeSales,
  marketPage,
  marketLimit = MARKET_PAGE_SIZE,
  loadingMore = false,
  onQueryChange,
  onLoadMore
}: {
  initialSection?: "browse" | "mine";
  pageHeading?: ReactNode;
  lists?: Record<"active" | "mine" | "won" | "sold", AuctionPresentation[]>;
  activeSales?: string;
  marketPage?: MarketPage;
  marketLimit?: number;
  loadingMore?: boolean;
  onQueryChange?: (query: MarketQuery) => void;
  onLoadMore?: () => void;
  onToggleWatch?: (id: string) => Promise<void>;
}) {
  const tm = useTranslations("market");
  const format = useFormatter();
  const formatKaras = (amount: number) => format.number(amount) + " Karas";

  const [section, setSection] = useState(initialSection);
  const [mineTab, setMineTab] = useState<MineTab>("all");
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState<Rarity[]>([]);
  const [sort, setSort] = useMarketSort();
  const [category, setCategory] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (!onQueryChange) return;
    const timer = window.setTimeout(
      () =>
        onQueryChange({
          query,
          rarity,
          category,
          sort: section === "browse" ? sort : "end",
          section: section === "browse" ? "active" : mineTab
        }),
      250
    );
    return () => window.clearTimeout(timer);
  }, [query, rarity, category, sort, section, mineTab, onQueryChange]);
  const matches = (a: AuctionPresentation) =>
    matchesCardSearch(query, [a.card.name, a.card.anime]) &&
    (!rarity.length || rarity.includes(a.card.rarity)) &&
    (!category || a.card.category === category);
  // Seller history is one legacy list; split it by outcome for Sold and Unsold.
  const myLists: Record<MineTab, AuctionPresentation[]> | undefined = lists && {
    all: [...lists.mine, ...lists.won, ...lists.sold],
    mine: lists.mine,
    won: lists.won,
    sales: lists.sold.filter(a => a.status === "sold"),
    unsold: lists.sold.filter(a => a.status === "unsold")
  };
  const categories =
    marketPage?.categories ??
    [
      ...new Set(
        (section === "browse" ? lists?.active : myLists?.[mineTab])?.map(
          a => a.card.category
        )
      )
    ].sort();
  const filtered = !!(query || rarity.length || category);
  const browse = lists?.active
    .filter(matches)
    .sort((a, b) => compareMarketAuctions(a, b, sort));
  const mine = myLists?.[mineTab]
    .filter(matches)
    .sort((a, b) => compareMarketAuctions(a, b, "end"));
  const counts = marketPage?.counts;
  const mineCounts: Partial<Record<MineTab, number>> | undefined = myLists && {
    all:
      counts?.all ??
      (counts ? counts.mine + counts.won + counts.sold : myLists.all.length),
    mine: counts?.mine ?? myLists.mine.length,
    won: counts?.won ?? myLists.won.length,
    // Before the history migration the server only counts seller history as a whole.
    sales: counts ? counts.sales : myLists.sales.length,
    unsold: counts ? counts.unsold : myLists.unsold.length
  };
  const mineCount = mineCounts?.all;
  const shown = section === "browse" ? browse : mine;
  const heading = !shown
    ? tm("loading")
    : section === "browse"
      ? tm("upForAuction", { count: shown.length })
      : tm(`count${mineTab}`, { count: shown.length });
  const recap =
    counts?.sales != null && counts.unsold != null
      ? tm(
          counts.salesKaras ? "recapSales" : "recap",
          counts.salesKaras
            ? {
                recap: tm("recap", {
                  won: format.number(counts.won),
                  sold: format.number(counts.sales),
                  unsold: format.number(counts.unsold)
                }),
                amount: formatKaras(counts.salesKaras)
              }
            : {
                won: format.number(counts.won),
                sold: format.number(counts.sales),
                unsold: format.number(counts.unsold)
              }
        )
      : undefined;
  const filters = (
    <>
      <button
        type="button"
        className="yk-filter-reset"
        disabled={
          !(
            filtered ||
            (section === "browse" ? sort !== "end" : mineTab !== "all")
          )
        }
        onClick={() => {
          setQuery("");
          setRarity([]);
          setCategory("");
          setSort("end");
          setMineTab("all");
        }}
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
        {tm("reset")}
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
        <label className="sr-only" htmlFor="market-query">
          {tm("search")}
        </label>
        <input
          id="market-query"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={tm("searchPlaceholder")}
        />
      </div>
      <div className="yk-market-filter-scroll">
        {section === "browse" && (
          <FilterGroup title={tm("sort")}>
            {(
              [
                ["end", "Ending soon"],
                ["asc", "Price: low to high"],
                ["desc", "Price: high to low"],
                ["popular", "Most popular"]
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                className="yk-filter-option"
                aria-pressed={sort === key}
                onClick={() => setSort(key)}
              >
                <span className="yk-filter-check" />
                <span>{tm(labelKeys[label])}</span>
              </button>
            ))}
          </FilterGroup>
        )}
        {section === "mine" && (
          <CatalogueFilterSection title="Status">
            {mineTabs.map(([key, label]) => (
              <button
                type="button"
                key={key}
                className="yk-filter-option"
                aria-pressed={mineTab === key}
                onClick={() => setMineTab(key)}
              >
                <span className="yk-filter-check" />
                <span>{tm(labelKeys[label])}</span>
                {mineCounts?.[key] != null && (
                  <strong>{format.number(mineCounts[key])}</strong>
                )}
              </button>
            ))}
          </CatalogueFilterSection>
        )}
        <CatalogueFilterSection title="Rarity" count={rarity.length}>
          <RarityChips
            selected={rarity}
            onToggle={r => setRarity(current => toggleFilterValue(current, r))}
          />
        </CatalogueFilterSection>
        <CatalogueFilterSection title="Category" count={category ? 1 : 0}>
          {categories.map(item => (
            <button
              type="button"
              key={item}
              className="yk-filter-option"
              aria-pressed={category === item}
              onClick={() =>
                setCategory(current => (current === item ? "" : item))
              }
            >
              <span className="yk-filter-check" />
              <span>{item}</span>
            </button>
          ))}
        </CatalogueFilterSection>
      </div>
    </>
  );
  const toolbar = (
    <div className="yk-collection-toolbar yk-market-toolbar-band">
      <button
        type="button"
        className="yk-mobile-filter-trigger"
        aria-expanded={filtersOpen}
        aria-controls="market-filters"
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
        {tm("filters")}
        {filtered ? <span>•</span> : null}
      </button>
      <div
        className="yk-market-sections"
        role="tablist"
        aria-label={tm("sections")}
      >
        {(
          [
            ["browse", "Auctions", counts?.active ?? lists?.active.length],
            ["mine", "My auctions", mineCount]
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            className="yk-market-section"
            onClick={() => {
              setSection(key);
              setCategory("");
            }}
          >
            {tm(labelKeys[label])}
            {count != null && <span>{count}</span>}
          </button>
        ))}
      </div>
      <div className="yk-market-band-actions">
        <StatusPill>
          {tm("activeListings", { count: activeSales ?? "—" })}
        </StatusPill>
      </div>
    </div>
  );
  return (
    <section aria-label={tm("region")} className="yk-market">
      {pageHeading ? (
        <header className="yk-market-heading">
          {pageHeading}
          <p role="status" className="sr-only">
            {heading}
          </p>
          {toolbar}
        </header>
      ) : (
        <div className="yk-catalogue-heading">
          <div>
            <p role="status" className="font-display text-xl">
              {heading}
            </p>
            <p className="mt-1 text-xs text-ink-3">
              {filtered
                ? tm("matching")
                : section === "browse"
                  ? tm("allActive")
                  : tm("yourListings")}
            </p>
          </div>
        </div>
      )}
      {filtersOpen && (
        <button
          type="button"
          className="yk-filter-backdrop"
          aria-label={tm("closeFilters")}
          onClick={() => setFiltersOpen(false)}
        />
      )}
      <div className="yk-collection-layout">
        <aside
          id="market-filters"
          className={`yk-collection-sidebar yk-market-sidebar ${filtersOpen ? "yk-sidebar-open" : ""}`}
          aria-label={tm("filterLabel")}
        >
          <div className="yk-sidebar-mobile-head">
            <strong>{tm("filters")}</strong>
            <button
              type="button"
              aria-label={tm("closeFilters")}
              onClick={() => setFiltersOpen(false)}
            >
              ×
            </button>
          </div>
          {filters}
        </aside>
        <div className="yk-collection-main">
          {!pageHeading && toolbar}
          {section === "browse" ? (
            !browse ? (
              <Unavailable>{tm("loading")}</Unavailable>
            ) : !browse.length ? (
              <Unavailable>
                {filtered ? tm("noMatch") : tm("noActive")}
              </Unavailable>
            ) : (
              <ul
                className="yk-card-grid yk-market-list"
                aria-label={tm("activeLabel")}
              >
                {browse.map(a => (
                  <AuctionTile key={a.id} auction={a} />
                ))}
              </ul>
            )
          ) : !lists || !mine ? (
            <Unavailable>{tm("loadingMine")}</Unavailable>
          ) : (
              mineCounts?.[mineTab] != null
                ? !mineCounts[mineTab]
                : !mine.length && !filtered
            ) ? (
            <div role="status" className="yk-empty-state">
              <span
                aria-hidden="true"
                className="font-display text-3xl text-accent-gold"
              >
                ✦
              </span>
              <p className="mt-4 font-display text-lg">
                {tm(marketEmptyStates[mineTab].title)}
              </p>
              <p className="mt-2 max-w-md text-sm leading-6 text-ink-2">
                {tm(marketEmptyStates[mineTab].text)}
              </p>
              {mineTab === "sales" || mineTab === "unsold" ? (
                <Link
                  href="/collection"
                  className="yk-button yk-button-secondary mt-6"
                >
                  {tm(marketEmptyStates[mineTab].action)}
                </Link>
              ) : (
                <Button
                  variant="secondary"
                  className="mt-6"
                  onClick={() => {
                    setSection("browse");
                    setSort("end");
                  }}
                >
                  {tm(marketEmptyStates[mineTab].action)}
                </Button>
              )}
            </div>
          ) : !mine.length ? (
            <Unavailable>{tm("noMatch")}</Unavailable>
          ) : (
            <>
              {recap && <p className="yk-market-recap">{recap}</p>}
              <ul
                className="yk-card-grid yk-market-list"
                aria-label={tm("mineLabel", {
                  status: tm(
                    "label" + mineTab[0].toUpperCase() + mineTab.slice(1)
                  )
                })}
              >
                {mine.map(a => (
                  <AuctionTile key={a.id} auction={a} />
                ))}
              </ul>
            </>
          )}
          {onLoadMore && lists && (
            <div className="mt-6 flex flex-col items-center gap-3">
              {marketPage?.hasMore && marketLimit < MARKET_MAX_ITEMS && (
                <Button
                  variant="secondary"
                  disabled={loadingMore}
                  onClick={onLoadMore}
                >
                  {loadingMore ? tm("loadingMore") : tm("loadMore")}
                </Button>
              )}
              <p role="status" className="text-sm text-ink-2">
                {loadingMore ? (
                  tm("loading")
                ) : marketPage?.hasMore && marketLimit >= MARKET_MAX_ITEMS ? (
                  tm("limit")
                ) : marketPage && !marketPage.hasMore ? (
                  <span className="sr-only">{tm("allLoaded")}</span>
                ) : (
                  ""
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
function AuctionOutcome({ auction }: { auction: AuctionPresentation }) {
  const t = useTranslations();
  const format = useFormatter();
  const formatKaras = (amount: number) => format.number(amount) + " Karas";
  const won = auction.status === "won" || auction.status === "leading";
  const lost = auction.status === "lost" || auction.status === "outbid";
  if (won)
    return (
      <div role="status" className="yk-auction-outcome yk-outcome-won">
        <p className="yk-outcome-badge">{t("profileUi.auctionWon")}</p>
        <p className="mt-2 text-sm text-ink-2">
          {t("profileUi.cardJoinsCollection", {
            name: auction.card.name,
            amount: formatKaras(auction.amount)
          })}
        </p>
        <Link href="/collection" className="yk-button yk-button-secondary mt-4">
          {t("profileUi.viewMyCollection")}{" "}
        </Link>
      </div>
    );
  if (lost)
    return (
      <div role="status" className="yk-auction-outcome yk-outcome-lost">
        <p className="yk-outcome-badge">{t("profileUi.auctionLost")}</p>
        <p className="mt-2 text-sm text-ink-2">
          {auction.winner
            ? t("profileUi.wonAuctionBy", {
                name: auction.winner,
                amount: formatKaras(auction.amount)
              })
            : t("profileUi.anotherBidWon")}{" "}
          {t("profileUi.yourBidHasBeenRefunded")}{" "}
        </p>
        <Link href="/market" className="yk-button yk-button-secondary mt-4">
          {t("profileUi.backToMarket")}{" "}
        </Link>
      </div>
    );
  if (
    auction.status === "sold" ||
    (auction.status === "mine" && auction.winner)
  )
    return (
      <div role="status" className="yk-auction-outcome yk-outcome-won">
        <p className="yk-outcome-badge">{t("profileUi.cardSold")}</p>
        <p className="mt-2 text-sm text-ink-2">
          {t("profileUi.soldToPlayer", {
            name: auction.winner ?? t("profileUi.aPlayer"),
            amount: formatKaras(auction.amount)
          })}
        </p>
      </div>
    );
  if (auction.status === "unsold")
    return (
      <div role="status" className="yk-auction-outcome">
        <p className="yk-outcome-badge">{t("profileUi.noBids")}</p>
        <p className="mt-2 text-sm text-ink-2">
          {t("profileUi.auctionCardReturned")}{" "}
        </p>
      </div>
    );
  return (
    <div role="status" className="yk-auction-outcome">
      <p className="yk-outcome-badge">{t("profileUi.auctionEnded")}</p>
      <p className="mt-2 text-sm text-ink-2">
        {auction.winner
          ? t("profileUi.wonAuctionBy", {
              name: auction.winner,
              amount: formatKaras(auction.amount)
            })
          : t("profileUi.noBidsWerePlaced")}
      </p>
    </div>
  );
}
export type AuctionChatAdapter = {
  get: typeof getAuctionChat;
  send: typeof sendAuctionChatMessage;
  moderation?: ModerationAdapter;
  preview?: PlayerPreviewAdapter;
};
const liveAuctionChat: AuctionChatAdapter = {
  get: getAuctionChat,
  send: sendAuctionChatMessage
};
// Mirrors the server-wide minimum spacing between two chat messages.
const AUCTION_CHAT_SUCCESS_COOLDOWN_SECONDS = 3;
function auctionChatCooldownUntil(
  currentUntil: number,
  delaySeconds: number,
  currentTime = Date.now()
) {
  return Math.max(currentUntil, currentTime + delaySeconds * 1000);
}
export function AuctionChatPanel({
  auctionId,
  refreshKey,
  finished,
  adapter = liveAuctionChat
}: {
  auctionId: string;
  refreshKey: number;
  finished: boolean;
  adapter?: AuctionChatAdapter;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [reportMessage, setReportMessage] = useState("");
  const [chat, setChat] =
    useState<Awaited<ReturnType<typeof getAuctionChat>>>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const retryUntilRef = useRef(0);
  const sendLockRef = useRef(false);
  const listRef = useRef<HTMLOListElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const mentionIndexRef = useRef(0);
  const mentionMatch = draft.match(/(?:^|\s)@([^\s@]*)$/);
  const mentionQuery = mentionMatch?.[1].toLocaleLowerCase("en-US");
  const hasMention = !!mentionMatch;
  const mentionOptions = useMemo(
    () =>
      hasMention
        ? (chat?.participants
            .filter(
              participant =>
                !participant.mine &&
                participant.pseudo
                  .toLocaleLowerCase("en-US")
                  .startsWith(mentionQuery ?? "")
            )
            .slice(0, 5) ?? [])
        : [],
    [chat?.participants, hasMention, mentionQuery]
  );
  const [mentionSelection, setMentionSelection] = useState<{
    options: typeof mentionOptions;
    index: number;
  }>();
  const mentionPlayers = [
    ...(chat?.participants ?? []),
    ...(chat?.messages ?? [])
  ];
  const mentionIndex =
    mentionSelection?.options === mentionOptions ? mentionSelection.index : 0;
  const load = useCallback(async () => {
    try {
      setChat(await adapter.get(auctionId));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat unavailable.");
    }
  }, [auctionId, adapter]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void adapter.get(auctionId).then(
        value => {
          if (active) {
            setChat(value);
            setError("");
          }
        },
        reason => {
          if (active)
            setError(
              reason instanceof Error ? reason.message : "Chat unavailable."
            );
        }
      );
    };
    const frame = window.requestAnimationFrame(refresh);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 3000);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [auctionId, refreshKey, adapter]);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chat?.messages.length]);
  useEffect(() => {
    const textarea = document.getElementById("auction-chat-message");
    if (
      !(textarea instanceof HTMLTextAreaElement) ||
      mentionOptions.length === 0
    )
      return;
    mentionIndexRef.current = 0;
    const navigate = (event: KeyboardEvent) => {
      if (event.isComposing || mentionIndexRef.current < 0) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        mentionIndexRef.current = -1;
        setMentionSelection({ options: mentionOptions, index: -1 });
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        mentionIndexRef.current =
          (mentionIndexRef.current +
            (event.key === "ArrowDown" ? 1 : -1) +
            mentionOptions.length) %
          mentionOptions.length;
        setMentionSelection({
          options: mentionOptions,
          index: mentionIndexRef.current
        });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        selectMention(mentionOptions[mentionIndexRef.current].pseudo);
      }
    };
    textarea.addEventListener("keydown", navigate);
    return () => textarea.removeEventListener("keydown", navigate);
  }, [mentionOptions]);
  useEffect(() => {
    if (!retryUntil) return;
    const timer = window.setInterval(() => {
      const secondsLeft = Math.max(
        0,
        Math.ceil((retryUntilRef.current - Date.now()) / 1000)
      );
      setRetrySeconds(secondsLeft);
      if (!secondsLeft) {
        retryUntilRef.current = 0;
        setRetryUntil(0);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [retryUntil]);
  function waitToSend(seconds: number) {
    const nextUntil = auctionChatCooldownUntil(retryUntilRef.current, seconds);
    if (nextUntil === retryUntilRef.current) return;
    retryUntilRef.current = nextUntil;
    setRetryUntil(nextUntil);
    setRetrySeconds(Math.ceil((nextUntil - Date.now()) / 1000));
  }
  function insertEmoji(id: string) {
    const emoji = reactionEmoji(id)?.emoji;
    const input = composerRef.current;
    if (!emoji || !input || busy || retryUntilRef.current > Date.now()) return;
    const next = insertMessageEmoji(
      draft,
      emoji,
      input.selectionStart,
      input.selectionEnd,
      500
    );
    if (!next) return;
    setDraft(next.text);
    window.requestAnimationFrame(() => {
      if (!input.isConnected || input.disabled) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(next.caret, next.caret);
    });
  }
  async function send(gif?: GifChoice) {
    const message = draft.trim();
    if (
      (!message && !gif) ||
      busy ||
      sendLockRef.current ||
      retryUntilRef.current > Date.now()
    )
      return;
    sendLockRef.current = true;
    setBusy(true);
    setSendError("");
    try {
      const sent = await adapter.send(auctionId, message, gif?.url);
      setChat(current =>
        current
          ? { ...current, messages: [...current.messages, sent] }
          : current
      );
      if (!gif) setDraft("");
      waitToSend(AUCTION_CHAT_SUCCESS_COOLDOWN_SECONDS);
    } catch (e) {
      if (
        e instanceof Error &&
        "retryAfterSeconds" in e &&
        typeof e.retryAfterSeconds === "number"
      ) {
        waitToSend(e.retryAfterSeconds);
      } else {
        setSendError(
          e instanceof Error ? e.message : "Couldn't send this message."
        );
      }
    } finally {
      sendLockRef.current = false;
      setBusy(false);
    }
  }
  function selectMention(pseudo: string) {
    setDraft(current => current.replace(/@([^\s@]*)$/, `@${pseudo} `));
  }
  return (
    <section
      id="chat-enchere"
      className="yk-auction-chat"
      aria-label={t("profileUi.auctionChat")}
    >
      <div className="yk-auction-chat-head">
        <div>
          <h2 className="yk-section-title">{t("profileUi.auctionChat")}</h2>
          <p>{t("profileUi.auctionChatParticipantsHint")}</p>
        </div>
        <span>
          {t("profileUi.chatMessageCount", {
            count: chat?.messages.length ?? 0
          })}
        </span>
      </div>
      {!chat && !error ? (
        <p className="yk-auction-chat-empty">{t("profileUi.loadingChat")}</p>
      ) : chat?.messages.length ? (
        <ol ref={listRef} className="yk-auction-chat-list" aria-live="polite">
          {chat.messages.map(item => (
            <li key={item.id} className={item.mine ? "is-mine" : undefined}>
              <StyledPlayerAvatar
                name={item.pseudo}
                image={item.avatarUrl ?? undefined}
                size={30}
                cosmetics={item.profileStyle}
              />
              <div>
                <p>
                  <Link href={`/profile/${encodeURIComponent(item.pseudo)}`}>
                    <StyledPlayerName
                      name={item.pseudo}
                      cosmetics={item.profileStyle}
                      fallbackLabel={item.mine ? t("profileUi.you") : undefined}
                    />
                  </Link>
                  <time dateTime={item.createdAt}>
                    {format.dateTime(new Date(item.createdAt), {
                      timeZone,
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </time>
                </p>
                {item.gifUrl ? (
                  <img
                    className="yk-auction-chat-gif"
                    src={item.gifUrl}
                    alt={t("profileUi.sharedGIF")}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <AuctionMessageText
                    message={item.message}
                    players={mentionPlayers}
                    adapter={adapter.preview}
                  />
                )}
                {!item.mine && (
                  <PlayerModeration
                    userId={item.userId}
                    pseudo={item.pseudo}
                    contextId={item.id}
                    adapter={adapter.moderation}
                    onReported={() =>
                      setReportMessage(
                        "Thanks, your report has been submitted."
                      )
                    }
                    onBlocked={() => void load()}
                  />
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : chat ? (
        <p className="yk-auction-chat-empty">{t("profileUi.noMessagesYet")}</p>
      ) : null}
      {reportMessage && (
        <p role="status" className="text-sm text-ink-2">
          {t(gameErrorKey(reportMessage, "profileUi.profileUnavailable"))}
        </p>
      )}
      {error && (
        <p role="alert" className="yk-auction-alert">
          {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
        </p>
      )}
      {sendError && (
        <p role="alert" className="yk-auction-alert">
          {t(gameErrorKey(sendError, "profileUi.profileUnavailable"))}
        </p>
      )}
      {chat?.canPost && !finished ? (
        <form
          className="yk-auction-chat-form"
          onSubmit={event => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor="auction-chat-message">
            {t("profileUi.yourMessage")}{" "}
          </label>
          <div className="yk-auction-chat-composer">
            <textarea
              id="auction-chat-message"
              ref={composerRef}
              maxLength={500}
              rows={2}
              value={draft}
              disabled={busy}
              aria-autocomplete="list"
              aria-controls="auction-mention-options"
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={t("profileUi.auctionChatPlaceholder")}
            />
            {mentionOptions.length > 0 && mentionIndex >= 0 && (
              <ul
                id="auction-mention-options"
                className="yk-auction-mention-options"
                role="listbox"
                aria-label={t("profileUi.participantsYouCanMention")}
              >
                {mentionOptions.map((participant, index) => (
                  <li key={participant.userId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === mentionIndex}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => selectMention(participant.pseudo)}
                    >
                      <StyledPlayerAvatar
                        name={participant.pseudo}
                        image={participant.avatarUrl ?? undefined}
                        size={26}
                        cosmetics={participant.profileStyle}
                      />
                      <span>
                        @
                        <StyledPlayerName
                          name={participant.pseudo}
                          cosmetics={participant.profileStyle}
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="yk-auction-chat-toolbar">
            <div className="yk-auction-chat-tools">
              <GifPicker
                disabled={busy || retrySeconds > 0}
                onSelect={gif => void send(gif)}
              />
              <EmojiReactionPicker
                mode="message"
                disabled={busy || retrySeconds > 0}
                selected={[]}
                onSelect={insertEmoji}
              />
            </div>
            <span>
              {t("profileUi.chatComposerHint", { count: draft.length })}
            </span>
            <Button
              type="submit"
              className="yk-auction-chat-send"
              disabled={busy || retrySeconds > 0 || !draft.trim()}
              aria-label={
                retrySeconds > 0
                  ? t("profileUi.auctionSendCooldown")
                  : undefined
              }
            >
              {busy
                ? t("market.sending")
                : retrySeconds > 0
                  ? `${retrySeconds} s`
                  : t("profileUi.send")}
            </Button>
          </div>
        </form>
      ) : (
        <p className="yk-auction-chat-locked">
          {finished
            ? t("profileUi.auctionChatClosed")
            : t("profileUi.placeABidToJoinTheChat")}
        </p>
      )}
    </section>
  );
}
export function AuctionView({
  auction,
  onBid,
  onCancel,
  onToggleWatch,
  chatAdapter
}: {
  auction?: AuctionPresentation;
  onBid?: (amount: number) => Promise<void>;
  onCancel?: () => Promise<void>;
  onToggleWatch?: () => Promise<void>;
  chatAdapter?: AuctionChatAdapter;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const formatKaras = (amount: number) => format.number(amount) + " Karas";
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [offer, setOffer] = useState("");
  const [pending, setPending] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [error, setError] = useState("");
  async function bid(amount: number) {
    if (!onBid || pending) return;
    setPending(true);
    setError("");
    try {
      await onBid(amount);
      setOffer("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't place this bid.");
    } finally {
      setPending(false);
    }
  }
  async function cancel() {
    if (!onCancel || pending) return;
    setPending(true);
    setError("");
    try {
      await onCancel();
      setCancelConfirm(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't cancel this listing."
      );
      setCancelConfirm(false);
    } finally {
      setPending(false);
    }
  }
  if (!auction)
    return (
      <Unavailable>{t("profileUi.auctionCurrentlyUnavailable")}</Unavailable>
    );
  // Display-only comparisons of values already provided by the adapter; the RPC stays the source of truth.
  const offerValue = offer.trim() === "" ? undefined : Number(offer);
  const offerTooLow =
    offerValue != null &&
    auction.minimumBid != null &&
    (!Number.isFinite(offerValue) || offerValue < auction.minimumBid);
  const quickShort =
    auction.balance != null &&
    auction.nextBid != null &&
    auction.balance < auction.nextBid;
  const offerShort =
    offerValue != null &&
    auction.balance != null &&
    offerValue > auction.balance;
  const biddable = !!onBid && !auction.finished && auction.nextBid != null;
  const franchise = auction.card.anime?.trim();
  return (
    <div className="yk-auction-page">
      <div className="yk-auction-art">
        <YokaiCard {...auction.card} />
      </div>
      <div className="yk-auction-main">
        <header className="yk-auction-header">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-sm font-bold tracking-widest ${catalogueRarityText[auction.card.rarity]}`}
              >
                {auction.card.rarity}
              </span>
              {auction.status && <AuctionStatus status={auction.status} />}
            </div>
            <h2 className="mt-2 font-display">{auction.card.name}</h2>
            <p className="yk-auction-seller mt-2 text-sm text-ink-2">
              {franchise ? `${franchise} · ` : ""}
              {t("profileUi.listedBy")}{" "}
              <Avatar
                name={auction.seller}
                image={auction.sellerAvatarUrl ?? undefined}
                size={26}
              />
              {auction.sellerId === null ? (
                <span className="font-semibold">
                  {t("profileUi.deletedPlayer")}
                </span>
              ) : (
                <Link
                  href={`/profile/${encodeURIComponent(auction.seller)}`}
                  className="font-semibold hover:text-accent-gold"
                >
                  {auction.seller}
                </Link>
              )}
            </p>
          </div>
          {onToggleWatch && (
            <WatchButton
              watched={auction.wishlist}
              onToggle={onToggleWatch}
              className="yk-auction-watch"
            />
          )}
        </header>
        <section
          className="yk-auction-panel"
          aria-label={t("profileUi.placeABid")}
        >
          <div className="yk-auction-figures">
            <div>
              <p className="yk-auction-label">{t("profileUi.currentPrice")}</p>
              <Karas
                amount={auction.amount}
                className="yk-auction-price yk-karas-gold"
              />
              <p className="mt-1 text-xs text-ink-3">
                {t("profileUi.bidCount", { count: auction.bids })}
              </p>
            </div>
            <div>
              <p className="yk-auction-label">
                {auction.finished
                  ? t("profileUi.auctionEnded")
                  : t("profileUi.timeRemaining")}
              </p>
              <p
                className={`yk-auction-countdown font-display ${auction.finished ? "" : urgencyClass(auction.remainingSeconds)} ${auction.extended ? "yk-countdown-extended" : ""}`}
                aria-live="off"
              >
                {auction.finished ? "00:00:00" : auction.remaining}
              </p>
            </div>
          </div>
          {auction.extended && !auction.finished && (
            <p role="status" className="yk-auction-extension">
              <HourglassIcon />
              {t("profileUi.auctionExtended")}{" "}
            </p>
          )}
          {!auction.extended &&
            auction.antiSnipeMessage &&
            !auction.finished && (
              <p className="yk-auction-hint">
                <HourglassIcon />
                {t("profileUi.antiSnipeMessage")}
              </p>
            )}
          {auction.finished ? (
            <AuctionOutcome auction={auction} />
          ) : auction.nextBid == null ? (
            <>
              <p className="yk-auction-hint">
                {t("profileUi.ownListingBidNotice")}{" "}
              </p>
              {onCancel &&
                (auction.bids === 0 ? (
                  <Button
                    variant="danger"
                    disabled={pending}
                    onClick={() => setCancelConfirm(true)}
                  >
                    {t("profileUi.cancelListing")}{" "}
                  </Button>
                ) : (
                  <p className="yk-auction-alert">
                    {t("profileUi.listingCancellationBlocked")}{" "}
                  </p>
                ))}
            </>
          ) : (
            <>
              <Button
                className="yk-bid-quick yk-karas-gold"
                disabled={!biddable || pending || quickShort}
                aria-busy={pending || undefined}
                onClick={() => void bid(auction.nextBid!)}
              >
                +10 Karas<span>· {formatKaras(auction.nextBid)}</span>
              </Button>
              <form
                className="yk-auction-offer"
                onSubmit={event => {
                  event.preventDefault();
                  if (offerValue != null && !offerTooLow && !offerShort)
                    void bid(offerValue);
                }}
              >
                <label htmlFor="bid" className="yk-auction-label">
                  {t("profileUi.orEnterAnAmount")}{" "}
                </label>
                <div className="yk-auction-offer-row">
                  <input
                    id="bid"
                    type="number"
                    inputMode="numeric"
                    min={auction.minimumBid}
                    value={offer}
                    disabled={!biddable || pending}
                    onChange={e => setOffer(e.target.value)}
                    placeholder={
                      auction.minimumBid == null
                        ? t("profileUi.yourBid")
                        : t("profileUi.minimumBid", {
                            amount: auction.minimumBid
                          })
                    }
                    aria-invalid={offerTooLow || offerShort || undefined}
                    aria-describedby="bid-help"
                    className="auth-input min-w-0"
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={
                      !biddable ||
                      pending ||
                      offerValue == null ||
                      offerTooLow ||
                      offerShort
                    }
                  >
                    {t("profileUi.placeBid")}{" "}
                  </Button>
                </div>
                <p
                  id="bid-help"
                  className={`mt-2 text-xs ${offerTooLow ? "text-danger-ink" : "text-ink-3"}`}
                >
                  {offerTooLow && auction.minimumBid != null
                    ? t("profileUi.bidAtLeast", {
                        amount: formatKaras(auction.minimumBid)
                      })
                    : t("profileUi.bidMinimumHint", {
                        amount:
                          auction.minimumBid != null
                            ? formatKaras(auction.minimumBid)
                            : "—"
                      })}
                </p>
              </form>
              <div className="yk-auction-balance">
                <span>{t("profileUi.yourBalance")}</span>
                <Karas amount={auction.balance} className="yk-karas-gold" />
              </div>
              {(quickShort || offerShort) && (
                <p role="alert" className="yk-auction-alert">
                  {t("profileUi.insufficientBalance", {
                    amount:
                      auction.balance != null
                        ? formatKaras(auction.balance)
                        : "—"
                  })}
                </p>
              )}
              <p className="text-xs text-ink-3">
                {t("profileUi.bidKarasNotice")}{" "}
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="yk-auction-alert">
              {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
            </p>
          )}
        </section>
        <AuctionChatPanel
          auctionId={auction.id}
          refreshKey={auction.bids}
          finished={!!auction.finished}
          adapter={chatAdapter}
        />
      </div>
      <Modal
        open={cancelConfirm}
        onClose={() => {
          if (!pending) setCancelConfirm(false);
        }}
        title={t("profileUi.cancelListing")}
      >
        <p className="text-sm leading-6 text-ink-2">
          {t("profileUi.cancelListingNotice")}{" "}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => setCancelConfirm(false)}
          >
            {t("profileUi.keepListing")}{" "}
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => void cancel()}
          >
            {pending
              ? t("profileUi.canceling")
              : t("profileUi.confirmCancellation")}
          </Button>
        </div>
      </Modal>
      <section
        className="yk-auction-history"
        aria-label={t("profileUi.bidHistory")}
      >
        <h2 className="yk-section-title">
          {t("profileUi.bidHistory")}{" "}
          {auction.history?.length ? ` (${auction.history.length})` : ""}
        </h2>
        {auction.history?.length ? (
          <ol
            className="yk-auction-history-list mt-4"
            tabIndex={0}
            aria-label={t("profileUi.bidHistory")}
          >
            {auction.history.map((h, i) => (
              <li
                key={h.id}
                className={i === 0 ? "yk-history-leading" : undefined}
              >
                <Avatar
                  name={h.name}
                  image={h.avatarUrl ?? undefined}
                  size={28}
                />
                <p className="min-w-0 flex-1 text-sm">
                  {h.mine ? (
                    <strong>{t("profileUi.you")}</strong>
                  ) : !h.name ||
                    h.name === "Joueur supprimé" ||
                    h.name === "Deleted player" ? (
                    <strong>{t("profileUi.deletedPlayer")}</strong>
                  ) : (
                    <Link
                      href={`/profile/${encodeURIComponent(h.name)}`}
                      className="font-semibold hover:text-accent-gold"
                    >
                      {h.name}
                    </Link>
                  )}
                  <span className="text-ink-3"> · </span>
                  <span className="text-karas tabular-nums">
                    {formatKaras(h.amount)}
                  </span>
                  <span className="text-ink-3"> · </span>
                  <time
                    dateTime={h.createdAt}
                    className="text-ink-3 tabular-nums"
                  >
                    {h.createdAt
                      ? format.dateTime(new Date(h.createdAt), {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone
                        })
                      : h.time}
                  </time>
                </p>
                {i === 0 && (
                  <StatusPill tone="success">
                    {auction.finished
                      ? t("profileUi.winner")
                      : t("profileUi.leading")}
                  </StatusPill>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-ink-3">
            {t("profileUi.noBidsStartingPrice", {
              amount: formatKaras(auction.amount)
            })}
          </p>
        )}
      </section>
    </div>
  );
}
export function ProfileView({
  joined,
  cards,
  isMe = true,
  identifier
}: {
  name?: string;
  joined?: string;
  cards?: CollectedCard[];
  isMe?: boolean;
  identifier?: string;
}) {
  return (
    <ProfileExperience
      key={identifier ?? "self"}
      identifier={isMe ? undefined : identifier}
      collection={cards}
      joined={joined}
    />
  );
}

export function SearchView(
  props: {
    loadPage?: typeof getCataloguePage;
    previewCategories?: string[];
    pageHeading?: ReactNode;
  } = {}
) {
  return (
    <Suspense fallback={null}>
      <SearchViewFromUrl {...props} />
    </Suspense>
  );
}

function SearchViewFromUrl(props: Parameters<typeof SearchView>[0]) {
  const params = useSearchParams();
  const category = params.get("category") ?? "";
  return (
    <SearchViewContent key={category} {...props} initialCategory={category} />
  );
}

function SearchViewContent({
  loadPage = getCataloguePage,
  initialCategory = "",
  previewCategories,
  pageHeading
}: {
  initialCategory?: string;
  loadPage?: typeof getCataloguePage;
  previewCategories?: string[];
  pageHeading?: ReactNode;
} = {}) {
  const tError = useTranslations();
  const tv = useTranslations("catalogueUi");
  const [pageSize, setPageSize] = useState<number>(CARD_PAGE_SIZES[0]);
  const [categories, setCategories] = useState<string[]>(
    previewCategories ?? []
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string[]>(
    initialCategory ? [initialCategory] : []
  );
  const [rarity, setRarity] = useState<Rarity[]>([]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Card | null>(null);
  const [results, setResults] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (previewCategories) return;
    let active = true;
    void getGameInfo().then(
      info => {
        if (active) setCategories(info.categories);
      },
      () => {}
    );
    return () => {
      active = false;
    };
  }, [previewCategories]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(
      () =>
        void loadPage({ query, category, rarity, page, pageSize })
          .then(
            value => {
              if (active) {
                setResults(value.cards);
                setTotal(value.total);
              }
            },
            () => {
              if (active)
                setSearchError(
                  "catalogueUi.theCatalogIsTemporarilyUnavailable"
                );
            }
          )
          .finally(() => {
            if (active) setSearching(false);
          }),
      250
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, category, rarity, page, pageSize, loadPage]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const resetPage = () => {
    setPage(1);
    setSearching(true);
    setSearchError("");
  };
  const resetFilters = () => {
    setQuery("");
    setCategory([]);
    setRarity([]);
    resetPage();
  };
  const filters = (
    <>
      <button
        type="button"
        className="yk-filter-reset"
        disabled={!(query || category.length || rarity.length)}
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
        {tv("resetFilters")}
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
        <label className="sr-only" htmlFor="catalogue-query">
          {tv("searchCatalog")}
        </label>
        <input
          id="catalogue-query"
          type="search"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            resetPage();
          }}
          placeholder={tv("search")}
        />
      </div>
      <CatalogueFilterSection title="Rarity" count={rarity.length}>
        <RarityChips
          selected={rarity}
          onToggle={item => {
            setRarity(current => toggleFilterValue(current, item));
            resetPage();
          }}
        />
      </CatalogueFilterSection>
      <CatalogueFilterSection title="Category" count={category.length}>
        {categories.map(item => (
          <button
            type="button"
            key={item}
            className="yk-filter-option"
            aria-pressed={category.includes(item)}
            onClick={() => {
              setCategory(current => toggleFilterValue(current, item));
              resetPage();
            }}
          >
            <span className="yk-filter-check" />
            <span>{item}</span>
          </button>
        ))}
      </CatalogueFilterSection>
    </>
  );
  return (
    <section className="yk-catalogue">
      {filtersOpen && (
        <button
          type="button"
          className="yk-filter-backdrop"
          aria-label={tv("closeFilters")}
          onClick={() => setFiltersOpen(false)}
        />
      )}
      <div className="yk-collection-layout">
        {pageHeading && (
          <header className="yk-catalogue-title">{pageHeading}</header>
        )}
        <aside
          id="catalogue-filters"
          className={`yk-collection-sidebar ${filtersOpen ? "yk-sidebar-open" : ""}`}
          aria-label={tv("catalogFilters")}
        >
          <div className="yk-sidebar-mobile-head">
            <strong>{tv("filters")}</strong>
            <button
              type="button"
              aria-label={tv("closeFilters")}
              onClick={() => setFiltersOpen(false)}
            >
              ×
            </button>
          </div>
          {filters}
        </aside>
        <div className="yk-collection-main">
          <div className="yk-catalogue-heading">
            <p role="status" className="yk-catalogue-total">
              {searching
                ? tv("loadingCatalog")
                : searchError
                  ? tv("cardCountUnavailable")
                  : tv("cardCount", { count: total })}
            </p>
            <button
              type="button"
              className="yk-mobile-filter-trigger"
              aria-expanded={filtersOpen}
              aria-controls="catalogue-filters"
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
              {tv("filters")}
              {query || category.length || rarity.length ? (
                <span>•</span>
              ) : null}
            </button>
          </div>
          {searchError && (
            <p role="alert" className="mb-5 text-sm text-danger">
              {tError(gameErrorKey(searchError))}
            </p>
          )}
          {!searching && results.length === 0 && (
            <Unavailable>{tv("noCardsMatchTheseFilters")}</Unavailable>
          )}
          <ul
            id="catalog-cards-list"
            tabIndex={0}
            className="yk-card-grid yk-catalogue-grid"
            aria-label={tv("catalogCards")}
          >
            {results.map(card => (
              <li key={card.id}>
                <button
                  type="button"
                  className="yk-catalogue-card"
                  onClick={() => setSelected(card)}
                  aria-label={tv("viewCard", {
                    name: card.name,
                    rarity: card.rarity
                  })}
                  aria-haspopup="dialog"
                >
                  <CardShell>
                    <YokaiCard {...card} animated={false} imageSizes="100vw" />
                  </CardShell>
                </button>
              </li>
            ))}
          </ul>
          <div className="yk-collection-pagination">
            <Pagination
              page={page}
              pageCount={pageCount}
              scrollTargetId="catalog-cards-list"
              onPageChange={number => {
                setPage(number);
                setSearching(true);
              }}
            />
            <label>
              {tv("cardsPerPage")}
              <select
                value={pageSize}
                onChange={event => {
                  setPageSize(Number(event.target.value));
                  resetPage();
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
        </div>
      </div>
      <CatalogueCardModal
        selected={selected}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}

export function FriendsView() {
  const params = useSearchParams();
  const router = useRouter();
  const conversation = params.get("message") ?? undefined;
  const showTrades = Boolean(params.get("ami") || params.get("offre"));
  function navigateTrades(friendId?: string) {
    if (!friendId) return;
    const query = new URLSearchParams({ tab: "trades" });
    query.set("ami", friendId);
    router.push(`/friends?${query.toString()}`, { scroll: false });
  }
  return (
    <FriendsPanel
      initialConversationId={conversation}
      tradeSection={{
        active: showTrades,
        routeKey: params.toString(),
        friendId: params.get("ami") ?? undefined,
        content: <TradesView />,
        compose: friendId => (
          <TradesPanel key={friendId} fixedFriendId={friendId} />
        ),
        open: navigateTrades,
        close: () => router.push("/friends", { scroll: false })
      }}
      onConversationClose={() => {
        if (conversation) router.replace("/friends", { scroll: false });
      }}
    />
  );
}

export function TradesView() {
  const searchParams = useSearchParams();
  return (
    <>
      <TradesPanel
        key={searchParams.toString()}
        initialOfferId={searchParams.get("offre") ?? undefined}
        fixedFriendId={searchParams.get("ami") ?? undefined}
        initialRequestedCardId={searchParams.get("carte") ?? undefined}
      />
    </>
  );
}
type WishlistSort = "recent" | "name" | "rarity";
const wishlistRarityRank: Record<Rarity, number> = {
  LR: 0,
  SSR: 1,
  SR: 2,
  R: 3,
  C: 4
};
export function WishlistView({
  previewCards,
  onRemove
}: {
  previewCards?: WishlistCard[];
  onRemove?: (id: string) => Promise<unknown>;
} = {}) {
  const tError = useTranslations();
  const tv = useTranslations("catalogueUi");
  const format = useFormatter();
  const [cards, setCards] = useState<WishlistCard[] | undefined>(previewCards);
  const [selected, setSelected] = useState<Card | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState<Rarity[]>([]);
  const [category, setCategory] = useState<string[]>([]);
  const [sort, setSort] = useState<WishlistSort>("recent");
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (previewCards) return;
    let active = true;
    void getWishlist().then(
      value => {
        if (active) setCards(value);
      },
      e => {
        if (active)
          setError(
            e instanceof Error
              ? gameErrorKey(e)
              : "catalogueUi.wishlistIndisponible"
          );
      }
    );
    return () => {
      active = false;
    };
  }, [previewCards]);
  const categories = useMemo(
    () =>
      Array.from(new Set((cards ?? []).map(card => card.category))).sort(
        (a, b) => a.localeCompare(b, "en-US")
      ),
    [cards]
  );
  const filteredCards = useMemo(
    () =>
      [...(cards ?? [])]
        .filter(
          card =>
            matchesCardSearch(query, [card.name, card.anime, card.category]) &&
            (!rarity.length || rarity.includes(card.rarity)) &&
            (!category.length || category.includes(card.category))
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, "en-US")
            : sort === "rarity"
              ? wishlistRarityRank[a.rarity] - wishlistRarityRank[b.rarity] ||
                a.name.localeCompare(b.name, "en-US")
              : Date.parse(b.createdAt) - Date.parse(a.createdAt)
        ),
    [cards, query, rarity, category, sort]
  );
  const filtered = !!(
    query ||
    rarity.length ||
    category.length ||
    sort !== "recent"
  );
  async function remove(id: string) {
    try {
      await (onRemove ? onRemove(id) : liveToggleWishlist(id));
      setCards(current => current?.filter(card => card.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? gameErrorKey(e)
          : "catalogueUi.couldntRemoveThisCardFromYourWishlist"
      );
    }
  }
  const filters = (
    <>
      <button
        type="button"
        className="yk-filter-reset"
        disabled={!filtered}
        onClick={() => {
          setQuery("");
          setRarity([]);
          setCategory([]);
          setSort("recent");
        }}
      >
        {tv("resetFilters")}
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
        <label className="sr-only" htmlFor="wishlist-query">
          {tv("searchWishlist")}
        </label>
        <input
          id="wishlist-query"
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={tv("search")}
        />
      </div>
      <FilterGroup title={tv("sortBy")}>
        <button
          type="button"
          className="yk-filter-option"
          aria-pressed={sort === "recent"}
          onClick={() => setSort("recent")}
        >
          <span className="yk-filter-check" />
          <span>{tv("recentlyAdded")}</span>
        </button>
        <button
          type="button"
          className="yk-filter-option"
          aria-pressed={sort === "name"}
          onClick={() => setSort("name")}
        >
          <span className="yk-filter-check" />
          <span>{tv("nameAZ")}</span>
        </button>
        <button
          type="button"
          className="yk-filter-option"
          aria-pressed={sort === "rarity"}
          onClick={() => setSort("rarity")}
        >
          <span className="yk-filter-check" />
          <span>{tv("rarity")}</span>
        </button>
      </FilterGroup>
      <CatalogueFilterSection title="Rarity" count={rarity.length}>
        <RarityChips
          selected={rarity}
          onToggle={item =>
            setRarity(current => toggleFilterValue(current, item))
          }
        />
      </CatalogueFilterSection>
      <CatalogueFilterSection title="Category" count={category.length}>
        {categories.map(item => (
          <button
            type="button"
            key={item}
            className="yk-filter-option"
            aria-pressed={category.includes(item)}
            onClick={() =>
              setCategory(current => toggleFilterValue(current, item))
            }
          >
            <span className="yk-filter-check" />
            <span>{item}</span>
          </button>
        ))}
      </CatalogueFilterSection>
    </>
  );
  return (
    <>
      {cards && cards.length > 0 && (
        <div className="yk-wishlist-head">
          <div>
            <p className="font-display text-xl">
              {format.number(cards.length)}{" "}
              {cards.length === 1
                ? tv("countPluralOneCardOtherCards", { count: cards.length })
                : tv("countPluralOneCardOtherCards", { count: cards.length })}
              {tv("onYourWishlist")}
            </p>
            <p className="mt-2 text-sm text-ink-2">
              {tv("getAnAlertWhenOneOfTheseCards")}
            </p>
          </div>
          <Link href="/catalog" className="yk-button yk-button-secondary">
            {tv("discoverCards")}
          </Link>
        </div>
      )}
      {error && (
        <p role="alert" className="yk-social-alert mb-5">
          {tError(gameErrorKey(error))}
        </p>
      )}
      {cards === undefined ? (
        <Unavailable>{tv("loadingYourWishlist")}</Unavailable>
      ) : cards.length === 0 ? (
        <div className="yk-wishlist-empty">
          <span aria-hidden="true">☆</span>
          <h2>{tv("yourWishlistIsEmpty")}</h2>
          <p>{tv("addCardsFromTheCatalogOrYourCollection")}</p>
          <Link href="/catalog" className="yk-button yk-button-secondary">
            {tv("exploreCatalog")}
          </Link>
        </div>
      ) : (
        <section className="yk-catalogue">
          <div className="yk-catalogue-heading">
            <div>
              <p role="status" className="font-display text-xl">
                {format.number(filteredCards.length)}{" "}
                {filteredCards.length === 1
                  ? tv("countPluralOneCardOtherCards", {
                      count: filteredCards.length
                    })
                  : tv("countPluralOneCardOtherCards", {
                      count: filteredCards.length
                    })}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                {filtered
                  ? tv("resultsMatchingYourFilters")
                  : tv("allCardsOnYourWishlist")}
              </p>
            </div>
            <button
              type="button"
              className="yk-mobile-filter-trigger"
              aria-expanded={filtersOpen}
              aria-controls="wishlist-filters"
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
              {tv("sortAndFilter")}
              {filtered ? <span>•</span> : null}
            </button>
          </div>
          {filtersOpen && (
            <button
              type="button"
              className="yk-filter-backdrop"
              aria-label={tv("closeFilters")}
              onClick={() => setFiltersOpen(false)}
            />
          )}
          <div className="yk-collection-layout">
            <aside
              id="wishlist-filters"
              className={`yk-collection-sidebar ${filtersOpen ? "yk-sidebar-open" : ""}`}
              aria-label={tv("wishlistSortingAndFilters")}
            >
              <div className="yk-sidebar-mobile-head">
                <strong>{tv("sortAndFilter")}</strong>
                <button
                  type="button"
                  aria-label={tv("closeFilters")}
                  onClick={() => setFiltersOpen(false)}
                >
                  ×
                </button>
              </div>
              {filters}
            </aside>
            <div className="yk-collection-main">
              {filteredCards.length ? (
                <div className="yk-card-grid yk-wishlist-grid">
                  {filteredCards.map(card => (
                    <article key={card.id} className="yk-wishlist-item">
                      <button
                        type="button"
                        className="yk-catalogue-card"
                        onClick={() => setSelected(card)}
                        aria-label={tv("viewCard", {
                          name: card.name,
                          rarity: card.rarity
                        })}
                        aria-haspopup="dialog"
                      >
                        <CardShell>
                          <YokaiCard
                            {...card}
                            animated={false}
                            imageSizes="100vw"
                          />
                        </CardShell>
                      </button>
                      <Button
                        variant="danger"
                        onClick={() => void remove(card.id)}
                        aria-label={tv("removeWishlistCard", {
                          name: card.name
                        })}
                      >
                        {tv("remove")}
                      </Button>
                    </article>
                  ))}
                </div>
              ) : (
                <Unavailable>{tv("noCardsMatchTheseFilters")}</Unavailable>
              )}
            </div>
          </div>
        </section>
      )}
      <CatalogueCardModal
        selected={selected}
        onClose={() => setSelected(null)}
        onWishlistChange={(id, wishlisted) => {
          if (!wishlisted) {
            setCards(current => current?.filter(card => card.id !== id));
            setSelected(null);
          }
        }}
      />
    </>
  );
}

const remaining = (endsAt: string) => {
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(endsAt) - Date.now()) / 1000)
  );
  return {
    seconds,
    text: `${Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
  };
};
export function presentAuction(
  raw: AuctionData | AuctionDetail,
  viewer?: string
): AuctionPresentation {
  const left = remaining(raw.endsAt);
  const finished = raw.status !== "active" || left.seconds === 0;
  const detail = raw as AuctionDetail;
  const bidder = !!raw.hasBid || !!detail.history?.some(b => b.mine);
  const status =
    raw.status === "sold"
      ? raw.buyerId === viewer
        ? "won"
        : raw.sellerId === viewer
          ? "sold"
          : bidder
            ? "lost"
            : undefined
      : raw.status === "expired"
        ? raw.sellerId === viewer
          ? "unsold"
          : bidder
            ? "lost"
            : undefined
        : raw.sellerId === viewer
          ? "mine"
          : raw.buyerId === viewer
            ? "leading"
            : bidder
              ? "outbid"
              : undefined;
  return {
    id: raw.id,
    ...(raw.ownedCount !== undefined ? { ownedCount: raw.ownedCount } : {}),
    card: { ...raw.card, image: raw.card.catalogueImage ?? raw.card.image },
    amount: raw.amount,
    remaining: left.text,
    remainingSeconds: left.seconds,
    seller: raw.seller || "Deleted player",
    sellerId: raw.sellerId,
    sellerAvatarUrl: raw.sellerAvatarUrl,
    bids: raw.bids ?? detail.history?.length ?? 0,
    popularity: raw.popularity,
    status,
    finished,
    endsAt: raw.endsAt,
    buyer:
      raw.status === "sold" && raw.buyer !== undefined
        ? raw.buyer || "Deleted player"
        : undefined,
    winner: detail.winner ?? undefined,
    balance: detail.balance,
    nextBid: !finished && raw.sellerId !== viewer ? raw.amount + 10 : undefined,
    minimumBid: raw.amount + 10,
    wishlist: raw.watched,
    antiSnipeMessage:
      left.seconds < 300 && !finished
        ? "Each bid adds one minute to the end time."
        : undefined,
    history: detail.history?.map(b => ({
      id: b.id,
      name: b.name,
      avatarUrl: b.avatarUrl,
      amount: b.amount,
      createdAt: b.createdAt,
      time: new Date(b.createdAt).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit"
      }),
      mine: b.mine
    }))
  };
}

export function buildAuctionLists(market: AuctionData[], viewer: string) {
  return {
    active: market
      .filter(a => a.status === "active")
      .map(a => presentAuction(a, viewer)),
    mine: market
      .filter(a => a.status === "active" && (a.sellerId === viewer || a.hasBid))
      .map(a => presentAuction(a, viewer)),
    won: market
      .filter(a => a.status === "sold" && a.buyerId === viewer)
      .map(a => presentAuction(a, viewer)),
    sold: market
      .filter(a => a.status !== "active" && a.sellerId === viewer)
      .map(a => presentAuction(a, viewer))
  };
}

export function CommunityView({
  screen,
  account,
  name,
  joined,
  isMe = true,
  playerId,
  auctionId,
  pageHeading,
  children
}: {
  children?: ReactNode;
  pageHeading?: ReactNode;
  screen: CommunityScreen;
  account: ReactNode;
  name?: string;
  joined?: string;
  isMe?: boolean;
  playerId?: string;
  auctionId?: string;
}) {
  const tError = useTranslations();
  const tv = useTranslations("catalogueUi");
  const router = useRouter();
  const [collection, setCollection] = useState<CollectedCard[]>();
  const [error, setError] = useState("");
  const [karas, setKaras] = useState<number>();
  const [viewer, setViewer] = useState<string>();
  const [market, setMarket] = useState<AuctionData[]>();
  const [marketPage, setMarketPage] = useState<MarketPage>();
  const [marketLimit, setMarketLimit] = useState(MARKET_PAGE_SIZE);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketQuery, setMarketQuery] = useState<MarketQuery>({
    query: "",
    rarity: "",
    category: "",
    sort: "end",
    section: "active"
  });
  const marketQueryRef = useRef(marketQuery);
  const changeMarketQuery = useCallback((next: MarketQuery) => {
    if (JSON.stringify(next) === JSON.stringify(marketQueryRef.current)) return;
    marketQueryRef.current = next;
    setMarketQuery(next);
    setMarketLimit(MARKET_PAGE_SIZE);
    setMarket(undefined);
    setMarketPage(undefined);
  }, []);
  const [auction, setAuction] = useState<AuctionDetail>();
  const [, setClock] = useState(0);
  const [extended, setExtended] = useState(false);
  const lastEndsAt = useRef<{ id: string; endsAt: string } | undefined>(
    undefined
  );
  const extensionTimer = useRef<number | undefined>(undefined);
  const viewerRef = useRef<string | undefined>(undefined);
  const marketRef = useRef<AuctionData[] | undefined>(undefined);
  const auctionRef = useRef<AuctionDetail | undefined>(undefined);
  // Presentation only: flags the notice when the server-provided endsAt moves later (anti-snipe already applied by place_bid).
  const receiveAuction = useCallback((next: AuctionDetail) => {
    const previous = lastEndsAt.current;
    const scopes = auctionReconciliationScopes(
      auctionRef.current ? [auctionRef.current] : [],
      [next],
      viewerRef.current
    );
    auctionRef.current = next;
    if (scopes.length) invalidatePlayerSnapshots(scopes);
    lastEndsAt.current = { id: next.id, endsAt: next.endsAt };
    setAuction(next);
    setKaras(next.balance);
    if (
      previous?.id === next.id &&
      next.status === "active" &&
      Date.parse(next.endsAt) > Date.parse(previous.endsAt)
    ) {
      setExtended(true);
      window.clearTimeout(extensionTimer.current);
      extensionTimer.current = window.setTimeout(
        () => setExtended(false),
        animation.market.extensionNotice
      );
    }
  }, []);
  useEffect(() => () => window.clearTimeout(extensionTimer.current), []);
  useEffect(() => {
    if (screen !== "market" && screen !== "auction") return;
    const timer = window.setInterval(() => setClock(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [screen]);
  useEffect(() => {
    let active = true;
    void getGameInfo().then(
      info => {
        if (active) {
          viewerRef.current = info.user.id;
          setKaras(info.karasBalance);
          setViewer(info.user.id);
        }
      },
      () => {
        if (active)
          setError("Couldn't load your balance. Please try again later.");
      }
    );
    if (screen === "profile" && isMe)
      void getUserCollection().then(
        data => {
          if (active) setCollection(data);
        },
        () => {
          if (active)
            setError("Couldn't load your collection. Please try again later.");
        }
      );
    if (screen === "auction" && auctionId)
      void getAuction(auctionId).then(
        data => {
          if (active) receiveAuction(data);
        },
        e => {
          if (active)
            setError(
              e instanceof Error ? e.message : "Couldn't load this auction."
            );
        }
      );
    return () => {
      active = false;
    };
  }, [screen, isMe, playerId, auctionId, receiveAuction]);
  useEffect(() => {
    if (screen !== "market") return;
    let active = true,
      loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      setMarketLoading(true);
      try {
        const page = await browseAuctions(marketQuery, marketLimit);
        if (!active) return;
        const next = page.items;
        const scopes = auctionReconciliationScopes(
          marketRef.current ?? [],
          next,
          viewerRef.current
        );
        marketRef.current = next;
        if (scopes.length) invalidatePlayerSnapshots(scopes);
        setMarket(next);
        setMarketPage(page);
        setError("");
      } catch (e) {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Couldn't load the market. Please try again."
          );
      } finally {
        loading = false;
        if (active) setMarketLoading(false);
      }
    };
    // #388: the list is not live; actions and invalidations refresh it sooner.
    const stop = startVisiblePolling(() => void refresh(), 30_000);
    const unsubscribe = subscribePlayerSnapshotInvalidation(scopes => {
      if (scopes.includes("collection")) void refresh();
    });
    return () => {
      active = false;
      stop();
      unsubscribe();
    };
  }, [screen, marketQuery, marketLimit]);
  useEffect(() => {
    if (screen !== "auction") return;
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        if (auctionId) {
          const next = await getAuction(auctionId);
          if (active) receiveAuction(next);
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production")
          console.error("[market] automatic refresh failed", error);
      } finally {
        loading = false;
      }
    };
    // Live bidding stays at 3 s while visible. The auction effect above already
    // loads it on open, so skip the helper's first immediate read.
    let skipFirst = !document.hidden;
    const stop = startVisiblePolling(() => {
      if (skipFirst) skipFirst = false;
      else void refresh();
    }, 3000);
    return () => {
      active = false;
      stop();
    };
  }, [screen, auctionId, receiveAuction]);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribePlayerSnapshotInvalidation(scopes => {
      if (scopes.includes("balance"))
        void getGameInfo().then(
          info => {
            if (active) setKaras(info.karasBalance);
          },
          () => undefined
        );
      if (scopes.includes("collection") && screen === "profile" && isMe)
        void getUserCollection().then(
          cards => {
            if (active) setCollection(cards);
          },
          () => undefined
        );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [screen, isMe]);
  const feed = useNotificationFeed();
  const lists =
    market && viewer ? buildAuctionLists(market, viewer) : undefined;
  const activeSales = marketPage?.counts
    ? String(marketPage.counts.activeSales)
    : market && viewer
      ? String(
          market.filter(a => a.status === "active" && a.sellerId === viewer)
            .length
        )
      : undefined;
  async function refreshAuction() {
    if (!auctionId) return;
    receiveAuction(await getAuction(auctionId));
  }
  async function watchFromMarket(id: string) {
    try {
      const watched = await toggleWatch(id);
      setMarket(current =>
        current?.map(item => (item.id === id ? { ...item, watched } : item))
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't update your watchlist."
      );
    }
  }
  async function watchAuction() {
    if (!auction) return;
    try {
      await toggleWatch(auction.id);
      await refreshAuction();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't update your watchlist."
      );
    }
  }
  const [overline, title] =
    screen === "search"
      ? [tv("catalogOverline"), tv("catalogTitle")]
      : screen === "wishlist"
        ? [tv("wishlistOverline"), tv("wishlistTitle")]
        : screen === "profile"
          ? [tError("profileUi.collector"), tError("profileUi.myProfile")]
          : screen === "friends" || screen === "feed"
            ? [
                tError("socialFriends.overline"),
                tError(
                  screen === "feed" ? "topbar.social" : "socialFriends.title"
                )
              ]
            : screen === "auction"
              ? [
                  tError("market.auctionOverline"),
                  tError("market.auctionTitle")
                ]
              : headings[screen];
  const notificationItems = useNotificationItems(feed.notifications ?? []);
  return (
    <>
      <Topbar
        view={screen}
        account={account}
        name={isMe ? name : undefined}
        karas={karas}
        notifications={notificationItems}
        notificationError={feed.error || undefined}
        onRetryNotifications={feed.retry}
        onRefreshNotifications={() => void feed.refresh()}
        onReadAll={async () => {
          await markNotificationRead();
          feed.setNotifications(current =>
            current?.map(n => ({
              ...n,
              readAt: n.readAt ?? new Date().toISOString()
            }))
          );
        }}
        onOpenNotification={async (id, href) => {
          await markNotificationRead(id);
          window.location.assign(href);
        }}
      />
      <main
        id="main-content"
        className={`${screen === "friends" || screen === "feed" || screen === "trades" ? "yk-social-page" : ""} mx-auto w-full ${
          screen === "search" ||
          screen === "market" ||
          screen === "auction" ||
          screen === "wishlist" ||
          screen === "friends" ||
          screen === "feed" ||
          screen === "trades"
            ? "max-w-[var(--layout-collection-max)]"
            : "max-w-6xl"
        } px-6 py-10`}
      >
        {screen !== "market" && screen !== "search" && (
          <div>
            {screen === "auction" && (
              <Link href="/market" className="yk-back-link">
                {tError("market.back")}
              </Link>
            )}
            <p className="eyebrow">{overline}</p>
            <h1 className="yk-title mt-3">
              {screen === "profile" && !isMe
                ? tError("profileUi.playerProfile")
                : title}
            </h1>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="my-6 rounded-panel border border-danger/40 bg-danger/10 p-5 text-sm text-danger-ink"
          >
            {screen === "search" || screen === "wishlist"
              ? tError(gameErrorKey(error))
              : tError(gameErrorKey(error))}
          </p>
        )}
        <div
          className={
            screen === "market" || screen === "search"
              ? undefined
              : screen === "friends" || screen === "feed" || screen === "trades"
                ? "yk-social-page-content mt-4"
                : "mt-8"
          }
        >
          {screen === "profile" && (
            <ProfileView
              name={name}
              joined={joined}
              cards={collection}
              isMe={isMe}
              identifier={playerId}
            />
          )}
          {screen === "friends" && (children ?? <FriendsView />)}
          {screen === "feed" && children}
          {screen === "market" && (
            <MarketView
              pageHeading={pageHeading}
              lists={lists}
              activeSales={activeSales}
              marketPage={marketPage}
              marketLimit={marketLimit}
              loadingMore={marketLoading}
              onQueryChange={changeMarketQuery}
              onLoadMore={() =>
                setMarketLimit(limit =>
                  Math.min(MARKET_MAX_ITEMS, limit + MARKET_PAGE_SIZE)
                )
              }
              onToggleWatch={watchFromMarket}
            />
          )}{" "}
          {screen === "auction" && (
            <AuctionView
              auction={
                auction && { ...presentAuction(auction, viewer), extended }
              }
              onBid={
                auctionId
                  ? async amount => {
                      await placeBid(auctionId, amount);
                      await refreshAuction();
                    }
                  : undefined
              }
              onCancel={
                auction &&
                auction.status === "active" &&
                auction.sellerId === viewer
                  ? async () => {
                      await cancelAuction(auction.id);
                      router.push("/collection");
                    }
                  : undefined
              }
              onToggleWatch={auction ? watchAuction : undefined}
            />
          )}{" "}
          {screen === "search" && (
            <SearchView
              pageHeading={
                <>
                  <p className="eyebrow">{overline}</p>
                  <h1 className="yk-title mt-3">{title}</h1>
                </>
              }
            />
          )}
          {screen === "trades" && <TradesView />}
          {screen === "wishlist" && <WishlistView />}
        </div>
      </main>
    </>
  );
}
import { StyledPlayerName } from "@/components/styled-player-name";
