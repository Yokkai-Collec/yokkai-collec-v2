"use client";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { CollectionView } from "@/components/collection";
import type { CollectedCard, Folder } from "@/lib/data/cards";

// Local-only simulation of the Collection actions (no RPC). Every call is logged on
// window.__collectionPreviewActions so browser checks can assert what a click triggered.
declare global {
  interface Window {
    __collectionPreviewActions?: string[];
  }
}
const record = (entry: string) => {
  (window.__collectionPreviewActions ??= []).push(entry);
};

export function CollectionPreviewClient({
  cards: initialCards,
  pageHeading
}: {
  cards: CollectedCard[];
  pageHeading?: ReactNode;
}) {
  const [cards, setCards] = useState(initialCards);
  const [folders, setFolders] = useState<Folder[]>([
    { id: "favorites", name: "Favoris" }
  ]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("filters")) {
      const frame = window.requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(".yk-mobile-filter-trigger")
          ?.click()
      );
      return () => window.cancelAnimationFrame(frame);
    }
    if (params.has("detail")) {
      const frame = window.requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(".yk-collection-card")
          ?.click()
      );
      return () => window.cancelAnimationFrame(frame);
    }
    const selection = params.get("select");
    if (!selection) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(".yk-collection-summary .yk-button")
        ?.click();
      window.requestAnimationFrame(() => {
        const cardButtons = [
          ...document.querySelectorAll<HTMLButtonElement>(".yk-collection-card")
        ];
        const count =
          selection === "all"
            ? cardButtons.length
            : selection === "many"
              ? 5
              : 1;
        cardButtons.slice(0, count).forEach(button => button.click());
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const update = (instanceId: string, patch: Partial<CollectedCard>) =>
    setCards(current =>
      current.map(card =>
        card.instanceId === instanceId ? { ...card, ...patch } : card
      )
    );
  return (
    <CollectionView
      pageHeading={pageHeading}
      cards={cards}
      presentation={{
        "preview-evolve-2": {
          frozen: { remaining: "12 min" },
          destructionValue: 4
        },
        "preview-evolve-0": { destructionValue: 4 },
        "preview-evolve-1": { destructionValue: 4 },
        "preview-evolve-3": { destructionValue: 4 },
        "preview-evolve-4": { destructionValue: 4 }
      }}
      categories={["Anime", "Manga"]}
      folders={folders}
      onCreateFolder={async name => {
        record(`folder:${name}`);
        setFolders(current => [
          ...current,
          { id: `folder-${current.length}`, name }
        ]);
      }}
      onSetLocked={async (instanceId, locked) => {
        record(`lock:${instanceId}:${locked}`);
        update(instanceId, { locked });
      }}
      onMoveCard={async (instanceId, folderId) => {
        record(`move:${instanceId}:${folderId}`);
        update(instanceId, { folderId });
      }}
      onMoveCards={async (instanceIds, folderId) => {
        record(`moveMany:${instanceIds.length}:${folderId}`);
        setCards(current =>
          current.map(card =>
            instanceIds.includes(card.instanceId) ? { ...card, folderId } : card
          )
        );
      }}
      onCreateAuction={async (instanceId, price, duration) => {
        record(`auction:${instanceId}:${price}:${duration}`);
      }}
      onEvolve={async instanceIds => {
        record(`evolve:${instanceIds.join(",")}`);
        const source = cards.find(card => card.instanceId === instanceIds[0])!;
        const consumed = new Set(instanceIds);
        const evolved = {
          ...source,
          instanceId: `${source.instanceId}-shiny`,
          shiny:
            source.rarity === "SSR" ||
            cards.some(card => consumed.has(card.instanceId) && card.shiny),
          isEvolved: true
        };
        setCards(current => [
          evolved,
          ...current.filter(card => !consumed.has(card.instanceId))
        ]);
        return evolved;
      }}
      onSetCustomImage={async (instanceId, imageUrl) => {
        record(`image:${instanceId}:${imageUrl}`);
        const card = cards.find(item => item.instanceId === instanceId)!;
        update(instanceId, {
          customImageUrl: imageUrl,
          image: imageUrl ? "/assets/card-back.png" : card.catalogueImage
        });
      }}
      onDiscard={async instanceId => {
        record(`discard:${instanceId}`);
        setCards(current =>
          current.filter(card => card.instanceId !== instanceId)
        );
      }}
      onDiscardMany={async instanceIds => {
        record(`discardMany:${instanceIds.length}`);
        setCards(current =>
          current.filter(card => !instanceIds.includes(card.instanceId))
        );
      }}
    />
  );
}
