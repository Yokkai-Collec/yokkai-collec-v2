"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ProfileCompletion } from "@/components/profile-completion";
import type {
  Profile,
  ProfileDetails,
  getFriendPaniniAlbumCardsPage
} from "@/lib/data/profile";
import type { PaniniAlbumCard } from "@/lib/data/cards";
import "@/styles/profile.css";

const names = [
  "Bleach",
  "BLUE LOCK",
  "Boruto: Naruto Next Generations",
  "Dark Horse Comics",
  "DC Comics",
  "Dragon Ball",
  "Dragon Ball Super",
  "Icon Comics",
  "Image Comics",
  "Invincible",
  "JUJUTSU KAISEN",
  "JUJUTSU KAISEN MODULO",
  "KINGDOM",
  "Kuroko's Basketball",
  "Marvel",
  "MR. ROBOT",
  "ONE PIECE",
  "Attack on Titan",
  "Mushoku Tensei: Jobless Reincarnation",
  "NANA",
  "Harry Potter",
  "Vagabond",
  "Sonic Adventure 2",
  "Re:ZERO -Starting Life in Another World-",
  "Code Geass: Lelouch of the Rebellion"
];
const cover = (index: number) =>
  index % 2
    ? "/assets/premium-examples/gojo-original.png"
    : "/assets/landing/luffy.webp";
const ownerId = "84000000-0000-4000-8000-000000000001";
const profile: Profile = {
  id: ownerId,
  pseudo: "Kitsune",
  avatarUrl: null,
  bio: "",
  bannerCard: null,
  friendshipStatus: "accepted",
  isPublic: true,
  canViewCollection: true,
  featuredCards: [],
  friends: [],
  friendsVisible: true,
  cardCount: 100,
  distinctCardCount: 100
};
export function ProfileFavoriteBindersPreview({
  count = 25,
  privateProfile = false,
  fail = false
}: {
  count?: number;
  privateProfile?: boolean;
  fail?: boolean;
}) {
  const t = useTranslations("profileUi");
  const [requests, setRequests] = useState(0);
  const preview = useRef<HTMLElement>(null);
  useEffect(() => {
    preview.current?.setAttribute("data-preview-ready", "true");
  }, []);
  const attempts = useRef(0);
  const firstFailure = useRef<Promise<never> | undefined>(undefined);
  const loadCards = useCallback<typeof getFriendPaniniAlbumCardsPage>(
    async (owner, options = { license: "" }) => {
      setRequests(value => value + 1);
      if (owner !== ownerId) throw Error("Unexpected owner");
      if (fail && attempts.current++ === 0) {
        firstFailure.current = Promise.reject(
          new Error("Simulated unavailable binder")
        );
        queueMicrotask(() => {
          firstFailure.current = undefined;
        });
        return firstFailure.current;
      }
      if (firstFailure.current) return firstFailure.current;
      const index = Number(options.license.replace("preview-", ""));
      const owned = index === 1 ? 50 : 7 + index;
      const all: PaniniAlbumCard[] = Array.from({ length: 50 }, (_, card) => ({
        id: `preview-card-${card}`,
        name: card % 2 ? "SATORU GOJO" : "MONKEY D. LUFFY",
        anime: names[index] ?? names[0],
        category: "ANIME/MANGA",
        rarity: card % 2 ? "SSR" : "LR",
        image: cover(card),
        owned: card < owned
      }));
      const filtered = options.ownedOnly ? all.filter(card => card.owned) : all;
      const start = ((options.page ?? 1) - 1) * (options.pageSize ?? 24);
      return {
        items: filtered.slice(start, start + (options.pageSize ?? 24)),
        total: filtered.length,
        binderTotal: 50,
        binderOwned: owned
      };
    },
    [fail]
  );
  const albums = names.slice(0, count).map((license, index) => ({
    license,
    binderKey: `preview-${index}`,
    image: cover(index),
    total: 50,
    owned: index === 1 ? 50 : 7 + index,
    percent: index === 1 ? 100 : Math.round((7 + index) * 2)
  }));
  const details: ProfileDetails = {
    joinedAt: null,
    interests: { anime: [], games: [], kpop: [], other: [] },
    widgets: [],
    widgetCategories: [],
    bannerUrl: null,
    boostersOpened: 0,
    lrCount: 0,
    ssrCount: 0,
    mutualFriends: [],
    favoriteAlbums: albums,
    activity: []
  };
  return (
    <main
      ref={preview}
      className="yk-profile-favorite-preview"
      data-request-count={requests}
    >
      <h1>{t("favoriteBinders")}</h1>
      <ProfileCompletion
        profile={{ ...profile, canViewCollection: !privateProfile }}
        details={details}
        detailsError=""
        isMe={false}
        loadCards={loadCards}
      />
    </main>
  );
}
