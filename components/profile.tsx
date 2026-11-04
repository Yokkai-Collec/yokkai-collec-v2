"use client";
import { useSyncExternalStore } from "react";
import { i18nEnabled } from "@/i18n/locale";
const subscribeToHydration = () => () => {};
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations, useFormatter } from "next-intl";
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
const ProfileFeaturedCollection = dynamic(() =>
  import("@/components/profile-featured").then(
    module => module.ProfileFeaturedCollection
  )
);
import { PlayerModeration } from "@/components/player-moderation";
import { ProfileWall } from "@/components/profile-wall";
import { BannerCrop } from "@/components/banner-crop";
import { BannerImage } from "@/components/banner-image";
import { ProfileStyleFields } from "@/components/profile-style-fields";
import { AvatarDecoration } from "@/components/avatar-decoration";
import { StyledPlayerName } from "@/components/styled-player-name";
import {
  DEFAULT_PROFILE_STYLE,
  normalizeProfileStyle,
  showcaseColorVariables,
  type ProfileStyle
} from "@/lib/ui/profile-style";
import {
  useProAccess,
  useProMembershipStatus,
  ProFeatureNotice
} from "@/components/pro-access";
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
  PROFILE_IMAGE_MAX_BYTES,
  type ProfileDetails,
  type ProfileEngagement,
  type Profile
} from "@/lib/data/profile";
import { getWishlist, type WishlistCard } from "@/lib/data/wishlist";
import { matchesCardSearch } from "@/lib/ui/card-search";
import { compareBannerCards } from "@/lib/ui/banner-card-sort";

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
const PROFILE_CARD_IMAGE_SIZES =
  "(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 190px";

function widgetLabel(category: string, t: ReturnType<typeof useTranslations>) {
  const labels: Record<string, string> = {
    "ANIME/MANGA": t("profileUi.favoriteanimemanga"),
    "VIDEO GAMES": t("profileUi.favoritegames"),
    KPOP: t("profileUi.kpopgroups"),
    FILM: t("profileUi.favoritemovies"),
    SERIE: t("profileUi.favoriteseries"),
    KDRAMA: t("profileUi.favoriteKdramas"),
    COMICS: t("profileUi.favoritecomics"),
    ARTIST: t("profileUi.favoriteartists"),
    VOCALOID: t("profileUi.favoriteVocaloids"),
    MANWHA: t("profileUi.favoritemanhwa"),
    SPORT: t("profileUi.favoritesports"),
    "DISNEY CHANNEL": t("profileUi.disneyChannel"),
    MEME: t("profileUi.favoritememes"),
    BRAINROT: t("profileUi.favoritebrainrot")
  };
  return labels[category] ?? category;
}

const PreferencesEditor = dynamic(() =>
  import("@/components/profile-preferences-editor").then(
    module => module.PreferencesEditor
  )
);

function Featured({
  cards,
  emptyLabel,
  slots = FEATURED_CARD_LIMIT
}: {
  cards: CollectedCard[];
  emptyLabel?: string;
  slots?: number;
}) {
  const t = useTranslations();
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
    <div className="yk-card-grid yk-featured-stage">
      {cards.map(card => (
        <div key={card.instanceId}>
          <YokaiCard {...card} imageSizes={PROFILE_CARD_IMAGE_SIZES} />
        </div>
      ))}
      {Array.from({ length: Math.max(0, slots - cards.length) }, (_, i) => (
        <div key={`empty-${i}`} className="yk-featured-empty">
          <span aria-hidden="true">✦</span>
          <small>{t("profileUi.emptySlot")}</small>
        </div>
      ))}
    </div>
  );
}

