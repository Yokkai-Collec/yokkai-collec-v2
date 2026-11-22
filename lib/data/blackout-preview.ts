import blackoutRoster from "@/data/blackout-cards.json";
import type { Card, CollectedCard } from "@/lib/data/cards";

export const blackoutPreviewEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_BLACKOUT_PREVIEW === "true";

export const BLACKOUT_SLUG = "black-friday";
export const BLACKOUT_EVENT_PATH = `/events/${BLACKOUT_SLUG}`;

export const blackFridayTerms = {
  startsAt: "2026-11-26T20:00:00+01:00",
  endsAt: "2026-12-01T00:00:00+01:00",
  freePacks: { basic: 1, pro: 2 },
  firstMonthPrice: 2.99,
  renewalPrice: 4.99
} as const;

const cardImages = "https://api.yokkai-collec.com/storage/v1/object/public/card-images/";

function previewCard(
  id: string,
  name: string,
  anime: string,
  rarity: Card["rarity"],
  image: string
): Card {
  return {
    id,
    name,
    anime,
    category: "ANIME/MANGA",
    rarity,
    image
  };
}

export const blackoutCards = blackoutRoster.map(({ id, name, anime, artwork }) =>
  previewCard(id, name, anime, "LR", artwork)
);

const standardCards = [
  previewCard("preview-tenin", "Tenin", "Vampire Dormitory", "C", cardImages + "b31eb9154251bd668b1c6c384108d917561375b218d6900a68a2f4df7bb2a504"),
  previewCard("preview-aaduo", "Aaduo", "The Apothecary Diaries", "R", cardImages + "b28d9f990bbbb43f34b97d66613f9c04dd34ceb70c3f098222196c93de0d316b-c402cb940a3f644d")
];

export async function openBlackoutPreview(): Promise<CollectedCard[]> {
  if (!blackoutPreviewEnabled) return [];
  const legendary = blackoutCards[Math.floor(Math.random() * blackoutCards.length)];
  return [...standardCards, legendary].map(card => ({
    ...card,
    instanceId: crypto.randomUUID(),
    obtainedAt: new Date().toISOString(),
    shiny: false,
    isEvolved: false,
    isFirstOwner: false,
    folderId: null,
    catalogueImage: card.image,
    customImageUrl: null
  }));
}
