"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations } from "next-intl";
import { packCountdown } from "@/lib/ui/pack-countdown";
import dynamic from "next/dynamic";
import { Topbar } from "@/components/topbar";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  createFolder,
  deleteFolder,
  discardCollectionCards as discardCollectionCardsRequest,
  discardDecisionPack,
  discardPackCard,
  evolveSsrCard,
  evolveLrCard,
  getActiveAuctionCards,
  getDecisionPackStatus,
  getFolders,
  getGameInfo,
  getPaniniAlbumCardsPage,
  getPaniniAlbumsPage,
  getPackStatus,
  getUserCollection,
  keepDecisionPackCard,
  moveCardToFolder,
  moveCardsToFolder,
  openBooster,
  openBoosters,
  openDecisionPack,
  setPaniniAlbumFavorite,
  setCardCustomImage,
  setCollectionCardLocked,
  type ActiveAuctionCard,
  type CollectedCard,
  type DecisionPackStatus,
  type Folder,
  type PackStatus
} from "@/lib/data/cards";
import { createAuction } from "@/lib/data/market";
import { getWishlist } from "@/lib/data/wishlist";
import { subscribePlayerSnapshotInvalidation } from "@/lib/data/player-state";
import { useSfx } from "@/hooks/use-sfx";
import { runPackOpeningOnce } from "@/lib/ui/pack-opening";
import { releaseBoostersBackground } from "@/components/boosters-load-priority";
import { startVisiblePolling } from "@/lib/ui/visible-polling";
import { liveCollectionPages } from "@/lib/data/collection-pages";
import { SiteFooter } from "@/components/site-footer";
import { CollectionLoading } from "@/components/collection-loading";

const CollectionView = dynamic(
  () => import("@/components/collection").then(module => module.CollectionView),
  { loading: () => <CollectionLoading heading /> }
);

const Boosters = dynamic(
  () => import("@/components/boosters").then(module => module.Boosters),
  {
    loading: function LoadingPacks() {
      const tg = useTranslations("gameUi");
      return <p role="status">{tg("loadingPacks")}</p>;
    }
  }
);

