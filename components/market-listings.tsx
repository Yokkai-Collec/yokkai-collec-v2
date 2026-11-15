"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";
import type {
  MarketView,
  buildAuctionLists as buildLists
} from "@/components/community-views";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";
import {
  auctionReconciliationScopes,
  browseAuctions,
  MARKET_MAX_ITEMS,
  MARKET_PAGE_SIZE,
  toggleWatch,
  type AuctionData,
  type MarketPage,
  type MarketQuery
} from "@/lib/data/market";
import { localMarketFixture } from "@/lib/data/local-market-fixture";
import { subscribePlayerSnapshotInvalidation } from "@/lib/data/player-state";
import {
  createMarketReturnStore,
  marketReturnQuery,
  readMarketReturnContent,
  rememberMarketReturn
} from "@/lib/ui/market-return";
import { startVisiblePolling } from "@/lib/ui/visible-polling";

export default function MarketListings({
  view: View,
  buildAuctionLists,
  viewerId,
  pageHeading,
  onError: setError
}: {
  view: typeof MarketView;
  buildAuctionLists: typeof buildLists;
  viewerId?: string;
  pageHeading?: ReactNode;
  onError: (error: string) => void;
}) {
  const [market, setMarket] = useState<AuctionData[]>();
  const [marketPage, setMarketPage] = useState<MarketPage>();
  const marketReturnStore = useMemo(() => createMarketReturnStore(), []);
  const marketNavigation = useSyncExternalStore(
    marketReturnStore.subscribe,
    marketReturnStore.getSnapshot,
    marketReturnStore.getServerSnapshot
  );
  const [marketLimitOverride, setMarketLimit] = useState<number>();
  const marketLimit =
    marketLimitOverride ?? marketNavigation?.limit ?? MARKET_PAGE_SIZE;
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketQueryOverride, setMarketQuery] = useState<MarketQuery>();
  const cachedReturnContent = useMemo(
    () =>
      !marketQueryOverride && marketLimit === marketNavigation?.limit
        ? readMarketReturnContent(marketNavigation, viewerId)
        : null,
    [marketQueryOverride, marketLimit, marketNavigation, viewerId]
  );
  const marketQuery = useMemo<MarketQuery>(
    () =>
      marketQueryOverride ??
      (marketNavigation
        ? marketReturnQuery(marketNavigation)
        : {
            query: "",
            rarity: "",
            category: "",
            sort: "end",
            section: "active"
          }),
    [marketQueryOverride, marketNavigation]
  );
  const changeMarketQuery = useCallback(
    (next: MarketQuery) => {
      if (JSON.stringify(next) === JSON.stringify(marketQuery)) return;
      setMarketQuery(next);
      setMarketLimit(MARKET_PAGE_SIZE);
      setMarket(undefined);
      setMarketPage(undefined);
    },
    [marketQuery]
  );
  const marketRef = useRef<AuctionData[] | undefined>(undefined);
  useEffect(() => {
    if (marketNavigation === undefined) return;
    let active = true,
      loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      setMarketLoading(true);
      try {
        const page = await browseAuctions(marketQuery, marketLimit);
        if (!active) return;
        // A fresh local database is normally empty. Populate only the local
        // development view so the real Market route remains reviewable; live
        // environments always preserve the server response and empty state.
        const useLocalFixture =
          process.env.NODE_ENV !== "production" &&
          marketQuery.section === "active" &&
          page.items.length === 0;
        const next = useLocalFixture
          ? localMarketFixture(marketQuery)
          : page.items;
        const resolvedPage = useLocalFixture
          ? {
              ...page,
              items: next,
              hasMore: false,
              counts: {
                mine: 0,
                won: 0,
                sold: 0,
                ...page.counts,
                active: next.length,
                activeSales: 0
              },
              categories: [
                ...new Set(next.map(auction => auction.card.category))
              ].sort()
            }
          : page;
        const scopes = auctionReconciliationScopes(
          marketRef.current ?? [],
          next,
          viewerId
        );
        marketRef.current = next;
        if (scopes.length) invalidatePlayerSnapshots(scopes);
        setMarket(next);
        setMarketPage(resolvedPage);
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
  }, [marketQuery, marketLimit, marketNavigation, viewerId, setError]);
  const displayedMarket = market ?? cachedReturnContent?.items;
  const displayedMarketPage = marketPage ?? cachedReturnContent?.page;
  const activeSales = displayedMarketPage?.counts
    ? String(displayedMarketPage.counts.activeSales)
    : displayedMarket && viewerId
      ? String(
          displayedMarket.filter(
            a => a.status === "active" && a.sellerId === viewerId
          ).length
        )
      : undefined;
  async function watchFromMarket(id: string) {
    if (
      process.env.NODE_ENV !== "production" &&
      id.startsWith("local-market-demo-")
    ) {
      setMarket(current =>
        current?.map(item =>
          item.id === id ? { ...item, watched: !item.watched } : item
        )
      );
      return;
    }
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
  return marketNavigation !== undefined ? (
    <View
      initialNavigation={marketNavigation}
      pageHeading={pageHeading}
      lists={
        displayedMarket && viewerId
          ? buildAuctionLists(displayedMarket, viewerId)
          : undefined
      }
      activeSales={activeSales}
      marketPage={displayedMarketPage}
      onRememberNavigation={navigation =>
        rememberMarketReturn(
          navigation,
          displayedMarket && displayedMarketPage && viewerId
            ? {
                viewerId,
                items: displayedMarket,
                page: displayedMarketPage
              }
            : undefined
        )
      }
      marketLimit={marketLimit}
      loadingMore={marketLoading}
      onQueryChange={changeMarketQuery}
      onLoadMore={() =>
        setMarketLimit(limit =>
          Math.min(MARKET_MAX_ITEMS, (limit ?? marketLimit) + MARKET_PAGE_SIZE)
        )
      }
      onToggleWatch={watchFromMarket}
    />
  ) : null;
}
