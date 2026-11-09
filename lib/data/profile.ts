import { readRequest } from "@/lib/data/read-request";
import type { CollectionSort } from "@/lib/ui/collection-sort";
import { createClient } from "@/utils/supabase/client";
import {
  withLiveCardFranchises,
  type CardFilter,
  type Card,
  type CollectedCard,
  type PaniniAlbumCardPage,
  type PaniniAlbumPage,
  type Rarity
} from "@/lib/data/cards";
import type { FriendUser, FriendshipStatus } from "@/lib/data/friends";
import { publishPlayerSnapshotInvalidation } from "@/lib/data/player-state";
// Same encoding as cardFilterParam in cards.ts (kept local: this module only
// imports types from cards.ts).
const friendFilterParam = (value: CardFilter = "") =>
  typeof value === "string"
    ? value
    : value.length > 1
      ? JSON.stringify(value)
      : (value[0] ?? "");
import type { BannerFrame } from "@/lib/ui/banner-frame";
import type { PlayerCosmetics } from "@/components/styled-player-name";

export type Profile = {
  profileStyle?: PlayerCosmetics;
  id: string;
  pseudo: string;
  avatarUrl: string | null;
  bio: string;
  bannerCard: Card | null;
  friendshipStatus: FriendshipStatus;
  isPublic: boolean;
  canViewCollection: boolean;
  featuredCards: CollectedCard[];
  friends: (FriendUser & { avatarUrl?: string | null })[];
  friendsVisible: boolean;
  cardCount: number | null;
  distinctCardCount: number | null;
};
export type ProfileInterests = {
  anime: string[];
  games: string[];
  kpop: string[];
  other: string[];
};
export type ProfileWidget = { category: string; entries: string[]; labels?: Record<string, string>; unresolvedEntries?: string[] };
export type ProfileLicensePage = { items: string[]; total: number; labels?: Record<string, string>; origins?: Record<string, "series" | "source"> };
export type ProfileEngagement = {likes:number;likedByMe:boolean};
export async function getProfileEngagement(
  ownerId: string
): Promise<ProfileEngagement> {
  const { data, error } = await readRequest(signal =>
    db()
      .rpc("get_profile_engagement", { p_owner_id: ownerId })
      .abortSignal(signal)
  );
  if (error) throw new Error("Likes are temporarily unavailable.");
  return data as ProfileEngagement;
}
export async function setProfileLike(
  ownerId: string,
  liked: boolean
): Promise<ProfileEngagement> {
  const { data, error } = await db().rpc("set_profile_like", {
    p_owner_id: ownerId,
    p_liked: liked
  });
  if (error)
    throw new Error(
      "Couldn't update this profile like. Please try again in a moment."
    );
  return data as ProfileEngagement;
}
export type ProfileDetails = {
  joinedAt: string | null;
  interests: ProfileInterests;
  widgets: ProfileWidget[];
  widgetCategories: string[];
  bannerUrl: string | null;
  bannerFrame?: BannerFrame | null;
  boostersOpened: number | null;
  lrCount: number | null;
  ssrCount: number | null;
  mutualFriends: FriendUser[];
  favoriteAlbums: {
    license: string;
    binderKey?: string;
    origin?: "series" | "source";
    total: number;
    owned: number;
    percent: number;
  }[];
  activity: {
    id: string;
    kind: "obtained" | "bought" | "sold";
    at: string;
    price?: number;
    card: Card;
  }[];
};
let client: ReturnType<typeof createClient> | undefined;
const db = () => (client ??= createClient());
function fail(error: { message?: string }) {
  const messages: Record<string, string> = {
    PRO_REQUIRED: "This feature is available to Pro members only.",
    PROFILE_NOT_FOUND: "This profile couldn't be found.",
    BIO_TOO_LONG: "Your bio can contain up to 300 characters.",
    AVATAR_URL_INVALID:
      "This URL is not allowed. Use the button to upload your avatar (up to 2,048 characters).",
    FEATURED_CARDS_INVALID:
      "Your showcase selection exceeds your membership limit.",
    CARD_NOT_OWNED: "This card is no longer in your collection.",
    FRIENDS_ONLY: "Only friends can view the full collection.",
    PROFILE_PRIVATE:
      "This profile is private. Only friends can view its collection."
  };
  return new Error(
    messages[error.message ?? ""] ?? "Couldn't load profile data."
  );
}
async function hydrateProfile(profile: Profile, bounded = false) {
  const bannerCard = profile.bannerCard
    ? (await withLiveCardFranchises([profile.bannerCard], bounded))[0]
    : null;
  const featuredCards = await withLiveCardFranchises(
    profile.featuredCards,
    bounded
  );
  const friendsVisible =
    profile.friendsVisible ?? profile.friendshipStatus === "self";
  const friends =
    friendsVisible && Array.isArray(profile.friends) ? profile.friends : [];
  return { ...profile, bannerCard, featuredCards, friends, friendsVisible };
}
export async function getProfile(identifier?: string) {
  const { data, error } = await readRequest(signal =>
    db()
      .rpc("get_profile", { p_identifier: identifier ?? null })
      .abortSignal(signal)
  );
  if (error) throw fail(error);
  return hydrateProfile(data as Profile, true);
}
export async function getProfileDetails(
  identifier?: string
): Promise<ProfileDetails> {
  const { data, error } = await readRequest(signal =>
    db()
      .rpc(typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true" ? "get_profile_details_with_binders" : "get_profile_details", { p_identifier: identifier ?? null })
      .abortSignal(signal)
  );
  if (error) throw fail(error);
  return data as ProfileDetails;
}
export async function saveProfileInterests(
  interests: ProfileInterests
): Promise<ProfileInterests> {
  const { data, error } = await db().rpc("update_profile_interests", {
    p_interests: interests
  });
  if (error)
    throw new Error(
      "Couldn't save your dashboard. Each section can contain up to 12 titles of 100 characters."
    );
  publishPlayerSnapshotInvalidation(["profile"]);
  return data as ProfileInterests;
}
export async function saveProfileWidgets(
  widgets: ProfileWidget[]
): Promise<ProfileWidget[]> {
  const stable = typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true";
  const { data, error } = await db().rpc(stable ? "set_profile_binder_widgets" : "update_profile_widgets", {
    p_widgets: stable ? widgets.map(({category, entries}) => ({category, entries})) : widgets
  });
  if (error)
    throw new Error(
      "Couldn't save your widgets. Choose up to 12 catalog franchises per category; a franchise may have been renamed or removed."
    );
  publishPlayerSnapshotInvalidation(["profile"]);
  return data as ProfileWidget[];
}
export async function getProfileWidgetLicenses({
  category,
  query = "",
  page = 1
}: {
  category: string;
  query?: string;
  page?: number;
}): Promise<ProfileLicensePage> {
  const { data, error } = await readRequest(signal =>
    db()
      .rpc(typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true" ? "get_profile_binders_page" : "get_profile_widget_licenses", {
        p_category: category,
        p_query: query,
        p_offset: (Math.max(1, Math.trunc(page)) - 1) * 72,
        p_limit: 72
      })
      .abortSignal(signal)
  );
  if (error)
    throw new Error("Couldn't load franchises. Please try again in a moment.");
  const result = data as ProfileLicensePage | null;
  return { items: result?.items ?? [], total: result?.total ?? 0, ...(result?.labels ? {labels: result.labels, origins: result.origins} : {}) };
}
export async function saveProfileAppearance(
  bio: string,
  avatarUrl: string | null,
  featuredIds: string[],
  bannerCardId: string | null,
  bannerUrl: string | null,
  bannerFrame?: BannerFrame | null
): Promise<
  Profile & { bannerUrl: string | null; bannerFrame?: BannerFrame | null }
