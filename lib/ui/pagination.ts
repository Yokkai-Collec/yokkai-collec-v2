// Multiples of 6 so every page fills the six-column desktop card grids (Collection, Catalogue).
export const CARD_PAGE_SIZES = [24, 36, 48] as const;
export const DEFAULT_CARD_PAGE_SIZE = CARD_PAGE_SIZES[1];

// The binder uses seven columns on desktop, so 28 cards fill four complete rows.
export const BINDER_CARD_PAGE_SIZES = [28, 42, 56] as const;

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