function Editor({
  mode,
  profile,
  collection,
  initialBannerUrl,
  initialBannerFrame,
  framingAvailable,
  adapter,
  onSaved,
  onClose
}: {
  mode: "profile" | "showcase";
  profile: Profile;
  collection: CollectedCard[];
  initialBannerUrl: string | null;
  initialBannerFrame: BannerFrame | null;
  framingAvailable: boolean;
  adapter: ProfileAdapter;
  onSaved: (
    p: Profile & { bannerUrl: string | null; bannerFrame?: BannerFrame | null }
  ) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [bio, setBio] = useState(profile.bio);
  const pro = useProAccess();
  const FEATURED_CARD_LIMIT = pro ? 10 : 5;
  const [avatar, setAvatar] = useState(profile.avatarUrl);
  const ownedBannerCards = useMemo(() => {
    const cards = new Map<string, Card>();
    for (const card of collection) {
      if (card.catalogueImage?.trim() && !cards.has(card.id))
        cards.set(card.id, { ...card, image: card.catalogueImage });
    }
    return [...cards.values()];
  }, [collection]);
  const eligibleBanner =
    ownedBannerCards.find(card => card.id === profile.bannerCard?.id) ?? null;
  const [bannerCard, setBannerCard] = useState<Card | null>(
    initialBannerUrl ? null : eligibleBanner
  );
  const [bannerUrl, setBannerUrl] = useState(initialBannerUrl);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!bannerPreview) return;
    return () => URL.revokeObjectURL(bannerPreview);
  }, [bannerPreview]);
  const bannerSource =
    (bannerFile ? bannerPreview : bannerUrl) || bannerCard?.image;
  const [bannerFrame, setBannerFrame] = useState(
    initialBannerUrl || eligibleBanner ? initialBannerFrame : null
  );
  const [crop, setCrop] = useState<{
    src: string;
    frame: BannerFrame | null;
    card: Card | null;
    file?: File;
  } | null>(null);
  useEffect(() => {
    if (!crop?.file) return;
    const url = crop.src;
    return () => URL.revokeObjectURL(url);
  }, [crop]);
  const [selected, setSelected] = useState(
    () => new Set(profile.featuredCards.map(c => c.instanceId))
  );
  const [featuredQuery, setFeaturedQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bannerQuery, setBannerQuery] = useState("");
  const ownedBannerChoices = useMemo(
    () =>
      ownedBannerCards
        .filter(card =>
          matchesCardSearch(bannerQuery, [card.name, card.category, card.anime])
        )
        .toSorted(compareBannerCards),
    [ownedBannerCards, bannerQuery]
  );
  const unique = useMemo(() => {
    if (mode !== "showcase") return [];
    const byCard = new Map<string, CollectedCard>();
    for (const card of collection) {
      if (!byCard.has(card.id) || selected.has(card.instanceId))
        byCard.set(card.id, card);
    }
    return [...byCard.values()];
  }, [collection, selected, mode]);
  const featuredChoices = useMemo(
    () =>
      unique
        .filter(card =>
          matchesCardSearch(featuredQuery, [
            card.name,
            card.category,
            card.anime
          ])
        )
        .toSorted(
          (a, b) =>
            Number(selected.has(b.instanceId)) -
            Number(selected.has(a.instanceId))
        ),
    [unique, featuredQuery, selected]
  );
  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < FEATURED_CARD_LIMIT) next.add(id);
      return next;
    });
  }
  async function photo(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      setAvatar(await (adapter.uploadAvatar ?? uploadAvatar)(file, profile.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload this image.");
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (bannerFrame && !framingAvailable) {
        throw new Error(
          "Banner framing is not available yet. Please try again after the update."
        );
      }
      if (
        bannerCard &&
        !ownedBannerCards.some(card => card.id === bannerCard.id)
      )
        throw new Error("Choose a card you own for your banner.");
      const uploadedBannerUrl = bannerFile
        ? await (adapter.uploadBanner ?? uploadBanner)(bannerFile, profile.id)
        : bannerUrl;
      const updated = await (adapter.saveAppearance ?? saveProfileAppearance)(
        bio,
        avatar,
        [...selected],
        bannerCard?.id ?? null,
        uploadedBannerUrl,
        bannerFrame ?? undefined
      );
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6 yk-profile-edit-grid" data-profile-editor={mode}>
      <div className="space-y-6">
        {mode === "profile" && (
          <>
            <div className="flex items-center gap-4">
              <Avatar
                name={profile.pseudo}
                image={avatar ?? undefined}
                size={80}
              />
              <label className="yk-button yk-button-secondary cursor-pointer">
                {t("profileUi.choosePhoto")}{" "}
                <input
                  className="sr-only"
                  type="file"
                  disabled={busy}
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={e => void photo(e.target.files?.[0])}
                />
              </label>
            </div>
            <p className="text-xs text-ink-3">
              {t("profileUi.jpgpngwebPOrGIFUpTo4")}{" "}
            </p>
            {!pro && (
              <ProFeatureNotice
                feature={t("profileUi.animatedProfilePictures")}
              />
            )}
            <label className="block text-sm text-ink-2">
              {t("profileUi.bio")}{" "}
              <textarea
                className="auth-input mt-2 min-h-28 resize-none overflow-y-auto py-3"
                maxLength={300}
                value={bio}
                onChange={e => setBio(e.target.value)}
                placeholder={t("profileUi.tellUsAboutYourCollection")}
              />
              <span className="mt-1 block text-right text-xs text-ink-3">
                {bio.length}/300
              </span>
            </label>
            <section
              className="yk-profile-banner-editor"
              data-owned-banner-picker
            >
              <h3 className="font-display text-lg">
                {t("profileUi.profileBanner")}
              </h3>
              <p className="yk-profile-muted">
                {t("profileUi.bannerSourceHint")}{" "}
              </p>
              {profile.bannerCard && !eligibleBanner && !initialBannerUrl && (
                <p className="mt-2 text-xs text-ink-3" role="status">
                  {t("profileUi.previousBannerIneligible")}{" "}
                </p>
              )}
              {bannerSource && (
                <div className="yk-banner-framed-preview">
                  <BannerImage
                    src={bannerSource}
                    frame={
                      bannerFrame ?? { x: 50, y: 50, zoom: 1, rotation: 0 }
                    }
                  />
                </div>
              )}
              <div className="yk-profile-widget-tools">
                <label
                  className="yk-button yk-button-secondary cursor-pointer"
                  data-banner-upload
                  aria-disabled={!pro}
                >
                  {t("profileUi.uploadBanner")}{" "}
                  <input
                    className="sr-only"
                    type="file"
                    disabled={busy || !pro}
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={event => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file || !pro) return;
                      if (file.size > PROFILE_IMAGE_MAX_BYTES) {
                        setError("Your banner must be 4 MB or smaller.");
                        return;
                      }
                      if (
                        ![
                          "image/jpeg",
                          "image/png",
                          "image/webp",
                          "image/gif"
                        ].includes(file.type)
                      ) {
                        setError("Use a JPG, PNG, WebP or GIF image.");
                        return;
                      }
                      setError("");
                      const src = URL.createObjectURL(file);
                      setCrop({ src, frame: null, card: null, file });
                    }}
                  />
                </label>
                {bannerSource && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setBannerCard(null);
                      setBannerFrame(null);
                      setBannerUrl(null);
                      setBannerFile(null);
                      setBannerPreview(null);
                    }}
                  >
                    {t("profileUi.removeBanner")}{" "}
                  </Button>
                )}
                {bannerSource && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      setCrop({
                        src: bannerSource,
                        frame: bannerFrame,
                        card: bannerCard
                      })
                    }
                  >
                    {t("profileUi.adjustBanner")}{" "}
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-3">
                {t("profileUi.jpgpngwebPOrGIFUpTo4")}{" "}
              </p>
              {!pro && (
                <ProFeatureNotice
                  feature={t("profileUi.customAnimatedBanners")}
                />
              )}
              {bannerCard && (
                <div className="yk-banner-choice mt-4">
                  <div>
                    <img src={bannerCard.image} alt="" decoding="async" />
                    <strong>{bannerCard.name}</strong>
                    {bannerCard.anime && <small>{bannerCard.anime}</small>}
                  </div>
                </div>
              )}
              <div className="relative mt-4">
                <input
                  className="auth-input"
                  type="search"
                  aria-label={t("profileUi.bannerCollectionSearch")}
                  aria-describedby="banner-search-help"
                  disabled={busy}
                  value={bannerQuery}
                  onChange={e => {
                    const value = e.target.value;
                    setBannerQuery(value);
                    setError("");
                  }}
                  placeholder={t("profileUi.bannerSearchPlaceholder")}
                />
                <p id="banner-search-help" className="mt-2 text-xs text-ink-3">
                  {t("profileUi.bannerSearchHint")}{" "}
                </p>
                {ownedBannerChoices.length > 0 ? (
                  <ul className="yk-banner-results">
                    {ownedBannerChoices.slice(0, 36).map(card => (
                      <li key={card.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setCrop({
                              src: card.image,
                              frame: null,
                              card
                            });
                          }}
                        >
                          <img
                            src={card.image}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                          <span>
                            <strong>{card.name}</strong>
                            {card.anime && <small>{card.anime}</small>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-ink-3" role="status">
                    {ownedBannerCards.length
                      ? t("profileUi.bannerSearchEmpty")
                      : t("profileUi.collectACardToUseItAsA")}
                  </p>
                )}
                {ownedBannerChoices.length > 36 && (
                  <p className="mt-2 text-xs text-ink-3">
                    {t("profileUi.bannerResults", {
                      count: ownedBannerChoices.length
                    })}
                  </p>
                )}
              </div>
            </section>
          </>
        )}
        {mode === "showcase" && (
          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-lg">
                {t("profileUi.featuredCards")}
              </h3>
              <span className="text-xs text-ink-3">
                {selected.size}/{FEATURED_CARD_LIMIT}
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-3">
              {t("profileUi.chooseFeatured", { limit: FEATURED_CARD_LIMIT })}
            </p>
            <label className="sr-only" htmlFor="featured-query">
              {t("profileUi.searchForACardToFeature")}{" "}
            </label>
            <input
              id="featured-query"
              className="auth-input mt-4"
              type="search"
              value={featuredQuery}
              onChange={e => setFeaturedQuery(e.target.value)}
              placeholder={t("collectionUi.searchCards")}
            />
            <div className="yk-featured-picker mt-4">
              {featuredChoices.map(card => {
                const featured = selected.has(card.instanceId);
                return (
                  <button
                    type="button"
                    key={card.instanceId}
                    aria-pressed={featured}
                    className={featured ? "is-selected" : ""}
                    onClick={() => toggle(card.instanceId)}
                  >
                    <YokaiCard
                      {...card}
                      image={featured ? card.image : card.catalogueImage}
                      animated={false}
                      imageSizes={PROFILE_CARD_IMAGE_SIZES}
                    />
                    <span>
                      {featured
                        ? t("collectionUi.selected")
                        : t("profileUi.choose")}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
        </p>
      )}
      <div className="flex justify-end gap-3 yk-profile-edit-actions">
        <Button variant="secondary" onClick={onClose}>
          {t("packs.cancel")}{" "}
        </Button>
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? t("collectionUi.saving") : t("profileUi.save")}
        </Button>
      </div>
      {crop && (
        <BannerCrop
          key={crop.src}
          src={crop.src}
          initial={crop.frame}
          onCancel={() => {
            if (crop.file) URL.revokeObjectURL(crop.src);
            setCrop(null);
          }}
          onApply={frame => {
            setBannerCard(crop.card);
            if (crop.file) {
              setBannerFile(crop.file);
              setBannerPreview(URL.createObjectURL(crop.file));
              setBannerUrl(null);
              URL.revokeObjectURL(crop.src);
            } else if (crop.card) {
              setBannerFile(null);
              setBannerUrl(null);
              setBannerPreview(null);
            }
            setBannerFrame(frame);
            setCrop(null);
          }}
        />
      )}
    </div>
  );
}

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
      const response = await fetch("/api/pro/profile-style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style })
      });
      if (!response.ok)
        throw new Error("Your profile style couldn't be saved. Try again.");
      onSaved(style);
      window.dispatchEvent(new Event("yokkai:profile-style-updated"));
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
  const friends = profile.friends ?? [];
  const blockedByMe = blocked.some(player => player.id === profile.id);
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
  return (
    <>
      <div
        className="yk-profile-hub"
        data-profile-compact={compact ? "true" : undefined}
        data-profile-tab={tab}
        data-profile-theme="default"
        style={
          showcaseColorVariables(
            profile.profileStyle?.active
              ? profile.profileStyle.style
              : undefined
          ) as CSSProperties
        }
        data-avatar-frame={
          profile.profileStyle?.active
            ? profile.profileStyle.style.avatarFrame
            : "none"
        }
        data-showcase-effect={
          profile.profileStyle?.active
            ? profile.profileStyle.style.showcaseEffect
            : "none"
        }
      >
        {compact && (
          <section className="yk-profile-main yk-profile-compact-board">
            {!profile.canViewCollection ? (
              <ProfilePrivate />
            ) : (
              <>
                <section className="yk-profile-surface yk-profile-showcase">
                  <div className="yk-profile-section-heading">
                    <h3 className="yk-section-title">
                      {t("profileUi.featuredCards")}
                    </h3>
                  </div>
                  <Featured
                    cards={profile.featuredCards}
                    slots={profile.profileStyle?.active ? 10 : 5}
                    emptyLabel={t("profileUi.noFeaturedCards", {
                      name: profile.pseudo
                    })}
                  />
                </section>
                <section className="yk-profile-completion">
                  <div className="yk-profile-section-heading">
                    <h3 className="yk-section-title">
                      {t("profileFeatured.title")}
                    </h3>
                  </div>
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
                    {t("profileUi.featuredCards")}
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
                  cards={profile.featuredCards}
                  slots={profile.profileStyle?.active ? 10 : 5}
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
              ) : (
                <section className="yk-profile-completion">
                  <div className="yk-profile-section-heading">
                    <h2>{t("profileFeatured.title")}</h2>
                    <span className="yk-profile-muted">
                      {t("profileFeatured.subtitle")}
                    </span>
                  </div>
                  <ProfileFeaturedCollection
                    key={profile.id}
                    loadCards={adapter.friendAlbumCards}
                    profile={profile}
                    isMe={isMe}
                  />
                </section>
              )}
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
        <aside className="yk-profile-identity">
          <div
            className={`yk-profile-banner ${bannerImage ? "has-image" : ""} ${bannerFrame ? "has-frame" : ""}`}
          >
            {bannerImage && (
              <>
                {bannerFrame ? (
                  <BannerImage src={bannerImage} frame={bannerFrame} />
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
            <div className="yk-profile-avatar">
              <Avatar
                name={profile.pseudo}
                image={profile.avatarUrl ?? undefined}
                size={compact ? 64 : 96}
              />
              <AvatarDecoration
                frame={
                  profile.profileStyle?.active
                    ? profile.profileStyle.style.avatarFrame
                    : "none"
                }
              />
            </div>
            <span className="yk-profile-identity-label">
              {t("profileUi.collectorLabel")}
            </span>
            <div className="yk-profile-name-row">
              <h2>
                <StyledPlayerName
                  name={profile.pseudo}
                  cosmetics={profile.profileStyle}
                />
              </h2>
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
              className={`yk-profile-actions ${profile.friendshipStatus === "accepted" && !blockedByMe ? "is-friend" : ""}`}
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
                  {profile.friendshipStatus === "accepted" && !blockedByMe && (
                    <>
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
                    </>
                  )}
                </>
              )}
            </div>
            {!isMe && (
              <Button
                variant="secondary"
                className="yk-profile-like"
                disabled={
                  !engagement || likeBusy || profileBlocked || !adapter.like
                }
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
            )}
            {engagementError && (
              <p className="yk-profile-muted" role="status">
                {t(
                  gameErrorKey(engagementError, "profileUi.profileUnavailable")
                )}
              </p>
            )}
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
                          timeZone:
                            Intl.DateTimeFormat().resolvedOptions().timeZone
                        })
                      : new Date(
                          details?.joinedAt || joined!
                        ).toLocaleDateString("en-US", { dateStyle: "long" })
                  : "—"}
              </strong>
            </div>
          </div>
        </aside>
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
              : "max-w-4xl"
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
              setProfile(p);
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
