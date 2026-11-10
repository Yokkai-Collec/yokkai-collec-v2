import type { Metadata } from "next";
import { CollectionPreviewClient } from "@/components/collection-preview";
import { Topbar } from "@/components/topbar";
import type { CollectedCard, Rarity } from "@/lib/data/cards";

export const metadata: Metadata = {
  title: "Collection preview",
  robots: { index: false, follow: false }
};

const rarities: Rarity[] = ["LR", "SSR", "SR", "R", "C"];
const cards: CollectedCard[] = Array.from({ length: 40 }, (_, index) => ({
  id: `preview-card-${index % 7}`,
  instanceId: `preview-instance-${index}`,
  name: [
    "Kitsune céleste",
    "Oni écarlate",
    "Tengu des brumes",
    "Kappa ancien",
    "Yuki-Onna",
    "Tanuki solaire"
  ][index % 6],
  category: index % 2 ? "Manga" : "Anime",
  anime: "Spirit Realm",
  rarity: rarities[index % rarities.length],
  image: "/assets/booster-pack.png",
  catalogueImage: "/assets/booster-pack.png",
  obtainedAt: new Date(2026, 8, 20 - index).toISOString(),
  shiny: index === 0 || index === 6,
  isEvolved: index === 6,
  isFirstOwner: index === 0,
  folderId: null,
  customImageUrl: null
}));
// Five non-Shiny copies exercise grouping, folders, custom art, a frozen copy and explicit evolution selection.
cards.push(
  ...Array.from({ length: 5 }, (_, index): CollectedCard => ({
    id: "preview-evolve",
    instanceId: `preview-evolve-${index}`,
    name: "Jorogumo",
    category: "Anime",
    anime: "Spirit Realm",
    rarity: "SSR",
    image: index === 0 ? "/assets/card-back.png" : "/assets/booster-pack.png",
    catalogueImage: "/assets/booster-pack.png",
    obtainedAt: new Date(2026, 8, 25 - index).toISOString(),
    shiny: false,
    isEvolved: false,
    isFirstOwner: false,
    folderId: index === 1 ? "favorites" : null,
    customImageUrl: index === 0 ? "https://i.imgur.com/preview.png" : null
  }))
);

cards.push(
  ...Array.from({ length: 6 }, (_, index): CollectedCard => ({
    ...cards[0],
    id: "preview-mixed-lr",
    instanceId: `preview-mixed-lr-${index}`,
    name: "Mixed LR",
    shiny: index === 5,
    isEvolved: false,
    isFirstOwner: false,
    obtainedAt: new Date(Date.UTC(2026, 8, 25 - index)).toISOString()
  }))
);

export default function CollectionPreview() {
  return (
    <>
      <Topbar
        view="collection"
        name="Kitsune"
        karas={4920}
        notifications={[]}
      />
      <main
        id="main-content"
        className="mx-auto w-full max-w-[var(--layout-collection-max)] px-6 py-6"
      >
        <CollectionPreviewClient
          cards={cards}
          pageHeading={
            <div>
              <p className="eyebrow">Collection personnelle</p>
              <h1 className="yk-title mt-3">Collection</h1>
            </div>
          }
        />
      </main>
    </>
  );
}
