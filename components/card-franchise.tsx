import type { Card } from "@/lib/data/cards";
import { formatLicenseName } from "@/lib/ui/license-name";

export function CardFranchise({
  card,
  className = "mt-1 block truncate text-center text-[11px] text-ink-3"
}: {
  card: Pick<Card, "anime" | "category">;
  className?: string;
}) {
  const franchise = card.anime?.trim();
  return franchise ? (
    <span className={className}>{formatLicenseName(franchise)}</span>
  ) : null;
}
