"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CollectionView } from "@/components/collection";
import {
  AuctionView,
  SearchView,
  type AuctionChatAdapter
} from "@/components/community-views";
import type { Card, CollectedCard, getCataloguePage } from "@/lib/data/cards";
import { matchesCardSearch } from "@/lib/ui/card-search";

// Isolated fixture: use the real modal and catalogue, with in-memory cards only.
const cards: Card[] = [
  {
    id: "gojo",
    name: "SATORU GOJO",
    anime: "JUJUTSU KAISEN",
    category: "ANIME/MANGA",
    rarity: "LR",
    image: "/assets/premium-examples/gojo-original.png"
  },
  {
    id: "toji",
    name: "TOJI FUSHIGURO",
    anime: "JUJUTSU KAISEN",
    category: "ANIME/MANGA",
    rarity: "SSR",
    image: "/assets/premium-examples/bbdou-card-4.png"
  },
  {
    id: "luffy",
    name: "MONKEY D. LUFFY",
    anime: "ONE PIECE",
    category: "ANIME/MANGA",
    rarity: "LR",
    image: "/assets/landing/luffy.webp"
  }
];
const collected: CollectedCard[] = cards.map(card => ({
  ...card,
  instanceId: `preview-${card.id}`,
  obtainedAt: "2026-11-11T12:00:00Z",
  shiny: false,
  isEvolved: false,
  isFirstOwner: false,
  folderId: null,
  catalogueImage: card.image,
  customImageUrl: null
}));
const loadPage: typeof getCataloguePage = async ({
  query = "",
  category = "",
  rarity = "",
  page = 1,
  pageSize = 24
} = {}) => {
  const found = cards.filter(
    card =>
      matchesCardSearch(query, [card.name, card.anime]) &&
      (typeof category === "string"
        ? !category || category === card.category
        : !category.length || category.includes(card.category)) &&
      (typeof rarity === "string"
        ? !rarity || rarity === card.rarity
        : !rarity.length || rarity.includes(card.rarity))
  );
  return {
    cards: found.slice((page - 1) * pageSize, page * pageSize),
    total: found.length
  };
};
const discovery = async () => ({ marketValue: null });
const chat: AuctionChatAdapter = {
  get: async () => ({ canPost: false, participants: [], messages: [] }),
  send: async () => {
    throw new Error("Read-only local fixture");
  }
};
const path = "/design-system/card-license-preview";

export function CardLicensePreview() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}

function Preview() {
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <main
      className="yk-card-browse-page mx-auto py-10"
      onClickCapture={event => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const anchor =
          event.target instanceof Element ? event.target.closest("a") : null;
        const href = anchor?.getAttribute("href");
        if (href?.startsWith("/catalog?")) {
          // Keep the local demo navigable without a player session. The actual
          // modal still generates the production /catalog?q=… destination.
          event.preventDefault();
          router.push(`${path}${href.slice("/catalog".length)}`);
        }
      }}
    >
      <div className="mb-6 flex flex-wrap gap-4">
        <Link className="yk-button" href={path} onClick={() => setOpen(true)}>
          Détails de la carte
        </Link>
        <Link className="yk-button" href={`${path}?q=ONE%20PIECE`}>
          Catalogue · ONE PIECE
        </Link>
        <Link className="yk-button" href={`${path}?auction=1`}>
          Détail d’une enchère
        </Link>
      </div>
      {params.has("q") ? (
        <SearchView loadPage={loadPage} previewCategories={["ANIME/MANGA"]} />
      ) : params.has("auction") ? (
        <AuctionView
          chatAdapter={chat}
          auction={{
            id: "license-preview-auction",
            card: cards[0],
            amount: 100,
            remaining: "00:25:00",
            remainingSeconds: 1500,
            seller: "Kitsune",
            sellerId: "preview-seller",
            bids: 0,
            balance: 9480,
            nextBid: 110,
            minimumBid: 110
          }}
        />
      ) : (
        <>
          <p className="text-ink-2">
            Démo locale : clique sur la licence dans les détails de la carte.
          </p>
          {open && (
            <CollectionView
              cards={collected}
              categories={["ANIME/MANGA"]}
              detailOnly
              previewOnly
              readOnly
              initialSelectedId="preview-gojo"
              onDetailClose={() => setOpen(false)}
              loadCardDiscovery={discovery}
            />
          )}
        </>
      )}
    </main>
  );
}
