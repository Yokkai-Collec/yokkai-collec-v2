"use client";
import { useSyncExternalStore } from "react";
import { showcaseScrollRef } from "@/lib/ui/profile-style";
import { i18nEnabled } from "@/i18n/locale";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations, useFormatter } from "next-intl";
const subscribeToHydration = () => () => {};
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type CSSProperties
} from "react";
import { Avatar, Button, Modal, Toast } from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import { CardShell } from "@/components/card-shell";
import dynamic from "next/dynamic";
import { ProfilePrivate } from "@/components/profile-private";
import { PlayerModeration } from "@/components/player-moderation";
import { ProfileWall } from "@/components/profile-wall";
import { BannerImage } from "@/components/banner-image";
import { ProfileStyleFields } from "@/components/profile-style-fields";
import { AvatarDecoration } from "@/components/avatar-decoration";
import { StyledPlayerName } from "@/components/styled-player-name";
import { PlayerTitle, NewTitlesBadge } from "@/components/player-title";
import {
  DEFAULT_PROFILE_STYLE,
  PROFILE_CARD_IMAGE_SIZES,
  profileWidgetLabel as widgetLabel,
  tiltShowcaseCard,
  resetShowcaseCard,
  showcaseCardPosition,
  showcaseDesignAttributes,
  normalizeProfileStyle,
  showcaseColorVariables,
  type ProfileStyle
} from "@/lib/ui/profile-style";
import { useProAccess, useProMembershipStatus } from "@/components/pro-access";
import type { BannerFrame } from "@/lib/ui/banner-frame";
import type { CatalogueCardAdapter } from "@/components/community-views";
import type { WallAdapter } from "@/lib/data/profile-wall";
import type { ProfileMarketAdapter } from "@/lib/data/profile-market";
import { listBlockedUsers, type BlockedUser } from "@/lib/data/moderation";
import { type ModerationAdapter } from "@/lib/data/moderation";
import {
  FriendAction,
  FriendMessageButton,
  type FriendActionAdapter
} from "@/components/friends";
import { type Card, type CollectedCard, type Rarity } from "@/lib/data/cards";
import {
  getFriendCollection,
  getFriendPaniniAlbumCardsPage,
  getFriendPaniniAlbumsPage,
  getProfile,
  getProfileDetails,
  getProfileEngagement,
  setProfileLike,
  getProfileWidgetLicenses,
  saveProfileAppearance,
  saveProfileWidgets,
  uploadAvatar,
  uploadBanner,
  type ProfileDetails,
  type ProfileEngagement,
  type Profile
} from "@/lib/data/profile";
import { getWishlist, type WishlistCard } from "@/lib/data/wishlist";
import { matchesCardSearch } from "@/lib/ui/card-search";
const ProfileRecentCards = dynamic(() =>
  import("@/components/profile-recent-cards").then(
    module => module.ProfileRecentCards
  )
);
const ProfileFeaturedCollection = dynamic(() =>
  import("@/components/profile-featured").then(
    module => module.ProfileFeaturedCollection
  )
);

function warmCollectionView() {
  void import("@/components/collection").catch(() => {});
}
const CollectionView = dynamic(
  () => import("@/components/collection").then(module => module.CollectionView),
  {
    loading: function CollectionLoading() {
      const t = useTranslations();
      return <p role="status">{t("profileUi.loadingCollection")}</p>;
    }
  }
);

const ProfileSales = dynamic(() =>
  import("@/components/profile-sales").then(module => module.ProfileSales)
);

const CatalogueCardModal = dynamic(() =>
  import("@/components/community-views").then(
    module => module.CatalogueCardModal
  )
);

const FEATURED_CARD_LIMIT = 5;

const PreferencesEditor = dynamic(() =>
  import("@/components/profile-preferences-editor").then(
    module => module.PreferencesEditor
  )
);

const ShowcaseAtmosphere = dynamic(() =>
  import("@/components/showcase-atmosphere").then(
    module => module.ShowcaseAtmosphere
  )
);

