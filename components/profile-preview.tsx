"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ProfileExperience, type ProfileAdapter } from "@/components/profile";
import { Topbar } from "@/components/topbar";
import { getPaniniAlbumsPage, type CollectedCard } from "@/lib/data/cards";
import type { ProfileDetails, ProfileInterests } from "@/lib/data/profile";
import { PROFILE_IMAGE_MAX_BYTES } from "@/lib/data/profile";
import type { ProfileEngagement } from "@/lib/data/profile";
import { showcaseSelection, type ProfileStyle } from "@/lib/ui/profile-style";
import type { WallPost } from "@/lib/data/profile-wall";
import type { AuctionDetail, AuctionChatMessage } from "@/lib/data/market";

function previewSales(): AuctionDetail[] {
  return collection.slice(0, 2).map((card, index) => ({
    id: `preview-sale-${index}`,
    card,
    amount: index ? 180 : 500,
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    status: "active",
    seller: "Toba",
    sellerId: "preview",
    bids: 0,
    watched: false,
    balance: 2578,
    history: []
  }));
}

const collection: CollectedCard[] = [
  ["SATORU GOJO", "Jujutsu Kaisen", "gojou.webp", "LR"],
  ["LEVI ACKERMAN", "Attack on Titan", "levi.webp", "SSR"],
  ["MONKEY D. LUFFY", "One Piece", "luffy.webp", "SSR"]
].map(([name, anime, image, rarity], index) => ({
  id: `preview-${index}`,
  instanceId: `preview-instance-${index}`,
  name,
  anime,
  category: "ANIME/MANGA",
  rarity: rarity as CollectedCard["rarity"],
  image: `/assets/landing/${image}`,
  catalogueImage: `/assets/landing/${image}`,
  customImageUrl: null,
  folderId: null,
  obtainedAt: "2026-10-14T10:00:00Z",
  shiny: false,
  isEvolved: false,
  isFirstOwner: true
}));
const showcaseDemoCollection = Array.from({ length: 989 }, (_, index) => {
  const sample = collection[index % collection.length];
  const rarities = ["LR", "SSR", "SR", "R", "C"] as const;
  return {
    ...sample,
    id: "showcase-demo-" + index,
    instanceId: "showcase-demo-instance-" + index,
    name:
      index < 3
        ? sample.name
        : String(index + 1).padStart(3, "0") + " · " + sample.name,
    category: ["ANIME/MANGA", "VIDEO GAMES", "COMICS"][index % 3],
    rarity: rarities[index % rarities.length],
    shiny: index % 25 === 0
  };
});
const initial: ProfileInterests = {
  anime: ["One Piece", "Noragami", "Black Butler", "Jujutsu Kaisen"],
  games: ["Final Fantasy VII", "Silent Hill 2", "Hollow Knight"],
  kpop: ["BTS", "TWICE", "Stray Kids"],
  other: ["Studio Ghibli", "Le Seigneur des Anneaux", "Daft Punk"]
};
const licenses: Record<string, string[]> = {
  "ANIME/MANGA": [
    ...initial.anime,
    "Bleach",
    "Naruto",
    "Demon Slayer",
    "Attack on Titan",
    "Fullmetal Alchemist",
    "Hunter x Hunter",
    "Death Note",
    "Dragon Ball",
    "Chainsaw Man"
  ],
  "VIDEO GAMES": [
    ...initial.games,
    "Persona 5",
    "The Last of Us",
    "Elden Ring"
  ],
  KPOP: [...initial.kpop, "BLACKPINK", "EXO", "SEVENTEEN"],
  FILM: [
    "Le Seigneur des Anneaux",
    "Harry Potter",
    "Star Wars",
    "Studio Ghibli"
  ],
  KDRAMA: ["Goblin", "Crash Landing on You", "Squid Game"],
  COMICS: ["Marvel", "DC"],
  ARTIST: ["Daft Punk", "Taylor Swift", "The Weeknd"],
  BRAINROT: ["BRAINROT"],
  MEME: ["MEME"],
  VOCALOID: ["VOCALOID"],
  "DISNEY CHANNEL": ["DISNEY CHANNEL"],
  SPORT: ["NBA", "Football"],
  SERIE: ["Breaking Bad", "Stranger Things"],
  MANWHA: ["Solo Leveling", "Omniscient Reader"],
  ESPORT: ["League of Legends", "Valorant"],
  "INTERNET PERSONALITY": ["MrBeast", "Logan Paul"]
};

