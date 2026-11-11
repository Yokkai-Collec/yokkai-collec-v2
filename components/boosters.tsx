"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations, useFormatter } from "next-intl";
import { cardRarityLabel } from "@/lib/ui/card-rarity-label";
import { ReferralReminder } from "@/components/referral-reminder";
import { AmbientGlow } from "@/components/ambient-glow";
import { packCopySnapshot, packCopyLabels, packRevealWindow, packRareRevealQueue } from "@/lib/ui/pack-opening";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  Card,
  CollectedCard,
  DecisionPackStatus,
  Folder,
  PackStatus,
  Rarity
} from "@/lib/data/cards";
import dynamic from "next/dynamic";
import { CardShareButton } from "@/components/card-sharing";
import {
  Button,
  Modal,
  SelectionBar,
  SelectionModeButton,
  StatusPill
} from "@/components/ui";
import { CardBack, YokaiCard } from "@/components/yokai-card";
import type { SfxName } from "@/hooks/use-sfx";
import { animation } from "@/lib/ui/animations";
import { runFinalBoosterOpening } from "@/lib/ui/pack-opening";

const PackBinderProgress = dynamic(
  () => import("@/components/pack-binder-progress").then(module => module.PackBinderProgress),
  { ssr: false }
);

const CollectionView = dynamic(
  () => import("@/components/collection").then(module => module.CollectionView),
  { loading: function LoadingCollection() { const tp = useTranslations("packs"); return <p role="status">{tp("loadingCollection")}</p>; } }
);

const DecisionCardModal = dynamic(() =>
  import("@/components/decision-card-modal").then(
    module => module.DecisionCardModal
  )
);

const CardCinematic = dynamic(
  () => import("@/components/card-cinematic").then(module => module.CardCinematic),
  { loading: function LoadingCinematic() { const tp = useTranslations("packs"); return <p role="status">{tp("loadingCinematic")}</p>; } }
);

const BoosterOpening = dynamic(
  () => import("@/components/booster-opening").then(module => module.BoosterOpening),
  { loading: function PreparingPack() { const tp = useTranslations("packs"); return <p role="status">{tp("preparingYourPack")}</p>; } }
);

// The pack art is a 941x1672 PNG (2-3 MB). Serve resized WebP variants for
// the picker; the original stays the src fallback.
const PACK_IMAGE_SIZES = "(max-width: 640px) 55vw, 340px";
const packSrcSet = (kind: "regular" | "decision") =>
  [384, 640, 828]
    .map(
      width =>
        `/_next/image?url=${encodeURIComponent(`/assets/chrome-${kind}-booster-v1.png`)}&w=${width}&q=85 ${width}w`
    )
    .join(", ");
export type RevealCard = Card & {
  instanceId: string;
  shiny?: boolean;
  isEvolved?: boolean;
  isNew?: boolean;
  copies?: number;
  wishlisted?: boolean;
  discarded?: boolean;
  destructionValue?: number;
  locked?: boolean;
};
const isDuplicate = (card: RevealCard) => !card.isNew && !!card.copies && card.copies > 1;
function DropBadges({ card, iconsOnly = false, favorite = false }: { card: RevealCard; iconsOnly?: boolean; favorite?: boolean }) {
  const tp = useTranslations("packs");
  if (!card.wishlisted && !isDuplicate(card) && !favorite) return null;
  return (
    <span className={iconsOnly ? "yk-drop-card-icons" : "yk-drop-badges yk-drop-badges-labels"} aria-hidden="true">
      {favorite && !iconsOnly && <span className="yk-drop-badge yk-drop-favorite">
        <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8">
          <path d="m12 2.8 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 16.83l-5.5 2.89 1.05-6.12L3.1 9.27l6.15-.9L12 2.8Z" />
        </svg>
        <span>{tp("favoriteCollection")}</span>
      </span>}
      {card.wishlisted && <span className="yk-drop-badge yk-drop-wishlist"><span>♥</span>{!iconsOnly && <span>{tp("inYourWishlist")}</span>}</span>}
      {isDuplicate(card) && <span className="yk-drop-badge yk-drop-duplicate">
        <svg className="yk-duplicate-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect className="yk-duplicate-back" x="3" y="2" width="12" height="16" rx="2.2" transform="rotate(-12 9 10)" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.6" />
          <g className="yk-duplicate-front" transform="rotate(8 14 13)">
            <rect x="8" y="5" width="12" height="16" rx="2.2" fill="var(--color-surface)" stroke="currentColor" strokeWidth="1.7" />
            <path d="m14 9 2.7 4-2.7 4-2.7-4Z" fill="currentColor" />
          </g>
        </svg>
        {!iconsOnly && <span>{tp("duplicate")}</span>}
      </span>}
    </span>
  );
}
type Sound = SfxName;
type DropRate = { rarity: Rarity; percent: number };
const DECISION_DROP_RATES: DropRate[] = [{ rarity: "SR", percent: 96.5 }, { rarity: "SSR", percent: 3 }, { rarity: "LR", percent: 0.5 }];
const noopSound = () => {};
type Decision = {
  onKeep: (instanceId: string) => Promise<number>;
  onSellAll?: () => Promise<number>;
  keptId?: string;
  soldAll?: boolean;
  busy?: boolean;
  karasReward?: number;
};

// Desktop overview tile width (card + frame); keep in sync with boosters.css.
const OVERVIEW_TILE_WIDTH = 150;

// Widest column count (down to half of max) that leaves the fewest empty
// slots, so every overview row is as long as the others.
function overviewColumns(count: number, max: number) {
  if (count <= max) return Math.max(1, count);
  let best = max;
  for (let columns = max; columns >= Math.ceil(max / 2); columns--) {
    const empty = (columns - (count % columns)) % columns;
    if (empty < (best - (count % best)) % best) best = columns;
  }
  return best;
}