// Share initial/polling reads, while post-mutation reconciliation still requests
// a fresh server status even when a previous initial read is pending.
export const gameReads = {
  getGameInfo,
  getPackStatus: () => getPackStatus(true),
  getDecisionPackStatus: () => getDecisionPackStatus(false),
  getUserCollection: () => getUserCollection(false),
  getFolders: () => getFolders(true),
  getActiveAuctionCards: () => getActiveAuctionCards(true)
};
type Info = Awaited<ReturnType<typeof getGameInfo>>;
export function Game({
  view,
  account,
  previewData,
  discordEnabled = false
}: {
  view: "packs" | "collection";
  account?: ReactNode;
  previewData?: typeof gameReads;
  discordEnabled?: boolean;
}) {
  const tError = useTranslations();
  const tg = useTranslations("gameUi");
  const [info, setInfo] = useState<Info | null>(null);
  const [status, setStatus] = useState<PackStatus | null>(null);
  const [decisionStatus, setDecisionStatus] =
    useState<DecisionPackStatus | null>(null);
  const [collection, storeCollection] = useState<CollectedCard[]>([]);
  const [collectionBinders, setCollectionBinders] = useState<
    Map<string, NonNullable<CollectedCard["binders"]>>
  >(new Map());
  const renderedCollection = useMemo(
    () =>
      collection.map(card => {
        const binders = collectionBinders.get(card.id);
        return binders ? { ...card, binders } : card;
      }),
    [collection, collectionBinders]
  );
  const [activeAuctionCards, setActiveAuctionCards] = useState<
    ActiveAuctionCard[]
  >([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [draw, setDraw] = useState<CollectedCard[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [drawKind, setDrawKind] = useState<"regular" | "decision">("regular");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [collectionReady, setCollectionReady] = useState(false);
  const [wishlist, setWishlist] = useState<ReadonlySet<string> | null>(null);
  const setCollection = useCallback((cards: CollectedCard[]) => {
    storeCollection(cards);
    setCollectionReady(true);
  }, []);
  const retries = useRef<Record<string, () => void>>({});
  const reads = previewData ?? gameReads;
  // #388: the collection screen reads pages from the server once its RPC
  // answers; until the migration is applied it keeps the full load.
  const [pagesVersion, setPagesVersion] = useState(0);
  const pagesProbe = useMemo(
    () =>
      // Binder search names stay client-side: keep the full load with them.
      view === "collection" &&
      !previewData &&
      process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED !== "true"
        ? liveCollectionPages.counts().then(
            counts => (typeof counts?.copies === "number" ? "server" : "full"),
            () => "full" as const
          )
        : Promise.resolve("full" as const),
    [view, previewData]
  );
  const [pagesMode, setPagesMode] = useState<"probing" | "server" | "full">(
    view === "collection" && !previewData ? "probing" : "full"
  );
  useEffect(() => {
    let active = true;
    void pagesProbe.then(mode => {
      if (active) setPagesMode(mode);
    });
    return () => {
      active = false;
    };
  }, [pagesProbe]);
  const serverPages = pagesMode === "server";
  // After a mutation: read pages again, or the full collection in fallback.
  const reloadCollection = useCallback(async () => {
    if ((await pagesProbe) === "server")
      setPagesVersion(current => current + 1);
    else setCollection(await getUserCollection(false));
  }, [pagesProbe, setCollection]);
  const opening = useRef(false);
  const sound = useSfx();
  useEffect(() => {
    let active = true;
    let backgroundStarted = false;
    const pending = new Map<string, Promise<unknown>>();
    const failed = new Set<string>();
    function load<T>(
      key: string,
      read: () => Promise<T>,
      apply: (value: T) => void
    ) {
      if (pending.has(key)) return pending.get(key)!;
      if (key === "collection") setCollectionReady(false);
      setLoadErrors(current => ({ ...current, [key]: "" }));
      const request = read()
        .then(
          value => {
            if (!active) return;
            failed.delete(key);
            apply(value);
            if (key === "collection") setCollectionReady(true);
          },
          failure => {
            failed.add(key);
            if (active)
              setLoadErrors(current => ({
                ...current,
                [key]:
                  failure instanceof Error
                    ? failure.message
                    : "gameUi.couldntLoadThisData"
              }));
          }
        )
        .finally(() => pending.delete(key));
      pending.set(key, request);
      retries.current[key] = () => {
        void load(key, read, apply);
      };
      return request;
    }
    function background() {
      if (!active || document.hidden) return;
      backgroundStarted = true;
      void pagesProbe.then(mode => {
        if (mode === "full" && active)
          void load("collection", reads.getUserCollection, setCollection);
      });
      void load("folders", reads.getFolders, setFolders);
      void load("auctions", reads.getActiveAuctionCards, setActiveAuctionCards);
      releaseBoostersBackground();
    }
    function refresh(full: boolean) {
      for (const key of failed) retries.current[key]?.();
      void load("info", reads.getGameInfo, setInfo);
      if (view === "collection") {
        if (!backgroundStarted || full) background();
        else
          void load(
            "auctions",
            reads.getActiveAuctionCards,
            setActiveAuctionCards
          );
        return;
      }
      const packs =
        full || view === "packs"
          ? load("regular", reads.getPackStatus, setStatus)
          : Promise.resolve();
      const decision =
        full || view === "packs"
          ? load("decision", reads.getDecisionPackStatus, setDecisionStatus)
          : Promise.resolve();
      if (!backgroundStarted)
        void Promise.all([packs, decision]).then(() => {
          if (!backgroundStarted) background();
        });
      else if (full) background();
    }
    const timer = window.setTimeout(() => {
      if (!backgroundStarted) background();
    }, 1000);
    const stop = startVisiblePolling(refresh, 30_000);
    return () => {
      active = false;
      clearTimeout(timer);
      stop();
      retries.current = {};
    };
  }, [view, reads, setCollection, pagesProbe]);
  useEffect(() => {
    if (
      view !== "collection" ||
      previewData ||
      !collectionReady ||
      !collection.length
    )
      return;
    let active = true;
    // Optional public metadata cannot delay or replace the owned-card snapshot.
    void import("@/lib/data/binders")
      .then(module => module.withBinderMetadata(collection))
      .then(
        cards => {
          if (active && cards.some(card => card.binders))
            setCollectionBinders(
              new Map(
                cards
                  .filter(card => card.binders)
                  .map(card => [card.id, card.binders!])
              )
            );
        },
        () => undefined
      );
    return () => {
      active = false;
    };
  }, [collection, collectionReady, view, previewData]);
  useEffect(() => {
    return startVisiblePolling(() => setNow(Date.now()), 1000);
  }, []);
  const loadWishlist = useCallback(() => {
    void getWishlist().then(
      cards => setWishlist(new Set(cards.map(card => card.id))),
      () => undefined
    );
  }, []);
  useEffect(() => {
    if (view === "packs" && !previewData) loadWishlist();
  }, [view, previewData, loadWishlist]);
  useEffect(() => {
    if (view !== "packs" || status?.nextPackAt == null) return;
    const timer = window.setTimeout(
      () => {
        if (!document.hidden) retries.current.regular?.();
      },
      Math.max(0, status.nextPackAt - Date.now()) + 100
    );
    return () => window.clearTimeout(timer);
  }, [view, status?.nextPackAt]);
  useEffect(() => {
    if (view !== "packs" || !decisionStatus?.resetAt) return;
    // Re-read the server at the shared reset, in addition to background polling.
    // nextPackAt is corrected for the browser clock; resetAt is absolute metadata.
    const timer = window.setTimeout(
      () => {
        if (!document.hidden) retries.current.decision?.();
      },
      Math.max(0, decisionStatus.nextPackAt - Date.now()) + 100
    );
    return () => window.clearTimeout(timer);
  }, [view, decisionStatus?.resetAt, decisionStatus?.nextPackAt]);
  const serverPagesRef = useRef(false);
  useEffect(() => {
    serverPagesRef.current = serverPages;
  }, [serverPages]);
  useEffect(() => {
    let active = true;
    if (previewData) return;
    const unsubscribe = subscribePlayerSnapshotInvalidation(scopes => {
      if (document.hidden) return;
      if (scopes.includes("balance"))
        void getGameInfo().then(
          game => {
            if (active) setInfo(game);
          },
          () => undefined
        );
      if (scopes.includes("collection") && serverPagesRef.current) {
        setPagesVersion(current => current + 1);
        void getActiveAuctionCards().then(
          auctions => {
            if (active) setActiveAuctionCards(auctions);
          },
          () => undefined
        );
      } else if (scopes.includes("collection")) {
        setCollectionReady(false);
        setLoadErrors(current => ({ ...current, collection: "" }));
        void getUserCollection(false).then(
          cards => {
            if (active) {
              setCollection(cards);
            }
          },
          failure => {
            if (active)
              setLoadErrors(current => ({
                ...current,
                collection:
                  failure instanceof Error
                    ? failure.message
                    : "gameUi.couldntLoadYourCards"
              }));
          }
        );
        void getActiveAuctionCards().then(
          auctions => {
            if (active) setActiveAuctionCards(auctions);
          },
          () => undefined
        );
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [previewData, setCollection]);
  async function open(kind: "regular" | "decision", count: 1 | 5 | 10 = 1) {
    if (draw.length > 0 && revealed < draw.length) return [];
    return await runPackOpeningOnce(opening, async () => {
      setBusy(true);
      setError("");
      try {
        const cards =
          kind === "regular" && count > 1
            ? await openBoosters(count)
            : kind === "regular"
              ? await openBooster()
              : await openDecisionPack();
        setDraw(cards);
        setDrawKind(kind);
        setRevealed(0);
        setBusy(false);
        void Promise.all([
          getPackStatus(),
          getDecisionPackStatus(),
          getUserCollection(false)
        ]).then(
          ([packs, decision, cards]) => {
            setStatus(packs);
            setDecisionStatus(decision);
            setCollection(cards);
          },
          () => undefined
        );
        loadWishlist();
        return cards;
      } catch (e) {
        setError(
          e instanceof Error ? gameErrorKey(e) : "gameUi.couldntOpenThisPack"
        );
        throw e;
      } finally {
        setBusy(false);
        if (count > 1) void getPackStatus().then(setStatus, () => undefined);
      }
    });
  }
  async function evolve(instanceIds: string[]) {
    if (previewData)
      throw new Error("This action is unavailable in the simulation.");
    // Server pages keep no full collection: LR evolutions take 3 copies, SSR 5.
    const source =
      collection.find(card => card.instanceId === instanceIds[0])?.rarity ??
      (serverPages ? (instanceIds.length === 3 ? "LR" : "SSR") : undefined);
    if (!source) throw new Error("This card is no longer in your collection.");
    const evolved = await (source === "LR" ? evolveLrCard : evolveSsrCard)(
      instanceIds
    );
    await reloadCollection();
    return evolved;
  }
  async function keepDecision(instanceId: string) {
    const kept = await keepDecisionPackCard(instanceId);
    const [decision, cards] = await Promise.all([
      getDecisionPackStatus(),
      getUserCollection(false)
    ]);
    setDecisionStatus(decision);
    setCollection(cards);
    setInfo(current =>
      current
        ? { ...current, karasBalance: current.karasBalance + kept.karasReward }
        : current
    );
    return kept.karasReward;
  }
  async function discardDecision() {
    const reward = await discardDecisionPack();
    const [decision, game] = await Promise.all([
      getDecisionPackStatus(),
      getGameInfo()
    ]);
    setDecisionStatus(decision);
    setInfo(game);
    return reward;
  }
  async function discard(instanceId: string) {
    const balance = await discardPackCard(instanceId, drawKind);
    if (drawKind === "regular") {
      setCollection(await getUserCollection(false));
      setInfo(current =>
        current && balance !== null
          ? { ...current, karasBalance: balance }
          : current
      );
    } else {
      const [decision, game] = await Promise.all([
        getDecisionPackStatus(),
        getGameInfo()
      ]);
      setDecisionStatus(decision);
      setInfo(game);
    }
  }
  async function discardCollectionCard(instanceId: string) {
    const balance = await discardPackCard(instanceId, "regular");
    await reloadCollection();
    setInfo(current =>
      current && balance !== null
        ? { ...current, karasBalance: balance }
        : current
    );
  }
  async function discardCollectionCards(instanceIds: string[]) {
    try {
      await discardCollectionCardsRequest(instanceIds);
    } finally {
      // Reconcile if the response is lost after the atomic transaction commits.
      const [, game] = await Promise.all([reloadCollection(), getGameInfo()]);
      setInfo(game);
    }
  }
  useEffect(() => {
    let active = true;
    const refreshFolders = () => {
      void reloadCollection().catch(() => {});
      void getFolders()
        .then(next => {
          if (active) setFolders(next);
        })
        .catch(() => {});
    };
    window.addEventListener("yokkai:folders-updated", refreshFolders);
    return () => {
      active = false;
      window.removeEventListener("yokkai:folders-updated", refreshFolders);
    };
  }, [reloadCollection]);
  async function addFolder(name: string) {
    const folder = await createFolder(name);
    setFolders(current =>
      [...current, folder].sort((a, b) => a.name.localeCompare(b.name, "fr"))
    );
  }
  async function removeFolder(folderId: string) {
    await deleteFolder(folderId);
    const [nextFolders] = await Promise.all([getFolders(), reloadCollection()]);
    setFolders(nextFolders);
  }
  async function moveCard(instanceId: string, folderId: string | null) {
    if (previewData)
      throw new Error("This action is unavailable in the simulation.");
    await moveCardToFolder(instanceId, folderId);
    await reloadCollection();
    setFolders(await getFolders());
  }
  async function moveCards(instanceIds: string[], folderId: string | null) {
    await moveCardsToFolder(instanceIds, folderId);
    await reloadCollection();
    setFolders(await getFolders());
  }
  async function lockCard(instanceId: string, locked: boolean) {
    if (previewData)
      throw new Error("This action is unavailable in the simulation.");
    await setCollectionCardLocked(instanceId, locked);
    await reloadCollection();
  }
  async function auctionCard(
    instanceId: string,
    price: number,
    duration: number
  ) {
    if (previewData)
      throw new Error("This action is unavailable in the simulation.");
    await createAuction(instanceId, price, duration);
    const [, auctions] = await Promise.all([
      reloadCollection(),
      getActiveAuctionCards()
    ]);
    setActiveAuctionCards(auctions);
  }
  async function customizeCard(instanceId: string, imageUrl: string | null) {
    if (previewData)
      throw new Error("This action is unavailable in the simulation.");
    await setCardCustomImage(instanceId, imageUrl);
    await reloadCollection();
  }
  const revealCard = useCallback(
    (index: number) =>
      setRevealed(current => (current === index ? current + 1 : current)),
    []
  );
  const countdown = packCountdown(status?.nextPackAt, now);
  const decisionSeconds = decisionStatus?.nextPackAt
    ? Math.max(0, Math.ceil((decisionStatus.nextPackAt - now) / 1000))
    : 0;
  const decisionCountdown = `${Math.floor(decisionSeconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((decisionSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(decisionSeconds % 60).toString().padStart(2, "0")}`;
  const collectionHeading = (
    <div>
      <p className="eyebrow">{tg("everyCardYouOwn")}</p>
      <h1 className="yk-title mt-3">{tg("collection")}</h1>
    </div>
  );
  return (
    <div
      className={view === "packs" ? "flex min-h-dvh w-full flex-col" : "w-full"}
    >
      {!previewData && (
        <Topbar
          view={view}
          account={account}
          name={info?.user.name}
          karas={info?.karasBalance}
          collection={collection}
          infoError={loadErrors.info}
          onRetryInfo={() => retries.current.info?.()}
        />
      )}
      <main
        id="main-content"
        className={`yk-game-main mx-auto px-6 ${view === "collection" ? "max-w-[var(--layout-collection-max)] py-6" : "w-full max-w-6xl flex-1 py-10"}`}
      >
        {view === "packs" && (
          <header className="yk-pack-page-heading">
            <h1 className="yk-title mt-3">{tg("yourNextGreatPull")}</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-ink-2">
              {tg("newYokkaiNewStoriesAlwaysSomethingToDiscover")}
            </p>
          </header>
        )}
        {error && (
          <p
            role="alert"
            className="my-6 rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger-ink"
          >
            {tError(gameErrorKey(error))}
          </p>
        )}
        {Object.entries(loadErrors)
          .filter(
            ([key, message]) =>
              message &&
              ![
                "regular",
                "decision",
                "info",
                ...(view === "collection" ? ["collection"] : [])
              ].includes(key)
          )
          .map(([key, message]) => (
            <p key={key} role="alert" className="my-4 text-sm text-danger-ink">
              {key === "collection"
                ? tg("collection")
                : key === "folders"
                  ? tg("folders")
                  : tg("auctions")}{" "}
              : {tError(gameErrorKey(message))}{" "}
              <button
                className="yk-button yk-button-secondary"
                onClick={() => retries.current[key]?.()}
              >
                {tg("tryAgain")}
              </button>
            </p>
          ))}
        {previewData && info && (
          <p data-proof="info">
            {info.user.name} · {info.karasBalance} Karas
          </p>
        )}
        {previewData && loadErrors.info && (
          <p data-proof="info-error" role="alert">
            {tError(gameErrorKey(loadErrors.info))}{" "}
            <button onClick={() => retries.current.info?.()}>
              {tg("tryAgain")}
            </button>
          </p>
        )}
        {view === "packs" && !status && !error && !loadErrors.regular && (
          <p role="status" className="mt-10">
            {tg("loading")}
          </p>
        )}
        {view === "packs" && (
          <Boosters
            clickToOpen
            onOpenMany={
              previewData ? undefined : count => open("regular", count)
            }
            status={status}
            statusError={loadErrors.regular}
            decisionError={loadErrors.decision}
            onRetryRegular={() => retries.current.regular?.()}
            onRetryDecision={() => retries.current.decision?.()}
            collectionReady={collectionReady}
            wishlist={wishlist}
            countdown={countdown}
            decisionStatus={decisionStatus}
            decisionCountdown={decisionCountdown}
            dropRates={info?.dropRates}
            decisionDropRates={info?.decisionDropRates}
            shinyRate={info?.shinyRate}
            busy={busy}
            draw={draw}
            drawKind={drawKind}
            collection={collection}
            folders={folders}
            revealed={revealed}
            onOpen={
              previewData
                ? async kind => {
                    const cards: CollectedCard[] = [
                      {
                        id: "proof-card",
                        instanceId: "proof-instance",
                        name: "Carte de preuve",
                        rarity: "C",
                        category: "Anime",
                        image: "/assets/booster-pack.png",
                        catalogueImage: "/assets/booster-pack.png",
                        customImageUrl: null,
                        obtainedAt: new Date().toISOString(),
                        shiny: false,
                        isEvolved: false,
                        isFirstOwner: true,
                        folderId: null
                      }
                    ];
                    setDraw(cards);
                    setDrawKind(kind);
                    setRevealed(0);
                    return cards;
                  }
                : open
            }
            onKeepDecision={previewData ? async () => 0 : keepDecision}
            onSellDecisionAll={previewData ? undefined : discardDecision}
            onDiscard={previewData ? async () => {} : discard}
            onDiscardMany={
              previewData ? async () => {} : discardCollectionCards
            }
            onAuction={auctionCard}
            onMoveCard={moveCard}
            onSetLocked={lockCard}
            onEvolve={evolve}
            onSetCustomImage={customizeCard}
            onReveal={revealCard}
            onSound={sound.play}
            onStopSound={sound.stopCardSounds}
          />
        )}

        {view === "collection" && (
          <CollectionView
            pageHeading={collectionHeading}
            cards={serverPages ? [] : renderedCollection}
            loading={
              pagesMode === "probing" || (!serverPages && !collectionReady)
            }
            pages={
              serverPages
                ? { adapter: liveCollectionPages, version: pagesVersion }
                : undefined
            }
            loadError={loadErrors.collection}
            onRetryLoad={() => retries.current.collection?.()}
            categories={info?.categories || []}
            loadPaniniAlbums={getPaniniAlbumsPage}
            loadPaniniAlbumCards={getPaniniAlbumCardsPage}
            onSetPaniniAlbumFavorite={setPaniniAlbumFavorite}
            presentation={Object.fromEntries(
              activeAuctionCards.map(auction => [
                auction.instanceId,
                {
                  frozen: { remaining: auction.endsAt },
                  auctionId: auction.auctionId
                }
              ])
            )}
            folders={folders}
            onCreateFolder={addFolder}
            onDeleteFolder={removeFolder}
            onMoveCard={moveCard}
            onMoveCards={moveCards}
            onSetLocked={lockCard}
            onCreateAuction={auctionCard}
            onEvolve={evolve}
            onSetCustomImage={customizeCard}
            onDiscard={discardCollectionCard}
            onDiscardMany={discardCollectionCards}
          />
        )}
      </main>
      <SiteFooter
        note={tg("yourCollectionIsSavedToYourAccount")}
        discordEnabled={discordEnabled}
      />
    </div>
  );
}