export function ProfilePreview() {
  const params = useSearchParams();
  const visitor = params.get("visitor") === "1";
  const privateProfile = params.get("private") === "1";
  const hiddenCollection =
    privateProfile && visitor && params.get("friend") !== "1";
  const demoCatalogue = params.get("catalogue") === "demo";
  const previewWidgets = demoCatalogue && params.get("widgets") === "1";
  const emptyFavorites = params.get("favorites") === "empty";
  const reportError = params.get("reportError") === "1";
  const showcaseDemo = params.get("showcase") === "demo";
  const owned = showcaseDemo ? showcaseDemoCollection : collection;
  const demoStyle = useRef<ProfileStyle | null>(null);
  const previewUrls = useRef<string[]>([]);
  const wishlistedCards = useRef(new Set<string>());
  const social = useRef<ProfileEngagement>({
    likes: 42,
    likedByMe: false
  });
  const wallPosts = useRef<WallPost[]>([
    {
      id: "demo-wall-1",
      text: "Une nouvelle carte dans la collection ✨\nQuel est votre anime du moment ?",
      mediaPath: null,
      gifUrl: null,
      createdAt: "2026-10-14T18:00:00Z"
    },
    {
      id: "demo-wall-2",
      text: "La carte que je cherchais depuis longtemps !",
      mediaPath: "demo-image",
      previewUrl: "/assets/landing/gojou.webp",
      gifUrl: null,
      createdAt: "2026-10-13T12:00:00Z"
    }
  ]);
  const wallUploads = useRef(new Map<string, string>());
  const sales = useRef<AuctionDetail[] | null>(null);
  const chatMessages = useRef<AuctionChatMessage[]>([]);
  useEffect(
    () => () => {
      previewUrls.current.forEach(url => URL.revokeObjectURL(url));
    },
    []
  );
  const adapter = useMemo<ProfileAdapter>(() => {
    const friends = [
      { id: "friend-1", pseudo: "Kitsune" },
      { id: "friend-2", pseudo: "Sakura" },
      { id: "friend-3", pseudo: "Rin" }
    ];
    const profile = () => ({
      titleId: "collector",
      unlockedTitleIds: visitor ? undefined : ["collector"],
      unseenTitleIds:
        !visitor && params.get("newTitle") === "1" ? ["collector"] : [],
      id: "preview",
      pseudo: "Toba",
      avatarUrl: "/assets/landing/gojou.webp",
      bio: "Les histoires qui restent, les cartes qu’on collectionne.\nAnime, RPG et découvertes en boucle ✧",
      bannerCard: collection[0],
      friendshipStatus: visitor ? ("accepted" as const) : ("self" as const),
      isPublic: !privateProfile,
      canViewCollection: !hiddenCollection,
      featuredCards: hiddenCollection
        ? []
        : showcaseDemo
          ? owned.slice(0, 10)
          : collection,
      ...(demoStyle.current
        ? { profileStyle: { active: true, style: demoStyle.current } }
        : {}),
      friendsVisible: !hiddenCollection,
      friends: hiddenCollection ? [] : friends,
      cardCount: hiddenCollection ? null : 2578,
      distinctCardCount: hiddenCollection ? null : 1342
    });
    const upload = async (file: File) => {
      if (
        file.size > PROFILE_IMAGE_MAX_BYTES ||
        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
          file.type
        )
      )
        throw new Error("Use a JPG, PNG, WebP or GIF image up to 4 MB.");
      const url = URL.createObjectURL(file);
      previewUrls.current.push(url);
      return url;
    };
    return {
      markTitlesSeen: async () => {},
      previewWidgets,
      discovery: {
        get: async (id, offset = 0, limit = 12) => {
          if (params.get("discoveryError") === "1")
            throw new Error("Détail indisponible.");
          const card = collection.find(item => item.id === id);
          if (!card) throw new Error("Carte introuvable.");
          const owners = Array.from({ length: 14 }, (_, index) => ({
            id: `demo-owner-${index}`,
            pseudo: index ? `Joueur ${index}` : "Kitsune",
            copies: 1,
            isFriend: index === 0
          }));
          return {
            card,
            marketValue: 250,
            activeAuctionId: null,
            wishlisted: wishlistedCards.current.has(id),
            ownerCount: owners.length,
            owners: owners.slice(offset, offset + limit)
          };
        },
        toggle: async id => {
          if (wishlistedCards.current.has(id)) {
            wishlistedCards.current.delete(id);
            return false;
          }
          wishlistedCards.current.add(id);
          return true;
        },
        report: async () => {}
      },
      friendCollection: async () => {
        if (hiddenCollection) throw new Error("Cette collection est privée.");
        return collection;
      },
      friendAlbums: async (
        _id,
        { query = "", category = "", page = 1, pageSize = 72 } = {}
      ) => {
        if (hiddenCollection) throw new Error("Cette collection est privée.");
        const items = collection
          .filter(
            card =>
              (!category || card.category === category) &&
              card.anime?.toLowerCase().includes(query.trim().toLowerCase())
          )
          .map(card => ({
            license: card.anime!,
            total: 1,
            owned: 1,
            percent: 100,
            favorite: card.anime === "One Piece"
          }))
          .sort(
            (a, b) =>
              Number(b.favorite) - Number(a.favorite) ||
              a.license.localeCompare(b.license)
          );
        return {
          items: items.slice((page - 1) * pageSize, page * pageSize),
          total: items.length
        };
      },
      friendAlbumCards: async (
        _id,
        {
          license,
          query = "",
          category = "",
          rarity = "",
          page = 1,
          pageSize = 28
        }
      ) => {
        if (hiddenCollection) throw new Error("Cette collection est privée.");
        const items = collection
          .filter(
            card =>
              card.anime === license &&
              (!category || card.category === category) &&
              (!rarity || card.rarity === rarity) &&
              card.name.toLowerCase().includes(query.toLowerCase())
          )
          .map(card => ({ ...card, owned: true }));
        return {
          items: items.slice((page - 1) * pageSize, page * pageSize),
          total: items.length
        };
      },
      market: {
        viewer: async () => (visitor ? "preview-visitor" : "preview"),
        list: async () => {
          if (params.get("salesError") === "1")
            throw new Error(
              "Les ventes en cours sont temporairement indisponibles."
            );
          sales.current ??= previewSales();
          return {
            items:
              hiddenCollection || params.get("salesEmpty") === "1"
                ? []
                : sales.current.filter(item => item.status === "active"),
            nextCursor: null
          };
        },
        get: async id => {
          if (params.get("auctionError") === "1")
            throw new Error("Cette enchère est introuvable.");
          const item = sales.current?.find(item => item.id === id);
          if (!item) throw new Error("Cette enchère est introuvable.");
          return {
            ...item,
            ...(params.get("auctionClosed") === "1"
              ? { status: "sold" as const, winner: "Kitsune" }
              : {}),
            history: [...item.history]
          };
        },
        bid: async (id, amount) => {
          const item = sales.current?.find(item => item.id === id);
          if (!visitor)
            throw new Error("Vous ne pouvez pas miser sur votre propre vente.");
          if (
            !item ||
            item.status !== "active" ||
            params.get("auctionClosed") === "1"
          )
            throw new Error("Cette enchère est terminée.");
          if (amount < item.amount + 10)
            throw new Error(
              "La mise doit dépasser l’offre actuelle d’au moins 10 karas."
            );
          if (amount > item.balance)
            throw new Error("Votre solde de karas est insuffisant.");
          item.balance -= amount;
          item.amount = amount;
          item.bids++;
          item.buyerId = "preview-visitor";
          item.history.unshift({
            id: `mock-bid-${item.bids}`,
            name: "Visiteur",
            amount,
            createdAt: new Date().toISOString(),
            mine: true
          });
          return {
            currentPrice: amount,
            endsAt: item.endsAt,
            balance: item.balance
          };
        },
        cancel: async id => {
          const item = sales.current?.find(item => item.id === id);
          if (visitor || !item || item.bids)
            throw new Error("Retrait impossible.");
          item.status = "expired";
        },
        watch: async id => {
          const item = sales.current?.find(item => item.id === id);
          if (!item) throw new Error("Enchère introuvable.");
          return (item.watched = !item.watched);
        },
        chat: {
          get: async id => ({
            canPost:
              !visitor || !!sales.current?.find(item => item.id === id)?.bids,
            participants: [],
            messages: [...chatMessages.current]
          }),
          send: async (_id, message, gifUrl) => {
            const item = {
              id: crypto.randomUUID(),
              userId: visitor ? "preview-visitor" : "preview",
              pseudo: visitor ? "Visiteur" : "Toba",
              message,
              gifUrl,
              createdAt: new Date().toISOString(),
              mine: true
            };
            chatMessages.current.push(item);
            return item;
          },
          moderation: {
            list: async () => [],
            block: async () => {},
            unblock: async () => {},
            report: async () => {}
          }
        }
      },
      wall: {
        list: async () => {
          if (hiddenCollection) throw new Error("Ce mur est privé.");
          return { items: [...wallPosts.current], next: null };
        },
        publish: async input => {
          if (visitor) throw new Error("Seul le propriétaire peut publier.");
          if (params.get("wallError") === "1")
            throw new Error(
              "Publication impossible. Ton brouillon est conservé."
            );
          const old = wallPosts.current.find(post => post.id === input.id);
          if (old) return old;
          const post = {
            ...input,
            createdAt: new Date().toISOString(),
            previewUrl: input.mediaPath
              ? wallUploads.current.get(input.mediaPath)
              : undefined
          };
          wallPosts.current.unshift(post);
          return post;
        },
        remove: async id => {
          if (visitor) throw new Error("Seul le propriétaire peut supprimer.");
          const post = wallPosts.current.find(item => item.id === id);
          wallPosts.current = wallPosts.current.filter(item => item.id !== id);
          return post?.mediaPath ?? null;
        },
        upload: async file => {
          const url = URL.createObjectURL(file);
          previewUrls.current.push(url);
          const path = `preview/${crypto.randomUUID()}`;
          wallUploads.current.set(path, url);
          return path;
        },
        discard: async path => {
          wallUploads.current.delete(path);
        }
      },
      profile: async () => profile(),
      wishlist: async () =>
        (hiddenCollection || params.get("wishlistEmpty") === "1"
          ? []
          : collection
        ).map(card => ({
          ...card,
          createdAt: "2026-10-13T10:00:00Z"
        })),
      blocked: async () => [],
      moderation: {
        list: async () => [],
        block: async () => {},
        unblock: async () => {},
        report: async () => {
          if (reportError)
            throw new Error("Impossible de transmettre ce signalement.");
        }
      },
      engagement: async () => ({ ...social.current }),
      like: async (_id, liked) => {
        social.current = {
          ...social.current,
          likes:
            social.current.likes +
            Number(liked) -
            Number(social.current.likedByMe),
          likedByMe: liked
        };
        return { ...social.current };
      },
      saveWidgets: async value => value,
      widgetLicenses: async ({ category, query = "", page = 1 }) => {
        if (!demoCatalogue) {
          const data = await getPaniniAlbumsPage({
            category,
            query,
            page,
            pageSize: 72
          });
          return {
            items: data.items.map(album => album.license),
            total: data.total
          };
        }
        const items = (licenses[category] ?? [])
          .filter(license =>
            license.toLowerCase().includes(query.trim().toLowerCase())
          )
          .toSorted((a, b) => a.localeCompare(b, "fr"));
        return {
          items: items.slice((page - 1) * 72, page * 72),
          total: items.length
        };
      },
      uploadAvatar: upload,
      uploadBanner: upload,
      ...(showcaseDemo
        ? {
            saveShowcaseStyle: async (style: ProfileStyle) => {
              demoStyle.current = style;
            }
          }
        : {}),
      saveAppearance: async (
        bio,
        avatarUrl,
        ids,
        bannerCardId,
        bannerUrl,
        bannerFrame
      ) => ({
        ...profile(),
        bio,
        avatarUrl,
        bannerUrl,
        bannerFrame,
        bannerCard: collection.find(card => card.id === bannerCardId) ?? null,
        featuredCards: showcaseSelection(owned, new Set(ids))
      }),
      details: async () =>
        ({
          joinedAt: "2025-11-21T10:00:00Z",
          interests: initial,
          widgets: [
            { category: "ANIME/MANGA", entries: initial.anime },
            { category: "VIDEO GAMES", entries: initial.games },
            { category: "KPOP", entries: initial.kpop },
            {
              category: "FILM",
              entries: ["Studio Ghibli", "Le Seigneur des Anneaux"]
            }
          ],
          widgetCategories: previewWidgets ? Object.keys(licenses) : [],
          bannerUrl: null,
          bannerFrame: null,
          boostersOpened: hiddenCollection ? null : 824,
          lrCount: hiddenCollection ? null : 12,
          ssrCount: hiddenCollection ? null : 86,
          mutualFriends: hiddenCollection ? [] : friends.slice(0, 2),
          favoriteAlbums:
            hiddenCollection || emptyFavorites
              ? []
              : [
                  { license: "One Piece", owned: 156, total: 195, percent: 80 },
                  { license: "Naruto", owned: 95, total: 119, percent: 80 },
                  {
                    license: "Black Butler",
                    owned: 107,
                    total: 107,
                    percent: 100
                  },
                  { license: "KPOP", owned: 47, total: 56, percent: 84 },
                  { license: "Noragami", owned: 45, total: 62, percent: 73 },
                  {
                    license: "Final Fantasy",
                    owned: 48,
                    total: 63,
                    percent: 76
                  }
                ],
          activity: hiddenCollection
            ? []
            : collection.map((card, index) => ({
                id: card.id,
                kind: (["obtained", "bought", "sold"] as const)[index],
                at: `2026-10-${14 - index}T10:00:00Z`,
                card,
                ...(index ? { price: index === 1 ? 240 : 180 } : {})
              }))
        }) satisfies ProfileDetails
    };
  }, [
    visitor,
    privateProfile,
    hiddenCollection,
    demoCatalogue,
    reportError,
    previewWidgets,
    emptyFavorites,
    showcaseDemo,
    owned,
    params
  ]);
  return (
    <>
      <Topbar view="profile" name="Toba" karas={2578} notifications={[]} />
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <p className="eyebrow">Aperçu local · données de démonstration</p>
        <h1 className="yk-title mt-3">Profil du collectionneur</h1>
        <div className="mt-8">
          <ProfileExperience
            key={`${visitor}:${privateProfile}:${demoCatalogue}`}
            adapter={adapter}
            collection={
              params.get("bannerCards") === "empty"
                ? []
                : params.get("bannerCards") === "duplicates"
                  ? [...collection, ...collection]
                  : owned
            }
          />
        </div>
      </main>
    </>
  );
}
