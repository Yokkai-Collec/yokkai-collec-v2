import { useTranslations } from "next-intl";
import type { Rarity } from "@/lib/data/cards";
import { useFilterSectionsOpen } from "@/hooks/use-filter-sections-open";

const rarityText: Record<Rarity, string> = {
  C: "text-rarity-c",
  R: "text-rarity-r",
  SR: "text-rarity-sr",
  SSR: "text-rarity-ssr",
  LR: "text-rarity-lr"
};
const chipOrder: Rarity[] = ["LR", "SSR", "SR", "R", "C"];

// Open/closed state is remembered per section (shared by every filter panel); Reset filters only clears the count.
export function FilterSection({
  sectionId,
  title,
  count = 0,
  children
}: {
  sectionId?: string;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const tu = useTranslations("collectionShared");
  sectionId ??= title.toLowerCase();
  const [sectionsOpen, setSectionOpen] = useFilterSectionsOpen();
  const open = sectionsOpen[sectionId] ?? false;
  return (
    <details
      className="yk-filter-section"
      open={open}
      onToggle={event => setSectionOpen(sectionId, event.currentTarget.open)}
    >
      <summary
        aria-expanded={open}
        aria-label={
          count > 0
            ? tu("activeFilters", {
                title: tu("filterSectionTitle", { title }),
                count
              })
            : undefined
        }
      >
        <span>
          {tu("filterSectionTitle", { title })}
          {count > 0 && <span className="yk-filter-count"> · {count}</span>}
        </span>
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
      <div className="yk-filter-section-content">{children}</div>
    </details>
  );
}

// Always-visible group (no fold), e.g. Sort by right under the search field.
export function FilterGroup({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="yk-filter-section" role="group" aria-label={title}>
      <p className="yk-filter-heading" aria-hidden="true">
        {title}
      </p>
      <div className="yk-filter-section-content">{children}</div>
    </div>
  );
}

export function RarityChips({
  selected,
  count,
  onToggle,
  options = chipOrder
}: {
  selected: readonly Rarity[];
  count?: (rarity: Rarity) => number;
  onToggle: (rarity: Rarity) => void;
  options?: readonly Rarity[];
}) {
  return (
    <div className="yk-rarity-chips">
      {options.map(r => (
        <button
          type="button"
          key={r}
          className={`yk-rarity-chip ${rarityText[r]}`}
          aria-pressed={selected.includes(r)}
          onClick={() => onToggle(r)}
        >
          <span>{r}</span>
          {count && <strong>{count(r)}</strong>}
        </button>
      ))}
    </div>
  );
}
