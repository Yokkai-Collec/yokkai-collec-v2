// Multiples of 6 keep the desktop card grids complete. Card browsers pick a
// larger multiple at runtime when their visible filter panel is taller than
// the current grid.
export const CARD_PAGE_SIZES = [24, 36, 48] as const;
export const DEFAULT_CARD_PAGE_SIZE = CARD_PAGE_SIZES[1];

// The binder uses seven columns on desktop, so 28 cards fill four complete rows.
export const BINDER_CARD_PAGE_SIZES = [28, 42, 56] as const;

/**
 * Gives a card browser enough complete rows to reach its filter panel. This
 * deliberately has no upper cap: long filter lists and tall screens should
 * not leave a blank column of page background beside the filters.
 */
export function pageSizeForCollectionHeight(
  sidebarHeight: number,
  cardRowHeight: number,
  columns: number,
  minimum = DEFAULT_CARD_PAGE_SIZE
) {
  const safeColumns = Math.max(1, Math.trunc(columns));
  const safeRowHeight = Math.max(1, cardRowHeight);
  const rows = Math.max(
    1,
    Math.ceil(Math.max(0, sidebarHeight) / safeRowHeight)
  );
  const minimumRows = Math.ceil(Math.max(1, minimum) / safeColumns);
  return Math.max(rows, minimumRows) * safeColumns;
}

export function resolvePage(value: string, current: number, total: number) {
  const text = value.trim();
  if (!/^-?\d+$/.test(text)) return current;
  const page = Number(text);
  if (!Number.isFinite(page)) return current;
  return Math.max(1, Math.min(total, page));
}

export function changePage(
  value: string,
  current: number,
  total: number,
  onChange: (page: number) => void
) {
  const next = resolvePage(value, current, total);
  if (next === current) return false;
  onChange(next);
  return true;
}
