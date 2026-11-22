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
  imageKey: string
): Card {
  return {
    id,
    name,
    anime,
    category: "ANIME/MANGA",
    rarity,
    image: cardImages + imageKey
  };
}

export const blackoutCards = blackoutRoster.map(({ id, name, anime, imageKey }) =>
  previewCard(id, name, anime, "LR", imageKey)
);

const standardCards = [
  previewCard("preview-tenin", "Tenin", "Vampire Dormitory", "C", "b31eb9154251bd668b1c6c384108d917561375b218d6900a68a2f4df7bb2a504"),
  previewCard("preview-aaduo", "Aaduo", "The Apothecary Diaries", "R", "b28d9f990bbbb43f34b97d66613f9c04dd34ceb70c3f098222196c93de0d316b-c402cb940a3f644d")
];


export const blackoutPreviewShop = {
  price: 750,
  dailyLimit: 3
} as const;

const walletKey = "yokkai.blackout.preview-wallet";
const walletUpdated = "yokkai-blackout-preview-wallet";
const parisDay = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" });

const initialWallet = { day: "", boughtToday: 0, reserve: 0, balance: 5000 };
export type BlackoutPreviewWallet = typeof initialWallet;

function readPreviewWallet(): BlackoutPreviewWallet {
  const day = parisDay.format(new Date());
  let wallet = initialWallet;
  try {
    const saved = JSON.parse(window.localStorage.getItem(walletKey) ?? "null");
    if (
      typeof saved?.day === "string" &&
      [saved.boughtToday, saved.reserve, saved.balance].every(
        amount => Number.isSafeInteger(amount) && amount >= 0
      )
    ) {
      wallet = saved;
    }
  } catch {
    // A fresh preview can start without a stored wallet.
  }
  return wallet.day === day ? wallet : { ...wallet, day, boughtToday: 0 };
}

function savePreviewWallet(wallet: BlackoutPreviewWallet) {
  window.localStorage.setItem(walletKey, JSON.stringify(wallet));
  window.dispatchEvent(new Event(walletUpdated));
}

export function getBlackoutPreviewWallet() {
  return JSON.stringify(readPreviewWallet());
}

export function getInitialBlackoutPreviewWallet() {
  return JSON.stringify(initialWallet);
}

export function subscribeBlackoutPreviewWallet(notify: () => void) {
  window.addEventListener(walletUpdated, notify);
  window.addEventListener("storage", notify);
  window.addEventListener("focus", notify);
  const timer = window.setInterval(notify, 30_000);
  return () => {
    window.removeEventListener(walletUpdated, notify);
    window.removeEventListener("storage", notify);
    window.removeEventListener("focus", notify);
    window.clearInterval(timer);
  };
}

export function buyBlackoutPreviewPacks(quantity: number) {
  if (!blackoutPreviewEnabled) return;
  const wallet = readPreviewWallet();
  const { price, dailyLimit } = blackoutPreviewShop;
  const total = quantity * price;
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    wallet.boughtToday + quantity > dailyLimit ||
    wallet.balance < total
  ) return;

  savePreviewWallet({
    ...wallet,
    balance: wallet.balance - total,
    boughtToday: wallet.boughtToday + quantity,
    reserve: wallet.reserve + quantity
  });
}

export async function openBlackoutPreview(): Promise<CollectedCard[]> {
  if (!blackoutPreviewEnabled) return [];
  const wallet = readPreviewWallet();
  if (wallet.reserve > 0) savePreviewWallet({ ...wallet, reserve: wallet.reserve - 1 });
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
