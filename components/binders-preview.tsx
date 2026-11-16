"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import "@/styles/market.css";
import { HomeBinders } from "@/components/home-binders";
import { CollectionView } from "@/components/collection";
import { BoosterReveal } from "@/components/boosters";
import type { CollectedCard, PaniniAlbumProgress } from "@/lib/data/cards";
import type {
  BinderHighlight,
  PackBinderGain
} from "@/lib/data/binder-discovery";
import "@/styles/home.css";
import "@/styles/collection.css";
import "@/styles/boosters.css";
const albums: PaniniAlbumProgress[] = [
  {
    binderKey: "series:10000000-0000-4000-8000-000000000001",
    license: "Jujutsu Kaisen",
    owned: 18,
    total: 24,
    percent: 75,
    favorite: true
  },
  {
    binderKey: "series:10000000-0000-4000-8000-000000000002",
    license: "Attack on Titan",
    owned: 23,
    total: 24,
    percent: 96,
    favorite: true
  },
  {
    binderKey: "series:10000000-0000-4000-8000-000000000003",
    license: "One Piece",
    owned: 32,
    total: 45,
    percent: 71,
    favorite: false
  },
  {
    binderKey: "series:10000000-0000-4000-8000-000000000004",
    license: "An extraordinarily long universe name to verify small screens",
    owned: 0,
    total: 15,
    percent: 0,
    favorite: false
  }
];
const popularity: Record<string, number> = {
  "Jujutsu Kaisen": 120,
  "Attack on Titan": 80,
  "One Piece": 200
};
const images = [
  "/assets/landing/gojou.webp",
  "/assets/landing/levi.webp",
  "/assets/landing/luffy.webp"
];
const cards: CollectedCard[] = Array.from({ length: 5 }, (_, i) => ({
  id: i === 3 ? "preview-card-0" : "preview-card-" + i,
  instanceId: "preview-copy-" + i,
  name: ["Satoru Gojo", "Levi", "Luffy", "Satoru Gojo", "Unknown preview"][i],
  category: "ANIME/MANGA",
  anime: albums[i % 3].license,
  rarity: i === 0 ? "LR" : i === 1 ? "SSR" : "SR",
  image: images[i % 3],
  catalogueImage: images[i % 3],
  customImageUrl: null,
  obtainedAt: "2026-10-29T10:00:00Z",
  shiny: false,
  isEvolved: false,
  isFirstOwner: true,
  folderId: null,
  binders: [
    {
      key: albums[i % 3].binderKey!,
      name: albums[i % 3].license,
      origin: "series"
    }
  ]
}));
const loadHome = async (): Promise<BinderHighlight[]> =>
  albums.slice(0, 3).map((a, i) => ({ ...a, image: images[i] }));
const loadGains = async (input: { id: string }[]): Promise<PackBinderGain[]> =>
  albums
    .slice(0, 3)
    .filter((_, i) => input.some(card => card.id === cards[i].id))
    .map((a, i) => ({ ...a, cardIds: [cards[i].id], added: 1 }));
export function BindersPreview({ mode }: { mode: string }) {
  const tg = useTranslations("gameUi");
  const [favorites, setFavorites] = useState(
    new Map(
      albums.map(a => [a.binderKey, mode === "discovery" ? false : a.favorite])
    )
  );
  const [empty, setEmpty] = useState(false),
    [fail, setFail] = useState(false);
  const [decision, setDecision] = useState(false),
    [kept, setKept] = useState<string>();
  const [soldAll, setSoldAll] = useState(false);
  return (
    <main
      className={mode === "home" ? "yk-home-main" : "yk-game-main"}
      style={{ padding: 16, maxWidth: 1440, margin: "0 auto", width: "100%" }}
    >
      <nav
        aria-label="Preview controls"
        style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}
      >
        {["home", "collection", "packs"].map(item => (
          <a
            className="yk-button yk-button-secondary"
            key={item}
            href={"/design-system/binders-preview?mode=" + item}
          >
            {item}
          </a>
        ))}
      </nav>
      {mode === "home" ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="yk-button" onClick={() => setEmpty(!empty)}>
              Toggle empty
            </button>
            <button className="yk-button" onClick={() => setFail(!fail)}>
              Toggle failure
            </button>
          </div>
          <HomeBinders
            load={
              fail
                ? async () => {
                    throw Error("Fixture failure");
                  }
                : empty
                  ? async () => []
                  : loadHome
            }
          />
        </>
      ) : mode === "packs" ? (
        <>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 20
            }}
          >
            <button
              className="yk-button"
              onClick={() => {
                setDecision(!decision);
                setKept(undefined);
                setSoldAll(false);
              }}
            >
              Toggle Decision Pack
            </button>
          </div>
          <BoosterReveal
            key={String(decision)}
            previewOnly
            cards={cards.map((c, i) => ({
              ...c,
              isNew: i < 3,
              copies: i === 3 ? 2 : 1
            }))}
            revealed={5}
            onReveal={() => {}}
            onReturn={() => {}}
            loadBinderGains={loadGains}
            decision={
              decision
                ? {
                    keptId: kept,
                    soldAll,
                    onKeep: async id => {
                      setKept(id);
                      return 0;
                    },
                    onSellAll: async () => {
                      setSoldAll(true);
                      return 0;
                    }
                  }
                : undefined
            }
          />
        </>
      ) : (
        <CollectionView
          pageHeading={
            <div>
              <p className="eyebrow">{tg("everyCardYouOwn")}</p>
              <h1 className="yk-title mt-3">{tg("collection")}</h1>
            </div>
          }
          cards={cards}
          categories={["ANIME/MANGA"]}
          previewOnly
          folders={[]}
          loadPaniniAlbums={async options => {
            const items = albums
              .map(a => ({
                ...a,
                favorite: favorites.get(a.binderKey) ?? false
              }))
              .filter(
                a =>
                  (!options.query ||
                    a.license
                      .toLowerCase()
                      .includes(options.query.toLowerCase())) &&
                  (!options.favoritesOnly || a.favorite) &&
                  (!options.completedOnly ||
                    (a.total > 0 && a.owned === a.total))
              )
              .sort(
                (a, b) =>
                  Number(b.favorite) - Number(a.favorite) ||
                  (popularity[b.license] ?? 0) - (popularity[a.license] ?? 0) ||
                  b.percent - a.percent
              );
            return { items, total: items.length };
          }}
          loadPaniniAlbumCards={async options => {
            const index = albums.findIndex(
              a => a.binderKey === options.license
            );
            const a = albums[index];
            if (!a) return { items: [], total: 0 };
            return {
              items: cards
                .filter(c => c.binders?.some(b => b.key === a.binderKey))
                .map(c => ({ ...c, owned: true })),
              total: a.total,
              binderTotal: a.total,
              binderOwned: a.owned
            };
          }}
          onSetPaniniAlbumFavorite={async (key, favorite) => {
            setFavorites(current => new Map([...current, [key, favorite]]));
          }}
        />
      )}
    </main>
  );
}
