"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SearchView } from "@/components/community-views";
import { MarketPreviewMessenger } from "@/components/market-preview";
import { Topbar } from "@/components/topbar";
import type { Card, Rarity, getCataloguePage } from "@/lib/data/cards";

const categories = ["ANIME/MANGA", "FILM", "KPOP"];
const responsiveCategories = [
  "ANIME/MANGA",
  "ARTIST",
  "BRAINROT",
  "CHARACTERS",
  "COMICS",
  "DISNEY CHANNEL",
  "ESPORT",
  "FILM",
  "INTERNET PERSONALITY",
  "KPOP",
  "MANGA",
  "MANWHA",
  "MEME",
  "NOVEL",
  "SAGA",
  "SERIE",
  "SPORT",
  "VIDEO GAMES",
  "VOCALOID"
];
const cards: Card[] = Array.from({ length: 26 }, (_, index) => ({
  id: `counter-${index}`,
  name: `Preview card ${index + 1}`,
  category: categories[index % 2],
  rarity: (["LR", "SSR", "SR", "R", "C"] as Rarity[])[index % 5],
  image: "/assets/booster-pack.png"
}));
const responsiveCards: Card[] = Array.from({ length: 139 }, (_, index) => ({
  ...cards[index % cards.length],
  id: `responsive-${index}`,
  category: responsiveCategories[index % responsiveCategories.length]
}));
const loader =
  (items: Card[]): typeof getCataloguePage =>
  async ({
    category = "",
    rarity = "",
    query = "",
    page = 1,
    pageSize = 24
  } = {}) => {
    const matching = items.filter(
      card =>
        (typeof category === "string"
          ? !category || card.category === category
          : !category.length || category.includes(card.category)) &&
        (typeof rarity === "string"
          ? !rarity || card.rarity === rarity
          : !rarity.length || rarity.includes(card.rarity)) &&
        card.name.toLowerCase().includes(query.toLowerCase())
    );
    return {
      cards: matching.slice((page - 1) * pageSize, page * pageSize),
      total: matching.length
    };
  };
const loadPage = loader(cards);
const loadResponsivePage = loader(responsiveCards);

export default function BrandCatalogPreview() {
  return (
    <Suspense fallback={null}>
      <BrandCatalogFixture />
    </Suspense>
  );
}

function BrandCatalogFixture() {
  const params = useSearchParams();
  const responsive = params.has("responsive");
  return (
    <>
      <Topbar view="search" name="Preview" karas={0} notifications={[]} />
      <main
        className={
          responsive
            ? "yk-card-browse-page mx-auto py-10"
            : "mx-auto w-full max-w-[var(--layout-collection-max)] px-6 py-10"
        }
      >
        <SearchView
          loadPage={responsive ? loadResponsivePage : loadPage}
          previewCategories={responsive ? responsiveCategories : categories}
          pageHeading={
            <>
              <p className="eyebrow">Every card in the game</p>
              <h1 className="yk-title mt-3">Catalog</h1>
            </>
          }
        />
      </main>
      {responsive && <MarketPreviewMessenger />}
    </>
  );
}
