import { UrlPagination } from "@/components/ui/url-pagination";
import type { Metadata } from "next";
import { CardShell } from "@/components/card-shell";
import { MarketPreviewMessenger } from "@/components/market-preview";
import { Topbar } from "@/components/topbar";
import { YokaiCard } from "@/components/yokai-card";
import type { Card, Rarity } from "@/lib/data/cards";
import { CARD_PAGE_SIZES, DEFAULT_CARD_PAGE_SIZE } from "@/lib/ui/pagination";

export const metadata: Metadata = {
  title: "Catalogue preview",
  robots: { index: false, follow: false }
};
const rarities: Rarity[] = ["LR", "SSR", "SR", "R", "C"];
const rarityText: Record<Rarity, string> = {
  C: "text-rarity-c",
  R: "text-rarity-r",
  SR: "text-rarity-sr",
  SSR: "text-rarity-ssr",
  LR: "text-rarity-lr"
};
const cards: Card[] = Array.from(
  { length: DEFAULT_CARD_PAGE_SIZE },
  (_, index) => ({
    id: `catalogue-preview-${index}`,
    name: [
      "Kitsune céleste",
      "Oni écarlate",
      "Tengu des brumes",
      "Kappa ancien"
    ][index % 4],
    category: index % 2 ? "Manga" : "Anime",
    anime: "Spirit Realm",
    rarity: rarities[index % rarities.length],
    image: "/assets/booster-pack.png"
  })
);
const icon = (rarity: Rarity) => (
  <svg
    aria-hidden="true"
    className={rarityText[rarity]}
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="m12 2 2.45 6.1L21 10.5l-5.25 4.05L16 21l-4-3.55L8 21l.25-6.45L3 10.5l6.55-2.4L12 2Z" />
  </svg>
);

export default async function CataloguePreview({
  searchParams
}: {
  searchParams: Promise<{ page?: string; messenger?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(
    1,
    Math.min(4308, Number.parseInt(params.page ?? "1", 10) || 1)
  );
  return (
    <>
      <Topbar view="search" name="Kitsune" karas={4920} notifications={[]} />
      <main className="yk-card-browse-page mx-auto py-10">
        <section className="yk-catalogue">
          <div className="yk-collection-layout">
            <header className="yk-catalogue-title">
              <p className="eyebrow">Toutes les cartes du jeu</p>
              <h1 className="yk-title mt-3">Catalogue</h1>
            </header>
            <aside className="yk-collection-sidebar">
              <div className="yk-filter-search">
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
                <span>Rechercher…</span>
              </div>
              <details className="yk-filter-section" open>
                <summary>Rareté</summary>
                <div className="yk-filter-section-content">
                  <div className="yk-filter-option" aria-pressed="true">
                    <span className="yk-filter-check" />
                    <span>Toutes</span>
                  </div>
                  {rarities.map(rarity => (
                    <div className="yk-filter-option" key={rarity}>
                      <span className="yk-filter-check" />
                      {icon(rarity)}
                      <span className={rarityText[rarity]}>{rarity}</span>
                    </div>
                  ))}
                </div>
              </details>
              <details className="yk-filter-section" open>
                <summary>Catégorie</summary>
                <div className="yk-filter-section-content">
                  {[
                    "Toutes les catégories",
                    "Anime",
                    "Manga",
                    "Kpop",
                    "Film"
                  ].map((category, index) => (
                    <div
                      className="yk-filter-option"
                      aria-pressed={index === 0}
                      key={category}
                    >
                      <span className="yk-filter-check" />
                      <span>{category}</span>
                    </div>
                  ))}
                </div>
              </details>
              <button className="yk-filter-reset" disabled>
                Réinitialiser les filtres
              </button>
            </aside>
            <div className="yk-collection-main">
              <div className="yk-catalogue-heading">
                <p role="status" className="sr-only">
                  103 379 cartes
                </p>
                <button type="button" className="yk-mobile-filter-trigger">
                  <svg
                    aria-hidden="true"
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="M4 6h16M7 12h10M10 18h4" />
                  </svg>
                  Filtres
                </button>
              </div>
              <ul
                id="catalogue-preview-list"
                tabIndex={0}
                className="yk-card-grid yk-catalogue-grid"
              >
                {cards.map(card => (
                  <li key={card.id}>
                    <button type="button" className="yk-catalogue-card">
                      <CardShell>
                        <YokaiCard {...card} animated={false} />
                      </CardShell>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="yk-collection-pagination">
                <UrlPagination
                  page={page}
                  pageCount={4308}
                  scrollTargetId="catalogue-preview-list"
                />
                <label>
                  Cards per page
                  <select defaultValue={DEFAULT_CARD_PAGE_SIZE}>
                    {CARD_PAGE_SIZES.map(size => (
                      <option key={size}>{size}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
        </section>
      </main>
      {params.messenger !== undefined && <MarketPreviewMessenger />}
    </>
  );
}