function Featured({
  cards,
  adapter,
  design,
  emptyLabel,
  slots = FEATURED_CARD_LIMIT
}: {
  cards: CollectedCard[];
  adapter?: CatalogueCardAdapter;
  design?: Partial<ProfileStyle>;
  emptyLabel?: string;
  slots?: number;
}) {
  const t = useTranslations();
  const [selected, setSelected] = useState<Card | null>(null);
  const pathname = usePathname();
  const publicPseudo = pathname.startsWith("/profile/")
    ? decodeURIComponent(pathname.slice("/profile/".length))
    : undefined;
  const label =
    emptyLabel ??
    (publicPseudo
      ? t("profileUi.noFeaturedCards", { name: publicPseudo })
      : undefined);
  if (!cards.length && label)
    return (
      <div className="yk-featured-empty-state">
        <span aria-hidden="true">✦</span>
        <p>{label}</p>
      </div>
    );
  return (
    <>
      <ShowcaseAtmosphere
        scene={design?.showcaseScene}
        intensity={design?.showcaseIntensity}
      />
      <div
        className="yk-card-grid yk-featured-stage"
        ref={showcaseScrollRef}
        {...showcaseDesignAttributes(design)}
      >
        {cards.map((card, index) => (
          <div
            key={card.instanceId}
            style={showcaseCardPosition(index, cards.length) as CSSProperties}
          >
            <button
              type="button"
              className="yk-profile-showcase-card"
              onPointerMove={tiltShowcaseCard}
              onPointerLeave={resetShowcaseCard}
              aria-label={t("collectionUi.viewCard", { name: card.name })}
              aria-haspopup="dialog"
              onClick={() => setSelected(card)}
            >
              <YokaiCard {...card} imageSizes={PROFILE_CARD_IMAGE_SIZES} />
            </button>
          </div>
        ))}
        {Array.from({ length: Math.max(0, slots - cards.length) }, (_, i) => (
          <div key={`empty-${i}`} className="yk-featured-empty">
            <span aria-hidden="true">✦</span>
            <small>{t("profileUi.emptySlot")}</small>
          </div>
        ))}
      </div>
      {selected && (
        <CatalogueCardModal
          selected={selected}
          adapter={adapter}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

const Editor = dynamic(
  () => import("@/components/profile-editor").then(module => module.Editor),
  {
    loading: function EditorLoading() {
      const t = useTranslations();
      return <p role="status">{t("profileUi.loadingProfileEditor")}</p>;
    }
  }
);

function ProfileStyleEditor({
  profile,
  onSaved,
  onClose
}: {
  profile: Profile;
  onSaved: (style: ProfileStyle) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const pro = useProAccess();
  const membership = useProMembershipStatus();
  const initialStyle = normalizeProfileStyle({
    ...DEFAULT_PROFILE_STYLE,
    ...profile.profileStyle?.style
  });
  const [style, setStyle] = useState(initialStyle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!pro || busy) return;
    setBusy(true);
    setError("");
    try {
      await import("@/lib/data/showcase-style").then(module =>
        module.persistProfileStyle(style)
      );
      onSaved(style);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Your profile style couldn't be saved. Try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-profile-editor="style">
      <ProfileStyleFields
        showShowcase={false}
        name={profile.pseudo}
        avatarUrl={profile.avatarUrl}
        value={style}
        onChange={setStyle}
        busy={busy}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
        </p>
      )}
      <div className="yk-profile-style-actions">
        {!pro && (
          <p>
            {membership === true
              ? t("profileUi.proStyleUnavailable")
              : membership === null
                ? t("profileUi.membershipUnavailable")
                : t("profileUi.stylePreviewNotice")}
          </p>
        )}
        <div>
          <Button variant="secondary" onClick={onClose}>
            {t("packs.cancel")}{" "}
          </Button>
          <Button
            disabled={busy || !pro}
            aria-describedby={!pro ? "profile-style-save-help" : undefined}
            onClick={() => void submit()}
          >
            {busy
              ? t("collectionUi.saving")
              : pro
                ? t("profileUi.saveApply")
                : membership === true
                  ? t("profileUi.styleUnavailable")
                  : membership === null
                    ? t("profileUi.statusUnavailable")
                    : t("profileUi.proRequired")}
          </Button>
        </div>
        {!pro && (
          <span id="profile-style-save-help" className="sr-only">
            {membership === true
              ? t("profileUi.activeProRetry")
              : membership === null
                ? t("profileUi.membershipPending")
                : t("profileUi.styleUpgradeHint")}
          </span>
        )}
      </div>
    </div>
  );
}

const wishlistRarities: Rarity[] = ["LR", "SSR", "SR", "R", "C"];
const wishlistRarityText: Record<Rarity, string> = {
  C: "text-rarity-c",
  R: "text-rarity-r",
  SR: "text-rarity-sr",
  SSR: "text-rarity-ssr",
  LR: "text-rarity-lr"
};
// Same look as the shared FilterSection. profile.tsx keeps its imports fixed, so the
// open/closed state is not remembered here (ponytail: import FilterSection if that is needed).
function WishlistFilterSection({
  title,
  count = 0,
  children
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const t = useTranslations();
  return (
    <details
      className="yk-filter-section"
      open={title === t("collectionUi.rarity")}
    >
      <summary
        aria-label={
          count ? t("profileUi.activeFilters", { title, count }) : undefined
        }
      >
        <span>
          {title}
          {count > 0 && <span className="yk-filter-count"> · {count}</span>}
        </span>
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="m7 10 5 5 5-5" />
        </svg>
      </summary>
      <div className="yk-filter-section-content">{children}</div>
    </details>
  );
}
function FriendWishlist({
  cards,
  onNavigate,
  onSelect
}: {
  cards: WishlistCard[];
  onNavigate: () => void;
  onSelect: (card: WishlistCard) => void;
}) {
  const t = useTranslations();
  const openCard =
    (card: WishlistCard) => (event: MouseEvent<HTMLAnchorElement>) => {
      // Preserve href for new tabs and the navigation fallback.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        onNavigate();
        return;
      }
      event.preventDefault();
      onSelect(card);
    };
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState<Rarity[]>([]);
  const [category, setCategory] = useState("");
  const categories = useMemo(
    () =>
      [...new Set(cards.map(card => card.category))].sort((a, b) =>
        a.localeCompare(b, "en-US")
      ),
    [cards]
  );
  const shown = useMemo(
    () =>
      cards.filter(
        card =>
          matchesCardSearch(query, [card.name, card.category, card.anime]) &&
          (!rarity.length || rarity.includes(card.rarity)) &&
          (!category || card.category === category)
      ),
    [cards, query, rarity, category]
  );
  const filtered = !!(query || rarity.length || category);
  return (
    <div className="yk-friend-wishlist-layout">
      <aside
        className="yk-collection-sidebar yk-friend-wishlist-filters"
        aria-label={t("profileUi.wishlistFilters")}
      >
        <button
          type="button"
          className="yk-filter-reset"
          disabled={!filtered}
          onClick={() => {
            setQuery("");
            setRarity([]);
            setCategory("");
          }}
        >
          {t("collectionUi.resetFilters")}{" "}
        </button>
        <div className="yk-filter-search">
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <label className="sr-only" htmlFor="friend-wishlist-query">
            {t("catalogueUi.searchWishlist")}{" "}
          </label>
          <input
            id="friend-wishlist-query"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t("collectionUi.search")}
          />
        </div>
        <WishlistFilterSection
          title={t("collectionUi.rarity")}
          count={rarity.length}
        >
          <div className="yk-rarity-chips">
            {wishlistRarities.map(item => (
              <button
                type="button"
                key={item}
                className={`yk-rarity-chip ${wishlistRarityText[item]}`}
                aria-pressed={rarity.includes(item)}
                onClick={() =>
                  setRarity(current =>
                    current.includes(item)
                      ? current.filter(value => value !== item)
                      : [...current, item]
                  )
                }
              >
                <span>{item}</span>
              </button>
            ))}
          </div>
        </WishlistFilterSection>
        <WishlistFilterSection
          title={t("collectionUi.category")}
          count={category ? 1 : 0}
        >
          {categories.map(item => (
            <button
              type="button"
              key={item}
              className="yk-filter-option"
              aria-pressed={category === item}
              onClick={() =>
                setCategory(current => (current === item ? "" : item))
              }
            >
              <span className="yk-filter-check" />
              <span>{item}</span>
            </button>
          ))}
        </WishlistFilterSection>
      </aside>
      <section
        className="yk-friend-wishlist-results"
        aria-label={t("profileUi.wishlistCards")}
      >
        <p role="status" className="yk-friend-wishlist-count">
          {t("profileUi.wishlistResultCount", {
            count: shown.length,
            filtered: filtered ? "yes" : "no"
          })}
        </p>
        {shown.length ? (
          <div className="yk-card-grid yk-wishlist-grid">
            {shown.map(card => (
              <Link
                href={`/catalog?carte=${card.id}`}
                key={card.id}
                onClick={openCard(card)}
                aria-haspopup="dialog"
                aria-label={t("profileUi.viewCatalogCard", { name: card.name })}
              >
                <CardShell>
                  <YokaiCard
                    {...card}
                    animated={false}
                    imageSizes={PROFILE_CARD_IMAGE_SIZES}
                  />
                </CardShell>
              </Link>
            ))}
          </div>
        ) : (
          <div className="yk-empty-state">
            <p>{t("profileUi.noCardsMatchThisSearch")}</p>
          </div>
        )}
      </section>
    </div>
  );
}

export type ProfileAdapter = {
  markTitlesSeen?: typeof import("@/lib/data/profile").markPlayerTitlesSeen;
  messages?: import("@/lib/data/private-messages").PrivateMessagesAdapter;
  trades?: import("@/components/trades").TradesPanelAdapter;
  discovery?: CatalogueCardAdapter;
  friendCollection?: typeof getFriendCollection;
  enrichFriendCollection?: (cards: CollectedCard[]) => Promise<CollectedCard[]>;
  friendAlbums?: typeof getFriendPaniniAlbumsPage;
  friendAlbumCards?: typeof getFriendPaniniAlbumCardsPage;
  wall?: WallAdapter;
  market?: ProfileMarketAdapter;
  // Compatibility harness for the retired widget UI; never enabled by liveProfile.
  previewWidgets?: boolean;
  profile: typeof getProfile;
  wishlist: typeof getWishlist;
  blocked: typeof listBlockedUsers;
  moderation?: ModerationAdapter;
  friendAction?: FriendActionAdapter;
  details?: typeof getProfileDetails;
  engagement?: typeof getProfileEngagement;
  like?: typeof setProfileLike;
  saveWidgets?: typeof saveProfileWidgets;
  widgetLicenses?: typeof getProfileWidgetLicenses;
  saveAppearance?: typeof saveProfileAppearance;
  saveShowcaseStyle?: (style: ProfileStyle) => Promise<void>;
  uploadAvatar?: typeof uploadAvatar;
  uploadBanner?: typeof uploadBanner;
};
const liveProfile: ProfileAdapter = {
  friendCollection: id => getFriendCollection(id, false),
  enrichFriendCollection: async cards =>
    (await import("@/lib/data/binders")).withBinderMetadata(cards),
  profile: getProfile,
  wishlist: getWishlist,
  blocked: listBlockedUsers,
  details: getProfileDetails,
  engagement: getProfileEngagement,
  like: setProfileLike,
  saveWidgets: saveProfileWidgets
};
export function ProfileExperience({
  identifier,
  collection,
  joined,
  compact = false,
  adapter = liveProfile
}: {
  identifier?: string;
  collection?: CollectedCard[];
  joined?: string;
  compact?: boolean;
  adapter?: ProfileAdapter;
}) {
  const fmt = useFormatter();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile>();
  const [wishlist, setWishlist] = useState<WishlistCard[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(
    !compact && searchParams.get("edition") === "1"
  );
  const [editingMode, setEditingMode] = useState<
    "profile" | "style" | "showcase"
  >("profile");
  const [toast, setToast] = useState("");
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [wishlistCard, setWishlistCard] = useState<WishlistCard | null>(null);
  const [friendCollection, setFriendCollection] = useState<{
    ownerId: string;
    cards: CollectedCard[];
  }>();
  const friendCards =
    friendCollection?.ownerId === profile?.id
      ? friendCollection?.cards
      : undefined;
  const [collectionError, setCollectionError] = useState("");
  const [tab, setTab] = useState(
    !compact && searchParams.get("tab") === "wall" ? "wall" : "tableau"
  );
  const [details, setDetails] = useState<ProfileDetails>();
  const [detailsError, setDetailsError] = useState("");
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [mutualOnly, setMutualOnly] = useState(false);
  const [engagement, setEngagement] = useState<ProfileEngagement>();
  const [engagementError, setEngagementError] = useState("");
  const [likeBusy, setLikeBusy] = useState(false);
  const likePending = useRef(false);
  const [savedBannerUrl, setSavedBannerUrl] = useState<
    string | null | undefined
  >();
  const [savedBannerFrame, setSavedBannerFrame] = useState<
    BannerFrame | null | undefined
  >();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const profileId = profile?.id;
  const collectionRequest = useRef<{
    ownerId: string;
    promise: Promise<void>;
  } | null>(null);
  useEffect(
    () => () => {
      collectionRequest.current = null;
    },
    [profileId, adapter]
  );
  const profileBlocked = blocked.some(player => player.id === profileId);
  useEffect(() => {
    if (!profileId || !adapter.engagement) return;
    let active = true;
    void adapter.engagement(profileId).then(
      value => {
        if (active) {
          setEngagement(value);
          setEngagementError("");
        }
      },
      () => {
        if (active) setEngagementError("Likes are temporarily unavailable.");
      }
    );
    return () => {
      active = false;
    };
  }, [profileId, adapter]);
  useEffect(() => {
    let active = true;
    if (adapter.details)
      void adapter.details(identifier).then(
        data => {
          if (active) setDetails(data);
        },
        () => {
          if (active)
            setDetailsError("Stats and board are temporarily unavailable.");
        }
      );
    return () => {
      active = false;
    };
  }, [identifier, adapter]);
  const loadFriendPaniniAlbums = useCallback(
    (options: Parameters<typeof getFriendPaniniAlbumsPage>[1]) => {
      if (!profile) return Promise.reject(new Error("Profile unavailable."));
      if (adapter.friendAlbums)
        return adapter.friendAlbums(profile.id, options);
      return getFriendPaniniAlbumsPage(profile.id, options);
    },
    [profile, adapter]
  );
  const loadFriendPaniniAlbumCards = useCallback(
    (options: Parameters<typeof getFriendPaniniAlbumCardsPage>[1]) => {
      if (!profile) return Promise.reject(new Error("Profile unavailable."));
      if (adapter.friendAlbumCards)
        return adapter.friendAlbumCards(profile.id, options);
      return getFriendPaniniAlbumCardsPage(profile.id, options);
    },
    [profile, adapter]
  );
  useEffect(() => {
    let active = true;
    void Promise.all([
      adapter.profile(identifier),
      adapter.wishlist(identifier),
      adapter.blocked()
    ]).then(
      ([p, w, blocks]) => {
        if (active) {
          setProfile(p);
          setWishlist(w);
          setBlocked(blocks);
        }
      },
      e => {
        if (active)
          setError(e instanceof Error ? e.message : "Profile unavailable.");
      }
    );
    return () => {
      active = false;
    };
  }, [identifier, adapter, loadAttempt]);
  if (error)
    return (
      <div className="yk-empty-state" role={compact ? "alert" : undefined}>
        <p>{t(gameErrorKey(error, "profileUi.profileUnavailable"))}</p>
        {compact && (
          <Button
            variant="secondary"
            onClick={() => {
              setError("");
              setLoadAttempt(n => n + 1);
            }}
          >
            {t("packs.tryAgain")}
          </Button>
        )}
      </div>
    );
  if (!profile)
    return (
      <div className="yk-empty-state">
        <p>{t("profileUi.loadingProfile")}</p>
      </div>
    );
  const isMe = profile.friendshipStatus === "self";
  const showInlineProfileLike =
    !isMe && profile.friendshipStatus !== "accepted";
  async function likeProfile() {
    if (
      !profile ||
      !engagement ||
      isMe ||
      profileBlocked ||
      likePending.current ||
      !adapter.like
    )
      return;
    likePending.current = true;
    setLikeBusy(true);
    setEngagementError("");
    try {
      setEngagement(await adapter.like(profile.id, !engagement.likedByMe));
    } catch (reason) {
      setEngagementError(
        reason instanceof Error ? reason.message : "Like unavailable."
      );
    } finally {
      likePending.current = false;
      setLikeBusy(false);
    }
  }
  const profileLikeButton = !isMe ? (
    <Button
      variant="secondary"
      className="yk-profile-like"
      disabled={!engagement || likeBusy || profileBlocked || !adapter.like}
      aria-pressed={engagement?.likedByMe ?? false}
      aria-busy={likeBusy}
      onClick={() => void likeProfile()}
    >
      <svg
        className="yk-profile-like-heart"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={engagement?.likedByMe ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
      </svg>
      <span className="yk-profile-like-label">
        {likeBusy
          ? t("collectionUi.saving")
          : engagement?.likedByMe
            ? t("profileUi.profileLikedAction")
            : t("profileUi.likeProfileAction")}
      </span>
    </Button>
  ) : null;
  const friends = profile.friends ?? [];
  const blockedByMe = blocked.some(player => player.id === profile.id);
  const isAcceptedFriend =
    !isMe && profile.friendshipStatus === "accepted" && !blockedByMe;
  function afterBlock() {
    if (!profile) return;
    setBlocked(current =>
      current.some(player => player.id === profile.id)
        ? current
        : [...current, { id: profile.id, pseudo: profile.pseudo }]
    );
    void adapter
      .profile(identifier)
      .then(setProfile, () => setError("Profile unavailable."));
  }
  function afterUnblock() {
    if (!profile) return;
    setBlocked(current => current.filter(player => player.id !== profile.id));
    void adapter
      .profile(identifier)
      .then(setProfile, () => setError("Profile unavailable."));
  }
  async function openFriendCollection() {
    if (!profile || !profile.canViewCollection) return;
    const friendId = profile.id;
    setCollectionOpen(true);
    warmCollectionView();
    if (friendCards) return;
    if (collectionRequest.current?.ownerId === friendId)
      return collectionRequest.current.promise;
    setCollectionError("");
    const request = { ownerId: friendId, promise: Promise.resolve() };
    collectionRequest.current = request;
    request.promise = (async () => {
      try {
        const cards = adapter.friendCollection
          ? await adapter.friendCollection(friendId)
          : await getFriendCollection(friendId);
        if (collectionRequest.current !== request) return;
        setFriendCollection({ ownerId: friendId, cards });
        // Optional binder names must not delay the first grid or hide its cards.
        const enrich = adapter.enrichFriendCollection;
        if (enrich)
          void Promise.resolve()
            .then(() => enrich(cards))
            .then(
              enriched => {
                if (collectionRequest.current === request)
                  setFriendCollection({ ownerId: friendId, cards: enriched });
              },
              () => {}
            );
      } catch (reason) {
        if (collectionRequest.current !== request) return;
        collectionRequest.current = null;
        setCollectionError(
          reason instanceof Error ? reason.message : "Collection unavailable."
        );
      }
    })();
    return request.promise;
  }
  const categories = friendCards
    ? [...new Set(friendCards.map(card => card.category))].sort((a, b) =>
        a.localeCompare(b, "fr")
      )
    : [];
  const bannerImage =
    (savedBannerUrl === undefined ? details?.bannerUrl : savedBannerUrl) ||
    profile.bannerCard?.image;
  const bannerFrame =
    savedBannerFrame === undefined ? details?.bannerFrame : savedBannerFrame;
  const activeStyle = profile.profileStyle?.active
    ? profile.profileStyle.style
    : undefined;
  const metrics = (
    <div className="yk-profile-metrics">
      <div className="yk-profile-side-counts">
        {!isMe && profile.canViewCollection ? (
          <button
            type="button"
            onPointerEnter={warmCollectionView}
            onFocus={warmCollectionView}
            onClick={() => void openFriendCollection()}
            aria-label={t("profileUi.viewCollectionCount", {
              known: profile.cardCount == null ? "no" : "yes",
              count: profile.cardCount ?? 0,
              name: profile.pseudo
            })}
          >
            <p>{t("profileUi.cards")}</p>
            <strong>{profile.cardCount}</strong>
            <span>{t("profileUi.viewCollection")}</span>
          </button>
        ) : (
          <Link href="/collection">
            <p>{t("profileUi.cards")}</p>
            <strong>
              {profile.canViewCollection
                ? profile.cardCount
                : t("profileUi.private")}
            </strong>
            <span>{t("profileUi.viewCollection")}</span>
          </Link>
        )}
        <div>
          <p>{t("profileUi.unique")}</p>
          <strong>
            {profile.canViewCollection
              ? profile.distinctCardCount
              : t("profileUi.private")}
          </strong>
        </div>
        <button
          type="button"
          onClick={() => setWishlistOpen(true)}
          disabled={!profile.canViewCollection}
          data-profile-wishlist
          aria-haspopup="dialog"
          aria-label={t("profileUi.viewWishlistCount", {
            name: profile.pseudo,
            count: wishlist.length
          })}
        >
          <p>{t("gameUi.wishlistMetadata")}</p>
          <strong>
            {profile.canViewCollection
              ? fmt.number(wishlist.length)
              : t("profileUi.private")}
          </strong>
          {profile.canViewCollection && (
            <span>{t("profileUi.viewWishlist")}</span>
          )}
        </button>
        <div>
          <p>{t("profileUi.likes")}</p>
          <strong data-profile-likes>
            {engagement ? fmt.number(engagement.likes) : "—"}
          </strong>
        </div>
      </div>
      <div className="yk-profile-side-stats">
        <div>
          <p>{t("profileUi.packsOpened")}</p>
          <strong>
            {profile.canViewCollection
              ? details?.boostersOpened != null
                ? fmt.number(details.boostersOpened)
                : "—"
              : t("profileUi.private")}
          </strong>
        </div>
        <div className="is-lr">
          <p>✦ LR</p>
          <strong>
            {profile.canViewCollection
              ? details?.lrCount != null
                ? fmt.number(details.lrCount)
                : "—"
              : t("profileUi.private")}
          </strong>
        </div>
        <div className="is-ssr">
          <p>✦ SSR</p>
          <strong>
            {profile.canViewCollection
              ? details?.ssrCount != null
                ? fmt.number(details.ssrCount)
                : "—"
              : t("profileUi.private")}
          </strong>
        </div>
      </div>
      <div className="yk-profile-member">
        <p>{t("profileUi.memberSince")}</p>
        <strong>
          {details?.joinedAt || (isMe && joined)
            ? i18nEnabled() && !hydrated
              ? "…"
              : i18nEnabled()
                ? fmt.dateTime(new Date(details?.joinedAt || joined!), {
                    ...{ dateStyle: "long" },
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
                  })
                : new Date(details?.joinedAt || joined!).toLocaleDateString(
                    "en-US",
                    { dateStyle: "long" }
                  )
            : "—"}
        </strong>
      </div>
    </div>
  );
  return (
    <>
      <div
        className="yk-profile-hub"
        data-profile-compact={compact ? "true" : undefined}
        data-profile-tab={tab}
        data-profile-theme="default"
        style={showcaseColorVariables(activeStyle) as CSSProperties}
        data-avatar-frame={activeStyle?.avatarFrame ?? "none"}
        data-showcase-effect={activeStyle?.showcaseEffect ?? "none"}
      >
        {!compact && (
          <section className="yk-profile-recent yk-profile-overview">
            {metrics}
            <ProfileRecentCards
              activity={details?.activity}
              allowed={profile.canViewCollection}
              failed={Boolean(detailsError)}
              adapter={adapter.discovery}
            />
          </section>
        )}
        <header
          className={`yk-profile-identity ${bannerImage ? "" : "no-banner"}`}
        >
          <div
            className={`yk-profile-banner ${bannerImage ? "has-image" : ""} ${bannerFrame ? "has-frame" : ""}`}
          >
            {bannerImage && (
              <>
                {bannerFrame ? (
                  <BannerImage
                    src={bannerImage}
                    frame={bannerFrame}
                    fillContainer={!compact}
                  />
                ) : (
                  <img
                    src={bannerImage}
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                  />
                )}
                <span className="yk-profile-banner-shade" />
              </>
            )}
          </div>
          <div className="yk-profile-identity-content">
            <div className="yk-profile-intro">
              <div className="yk-profile-avatar">
                <Avatar
                  name={profile.pseudo}
                  image={profile.avatarUrl ?? undefined}
                  size={compact ? 64 : 96}
                />
                <AvatarDecoration frame={activeStyle?.avatarFrame ?? "none"} />
              </div>
              <span className="yk-profile-identity-label">
                <PlayerTitle titleId={profile.titleId} />
              </span>
              <div className="yk-profile-name-row">
                <h2>
                  <StyledPlayerName
                    name={profile.pseudo}
                    cosmetics={profile.profileStyle}
                  />
                </h2>
                {isAcceptedFriend && (
                  <span className="yk-profile-friend-status">
                    {t("profileUi.friendStatusaccepted")}
                  </span>
                )}
                {!isMe && (
                  <PlayerModeration
                    userId={profile.id}
                    pseudo={profile.pseudo}
                    blockedByMe={blockedByMe}
                    adapter={adapter.moderation}
                    onBlocked={afterBlock}
                  />
                )}
              </div>
              <p className="yk-profile-bio">
                {profile.bio || t("profileUi.noBioYet")}
              </p>
              <div
                className={`yk-profile-actions ${isAcceptedFriend ? "is-friend" : ""} ${showInlineProfileLike ? "has-profile-like" : ""}`}
              >
                {isMe ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingMode("profile");
                        setEditing(true);
                      }}
                    >
                      {t("profileUi.editProfile")}{" "}
                      <NewTitlesBadge
                        count={profile.unseenTitleIds?.length ?? 0}
                      />
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingMode("style");
                        setEditing(true);
                      }}
                    >
                      {t("profileUi.profileStyle")}{" "}
                    </Button>
                  </>
                ) : (
                  <>
                    {!isAcceptedFriend && (
                      <FriendAction
                        key={`${profile.id}:${profile.friendshipStatus}:${blockedByMe}`}
                        userId={profile.id}
                        status={profile.friendshipStatus}
                        blockedByMe={blockedByMe}
                        adapter={adapter.friendAction}
                        onChanged={status =>
                          setProfile(current =>
                            current
                              ? { ...current, friendshipStatus: status }
                              : current
                          )
                        }
                        onUnblocked={afterUnblock}
                      />
                    )}
                    {isAcceptedFriend && (
                      <FriendMessageButton
                        key={profile.id}
                        showTrade
                        friend={{
                          id: profile.id,
                          pseudo: profile.pseudo,
                          avatarUrl: profile.avatarUrl,
                          profileStyle: profile.profileStyle
                        }}
                        adapter={adapter.messages}
                        tradeAdapter={adapter.trades}
                        moderationAdapter={adapter.moderation}
                      />
                    )}
                    {showInlineProfileLike && profileLikeButton}
                  </>
                )}
              </div>
              {!isMe && !showInlineProfileLike && profileLikeButton}
              {engagementError && (
                <p className="yk-profile-muted" role="status">
                  {t(
                    gameErrorKey(
                      engagementError,
                      "profileUi.profileUnavailable"
                    )
                  )}
                </p>
              )}
            </div>
            {compact && metrics}
          </div>
        </header>
        {compact && (
          <section className="yk-profile-main yk-profile-compact-board">
            {!profile.canViewCollection ? (
              <ProfilePrivate />
            ) : (
              <>
                <section className="yk-profile-surface yk-profile-showcase">
                  <div className="yk-profile-section-heading">
                    <h3 className="yk-section-title">
                      {activeStyle?.showcaseTitle ||
                        t("profileUi.featuredCards")}
                    </h3>
                  </div>
                  <Featured
                    adapter={adapter.discovery}
                    design={activeStyle}
                    cards={profile.featuredCards}
                    slots={activeStyle ? 10 : 5}
                    emptyLabel={t("profileUi.noFeaturedCards", {
                      name: profile.pseudo
                    })}
                  />
                </section>
                <section className="yk-profile-completion">
                  <ProfileFeaturedCollection
                    key={profile.id}
                    loadCards={adapter.friendAlbumCards}
                    profile={profile}
                    isMe={isMe}
                  />
                </section>
              </>
            )}
          </section>
        )}
        {!compact && (
          <section className="yk-profile-main">
            <nav
              className="yk-profile-tabs"
              aria-label={t("profileUi.profileSections")}
            >
              {[
                ["tableau", t("profileUi.board")],
                ["wall", t("profileUi.wall")],
                ["activity", t("profileUi.activity")],
                ...(profile.friendsVisible
                  ? [["friends", t("catalogueUi.friends")]]
                  : [])
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={tab === key}
                  onClick={() => setTab(key)}
                  className={tab === key ? "is-active" : ""}
                >
                  {key === "friends" ? (
                    <p className="yk-profile-tab-label">
                      {t("catalogueUi.friends")}
                    </p>
                  ) : (
                    label
                  )}
                  {key === "friends" && (
                    <p className="yk-profile-tab-count">{friends.length}</p>
                  )}
                </button>
              ))}
            </nav>
            {detailsError && (
              <p role="status" className="yk-profile-notice">
                {detailsError}
              </p>
            )}
            <div hidden={tab !== "tableau"} className="yk-profile-panel">
              <section className="yk-profile-surface yk-profile-showcase">
                <div className="yk-profile-section-heading">
                  <h3 className="yk-section-title">
                    {activeStyle?.showcaseTitle || t("profileUi.featuredCards")}
                  </h3>
                  {isMe ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingMode("showcase");
                        setEditing(true);
                      }}
                    >
                      {t("profileUi.editShowcase")}{" "}
                    </Button>
                  ) : (
                    <span className="yk-profile-muted">
                      {t("profileUi.theirShowcase")}
                    </span>
                  )}
                </div>
                <Featured
                  adapter={adapter.discovery}
                  design={activeStyle}
                  cards={profile.featuredCards}
                  slots={activeStyle ? 10 : 5}
                />
              </section>
              {adapter.previewWidgets ? (
                <section className="yk-profile-universe">
                  <div className="yk-profile-section-heading">
                    <div>
                      <p className="eyebrow">{t("profileUi.theirWorld")}</p>
                      <h2>
                        {t("profileUi.boardFor", { name: profile.pseudo })}
                      </h2>
                    </div>
                    {isMe && (
                      <Button
                        variant="secondary"
                        disabled={!details}
                        onClick={() => setPreferencesOpen(true)}
                      >
                        {t("profileUi.customizeMyBoard")}{" "}
                      </Button>
                    )}
                  </div>
                  <div className="yk-profile-interests">
                    {(details?.widgets ?? []).map(widget => (
                      <section
                        key={widget.category}
                        className="yk-profile-surface"
                        data-widget-category={widget.category}
                      >
                        <div className="yk-profile-section-heading">
                          <h3>
                            <span aria-hidden="true">✧</span>{" "}
                            {widgetLabel(widget.category, t)}
                          </h3>
                          <span className="yk-profile-muted">
                            {widget.entries.length}
                          </span>
                        </div>
                        {widget.entries.length ? (
                          <ol className="yk-profile-taste-list">
                            {widget.entries.map((name, index) => (
                              <li key={name}>
                                <span className="yk-profile-taste-number">
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <strong>{widget.labels?.[name] ?? name}</strong>
                                {widget.unresolvedEntries?.includes(name) && (
                                  <small className="yk-binder-origin">
                                    {t("profileUi.previousBinderHint")}{" "}
                                  </small>
                                )}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="yk-profile-empty">
                            {isMe
                              ? t("profileUi.favoritesEmptyHint")
                              : t("profileUi.visitorFavoritesEmpty")}
                          </p>
                        )}
                      </section>
                    ))}
                  </div>
                  {details && !details.widgets.length && (
                    <p className="yk-profile-surface yk-profile-empty">
                      {isMe
                        ? t("profileUi.widgetsEmptyHint")
                        : t("profileUi.visitorWidgetsEmpty")}
                    </p>
                  )}
                </section>
              ) : null}
            </div>
            <div hidden={tab !== "activity"} className="yk-profile-panel">
              {tab === "activity" && profile.canViewCollection && (
                <ProfileSales
                  key={profile.id}
                  ownerId={profile.id}
                  adapter={adapter.market}
                />
              )}
              <div className="yk-profile-section-heading">
                <div>
                  <p className="eyebrow">{t("profileUi.theCollectorSFeed")}</p>
                  <h2>{t("profileUi.recentActivity")}</h2>
                </div>
                <span className="yk-profile-muted">
                  {t("profileUi.last20Activities")}
                </span>
              </div>
              {!profile.canViewCollection ? (
                <ProfilePrivate />
              ) : details?.activity.length ? (
                <ol className="yk-profile-activity">
                  {details.activity.map(event => (
                    <li
                      key={event.kind + event.id}
                      className="yk-profile-surface"
                    >
                      <Link
                        href={`/catalog?carte=${event.card.id}`}
                        className="yk-profile-activity-image"
                      >
                        <img
                          src={event.card.image}
                          alt={event.card.name}
                          loading="lazy"
                          decoding="async"
                        />
                      </Link>
                      <div>
                        <p
                          className={`yk-profile-event-label is-${event.kind}`}
                        >
                          {event.kind === "sold"
                            ? t("profileUi.cardSold")
                            : event.kind === "bought"
                              ? t("profileUi.cardBought")
                              : t("profileUi.cardObtained")}
                        </p>
                        <Link href={`/catalog?carte=${event.card.id}`}>
                          <h3>{event.card.name}</h3>
                        </Link>
                        <p className="yk-profile-muted">
                          {event.card.anime}{" "}
                          <span
                            className={`text-rarity-${event.card.rarity.toLowerCase()}`}
                          >
                            {event.card.anime ? "· " : ""}
                            {event.card.rarity}
                          </span>
                        </p>
                        {event.price !== undefined && (
                          <p className="yk-profile-event-price">
                            {fmt.number(event.price)} Karas
                          </p>
                        )}
                      </div>
                      <time dateTime={event.at}>
                        {i18nEnabled() && !hydrated
                          ? "…"
                          : i18nEnabled()
                            ? fmt.dateTime(new Date(event.at), {
                                ...{
                                  day: "numeric",
                                  month: "short"
                                },
                                timeZone:
                                  Intl.DateTimeFormat().resolvedOptions()
                                    .timeZone
                              })
                            : new Date(event.at).toLocaleDateString("en-US", {
                                day: "numeric",
                                month: "short"
                              })}
                      </time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="yk-profile-empty">
                  {details
                    ? t("profileUi.noActivityToShowYet")
                    : detailsError
                      ? t("profileUi.activityUnavailable")
                      : t("profileUi.loadingActivity")}
                </p>
              )}
            </div>
            {profile.friendsVisible && (
              <div hidden={tab !== "friends"} className="yk-profile-panel">
                <div className="yk-profile-section-heading">
                  <div>
                    <p className="eyebrow">{t("profileUi.theirCommunity")}</p>
                    <h3>{t("catalogueUi.friends")}</h3>
                  </div>
                  {!isMe && (
                    <button
                      type="button"
                      className="yk-profile-filter"
                      aria-pressed={mutualOnly}
                      onClick={() => setMutualOnly(!mutualOnly)}
                    >
                      {t("profileUi.mutualFriends", {
                        count: details?.mutualFriends.length ?? 0
                      })}
                    </button>
                  )}
                </div>
                {(mutualOnly ? (details?.mutualFriends ?? []) : friends)
                  .length ? (
                  <ul className="yk-profile-friend-list">
                    {(mutualOnly
                      ? (details?.mutualFriends ?? [])
                      : friends
                    ).map(friend => (
                      <li key={friend.id}>
                        <Link
                          href={`/profile/${encodeURIComponent(friend.pseudo)}`}
                        >
                          <Avatar
                            name={friend.pseudo}
                            image={friend.avatarUrl ?? undefined}
                            size={48}
                          />
                          <span>
                            <strong>{friend.pseudo}</strong>
                            {details?.mutualFriends.some(
                              common => common.id === friend.id
                            ) && <small>{t("profileUi.mutualFriend")}</small>}
                          </span>
                          <span
                            className="yk-profile-friend-arrow"
                            aria-hidden="true"
                          >
                            ↗
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="yk-profile-empty">
                    {mutualOnly
                      ? t("profileUi.mutualFriendsEmpty")
                      : t("profileUi.noFriendsToShow")}
                  </p>
                )}
              </div>
            )}
            <div hidden={tab !== "wall"} className="yk-profile-panel">
              <ProfileWall
                key={profile.id}
                ownerId={profile.id}
                pseudo={profile.pseudo}
                avatarUrl={profile.avatarUrl}
                isMe={isMe}
                isPublic={profile.isPublic}
                canRead={profile.canViewCollection}
                active={tab === "wall"}
                canInteract={isMe || profile.friendshipStatus === "accepted"}
                adapter={adapter.wall}
              />
            </div>
          </section>
        )}

        {!compact && tab === "tableau" && !adapter.previewWidgets && (
          <section className="yk-profile-completion yk-profile-featured-wide">
            <ProfileFeaturedCollection
              key={profile.id}
              loadCards={adapter.friendAlbumCards}
              profile={profile}
              isMe={isMe}
            />
          </section>
        )}
      </div>
      <Modal
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        title={t("profileUi.customizeMyBoard")}
      >
        {preferencesOpen && details && (
          <PreferencesEditor
            labelCategory={category => widgetLabel(category, t)}
            widgets={details.widgets}
            categories={details.widgetCategories}
            loadLicenses={adapter.widgetLicenses ?? getProfileWidgetLicenses}
            save={adapter.saveWidgets ?? saveProfileWidgets}
            onSaved={widgets => {
              setDetails({ ...details, widgets });
              setPreferencesOpen(false);
              setToast("Board updated");
            }}
          />
        )}
      </Modal>
      <Modal
        open={collectionOpen}
        onClose={() => setCollectionOpen(false)}
        title={t("profileUi.collectionFor", { name: profile.pseudo })}
        className="yk-friend-collection-modal yk-friend-card-grid-modal"
      >
        {collectionError ? (
          <div className="yk-empty-state">
            <p>
              {t(gameErrorKey(collectionError, "profileUi.profileUnavailable"))}
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setFriendCollection(undefined);
                void openFriendCollection();
              }}
            >
              {t("packs.tryAgain")}{" "}
            </Button>
          </div>
        ) : friendCards ? (
          <CollectionView
            cards={friendCards}
            categories={categories}
            loadPaniniAlbums={loadFriendPaniniAlbums}
            loadPaniniAlbumCards={loadFriendPaniniAlbumCards}
            readOnly
          />
        ) : (
          <div className="yk-empty-state">
            <p>{t("packs.loadingCollection")}</p>
          </div>
        )}
      </Modal>
      <Modal
        open={wishlistOpen && profile.canViewCollection}
        onClose={() => {
          setWishlistCard(null);
          setWishlistOpen(false);
        }}
        title={t("profileUi.wishlistFor", { name: profile.pseudo })}
        className="yk-friend-collection-modal"
      >
        {wishlist.length ? (
          <FriendWishlist
            cards={wishlist}
            onNavigate={() => {
              setWishlistCard(null);
              setWishlistOpen(false);
            }}
            onSelect={setWishlistCard}
          />
        ) : (
          <div className="yk-empty-state">
            <p>{t("profileUi.noCardsOnThisWishlistYet")}</p>
          </div>
        )}
      </Modal>
      {wishlistCard && wishlistOpen && profile.canViewCollection && (
        <CatalogueCardModal
          key={wishlistCard.id}
          selected={wishlistCard}
          onClose={() => setWishlistCard(null)}
          adapter={adapter.discovery}
        />
      )}
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={
          editingMode === "showcase"
            ? t("profileUi.editShowcase")
            : editingMode === "style"
              ? t("profileUi.profileStyle")
              : t("profileUi.editMyProfile")
        }
        className={
          editingMode === "profile"
            ? "yk-profile-edit-modal"
            : editingMode === "style"
              ? "yk-profile-style-modal"
              : "yk-showcase-edit-modal"
        }
      >
        {isMe && editingMode === "style" ? (
          <ProfileStyleEditor
            key={editingMode}
            profile={profile}
            onClose={() => setEditing(false)}
            onSaved={style => {
              setProfile({
                ...profile,
                profileStyle: { active: true, style }
              });
              setToast("Profile style updated");
            }}
          />
        ) : isMe && collection && details ? (
          <Editor
            onTitlesSeen={titleIds =>
              setProfile(current =>
                current
                  ? {
                      ...current,
                      unseenTitleIds: current.unseenTitleIds?.filter(
                        id => !titleIds.includes(id)
                      )
                    }
                  : current
              )
            }
            key={editingMode}
            mode={editingMode === "showcase" ? "showcase" : "profile"}
            profile={profile}
            collection={collection}
            initialBannerUrl={
              (savedBannerUrl === undefined
                ? details?.bannerUrl
                : savedBannerUrl) ?? null
            }
            initialBannerFrame={bannerFrame ?? null}
            framingAvailable={
              !!adapter.saveAppearance || details.bannerFrame !== undefined
            }
            adapter={adapter}
            onClose={() => setEditing(false)}
            onSaved={p => {
              setProfile(current => ({ ...current, ...p }));
              setSavedBannerUrl(p.bannerUrl);
              setSavedBannerFrame(p.bannerFrame ?? null);
              setToast(
                editingMode === "showcase"
                  ? "Showcase updated"
                  : "Profile updated"
              );
            }}
          />
        ) : (
          <p className="yk-profile-empty">
            {detailsError || t("profileUi.loadingProfileEditor")}
          </p>
        )}
      </Modal>
      <Toast
        message={
          toast ? t(gameErrorKey(toast, "profileUi.profileUnavailable")) : ""
        }
        onDismiss={() => setToast("")}
      />
    </>
  );
}
