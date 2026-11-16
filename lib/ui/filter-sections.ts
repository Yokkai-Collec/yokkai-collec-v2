export type FilterSectionsOpen = Record<string, boolean>;

export const FILTER_SECTIONS_OPEN_STORAGE_KEY = "yokkai:filters-open:v1";
// Sections missing from the map are closed.
export const DEFAULT_FILTER_SECTIONS_OPEN: FilterSectionsOpen = {
  rarity: true,
  "catalogue-category": true
};

// Invalid JSON or a throwing storage (private mode, blocked site data) falls back to the default.
export function readFilterSectionsOpen(
  getItem: () => string | null
): FilterSectionsOpen {
  try {
    const stored: unknown = JSON.parse(getItem() ?? "null");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      const open = { ...DEFAULT_FILTER_SECTIONS_OPEN };
      for (const [id, value] of Object.entries(stored))
        if (typeof value === "boolean") open[id] = value;
      return open;
    }
  } catch {}
  return DEFAULT_FILTER_SECTIONS_OPEN;
}

export const filterSectionLabel = (title: string, count: number) =>
  count > 0
    ? `${title}, ${count} active filter${count === 1 ? "" : "s"}`
    : undefined;