> {
  const { data, error } = await db().rpc(
    bannerFrame === undefined
      ? "update_profile_appearance"
      : "update_profile_appearance_framed",
    {
      p_bio: bio,
      p_avatar_url: avatarUrl,
      p_featured_card_ids: featuredIds,
      p_banner_card_id: bannerCardId,
      p_banner_url: bannerUrl,
      ...(bannerFrame === undefined ? {} : { p_banner_frame: bannerFrame })
    }
  );
  if (error?.code === "PGRST202" && bannerFrame !== undefined)
    throw new Error(
      "Banner framing is not available yet. Please try again after the update."
    );
  if (error?.message === "BANNER_FRAME_INVALID")
    throw new Error(
      "This banner crop is invalid. Adjust the image and try again."
    );
  if (
    error?.message === "BANNER_CARD_NOT_OWNED" ||
    error?.message === "BANNER_URL_DISABLED"
  )
    throw new Error(
      "Choose a card you own from your collection for your banner."
    );
  if (error)
    throw error.message === "BANNER_URL_INVALID"
      ? new Error(
          "This banner is not allowed. Upload a JPG, PNG, WebP or GIF image using the banner button."
        )
      : fail(error);
  const profile = await hydrateProfile(
    data as Profile & {
      bannerUrl: string | null;
      bannerFrame?: BannerFrame | null;
    }
  );
  publishPlayerSnapshotInvalidation(["profile"]);
  return profile as Profile & { bannerUrl: string | null };
}
export const PROFILE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export async function uploadBanner(file: File, _userId: string) {
  return uploadProfileMedia(file, "banner", "Your banner", "your banner");
}
export async function getFriendCollection(friendId: string, includeBinderMetadata = true) {
  const { data, error } = await readRequest(signal =>
    db()
      .rpc("get_friend_collection", { p_friend_id: friendId })
      .abortSignal(signal)
  );
  if (error) throw fail(error);
  const cards = data as CollectedCard[];
  if (includeBinderMetadata && typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true") return (await import("@/lib/data/binders")).withBinderMetadata(cards);
  return cards;
}
export async function getFriendPaniniAlbumsPage(
  friendId: string,
  {
    query = "",
    category = "",
    page = 1,
    pageSize = 72
  }: {
    query?: string;
    category?: CardFilter;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<PaniniAlbumPage> {
  const safePage = Math.max(1, Math.trunc(page));
  const safePageSize = Math.min(72, Math.max(1, Math.trunc(pageSize)));
  const stable = typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true";
  const { data, error } = await readRequest(signal =>
    db()
      .rpc(stable ? "get_binder_albums_page" : "get_friend_panini_albums_page", stable ? {
        p_owner_id: friendId, p_query: query, p_category: friendFilterParam(category), p_favorites_only: false,
        p_offset: (safePage - 1) * safePageSize, p_limit: safePageSize
      } : {
        p_friend_id: friendId,
        p_query: query,
        p_category: friendFilterParam(category),
        p_offset: (safePage - 1) * safePageSize,
        p_limit: safePageSize
      })
      .abortSignal(signal)
  );
  if (error) throw fail(error);
  const result = data as PaniniAlbumPage | null;
  return { items: result?.items ?? [], total: result?.total ?? 0 };
}
export async function getFriendPaniniAlbumCardsPage(
  friendId: string,
  {
    license,
    query = "",
    category = "",
    rarity = "",
    ownedOnly = false,
    page = 1,
    pageSize = 24,
    sort = "rarity"
  }: {
    license: string;
    query?: string;
    category?: CardFilter;
    rarity?: CardFilter;
    ownedOnly?: boolean;
    page?: number;
    pageSize?: number;
    sort?: CollectionSort;
  }
): Promise<PaniniAlbumCardPage> {
  const safePage = Math.max(1, Math.trunc(page));
  const safePageSize = Math.min(60, Math.max(1, Math.trunc(pageSize)));
  const stable = typeof process !== "undefined" && process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true";
  const { data, error } = await readRequest(signal =>
    db()
      .rpc(stable ? "get_binder_cards_page" : "get_friend_panini_album_cards_page", stable ? {
        p_owner_id: friendId, p_binder_key: license, p_query: query, p_category: friendFilterParam(category), p_rarity: friendFilterParam(rarity),
        p_owned_only: ownedOnly, p_offset: (safePage - 1) * safePageSize, p_limit: safePageSize, p_sort: sort
      } : {
        p_friend_id: friendId,
        p_license: license,
        p_query: query,
        p_category: friendFilterParam(category),
        p_owned_only: ownedOnly,
        p_offset: (safePage - 1) * safePageSize,
        p_limit: safePageSize,
        ...(friendFilterParam(rarity) ? { p_rarity: friendFilterParam(rarity) } : {})
      })
      .abortSignal(signal)
  );
  if (error) throw fail(error);
  const result = data as PaniniAlbumCardPage | null;
  return { items: result?.items ?? [], total: result?.total ?? 0,
    ...(stable ? {binderTotal: result?.binderTotal, binderOwned: result?.binderOwned} : {}) };
}
export async function saveProfile(
  bio: string,
  avatarUrl: string | null,
  featuredIds: string[],
  bannerCardId: string | null
) {
  const { data, error } = await db().rpc("update_profile", {
    p_bio: bio,
    p_avatar_url: avatarUrl,
    p_featured_card_ids: featuredIds,
    p_banner_card_id: bannerCardId
  });
  if (error) throw fail(error);
  const profile = await hydrateProfile(data as Profile);
  publishPlayerSnapshotInvalidation(["profile"]);
  return profile;
}
export async function uploadAvatar(file: File, _userId: string) {
  return uploadProfileMedia(
    file,
    "avatar",
    "Your profile photo",
    "your profile photo"
  );
}
// Server-validated, reserved and quota-checked: the only avatars write path.
async function uploadProfileMedia(
  file: File,
  purpose: "avatar" | "banner",
  label: string,
  name: string
) {
  if (file.size > PROFILE_IMAGE_MAX_BYTES)
    throw new Error(`${label} must be 4 MB or smaller.`);
  if (
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)
  )
    throw new Error("Use a JPG, PNG, WebP or GIF image.");
  const form = new FormData();
  form.set("file", file);
  form.set("purpose", purpose);
  const response = await fetch("/api/profile-media", {
    method: "POST",
    body: form
  });
  const result = await response.json();
  if (!response.ok || typeof result.url !== "string")
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : `Couldn't upload ${name}. Please try again.`
    );
  return result.url as string;
}
