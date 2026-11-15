import type { Rarity } from "@/lib/data/cards";
import type { MarketQuery } from "@/lib/data/market";

export type MarketReturn = {
  section: "browse" | "mine";
  mineTab: "all" | "mine" | "won" | "sales" | "unsold";
  query: string;
  rarity: Rarity[];
  category: string;
  sort: "end" | "asc" | "desc" | "popular";
  limit: number;
  scrollY: number;
  anchorId: string;
  anchorTop: number;
  savedAt: number;
};

const storageKey = "yokkai:market:return:v1";
let memory: MarketReturn | null = null;
let encoded: string | null = null;

export const subscribeMarketReturn = () => () => {};

export function readMarketReturn(): MarketReturn | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(storageKey);
    if (stored !== encoded) {
      memory = stored ? JSON.parse(stored) : null;
      encoded = stored;
    }
  } catch {
    // Keep navigation working when storage is unavailable.
  }
  const value = memory;
  if (
    !value ||
    !["browse", "mine"].includes(value.section) ||
    !["all", "mine", "won", "sales", "unsold"].includes(value.mineTab) ||
    !["end", "asc", "desc", "popular"].includes(value.sort) ||
    typeof value.query !== "string" ||
    typeof value.category !== "string" ||
    !Array.isArray(value.rarity) ||
    !value.rarity.every(rarity =>
      ["C", "R", "SR", "SSR", "LR"].includes(rarity)
    ) ||
    !Number.isInteger(value.limit) ||
    value.limit < 100 ||
    value.limit > 1000 ||
    !Number.isFinite(value.scrollY) ||
    value.scrollY < 0 ||
    typeof value.anchorId !== "string" ||
    !Number.isFinite(value.anchorTop) ||
    !Number.isFinite(value.savedAt) ||
    Date.now() - value.savedAt < 0 ||
    Date.now() - value.savedAt > 30 * 60_000
  )
    return null;
  return value;
}

export function rememberMarketReturn(value: MarketReturn) {
  memory = value;
  encoded = JSON.stringify(value);
  try {
    window.sessionStorage.setItem(storageKey, encoded);
  } catch {
    // In-memory fallback still supports Back in this tab.
  }
}

export function marketReturnQuery(value: MarketReturn): MarketQuery {
  return {
    query: value.query,
    rarity: value.rarity,
    category: value.category,
    sort: value.section === "browse" ? value.sort : "end",
    section: value.section === "browse" ? "active" : value.mineTab
  };
}

/** Wait for the returned grid's layout; never fight a player's own scrolling. */
export function restoreMarketScroll(
  value: MarketReturn,
  root: HTMLElement,
  done: () => void
) {
  let frame = 0;
  let settleTimer: number | undefined;
  let stopped = false;
  const cleanup = () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timeout);
    window.clearTimeout(settleTimer);
    observer.disconnect();
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      window.removeEventListener(event, cancel, true);
    }
  };
  const cancel = () => {
    done();
    cleanup();
  };
  const restore = (final = false) => {
    if (stopped) return;
    const anchor = [
      ...root.querySelectorAll<HTMLElement>("[data-market-auction]")
    ].find(node => node.dataset.marketAuction === value.anchorId);
    const target = Math.max(
      0,
      anchor
        ? window.scrollY + anchor.getBoundingClientRect().top - value.anchorTop
        : value.scrollY
    );
    const max = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    );
    if (max + 1 < target && !final) return;
    const top = Math.min(target, max);
    window.scrollTo({ top, behavior: "instant" });
    window.clearTimeout(settleTimer);
    if (final) {
      done();
      cleanup();
      return;
    }
    // Back/forward navigation may apply native scroll or focus restoration
    // after the grid commit. Verify once it settles, retrying only if moved.
    settleTimer = window.setTimeout(() => {
      if (Math.abs(window.scrollY - top) <= 1) {
        done();
        cleanup();
      } else schedule();
    }, 120);
  };
  const schedule = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => restore());
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(root);
  const timeout = window.setTimeout(() => restore(true), 3000);
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    window.addEventListener(event, cancel, { capture: true, passive: true });
  }
  // Let both React and the router finish committing their layout first.
  frame = window.requestAnimationFrame(schedule);
  return cleanup;
}