export function BoosterReveal({
  previewOnly = false,
  packCount = 1,
  cards,
  collection = [],
  collectionReady = true,
  folders = [],
  revealed,
  onReveal,
  onReturn,
  onNext,
  nextDisabled = false,
  nextLabel,
  nextRemaining,
  decision,
  onDiscard,
  onDiscardMany,
  onAuction,
  onMoveCard,
  onSetLocked,
  onEvolve,
  onSetCustomImage,
  onComplete,
  onSound,
  onStopSound,
  loadBinderGains,
  loadFavoriteCards
}: {
  previewOnly?: boolean;
  packCount?: number;
  cards: RevealCard[];
  revealed: number;
  onReveal: (index: number) => void;
  collection?: CollectedCard[];
  collectionReady?: boolean;
  folders?: Folder[];
  onReturn: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  nextRemaining?: number;
  decision?: Decision;
  onDiscard?: (instanceId: string) => Promise<void>;
  onDiscardMany?: (instanceIds: string[]) => Promise<void>;
  onAuction?: (
    instanceId: string,
    startingPrice: number,
    durationMinutes: number
  ) => Promise<void>;
  onMoveCard?: (instanceId: string, folderId: string | null) => Promise<void>;
  onSetLocked?: (instanceId: string, locked: boolean) => Promise<void>;
  onEvolve?: (instanceIds: string[]) => Promise<CollectedCard>;
  onSetCustomImage?: (
    instanceId: string,
    imageUrl: string | null
  ) => Promise<void>;
  onComplete?: () => void;
  onSound?: (sound: Sound) => void;
  onStopSound?: () => void;
  loadBinderGains?: typeof import("@/lib/data/binder-discovery").getPackBinderGains;
  loadFavoriteCards?: (ids: readonly string[], signal: AbortSignal) => Promise<readonly string[]>;
}) {
  const tError = useTranslations();
  const tp = useTranslations("packs");
  const format = useFormatter();
  const t = useTranslations("boosters.decision");
  const localPreview = process.env.NODE_ENV === "development" && previewOnly;
  const [faceUp, setFaceUp] = useState(false);
  const [revealLocked, setRevealLocked] = useState(false);
  const [spot, setSpot] = useState<RevealCard | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sellAllConfirm, setSellAllConfirm] = useState(false);
  const [sellingAll, setSellingAll] = useState(false);
  const [discarded, setDiscarded] = useState(
    () =>
      new Set(cards.filter(card => card.discarded).map(card => card.instanceId))
  );
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState(() => new Set<string>());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkDiscarding, setBulkDiscarding] = useState(false);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [discardCandidate, setDiscardCandidate] = useState<RevealCard | null>(
    null
  );
  const [locked, setLocked] = useState(
    () =>
      new Set(cards.filter(card => card.locked).map(card => card.instanceId))
  );
  const [detailCard, setDetailCard] = useState<RevealCard | null>(null);
  const [decisionCard, setDecisionCard] = useState<RevealCard | null>(null);
  const [auctioned, setAuctioned] = useState(() => new Set<string>());
  const [batchReview, setBatchReview] = useState<{ at: number; page: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [inspected, setInspected] = useState<RevealCard | null>(null);
  const [batchRevealed, setBatchRevealed] = useState<Set<number> | null>(null);
  const [sequencing, setSequencing] = useState(false);
  const [favoriteCards, setFavoriteCards] = useState<{ opening: string; ids: readonly string[] } | null>(null);
  const favoriteOpening = cards.map(card => card.instanceId).join(",");
  const favoriteQuery = JSON.stringify([...new Set(cards.map(card => card.id))].sort());
  useEffect(() => {
    if (!favoriteOpening || (previewOnly && !loadFavoriteCards)) return;
    const controller = new AbortController();
    let active = true;
    const ids: string[] = JSON.parse(favoriteQuery);
    const load = loadFavoriteCards
      ? loadFavoriteCards(ids, controller.signal)
      : import("@/lib/data/pack-favorites").then(module => module.getPackFavoriteCardIds(ids, controller.signal));
    void load.then(matches => {
      if (active) setFavoriteCards({ opening: favoriteOpening, ids: matches });
    }).catch(() => {
      // Optional presentation only: a failed lookup cannot interrupt a pack or retry a reward.
    });
    return () => { active = false; controller.abort(); };
  }, [favoriteOpening, favoriteQuery, previewOnly, loadFavoriteCards]);
  const rareQueue = useRef<number[]>([]);
  const batchCommitted = useRef(false);
  const keepLock = useRef(false);
  const sellAllLock = useRef(false);
  const revealTimer = useRef<number | null>(null);
  const next = useRef<HTMLButtonElement>(null);
  const completeLink = useRef<HTMLAnchorElement>(null);
  const nextBooster = useRef<HTMLButtonElement>(null);
  const revealAllLock = useRef(false);
  const bulkActionLock = useRef(false);
  const current = cards[revealed];
  const done = revealed >= cards.length && !sequencing;
  const revealedCount = batchRevealed?.size ?? revealed;
  // Summary counts only the cards that stay in the collection (not destroyed, not lost in a Decision Pack).
  const keptCards = cards.filter(
    c =>
      !discarded.has(c.instanceId) &&
      !decision?.soldAll &&
      (!decision?.keptId || decision.keptId === c.instanceId)
  );
  const visibleCards = decision
    ? cards
    : cards.filter(card => !discarded.has(card.instanceId));
  const batch = !decision && packCount > 1 && cards.length > 5;
  // Batches end on the full overview, whether revealed all at once or one by one.
  const overview = batch && (showAll || done);
  const overviewGrid = useRef<HTMLOListElement>(null);
  const [overviewFit, setOverviewFit] = useState<number | null>(null);
  const overviewCards = overview && !sequencing ? [...visibleCards].sort((a, b) => {
    const priority = { LR: 4, SSR: 3, SR: 2, R: 1, C: 0 };
    return priority[b.rarity] - priority[a.rarity];
  }) : visibleCards;
  const batchWindow = batch && !overview
    ? packRevealWindow(cards.length, revealed, batchReview?.at === revealed ? batchReview.page : undefined)
    : { page: 0, pages: 1, latest: 0, start: 0, end: cards.length };
  const selectedCards = cards.filter(
    card =>
      selection.has(card.instanceId) &&
      !discarded.has(card.instanceId) &&
      !auctioned.has(card.instanceId) &&
      !locked.has(card.instanceId)
  );
  const selectedValue =
    selectedCards.length &&
    selectedCards.every(card => card.destructionValue != null)
      ? selectedCards.reduce((sum, card) => sum + card.destructionValue!, 0)
      : undefined;
  const choosing =
    !!decision && done && !decision.keptId && !decision.soldAll;
  const chosen = cards.find(
    c => c.instanceId === pick && !discarded.has(c.instanceId)
  );
  const liveDetailCard = detailCard
    ? (collection.find(card => card.instanceId === detailCard.instanceId) ??
      (detailCard as CollectedCard))
    : null;
  const sourceDetailCards = liveDetailCard
    ? collection.some(card => card.instanceId === liveDetailCard.instanceId)
      ? collection
      : [...collection, liveDetailCard]
    : collection;
  const detailCards = sourceDetailCards.filter(card => !discarded.has(card.instanceId)).map(card => ({ ...card, locked: locked.has(card.instanceId) || !!card.locked }));
  const decisionReward = (keptId: string) => {
    const lost = cards.filter(
      card => card.instanceId !== keptId && !discarded.has(card.instanceId)
    );
    return lost.every(card => card.destructionValue != null)
      ? lost.reduce((sum, card) => sum + card.destructionValue!, 0)
      : undefined;
  };
  const sellableDecisionCards = cards.filter(
    card => !discarded.has(card.instanceId)
  );
  const sellAllReward = sellableDecisionCards.every(
    card => card.destructionValue != null
  )
    ? sellableDecisionCards.reduce(
        (sum, card) => sum + card.destructionValue!,
        0
      )
    : undefined;
  const deposit = useCallback(() => {
    if (revealTimer.current) window.clearTimeout(revealTimer.current);
    revealTimer.current = null;
    setRevealLocked(false);
    onSound?.("slide");
    setFaceUp(false);
    onReveal(revealed);
  }, [onReveal, onSound, revealed]);
  useEffect(() => () => onStopSound?.(), [onStopSound]);
  // Desktop overview: as many fixed-size tiles per row as the panel fits.
  useEffect(() => {
    const grid = overviewGrid.current;
    if (!overview || !grid || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const style = getComputedStyle(grid);
      const gap = parseFloat(style.columnGap) || 0;
      const width =
        grid.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      setOverviewFit(
        Math.max(1, Math.floor((width + gap) / (OVERVIEW_TILE_WIDTH + gap)))
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [overview]);
  useEffect(() => {
    if (!faceUp || spot || revealLocked) return;
    const timer = window.setTimeout(deposit, 1400);
    return () => clearTimeout(timer);
  }, [faceUp, spot, revealLocked, deposit]);
  useEffect(
    () => {
      batchCommitted.current = false;
      return () => {
        if (revealTimer.current) window.clearTimeout(revealTimer.current);
        rareQueue.current = [];
        batchCommitted.current = true;
      };
    },
    []
  );
  useEffect(() => {
    if (done && !choosing)
      (nextBooster.current && !nextBooster.current.disabled
        ? nextBooster.current
        : completeLink.current
      )?.focus({ preventScroll: true });
    else next.current?.focus({ preventScroll: true });
  }, [done, choosing]);
  function showRare(card: RevealCard) {
    onSound?.(card.rarity === "LR" ? "lr-reveal" : "ssr-reveal");
    setSpot(card);
  }
  function flip() {
    if (!current || revealAllLock.current) return;
    if (faceUp) {
      if (!revealLocked) deposit();
      return;
    }
    const isLR = current.rarity === "LR";
    const isSSR = current.rarity === "SSR";
    if (isLR || isSSR) {
      showRare(current);
      return;
    }
    setFaceUp(true);
    const revealDuration = current.rarity === "SR" ? 520 : 0;
    if (revealDuration) {
      setRevealLocked(true);
      revealTimer.current = window.setTimeout(() => {
        setRevealLocked(false);
        revealTimer.current = null;
      }, revealDuration);
    }
  }
  function finishBatch() {
    if (batchCommitted.current) return;
    batchCommitted.current = true;
    rareQueue.current = [];
    setSpot(null);
    setSequencing(false);
    setBatchRevealed(new Set(cards.map((_, index) => index)));
    // The parent counter accepts only consecutive indices. Commit once all visuals finish.
    for (let index = revealed; index < cards.length; index++) onReveal(index);
  }
  function finishRare(instanceId: string) {
    const index = rareQueue.current[0];
    if (index === undefined || cards[index].instanceId !== instanceId) return;
    rareQueue.current.shift();
    setBatchRevealed(current => new Set(current).add(index));
    if (!rareQueue.current.length) finishBatch();
    else showRare(cards[rareQueue.current[0]]);
  }
  function revealAll() {
    if (!batch || done || spot || revealAllLock.current) return;
    onStopSound?.();
    revealAllLock.current = true;
    if (revealTimer.current) window.clearTimeout(revealTimer.current);
    revealTimer.current = null;
    setRevealLocked(false);
    setFaceUp(false);
    setShowAll(true);
    rareQueue.current = packRareRevealQueue(cards, revealed + (faceUp ? 1 : 0));
    const pending = new Set(rareQueue.current);
    setBatchRevealed(new Set(cards.flatMap((_, index) => pending.has(index) ? [] : [index])));
    if (!rareQueue.current.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishBatch();
      return;
    }
    setSequencing(true);
    showRare(cards[rareQueue.current[0]]);
  }
  async function keep() {
    if (!chosen || !decision || keepLock.current) return;
    keepLock.current = true;
    setConfirming(true);
    setError("");
    try {
      await decision.onKeep(chosen.instanceId);
      setConfirm(false);
    } catch (e) {
      setError(
        e instanceof Error ? gameErrorKey(e) : "packs.couldntConfirmThisChoice"
      );
    } finally {
      keepLock.current = false;
      setConfirming(false);
    }
  }
  async function sellAll() {
    if (!decision?.onSellAll || sellAllLock.current) return;
    sellAllLock.current = true;
    setSellingAll(true);
    setError("");
    try {
      await decision.onSellAll();
      setDiscarded(new Set(cards.map(card => card.instanceId)));
      setSellAllConfirm(false);
    } catch (e) {
      setError(
        e instanceof Error ? gameErrorKey(e) : "packs.couldntSellTheseCards"
      );
    } finally {
      sellAllLock.current = false;
      setSellingAll(false);
    }
  }
  function toggleSelection(instanceId: string) {
    if (bulkActionLock.current || locked.has(instanceId) || auctioned.has(instanceId) || discarded.has(instanceId)) return;
    setSelection(current => {
      const next = new Set(current);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  }
  async function discard(instanceId: string) {
    if (!onDiscard || discarding || discarded.has(instanceId)) return;
    setDiscarding(instanceId);
    setError("");
    try {
      await onDiscard(instanceId);
      setDiscarded(current => new Set(current).add(instanceId));
      setDiscardCandidate(null);
      setDetailCard(null);
    } catch (e) {
      setError(e instanceof Error ? gameErrorKey(e) : "collectionUi.couldntDestroyThisCard");
    } finally {
      setDiscarding(null);
    }
  }
  async function discardSelection() {
    if (
      (!onDiscardMany && !onDiscard) ||
      !selectedCards.length ||
      bulkDiscarding ||
      bulkActionLock.current
    )
      return;
    bulkActionLock.current = true;
    const destroyingAll = selectedCards.length === visibleCards.length;
    const selectedIds = selectedCards.map(card => card.instanceId);
    setBulkDiscarding(true);
    setError("");
    try {
      if (onDiscardMany) {
        await onDiscardMany(selectedIds);
        setDiscarded(current => new Set([...current, ...selectedIds]));
        setSelection(current => {
          const next = new Set(current);
          for (const instanceId of selectedIds) next.delete(instanceId);
          return next;
        });
      } else if (onDiscard) {
        for (const instanceId of selectedIds) {
          await onDiscard(instanceId);
          setDiscarded(current => new Set(current).add(instanceId));
          setSelection(current => {
            const next = new Set(current);
            next.delete(instanceId);
            return next;
          });
        }
      }
      setBulkConfirm(false);
      setSelecting(false);
      if (destroyingAll) onReturn();
    } catch (e) {
      setError(
        e instanceof Error ? gameErrorKey(e) : "collectionUi.couldntDestroyTheSelectedCards"
      );
    } finally {
      bulkActionLock.current = false;
      setBulkDiscarding(false);
    }
  }
  async function auction(instanceId: string, price: number, duration: number) {
    if (!onAuction) return;
    await onAuction(instanceId, price, duration);
    setAuctioned(current => new Set(current).add(instanceId));
    setSelection(current => {
      const next = new Set(current);
      next.delete(instanceId);
      return next;
    });
  }
  async function lock(instanceId: string, next: boolean) {
    if (!onSetLocked) return;
    await onSetLocked(instanceId, next);
    setLocked(current => {
      const updated = new Set(current);
      if (next) updated.add(instanceId);
      else updated.delete(instanceId);
      return updated;
    });
    setSelection(current => {
      const updated = new Set(current);
      if (next) updated.delete(instanceId);
      return updated;
    });
  }
  return (
    <>
    <section
      onTransitionEnd={event => {
        if (faceUp && current && ["C", "R", "SR"].includes(current.rarity) && (event.target as HTMLElement).matches(".yk-flip") && event.propertyName === "transform")
          onSound?.(current.rarity === "SR" ? "sr" : current.rarity === "R" ? "rare" : "common");
      }}
      aria-label={tp("packCards")}
      data-pack-kind={decision ? "decision" : "regular"}
      data-reveal-state={done ? "complete" : "revealing"}
      className={`yk-reveal-screen ${done && !choosing ? "yk-reveal-complete" : ""} ${batch ? "yk-reveal-batch" : ""} ${overview ? "yk-reveal-instant" : ""}`}
      style={overview ? {
        "--overview-rows-small": Math.max(1, Math.ceil(visibleCards.length / 5)),
        "--overview-columns-medium": overviewColumns(visibleCards.length, visibleCards.length > 25 ? 10 : 7),
        "--overview-rows-medium": Math.max(1, Math.ceil(visibleCards.length / overviewColumns(visibleCards.length, visibleCards.length > 25 ? 10 : 7))),
        "--overview-columns-wide": overviewColumns(visibleCards.length, visibleCards.length > 25 ? 13 : 10),
        "--overview-rows-wide": Math.max(1, Math.ceil(visibleCards.length / overviewColumns(visibleCards.length, visibleCards.length > 25 ? 13 : 10))),
        ...(overviewFit ? { "--overview-columns-fit": overviewFit } : {})
      } as CSSProperties : undefined}
    >
      <header className="yk-reveal-header">
        <div className="yk-reveal-copy">
          <p className={`eyebrow ${!done && !batch ? "sr-only" : ""}`}>
            {decision ? "Decision Pack" : packCount > 1 ? `${packCount} Regular Packs` : "Regular Pack"}
          </p>
          <h2 className={done || batch ? "mt-2 font-display text-2xl" : "sr-only"}>
            {decision
              ? choosing
                ? tp("makeYourChoice")
                : tp("oneChoice")
              : tp("revealYourCards")}
          </h2>
          <p
            role="status"
            aria-atomic="true"
            className="mt-2 text-sm text-ink-2"
          >
            {choosing
              ? tp("allCardsRevealedChooseOneToKeep")
              : done
                ? tp("revealedCount", { count: revealed })
                : batch ? tp("tapTheCardToRevealTheNextOne") : tp("tapToRevealProgress", { count: revealed, total: cards.length })}
          </p>
        </div>
        {overview && <p className="yk-batch-highlights" role="status">
          <span className="yk-batch-lr-count">✦ {keptCards.filter(card => card.rarity === "LR").length} LR</span>
          <span className="yk-batch-ssr-count">✦ {keptCards.filter(card => card.rarity === "SSR").length} SSR</span>
          <span>{visibleCards.length === cards.length ? tp("allCards", { count: cards.length }) : tp("remainingCards", { count: visibleCards.length })} </span>
          <span>{tp("selectACardForACloserLook")}</span>
        </p>}
        {(!localPreview || onDiscard) && done && !decision && visibleCards.length > 0 && (
          <SelectionModeButton
            active={selecting}
            inactiveLabel={tp("select")}
            activeLabel={tp("cancel")}
            className="yk-reveal-selection-mode"
            onClick={() => {
              if (bulkActionLock.current) return;
              setSelecting(current => !current);
              setSelection(new Set());
            }}
          />
        )}
        {batch ? <div className="yk-batch-progress">
          <p><strong>{format.number(revealedCount)}</strong> / {format.number(cards.length)} <span>{tp("cardsRevealed")}</span></p>
          <div role="progressbar" aria-label={tp("cardsRevealedText")} aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={revealedCount} className="yk-batch-meter">
            <span style={{ width: `${Math.min(100, revealed / cards.length * 100)}%` }} />
          </div>
        </div> : <ol className={`yk-reveal-progress ${packCount > 1 ? "yk-reveal-progress-batch" : ""}`} aria-hidden="true">
          {cards.map((card, i) => (
            <li
              key={card.instanceId}
              className={
                i < revealed
                  ? "yk-progress-done"
                  : i === revealed
                    ? "yk-progress-current"
                    : undefined
              }
            />
          ))}
        </ol>}
      </header>
    {!done && !spot && <div className={`yk-reveal-stage ${faceUp && current?.rarity === "SR" ? "yk-reveal-sr" : ""}`}>
      {faceUp && current?.rarity === "SR" && <div className="yk-sr-flash" aria-hidden="true" />}
      <div className="yk-deck">{cards.slice(revealed + 1).map((card, i, remaining) => <div className="yk-stacked-back" key={card.instanceId} style={{ transform: `translate(${(remaining.length-i)*3}px,${-(remaining.length-i)*4}px) rotate(${(remaining.length-i)*1.3}deg)`, filter: `brightness(${1-(remaining.length-i)*.045})` }}><CardBack /></div>)}
        <button type="button" ref={next} onClick={flip} aria-disabled={revealLocked} aria-label={revealLocked ? tp("revealingCard", { name: current.name }) : faceUp ? tp("placeCard", { name: current.name }) : tp("revealCard", { index: revealed + 1, total: cards.length })} className={`yk-deck-button ${faceUp ? "yk-face-up" : ""}`}><span className="yk-flip"><span className="yk-flip-back" aria-hidden="true"><CardBack /></span><span className="yk-flip-front" aria-hidden="true">{faceUp && <YokaiCard {...current} />}</span></span></button>
      </div>
      <p className="mt-8 text-center text-xs text-ink-3">{revealLocked ? tp("theEnergyIsBuilding") : faceUp ? tp("tapToPlaceTheCard") : tp("tapThePackToRevealACard")}</p>
    </div>}
    {choosing && <div className="yk-decision-banner"><p className="font-display text-lg text-karas">{tp(
  "chooseYourCard")}</p><p className="mt-1 text-sm text-ink-2">{tp(
  "decisionLossPrefix")}{cards.length - 1} {cards.length - 1 === 1 ? tp(
  "countPluralOneCardWillOtherCardsWill", { count: cards.length - 1 }) : tp(
  "countPluralOneCardWillOtherCardsWill", { count: cards.length - 1 })} {tp(
  "decisionLossSuffix", { count: cards.length - 1 })}</p></div>}
    <ol className={`yk-reveal-grid ${choosing ? "yk-reveal-grid-choosing" : ""}`} ref={overviewGrid} aria-label={overview ? tp("allBatchCards") : undefined}>
        {overviewCards.map((card, visibleIndex) => {
          const i = batch ? cards.indexOf(card) : visibleIndex;
          if (batch && (i < batchWindow.start || i >= batchWindow.end)) return null;
          const isDiscarded = discarded.has(card.instanceId);
          const lost =
            isDiscarded ||
            !!decision?.soldAll ||
            (!!decision?.keptId && decision.keptId !== card.instanceId);
          const kept = decision?.keptId === card.instanceId;
          const favorite = favoriteCards?.opening === favoriteOpening && favoriteCards.ids.includes(card.id);
          return (
            <li
              key={card.instanceId}
              style={{ "--slot-i": batch ? i - batchWindow.start : i } as CSSProperties}
              className={`yk-reveal-slot ${!overview ? "yk-reveal-slot-label-space" : ""}
                ${(batchRevealed?.has(i) ?? i < revealed) ? "yk-filled" : ""} ${i === revealed && !done ? "yk-slot-next" : ""} ${pick === card.instanceId && choosing ? "yk-picked" : ""} ${lost ? "yk-lost" : ""} ${kept ? "yk-kept" : ""}`}
              data-batch-rarity={overview ? card.rarity : undefined}
            >
              {(batchRevealed?.has(i) ?? i < revealed) ? (
                <>
              <button
                    type="button"
                    disabled={
                      !done ||
                      confirming ||
                      sellingAll ||
                      isDiscarded ||
                      (selecting && (auctioned.has(card.instanceId) || locked.has(card.instanceId))) ||
                      (!overview && !choosing && !selecting && !onAuction && !onSetLocked)
                    }
                    aria-pressed={
                      selecting ? selection.has(card.instanceId) : undefined
                    }
                    aria-describedby={favorite ? `pack-favorite-${card.instanceId}` : undefined}
                    aria-label={`${
                      choosing
                        ? tp("viewDetails", { name: card.name })
                        : selecting
                          ? tp("selectCard", { name: card.name, rarity: card.rarity })
                          : overview
                            ? tp("inspectCard", { name: card.name, rarity: card.rarity })
                          : onAuction || onSetLocked
                            ? tp("manageCard", { name: card.name })
                            : `${card.name}, ${card.rarity}`
                    }${tp("badgeSuffix", { wishlist: String(!!card.wishlisted), duplicate: String(isDuplicate(card)) })}`}
                    onClick={() =>
                      choosing
                        ? setDecisionCard(card)
                        : selecting
                          ? toggleSelection(card.instanceId)
                          : overview && localPreview && !onAuction && !onSetLocked ? setInspected(card) : setDetailCard(card)
                    }
                    className={`yk-reveal-card block w-full rounded-card text-left disabled:cursor-default ${selecting && selection.has(card.instanceId) ? "yk-selected-card" : ""}`}
                    style={
                      choosing && pick && pick !== card.instanceId
                        ? { opacity: 0.55 }
                        : undefined
                    }
                  >
                    <YokaiCard {...card} {...collection.find(owned => owned.instanceId === card.instanceId)}
                      categoryAccessory={card.wishlisted || isDuplicate(card) ? <DropBadges card={card} iconsOnly /> : undefined}
                      animated={overview ? false : undefined} />
                    <DropBadges card={card} favorite={favorite} />
                    {selecting && (
                      <span
                        className={`yk-selection-check ${selection.has(card.instanceId) ? "yk-checked" : ""}`}
                      >
                        {selection.has(card.instanceId) ? "✓" : ""}
                      </span>
                    )}
                    {lost && (
                      <span className="yk-lost-stamp">
                        {isDiscarded ? t("destroyed") : t("lost")}
                      </span>
                    )}
                  </button>
                  {favorite && <span className="sr-only" id={`pack-favorite-${card.instanceId}`}>{tp("favoriteCollection")}</span>}
                  {overview && (card.rarity === "SSR" || card.rarity === "LR") && <span className="yk-batch-rarity-label" title={card.rarity === "LR" ? tp("legendaryPull") : tp("exceptionalPull")}>✦ {card.rarity}</span>}
                  {overview && <span className="yk-batch-copy-label">{auctioned.has(card.instanceId) ? tp("listed") : locked.has(card.instanceId) ? tp("locked") : card.isNew ? tp("new") : card.copies && card.copies > 1 ? `×${card.copies}` : ""}</span>}
                  {done && !overview && <div className="yk-reveal-actions">
                    {auctioned.has(card.instanceId) ? (
                      <StatusPill tone="info">{tp("listed")}</StatusPill>
                    ) : kept ? (
                      <StatusPill>{t("kept")}</StatusPill>
                    ) : choosing ? (
                      <Button
                        variant={
                          pick === card.instanceId ? "primary" : "secondary"
                        }
                        disabled={decision.busy || confirming}
                        onClick={() => {
                          setPick(card.instanceId);
                          setConfirm(true);
                        }}
                        className="yk-slot-button"
                      >
                        {tp("keepThisOne")}</Button>
                    ) : !selecting && onDiscard ? (
                      <Button
                        variant="danger"
                        disabled={!!discarding}
                        onClick={() => setDiscardCandidate(card)}
                        className="yk-slot-button yk-reveal-discard"
                      >
                        {discarding === card.instanceId
                          ? tp("discarding")
                          : tp("discard")}
                      </Button>
                    ) : (
                      !selecting &&
                      (card.isNew ? (
                        <StatusPill>{tp("new")}</StatusPill>
                      ) : card.copies && card.copies > 1 ? (
                        <span className="text-[10px] text-ink-3">
                          {tp("duplicateText")}{card.copies}
                        </span>
                      ) : null)
                    )}
                  </div>}
                </>
              ) : (
                <span className="yk-slot-placeholder">
                  <span className="yk-slot-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="yk-slot-hint">
                    {i === revealed ? tp("next") : tp("pending")}
                  </span>
                </span>
              )}
              {!overview && !localPreview && done &&
                !choosing &&
                !lost &&
                !selecting &&
                !auctioned.has(card.instanceId) &&
                (card.rarity === "SSR" ||
                  card.rarity === "LR" ||
                  card.shiny) && (
                  <CardShareButton
                    instanceId={card.instanceId}
                    name={card.name}
                  />
                )}
            </li>
          );
        })}
      </ol>
      {choosing && decision.onSellAll && (
        <div className="yk-decision-sell-all">
          <Button
            variant="danger"
            disabled={decision.busy || confirming || sellingAll}
            onClick={() => {
              setError("");
              setSellAllConfirm(true);
            }}
          >
            {tp("sellAllCards")}</Button>
          {sellAllReward != null && (
            <p>
              {tp("receivePrefix")}{format.number(sellAllReward)} {tp("sellAllRewardSuffix")}</p>
          )}
        </div>
      )}
      {batch && !done && <button type="button" className="yk-button yk-button-secondary yk-reveal-all" disabled={sequencing || !!spot || undefined} onClick={revealAll}>{tp("revealAll")}</button>}
      {batch && !overview && <nav className="yk-batch-pagination" aria-label={tp("batchCardGroups")}>
        <button type="button" aria-label={tp("previousFiveCards")} disabled={batchWindow.page === 0} onClick={() => setBatchReview({ at: revealed, page: batchWindow.page - 1 })}>{tp("previous")}</button>
        <div aria-live="polite">
          <strong>{tp("cardsHeading")}{batchWindow.start + 1}–{batchWindow.end}</strong>
          <span>{tp("groupHeading")}{batchWindow.page + 1} {tp("ofFragment")}{batchWindow.pages}</span>
        </div>
        <button type="button" aria-label={tp("nextFiveCards")} disabled={batchWindow.page >= batchWindow.latest} onClick={() => setBatchReview({ at: revealed, page: batchWindow.page + 1 })}>{tp("nextText")}</button>
      </nav>}
      {batch && done && !visibleCards.some(card => { const i = cards.indexOf(card); return i >= batchWindow.start && i < batchWindow.end; }) && <p className="yk-batch-empty" role="status">{tp("allCardsInThisGroupHaveBeenDiscarded")}</p>}
      {selecting && (
        <SelectionBar
          count={selectedCards.length}
          value={selectedValue}
          busy={bulkDiscarding}
          error={error}
          onAll={() =>
            setSelection(
              new Set(
                visibleCards
                  .filter(
                    card =>
                      !auctioned.has(card.instanceId) &&
                      !locked.has(card.instanceId)
                  )
                  .map(card => card.instanceId)
              )
            )
          }
          onNone={() => setSelection(new Set())}
          onDestroy={() => setBulkConfirm(true)}
          onClose={() => {
            setSelecting(false);
            setSelection(new Set());
            setError("");
          }}
        />
      )}
      {error && (
        <p role="alert" className="mt-5 text-center text-sm text-danger">
          {tError(gameErrorKey(error))}
        </p>
      )}
      {done && !choosing && (
        <div
          className={`yk-reveal-summary ${decision ? "yk-reveal-summary-decision" : ""}`}
        >
          <h2 className="mb-5 font-display text-2xl">
            {decision?.soldAll
              ? tp("soldSummary", { amount: format.number(decision.karasReward ?? 0) })
              : decision
              ? tp("keptSummary", { amount: format.number(decision.karasReward ?? 0) })
              : tp("summonComplete")}
          </h2>
          {cards.every(c => c.isNew !== undefined) && (
            <p className="mb-5 text-sm text-ink-2">
              {format.number(keptCards.filter(c => c.isNew).length)}{" "}
              {keptCards.filter(c => c.isNew).length === 1
                ? tp("countPluralOneNewCardOtherNewCards", { count: keptCards.filter(c => c.isNew).length })
                : tp("countPluralOneNewCardOtherNewCards", { count: keptCards.filter(c => c.isNew).length })}
            </p>
          )}
          {(!localPreview || loadBinderGains) && !decision?.soldAll && <PackBinderProgress cards={keptCards.filter(card => card.isNew === true)} load={loadBinderGains} />}
          <div className="yk-reveal-navigation flex flex-wrap justify-center gap-3">
            {onNext && !overview && (
              <span className="yk-reveal-next">
                <button
                  type="button"
                  ref={nextBooster}
                  disabled={nextDisabled}
                  onClick={onNext}
                  className="yk-button yk-button-primary"
                >
                  {nextLabel ?? tp("nextPack")}
                  {!!nextRemaining && (
                    <span className="font-normal">
                      {tp("remainingSuffix", { count: nextRemaining })}
                    </span>
                  )}
                </button>
              </span>
            )}
            {onComplete ? (
              <Button
                variant={onNext ? "secondary" : "primary"}
                onClick={onComplete}
              >
                {decision ? tp("viewMyCollection") : tp("continue")}
              </Button>
            ) : (
              <Link
                ref={completeLink}
                href="/collection"
                className={`yk-button ${onNext ? "yk-button-secondary" : "yk-button-primary"}`}
              >
                {tp("viewMyCollection")}</Link>
            )}
            <Button variant="secondary" onClick={onReturn}>
              {tp("backToPacks")}</Button>
          </div>
        </div>
      )}
      <Modal open={!!inspected} onClose={() => setInspected(null)} title={inspected?.name ?? tp("cardPreview")} className="yk-batch-inspection">
        {inspected && <div className="yk-batch-card-preview">
          <YokaiCard {...inspected} animated={false} />
          <p>{cardRarityLabel(inspected.rarity, inspected.shiny, inspected.isEvolved)}{inspected.anime ? ` · ${inspected.anime}` : ""}</p>
          {inspected.isNew ? <StatusPill>{tp("new")}</StatusPill> : inspected.copies && inspected.copies > 1 ? <p>{tp("duplicateText")}{inspected.copies}</p> : null}
          <Button variant="secondary" onClick={() => setInspected(null)}>{tp("backToResults")}</Button>
        </div>}
      </Modal>
      <Modal
        open={sellAllConfirm}
        onClose={() => {
          if (!sellingAll) setSellAllConfirm(false);
        }}
        title={tp("sellAllCardsText")}
      >
        <p className="text-center text-sm leading-6 text-ink-2">
          {tp("noneOfTheseCardsWillJoinYourCollection")}{sellAllReward != null && (
            <>
              {" "}
              {tp("youllReceive")}{" "}
              <strong className="text-karas">
                {format.number(sellAllReward)} Karas
              </strong>
              .
            </>
          )}
        </p>
        <p className="mt-2 text-center text-xs text-ink-3">
          {tp("thisChoiceIsFinal")}</p>
        {error && (
          <p role="alert" className="mt-4 text-center text-sm text-danger">
            {tError(gameErrorKey(error))}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button
            variant="secondary"
            disabled={sellingAll}
            onClick={() => setSellAllConfirm(false)}
          >
            {tp("backToChoices")}</Button>
          <Button
            variant="danger"
            disabled={sellingAll || sellAllReward == null}
            aria-busy={sellingAll || undefined}
            onClick={() => void sellAll()}
          >
            {sellingAll ? tp("selling") : tp("sellAllCards")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={confirm}
        onClose={() => {
          if (!confirming) setConfirm(false);
        }}
        title={tp("keepNamedCard", { name: chosen?.name || tp("thisCard") })}
      >
        {chosen && (
          <>
            <div className="mx-auto w-40">
              <YokaiCard {...chosen} />
            </div>
            <p className="mt-6 text-center font-semibold text-ink">
              {tp("keepLossPrefix")}{cards.length - 1}{" "}
              {cards.length - 1 === 1 ? tp("countPluralOneCardOtherCards", { count: cards.length - 1 }) : tp("countPluralOneCardOtherCards", { count: cards.length - 1 })}?
            </p>
            {decisionReward(chosen.instanceId) != null && (
              <p className="mt-2 text-center text-sm text-karas">
                +{format.number(decisionReward(chosen.instanceId)!)}{"  "}
                {tp("karasFromTheCardsYouDidntKeep")}</p>
            )}
            <p className="mb-6 mt-2 text-center text-xs text-ink-3">
              {tp("thisChoiceIsFinal")}</p>
            {error && (
              <p role="alert" className="mb-4 text-center text-danger">
                {tError(gameErrorKey(error))}
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                variant="secondary"
                disabled={confirming}
                onClick={() => setConfirm(false)}
              >
                {tp("backToChoices")}</Button>
              <Button
                disabled={decision?.busy || confirming}
                aria-busy={confirming || undefined}
                onClick={keep}
              >
                {confirming ? tp("confirming") : tp("keepThisCard")}
              </Button>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={!!discardCandidate}
        onClose={() => {
          if (!discarding) setDiscardCandidate(null);
        }}
        title={tp("discardThisCard")}
      >
        {discardCandidate && (
          <>
            <div className="mx-auto w-32">
              <YokaiCard {...discardCandidate} />
            </div>
            <p className="mb-6 mt-5 text-center text-sm text-ink-2">
              {discardCandidate.name}{"  "}{tp("willBeRemovedFromYourCollection")}{discardCandidate.destructionValue != null && (
                <>
                  {"  "}
                  {tp("youllReceive")}{" "}
                  <strong className="text-karas">
                    {format.number(discardCandidate.destructionValue)}{" "}
                    Karas
                  </strong>
                  .
                </>
              )}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                variant="secondary"
                disabled={!!discarding}
                onClick={() => setDiscardCandidate(null)}
              >
                {tp("cancel")}</Button>
              <Button
                variant="danger"
                disabled={!!discarding}
                onClick={() => void discard(discardCandidate.instanceId)}
              >
                {discarding ? tp("discarding") : tp("discard")}
              </Button>
            </div>
          </>
        )}
      </Modal>
      {decisionCard && choosing && (
        <DecisionCardModal
          key={decisionCard.instanceId}
          card={decisionCard}
          ownedCopies={collectionReady ? collection.filter(owned => owned.id === decisionCard.id && !!owned.shiny === !!decisionCard.shiny && !owned.isEvolved && !cards.some(card => card.instanceId === owned.instanceId)).length : undefined}
          keepReward={decisionReward(decisionCard.instanceId)}
          disabled={decision?.busy || confirming}
          onClose={() => setDecisionCard(null)}
          onChoose={() => {
            setPick(decisionCard.instanceId);
            setDecisionCard(null);
            setConfirm(true);
          }}
        />
      )}
      {detailCard && (
        <CollectionView
          key={detailCard.instanceId}
          cards={detailCards}
          previewOnly={localPreview}
          presentation={Object.fromEntries([...auctioned].map(id => [id, { frozen: { remaining: tp("listedText") } }]))}
          categories={[]}
          folders={folders}
          detailOnly
          initialSelectedId={detailCard.instanceId}
          onDetailClose={() => setDetailCard(null)}
          onMoveCard={onMoveCard}
          onCreateAuction={auction}
          onSetLocked={lock}
          onEvolve={onEvolve}
          onSetCustomImage={onSetCustomImage}
          onDiscard={onDiscard}
          onCardsRemoved={ids => {
            setDiscarded(current => new Set([...current, ...ids]));
            setSelection(current => new Set([...current].filter(id => !ids.includes(id))));
          }}
        />
      )}
      <Modal
        open={bulkConfirm}
        onClose={() => {
          if (!bulkDiscarding) setBulkConfirm(false);
        }}
        title={tp("destroySelectedCards")}
      >
        <p className="text-sm leading-6 text-ink-2">
          {tp("destroying")}{" "}
          <strong className="text-ink">
            {selectedCards.length}{"  "}{tp("card")}{selectedCards.length === 1 ? "" : "s"}
          </strong>{"  "}
          {tp("isPermanent")}{selectedValue != null && (
            <>
              {"  "}
              {tp("youllReceive")}{" "}
              <strong className="text-karas">
                {format.number(selectedValue)} Karas
              </strong>
              .
            </>
          )}
        </p>
        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {tError(gameErrorKey(error))}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            disabled={bulkDiscarding}
            onClick={() => setBulkConfirm(false)}
          >
            {tp("cancel")}</Button>
          <Button
            variant="danger"
            disabled={bulkDiscarding || selectedValue == null}
            onClick={() => void discardSelection()}
          >
            {bulkDiscarding ? tp("destroyingText") : tp("destroySelected")}
          </Button>
        </div>
      </Modal>
    </section>
      <Modal
        open={!!spot}
        onClose={() => { onStopSound?.(); if (sequencing) finishBatch(); else { setSpot(null); if (!done) setFaceUp(true); } }}
        title={spot?.shiny ? tp("raritySummon", { rarity: cardRarityLabel(spot.rarity, spot.shiny) }) : spot?.rarity === "SSR" ? tp("ssrSummon") : tp("legendarySummon")}
        className="yk-invocation yk-lr-file-modal"
      >
        {spot && <CardCinematic key={spot.instanceId} card={spot}
          autoAdvance={false}
          onRevealStart={() => onSound?.(spot.rarity === "LR" ? "lr" : "ssr")}
          onReplay={() => { onStopSound?.(); onSound?.(spot.rarity === "LR" ? "lr-reveal" : "ssr-reveal"); }}
          onContinue={() => {
            onStopSound?.();
            if (sequencing) finishRare(spot.instanceId);
            else { setSpot(null); if (!done) setFaceUp(true); }
          }}
        />}
      </Modal>
    </>
  );
}

export function Boosters({
  previewOnly = false,
  simulateActions = false,
  clickToOpen = false,
  statusError,
  decisionError,
  onRetryRegular,
  onRetryDecision,
  collectionReady = true,
  wishlist = null,
  status,
  countdown,
  decisionStatus,
  decisionCountdown,
  dropRates = [],
  decisionDropRates = DECISION_DROP_RATES,
  shinyRate = 1,
  busy,
  draw,
  drawKind,
  collection,
  folders = [],
  revealed,
  onOpen,
  onOpenMany,
  onKeepDecision,
  onSellDecisionAll,
  onDiscard,
  onDiscardMany,
  onAuction,
  onMoveCard,
  onSetLocked,
  onEvolve,
  onSetCustomImage,
  onReveal,
  onSound,
  onStopSound
}: {
  previewOnly?: boolean;
  simulateActions?: boolean;
  clickToOpen?: boolean;
  statusError?: string;
  decisionError?: string;
  onRetryRegular?: () => void;
  onRetryDecision?: () => void;
  collectionReady?: boolean;
  wishlist?: ReadonlySet<string> | null;
  status: PackStatus | null;
  countdown: string;
  decisionStatus: DecisionPackStatus | null;
  decisionCountdown: string;
  busy: boolean;
  dropRates?: DropRate[];
  decisionDropRates?: DropRate[];
  shinyRate?: number;
  draw: RevealCard[];
  drawKind: "regular" | "decision";
  collection: CollectedCard[];
  folders?: Folder[];
  revealed: number;
  onOpen: (kind: "regular" | "decision") => Promise<RevealCard[] | undefined>;
  onOpenMany?: (count: 1 | 5 | 10) => Promise<RevealCard[] | undefined>;
  onKeepDecision: (instanceId: string) => Promise<number>;
  onSellDecisionAll?: () => Promise<number>;
  onDiscard: (instanceId: string) => Promise<void>;
  onDiscardMany?: (instanceIds: string[]) => Promise<void>;
  onAuction?: (
    instanceId: string,
    startingPrice: number,
    durationMinutes: number
  ) => Promise<void>;
  onMoveCard?: (instanceId: string, folderId: string | null) => Promise<void>;
  onSetLocked?: (instanceId: string, locked: boolean) => Promise<void>;
  onEvolve?: (instanceIds: string[]) => Promise<CollectedCard>;
  onSetCustomImage?: (
    instanceId: string,
    imageUrl: string | null
  ) => Promise<void>;
  onReveal: (index: number) => void;
  onSound?: (sound: Sound) => void;
  onStopSound?: () => void;
}) {
  const tError = useTranslations();
  const tp = useTranslations("packs");
  const format = useFormatter();
  const localPreview = process.env.NODE_ENV === "development" && previewOnly;
  const [openingPhase, setOpeningPhase] = useState<"idle" | "tension" | "seal" | "fan">(
    "idle"
  );
  const [openingKind, setOpeningKind] = useState<"regular" | "decision">(
    "regular"
  );
  const [waiting, setWaiting] = useState(false);
  const [showDraw, setShowDraw] = useState(false);
  const [priorCopies, setPriorCopies] = useState<Record<string, number> | null>(
    null
  );
  const [priorWishlist, setPriorWishlist] = useState<ReadonlySet<string> | null>(
    null
  );
  const [keptId, setKeptId] = useState<string>();
  const [decisionSoldAll, setDecisionSoldAll] = useState(false);
  const [decisionKaras, setDecisionKaras] = useState<number>();
  const [ratesKind, setRatesKind] = useState<"regular" | "decision" | null>(
    null
  );
  const [ratesPinned, setRatesPinned] = useState(false);
  const [regularCount, setRegularCount] = useState<1 | 5 | 10>(1);
  const [activePackCount, setActivePackCount] = useState(1);
  const batchEnabled = !!onOpenMany;
  const selectedCount = batchEnabled && status && status.available >= regularCount ? regularCount : 1;
  const openingLock = useRef(false);
  const openingStage = useRef<HTMLDivElement>(null);
  const openingTrigger = useRef<HTMLElement | null>(null);
  const preloading = useRef<Promise<void>>(Promise.resolve());
  const finishOpening = useRef<(() => void) | null>(null);
  const openingAbort = useRef<AbortController | null>(null);
  const waitingTimer = useRef<number | undefined>(undefined);
  const preloadTimer = useRef<number | undefined>(undefined);
  const finishPreload = useRef<(() => void) | null>(null);
  const [tearRequested, setTearRequested] = useState(false);
  const openingClicked = useRef(false);
  const pendingOpeningSkips = useRef(0);
  const playSound = onSound ?? noopSound;
  function closeRates() {
    setRatesKind(null);
    setRatesPinned(false);
  }
  function showRates(kind: "regular" | "decision") {
    if (!ratesPinned) setRatesKind(kind);
  }
  function hideRates() {
    if (!ratesPinned) setRatesKind(null);
  }
  function toggleRates(kind: "regular" | "decision") {
    const shouldClose = ratesPinned && ratesKind === kind;
    setRatesKind(shouldClose ? null : kind);
    setRatesPinned(!shouldClose);
  }
  useEffect(() => {
    if (!ratesPinned) return;
    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest(".yk-pack-info-trigger")
      )
        return;
      setRatesKind(null);
      setRatesPinned(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [ratesPinned]);
  const speedUpSeal = () => {
    if (clickToOpen && !openingClicked.current) {
      openingClicked.current = true;
      setTearRequested(true);
      openingStage.current?.querySelector("iframe")?.contentWindow?.postMessage(
        { type: "yokkai-booster-open" }, "*"
      );
      return;
    }
    const player = openingStage.current?.querySelector("iframe");
    if (!player || player.dataset?.ready === "false") {
      pendingOpeningSkips.current = Math.min(2, pendingOpeningSkips.current + 1);
      return;
    }
    player.contentWindow?.postMessage(
      { type: "yokkai-booster-next-step" }, "*"
    );
  };
  function preload(cards: RevealCard[]) {
    const decoding = Promise.allSettled(
      cards.map(card => {
        const image = new Image();
        image.src = card.image;
        return image.decode();
      })
    );
    preloading.current = new Promise<void>(resolve => {
      finishPreload.current = resolve;
      preloadTimer.current = window.setTimeout(resolve, animation.packOpening.seal);
      void decoding.then(() => { window.clearTimeout(preloadTimer.current); resolve(); });
    });
  }
  function start(kind: "regular" | "decision", trigger?: HTMLElement) {
    if (openingLock.current) return;
    openingTrigger.current = trigger ?? (document.activeElement instanceof HTMLElement && document.activeElement.tabIndex >= 0 ? document.activeElement : null);
    openingLock.current = true;
    const controller = new AbortController();
    openingAbort.current = controller;
    const count = kind === "regular" ? selectedCount : 1;
    setActivePackCount(count);
    setOpeningKind(kind);
    setPriorCopies(packCopySnapshot(collection, collectionReady));
    setPriorWishlist(wishlist);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    setKeptId(undefined);
    setDecisionSoldAll(false);
    setDecisionKaras(undefined);
    setShowDraw(true);
    setWaiting(false);
    setTearRequested(false);
    openingClicked.current = false;
    pendingOpeningSkips.current = 0;
    setOpeningPhase("tension");
    waitingTimer.current = window.setTimeout(
      () => setWaiting(true),
      animation.packOpening.slowResponse
    );
      const finished = new Promise<void>(resolve => { finishOpening.current = resolve; });
      void runFinalBoosterOpening({
        open: count > 1 && onOpenMany ? () => onOpenMany(count) : () => onOpen(kind),
        finished,
        onResponse: cards => {
          if (controller.signal.aborted) return;
          clearTimeout(waitingTimer.current);
          setWaiting(false);
          if (cards?.length) preload(cards);
        },
        preload: () => reducedMotion ? Promise.resolve() : preloading.current
      }).then(
        success => {
          if (controller.signal.aborted) return;
          if (!success) setShowDraw(false);
          setOpeningPhase("idle");
        },
        () => { if (!controller.signal.aborted) { setShowDraw(false); setOpeningPhase("idle"); } }
      ).finally(() => {
        clearTimeout(waitingTimer.current);
        window.clearTimeout(preloadTimer.current);
        if (!controller.signal.aborted) setWaiting(false);
        finishOpening.current = null;
        openingLock.current = false;
      });
  }
  const revealCards = packCopyLabels(draw, priorCopies, priorWishlist);
  const revealing =
    showDraw && draw.length > 0 && openingPhase === "idle" && !busy;
  const opening = openingPhase !== "idle";
  useEffect(() => {
    const stage = openingStage.current;
    if (!opening || !stage) return;
    const trigger = openingTrigger.current;
    const main = stage.closest("main");
    const background: { element: HTMLElement; inert: boolean }[] = [];
    stage.focus({ preventScroll: true });
    for (
      let branch: HTMLElement = stage;
      branch.parentElement;
      branch = branch.parentElement
    ) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        const element = sibling;
        background.push({ element, inert: element.inert });
        element.inert = true;
      }
      if (branch.parentElement === document.body) break;
    }
    return () => {
      for (const { element, inert } of background) element.inert = inert;
      const target =
        trigger?.isConnected && !trigger.matches(":disabled")
          ? trigger
          : (main ?? document).querySelector<HTMLElement>(
              'button:not(:disabled), a[href], [tabindex="0"]'
            );
      target?.focus({ preventScroll: true });
    };
  }, [opening]);
  useEffect(() => {
    if (openingPhase === "seal")
      openingStage.current?.focus({ preventScroll: true });
  }, [openingPhase]);
  useEffect(() => () => {
    openingAbort.current?.abort();
    window.clearTimeout(waitingTimer.current);
    window.clearTimeout(preloadTimer.current);
    finishPreload.current?.();
    finishOpening.current?.();
  }, []);
  const shownRates = ratesKind === "decision" ? decisionDropRates : dropRates;
  const rateDetails = <>
        <p className="text-sm leading-6 text-ink-2">
          {ratesKind === "decision"
            ? tp("reveal5CardsAndChooseOneToKeep")
            : tp("openARegularPackAndAddAll5")}
        </p>
        <p className="mt-4 text-sm text-ink-2">
          {tp("chanceForEachCardRevealed")}</p>
        <dl className="yk-drop-rates">
          {shownRates.map(rate => (
            <div key={rate.rarity}>
              <dt>{rate.rarity}</dt>
              <dd>
                {format.number(rate.percent, {
                  maximumFractionDigits: 2
                })}
                %
              </dd>
            </div>
          ))}
        </dl>
        <p className="yk-drop-shiny">
          {tp("anLrCardThenHasA")}{" "}
          <strong>
            {format.number(shinyRate, { maximumFractionDigits: 2 })}%
          </strong>{"  "}
          {tp("chanceOfBeingShiny")}</p>

  </>;
  return (
    <>
      {opening ? (
        <div
          ref={openingStage}
          className="yk-opening-stage"
          role="button" tabIndex={0}
          aria-label={openingPhase === "fan" ? tp("clickTheFanToRevealCards") : clickToOpen && !tearRequested ? tp("tearOpenThePack") : clickToOpen ? tp("skipBoosterOpening") : tp("nextOpeningStep")}
          onPointerMove={event => {
            if (event.pointerType !== "mouse") return;
            const rect = event.currentTarget.getBoundingClientRect();
            event.currentTarget.querySelector("iframe")?.contentWindow?.postMessage({ type: "yokkai-booster-pointer", point: { x: event.clientX - rect.left, y: event.clientY - rect.top } }, "*");
          }}
          onPointerLeave={event => event.currentTarget.querySelector("iframe")?.contentWindow?.postMessage({ type: "yokkai-booster-pointer", point: null }, "*")}
          onClick={speedUpSeal}
          onMouseDown={event => {
            if (event.detail > 1) event.preventDefault();
          }}
          onKeyDown={event => {
            if (event.repeat) {
              event.preventDefault();
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
            } else if (event.key==="Enter"||event.key===" ") {
              event.preventDefault();
              speedUpSeal();
            }
          }}
        >
              <BoosterOpening
                kind={openingKind}
                onStarted={() => playSound("opening")}
                onHover={() => playSound("hover")}
                onFanReady={() => setOpeningPhase("fan")}
                onStopSound={onStopSound}
                openRequested={clickToOpen ? tearRequested : undefined}
                onReady={() => {
                  const player = openingStage.current?.querySelector("iframe")?.contentWindow;
                  if (clickToOpen && openingClicked.current) player?.postMessage({ type: "yokkai-booster-open" }, "*");
                  while (pendingOpeningSkips.current > 0) {
                    pendingOpeningSkips.current--;
                    player?.postMessage({ type: "yokkai-booster-next-step" }, "*");
                  }
                }}
                onComplete={() => finishOpening.current?.()}
                onTear={() => setOpeningPhase("seal")}
              />
              {activePackCount > 1 && <p className="yk-opening-batch-count">{activePackCount} Regular Packs · {activePackCount * 5} {tp("cardsSuffix")}</p>}
              {waiting && (!clickToOpen || tearRequested) && <p className="yk-opening-server-status" role="status">{tp("yourPackIsStillBeingPrepared")}</p>}
        </div>
      ) : revealing ? (
        <BoosterReveal
          packCount={drawKind === "regular" ? activePackCount : 1}
          previewOnly={localPreview}
          onComplete={localPreview ? () => setShowDraw(false) : undefined}
          key={draw[0].instanceId}
          cards={revealCards}
          collection={collection}
          collectionReady={collectionReady}
          folders={folders}
          revealed={revealed}
          onReveal={onReveal}
          onReturn={() => setShowDraw(false)}
          onNext={drawKind === "regular" ? () => start("regular") : undefined}
          nextDisabled={!status || status.available < selectedCount || busy}
          nextRemaining={status?.available}
          nextLabel={
            status?.available === 0 ? tp("nextIn", { time: countdown }) : selectedCount > 1 ? tp("nextPacks", { count: selectedCount }) : tp("nextPack")
          }
          onDiscard={(!localPreview || simulateActions) && drawKind === "regular" ? onDiscard : undefined}
          onDiscardMany={
            (!localPreview || simulateActions) && drawKind === "regular"
              ? onDiscardMany
              : undefined
          }
          onAuction={drawKind === "regular" ? onAuction : undefined}
          onMoveCard={drawKind === "regular" ? onMoveCard : undefined}
          onSetLocked={drawKind === "regular" ? onSetLocked : undefined}
          onEvolve={drawKind === "regular" ? onEvolve : undefined}
          onSetCustomImage={
            drawKind === "regular" ? onSetCustomImage : undefined
          }
          decision={
            drawKind === "decision"
              ? {
                  keptId,
                  soldAll: decisionSoldAll,
                  busy,
                  karasReward: decisionKaras,
                  onKeep: async id => {
                    const reward = await onKeepDecision(id);
                    setDecisionKaras(reward);
                    setKeptId(id);
                    return reward;
                  },
                  onSellAll: onSellDecisionAll
                    ? async () => {
                        const reward = await onSellDecisionAll();
                        setDecisionKaras(reward);
                        setDecisionSoldAll(true);
                        return reward;
                      }
                    : undefined
                }
              : undefined
          }
          onSound={playSound}
          onStopSound={onStopSound}
        />
      ) : (
        <div className="yk-pack-grid">
          <AmbientGlow />
          <article
            className="yk-pack-panel"
            data-unavailable={!status || status.available === 0}
          >
            <div className="yk-pack-art-stage">
              <span className="yk-pack-aura" aria-hidden="true" />
              <span className="yk-pack-floor" aria-hidden="true" />
              <div
                className="yk-pack-info-trigger"
                onMouseEnter={() => showRates("regular")}
                onMouseLeave={hideRates}
                onKeyDown={event => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    closeRates();
                  }
                }}
              >
<button
                type="button"
                className="yk-pack-info"
                aria-label={tp("viewRegularPackDropRates")}
                aria-expanded={ratesKind === "regular"}
                onClick={() => toggleRates("regular")}
                onFocus={() => showRates("regular")}
                onBlur={hideRates}
                aria-describedby={ratesKind === "regular" ? "regular-drop-rates" : undefined}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v6M12 7h.01" />
                </svg>
              </button>
{ratesKind === "regular" && <div id="regular-drop-rates" role="tooltip" className="yk-pack-info-popover">{rateDetails}</div>}
</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/chrome-regular-booster-v1.png" alt="Yokkai Collec’ Regular Pack"
                width={941}
                height={1672}
                className="yk-pack-image"
                srcSet={packSrcSet("regular")}
                sizes={PACK_IMAGE_SIZES}
              />
            </div>
            <div className="yk-pack-body">
              <h2 className="font-display text-[26px] font-semibold">
                Regular Pack
              </h2>
              <div className="yk-pack-status">
                {status ? (
                  <div className="yk-pack-reserve"
                    role="img"
                    aria-label={tp("reserveDescription", { count: status.reserve ?? status.available, maximum: status.maximum, bonus: status.bonus ?? 0 })}
                  >
                    <span className="yk-pack-dots" aria-hidden="true">
                      {Array.from({ length: status.maximum }, (_, index) => (
                        <span
                          key={index}
                          data-filled={index < (status.reserve ?? status.available)}
                        />
                      ))}
                    </span>
                    <span aria-hidden="true">
                      {status.reserve ?? status.available}/{status.maximum}
                      {status.bonus ? tp("bonusSuffix", { count: status.bonus }) : ""}
                    </span>
                  </div>
                ) : (
                  <p>{statusError ? tp("unavailable") : tp("loadingReserve")}</p>
                )}
                {status?.available !== 0 && (
                  <p className="yk-pack-timing">
                    {status
                      ? status.nextPackAt === null
                        ? tp("reserveFull")
                        : tp("nextIn", { time: countdown })
                      : tp("text5CardsPerPack")}
                    {status && status.available > 0 && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="text-success">{tp("availableNow")}</span>
                      </>
                    )}
                  </p>
                )}
              </div>
              {statusError && (
                <p role="alert" className="my-3 text-sm text-danger-ink">
                  {tError(gameErrorKey(statusError))}{" "}
                  <button
                    className="yk-button yk-button-secondary"
                    onClick={onRetryRegular}
                  >
                    {tp("tryAgain")}</button>
                </p>
              )}
              {batchEnabled && <div className="yk-pack-batch-picker">
                <div className="yk-pack-quantity" role="group" aria-label={tp("regularPackQuantity")}>
                  {([1, 5, 10] as const).map(count => <button
                    key={count}
                    type="button"
                    aria-label={tp("openPacks", { count, pack: count === 1 ? "Regular Pack" : "Regular Packs" })}
                    aria-pressed={selectedCount === count}
                    disabled={busy || !status || status.available < count}
                    onClick={() => setRegularCount(count)}
                  >×{count}</button>)}
                </div>
                <p className="yk-pack-batch-details" aria-live="polite">{selectedCount * 5} {tp("batchCardsFragment", { count: selectedCount * 5 })}{selectedCount} {selectedCount === 1 ? tp("packUnit", { count: selectedCount }) : tp("packUnit", { count: selectedCount })}</p>
              </div>}
              <Button
                className="w-full"
                disabled={!status || status.available === 0 || busy}
                onClick={event => start("regular", event.currentTarget)}
              >
                {status?.available === 0 ? tp("nextIn", { time: countdown }) : selectedCount > 1 ? tp("openBatch", { count: selectedCount }) : tp("open")}
              </Button>
            </div>
          </article>
          <article
            className="yk-pack-panel yk-decision-panel"
            data-unavailable={
              !decisionStatus ||
              (!decisionStatus.available && decisionStatus.pending.length === 0)
            }
          >
            <div className="yk-pack-art-stage">
              <span className="yk-pack-aura" aria-hidden="true" />
              <span className="yk-pack-floor" aria-hidden="true" />
              <div
                className="yk-pack-info-trigger"
                onMouseEnter={() => showRates("decision")}
                onMouseLeave={hideRates}
                onKeyDown={event => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    closeRates();
                  }
                }}
              >
<button
                type="button"
                className="yk-pack-info"
                aria-label={tp("viewDecisionPackDropRates")}
                aria-expanded={ratesKind === "decision"}
                onClick={() => toggleRates("decision")}
                onFocus={() => showRates("decision")}
                onBlur={hideRates}
                aria-describedby={ratesKind === "decision" ? "decision-drop-rates" : undefined}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v6M12 7h.01" />
                </svg>
              </button>
{ratesKind === "decision" && <div id="decision-drop-rates" role="tooltip" className="yk-pack-info-popover">{rateDetails}</div>}
</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/chrome-decision-booster-v1.png" alt="Decision Pack"
                width={941}
                height={1672}
                className="yk-pack-image yk-decision-image"
                srcSet={packSrcSet("decision")}
                sizes={PACK_IMAGE_SIZES}
              />
            </div>
            <div className="yk-pack-body">
              <h2 className="font-display text-[26px] font-semibold">
                Decision Pack
              </h2>
              <div className="yk-pack-status">
                <p>{tp("dailyKeep1Of5")}</p>
                <p className="yk-pack-timing" suppressHydrationWarning>
                  {!decisionStatus ? (
                    decisionError ? (
                      tp("unavailable")
                    ) : (
                      tp("loading")
                    )
                  ) : decisionStatus.pending.length ? (
                    tp("choicePending")
                  ) : decisionStatus.available ? (
                    <span className="text-success">{tp("availableNow")}</span>
                  ) : decisionStatus.resetTimeZone === "Europe/Paris" ? (
                    tp("availableIn", { time: decisionCountdown })
                  ) : (
                    tp("availableIn", { time: decisionCountdown })
                  )}
                </p>
                {decisionStatus?.maximum !== undefined && decisionStatus.remaining !== undefined && (
                  <p className="yk-pack-timing">
                    {decisionStatus.remaining}/{decisionStatus.maximum} {tp("packsLeftReset", { time: decisionCountdown })}
                  </p>
                )}
              </div>
              {decisionError && (
                <p role="alert" className="my-3 text-sm text-danger-ink">
                  {tError(gameErrorKey(decisionError))}{" "}
                  <button
                    className="yk-button yk-button-secondary"
                    onClick={onRetryDecision}
                  >
                    {tp("tryAgain")}</button>
                </p>
              )}
              <Button
                disabled={
                  !decisionStatus ||
                  (!decisionStatus.available &&
                    decisionStatus.pending.length === 0) ||
                  busy
                }
                onClick={event => start("decision", event.currentTarget)}
                className="w-full"
              >
                {decisionStatus?.pending.length
                  ? tp("resumeMyChoice")
                  : decisionStatus?.available
                    ? tp("open")
                    : tp("availableIn", { time: decisionCountdown })}
              </Button>
            </div>
          </article>
        </div>
      )}
      {!opening && !revealing && !localPreview && (
        <ReferralReminder packChoices />
      )}
    </>
  );
}
