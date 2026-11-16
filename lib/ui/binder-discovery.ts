import type { Card, PaniniAlbumProgress } from "@/lib/data/cards";
import { binderIdentity } from "@/lib/ui/binder-identity";

export function binderHref(
  binder?: { binderKey?: string; license: string },
  completedOnly = false
) {
  const params = new URLSearchParams({ view: "binders" });
  if (completedOnly) params.set("completed", "1");
  if (binder) {
    params.set("binder", binderIdentity(binder));
    params.set("name", binder.license);
  }
  return "/collection?" + params.toString();
}
export function binderHighlights(albums: PaniniAlbumProgress[], limit = 3) {
  return [...albums]
    .filter(a => a.total > 0 && (a.favorite || a.owned > 0))
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        Number(a.owned >= a.total) - Number(b.owned >= b.total) ||
        b.owned / b.total - a.owned / a.total ||
        a.license.localeCompare(b.license) ||
        binderIdentity(a).localeCompare(binderIdentity(b))
    )
    .slice(0, limit);
}
export function binderCover(binder: PaniniAlbumProgress, cards: Card[]) {
  if (binder.image?.trim()) return binder.image;
  return cards.find(card =>
    binder.binderKey
      ? card.binders?.some(item => item.key === binder.binderKey)
      : (card.anime?.trim() || card.category.trim()) === binder.license
  )?.image;
}
