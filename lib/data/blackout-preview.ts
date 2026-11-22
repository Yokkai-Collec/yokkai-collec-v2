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

export const blackoutCards = [
  previewCard("blackout-sung-jinwoo", "Sung Jin-Woo", "Solo Leveling", "LR", "729e3c5364cf4db6b8874ece22af5f487789b1976b4d6bcf2db7142184811633"),
  previewCard("blackout-ryomen-sukuna", "Ryomen Sukuna", "JUJUTSU KAISEN", "LR", "370e1a75b5b6f7173388bbb7eb795f7678604031183dcb6024b9fb1ce6da3a13-11793d74-f8aa-4a07-aa10-443a91c6916b"),
  previewCard("blackout-goku-black", "Goku Black", "Dragon Ball Super", "LR", "0625d99359c4c91bb2f60cc576b5908eea9bfe08643da1649fa2eba072fd8c29-650ef4eb67ca9fb2"),
  previewCard("blackout-itachi-uchiha", "Itachi Uchiha", "Naruto", "LR", "0945d625057b159a33a9488e54a0158e739f5821955906d0685ad252449254ff-137a4418-ca04-46dc-a1c4-3f47689108a6"),
  previewCard("blackout-ichigo-kurosaki", "Ichigo Kurosaki", "Bleach", "LR", "ebe38465c6a4d5892ce148567c27f82276922ab3a0f946b5a47f46a0c737c7c1-2edf87f59661c10a"),
  previewCard("blackout-sosuke-aizen", "S\u014Dsuke Aizen", "Bleach", "LR", "513e99b167e980644150cfa568ce893389234dc17f2a6a2348f7106bd7160d6a-81449e8479687e43"),
  previewCard("blackout-guts", "Guts", "Berserk", "LR", "4be2d74e3b81cbdf72d880c9ef66e0eb963bb8417baf2a879d2372e6c8a7377e-7dbef174-048a-4ea0-af59-96709d6cc613"),
  previewCard("blackout-madara-uchiha", "Madara Uchiha", "Naruto", "LR", "20f5bc4f195becf9cdd1201fbbfe4b00af9469442371cfae6cc391c175fd103f-b4b7cf67-df5b-42e6-a093-fab485c6620a")
];

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

export function buyBlackoutPreviewPack() {
  if (!blackoutPreviewEnabled) return;
  const wallet = readPreviewWallet();
  const { price, dailyLimit } = blackoutPreviewShop;
  if (wallet.balance < price || wallet.boughtToday >= dailyLimit) return;

  savePreviewWallet({
    ...wallet,
    balance: wallet.balance - price,
    boughtToday: wallet.boughtToday + 1,
    reserve: wallet.reserve + 1
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
