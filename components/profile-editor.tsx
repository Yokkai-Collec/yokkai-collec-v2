"use client";
/* eslint-disable @next/next/no-img-element */
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Avatar, Button } from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import dynamic from "next/dynamic";
import { BannerCrop } from "@/components/banner-crop";
import { BannerImage } from "@/components/banner-image";
import {
  DEFAULT_PROFILE_STYLE,
  PROFILE_CARD_IMAGE_SIZES,
  showcaseSelection,
  normalizeProfileStyle
} from "@/lib/ui/profile-style";
import { useProAccess, ProFeatureNotice } from "@/components/pro-access";
import type { BannerFrame } from "@/lib/ui/banner-frame";
import { type Card, type CollectedCard, type Rarity } from "@/lib/data/cards";
import {
  saveProfileAppearance,
  uploadAvatar,
  uploadBanner,
  PROFILE_IMAGE_MAX_BYTES,
  type Profile
} from "@/lib/data/profile";
import { matchesCardSearch } from "@/lib/ui/card-search";
import { compareBannerCards } from "@/lib/ui/banner-card-sort";
import { toggleFilterValue } from "@/lib/ui/card-search";
import {
  COLLECTION_SORTS,
  sortCollection,
  type CollectionSort
} from "@/lib/ui/collection-sort";
import { FilterSection, RarityChips } from "@/components/collection-filters";
import { type ProfileAdapter } from "@/components/profile";
const ShowcaseStyleFields = dynamic(() =>
  import("@/components/showcase-style-fields").then(
    module => module.ShowcaseStyleFields
  )
);
export function Editor({
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
  const [style, setStyle] = useState(() =>
    normalizeProfileStyle({
      ...DEFAULT_PROFILE_STYLE,
      ...profile.profileStyle?.style
    })
  );
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
  const [featuredRarities, setFeaturedRarities] = useState<Rarity[]>([]);
  const [featuredCategories, setFeaturedCategories] = useState<string[]>([]);
  const [featuredSpecialOnly, setFeaturedSpecialOnly] = useState(false);
  const [featuredSort, setFeaturedSort] = useState<CollectionSort>("rarity");
  const [showcaseEditorTab, setShowcaseEditorTab] = useState<"cards" | "style">(
    "cards"
  );
  const draggedFeaturedId = useRef<string | null>(null);
  const [draggingFeaturedId, setDraggingFeaturedId] = useState<string | null>(
    null
  );
  const [featuredDropTarget, setFeaturedDropTarget] = useState<string | null>(
    null
  );
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
  const featuredChoices = useMemo(() => {
    const available = unique
      .filter(card => !selected.has(card.instanceId))
      .filter(card =>
        matchesCardSearch(featuredQuery, [card.name, card.category, card.anime])
      )
      .filter(
        card =>
          (!featuredRarities.length ||
            featuredRarities.includes(card.rarity)) &&
          (!featuredCategories.length ||
            featuredCategories.includes(card.category)) &&
          (!featuredSpecialOnly || card.shiny || card.isEvolved)
      );
    return sortCollection(available, featuredSort);
  }, [
    unique,
    featuredQuery,
    selected,
    featuredRarities,
    featuredCategories,
    featuredSpecialOnly,
    featuredSort
  ]);
  const featuredCategoryChoices = useMemo(
    () =>
      [...new Set(unique.map(card => card.category))].toSorted((a, b) =>
        a.localeCompare(b, "fr")
      ),
    [unique]
  );
  const selectedFeaturedCards = useMemo(
    () => showcaseSelection(collection, selected),
    [collection, selected]
  );
  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < FEATURED_CARD_LIMIT) next.add(id);
      return next;
    });
  }
  function reorderFeaturedCard(id: string, beforeId: string) {
    if (id === beforeId) return;
    setSelected(current => {
      const ordered = [...current];
      const sourceIndex = ordered.indexOf(id);
      const targetIndex = ordered.indexOf(beforeId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      ordered.splice(sourceIndex, 1);
      ordered.splice(ordered.indexOf(beforeId), 0, id);
      return new Set(ordered);
    });
  }
  function moveFeaturedCard(id: string, direction: -1 | 1) {
    setSelected(current => {
      const ordered = [...current];
      const sourceIndex = ordered.indexOf(id);
      const targetIndex = sourceIndex + direction;
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length)
        return current;
      [ordered[sourceIndex], ordered[targetIndex]] = [
        ordered[targetIndex],
        ordered[sourceIndex]
      ];
      return new Set(ordered);
    });
  }
  function startFeaturedDrag(event: DragEvent<HTMLLIElement>, id: string) {
    if (busy) {
      event.preventDefault();
      return;
    }
    draggedFeaturedId.current = id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setDraggingFeaturedId(id);
  }
  function endFeaturedDrag() {
    draggedFeaturedId.current = null;
    setDraggingFeaturedId(null);
    setFeaturedDropTarget(null);
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
      if (mode === "showcase" && pro) {
        if (
          JSON.stringify(style) !==
          JSON.stringify(
            normalizeProfileStyle({
              ...DEFAULT_PROFILE_STYLE,
              ...profile.profileStyle?.style
            })
          )
        )
          await import("@/lib/data/showcase-style").then(module =>
            module.persistProfileStyle(style)
          );
        updated.profileStyle = { active: true, style };
      }
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
          <>
            <div
              className="yk-showcase-editor-tabs"
              role="tablist"
              aria-label={t("profileUi.showcaseEditorTabs")}
            >
              <button
                id="showcase-cards-tab"
                type="button"
                role="tab"
                aria-selected={showcaseEditorTab === "cards"}
                aria-controls="showcase-cards-panel"
                tabIndex={showcaseEditorTab === "cards" ? 0 : -1}
                onClick={() => setShowcaseEditorTab("cards")}
              >
                {t("profileUi.showcaseEditorCards")}
              </button>
              <button
                id="showcase-style-tab"
                type="button"
                role="tab"
                aria-selected={showcaseEditorTab === "style"}
                aria-controls="showcase-style-panel"
                tabIndex={showcaseEditorTab === "style" ? 0 : -1}
                onClick={() => setShowcaseEditorTab("style")}
              >
                {t("profileUi.showcaseEditorStyle")}
              </button>
            </div>
            {showcaseEditorTab === "cards" ? (
              <section
                id="showcase-cards-panel"
                role="tabpanel"
                aria-labelledby="showcase-cards-tab"
              >
                <div className="yk-showcase-card-selector">
                  <div className="yk-showcase-card-selector-heading">
                    <div>
                      <h3 className="font-display text-lg">
                        {t("profileUi.featuredCards")}
                      </h3>
                      <p>
                        {t("profileUi.chooseFeatured", {
                          limit: FEATURED_CARD_LIMIT
                        })}
                      </p>
                      {selectedFeaturedCards.length > 1 && (
                        <small className="yk-showcase-selection-reorder-hint">
                          {t("profileUi.showcaseReorderHint")}
                        </small>
                      )}
                    </div>
                    <strong>
                      {t("profileUi.showcaseSelectedCount", {
                        count: selected.size,
                        limit: FEATURED_CARD_LIMIT
                      })}
                    </strong>
                  </div>
                  {selectedFeaturedCards.length > 0 && (
                    <ol
                      className="yk-showcase-selection-strip"
                      aria-label={t("profileUi.showcaseSelectedCards")}
                    >
                      {selectedFeaturedCards.map((card, index) => (
                        <li
                          key={card.instanceId}
                          draggable={!busy}
                          data-dragging={
                            draggingFeaturedId === card.instanceId || undefined
                          }
                          data-drop-target={
                            featuredDropTarget === card.instanceId &&
                            draggingFeaturedId !== card.instanceId
                              ? true
                              : undefined
                          }
                          onDragStart={event =>
                            startFeaturedDrag(event, card.instanceId)
                          }
                          onDragOver={event => event.preventDefault()}
                          onDragEnter={() =>
                            setFeaturedDropTarget(card.instanceId)
                          }
                          onDrop={event => {
                            event.preventDefault();
                            const draggedId =
                              event.dataTransfer.getData("text/plain") ||
                              draggedFeaturedId.current;
                            if (draggedId)
                              reorderFeaturedCard(draggedId, card.instanceId);
                            endFeaturedDrag();
                          }}
                          onDragEnd={endFeaturedDrag}
                        >
                          <button
                            type="button"
                            className="yk-showcase-selection-card"
                            onClick={() => toggle(card.instanceId)}
                            aria-label={t("profileUi.showcaseRemoveCard", {
                              name: card.name
                            })}
                            title={t("profileUi.showcaseRemoveCard", {
                              name: card.name
                            })}
                            disabled={busy}
                          >
                            <img src={card.image} alt="" />
                            <span className="yk-showcase-selection-order">
                              {index + 1}
                            </span>
                            <span className="yk-showcase-selection-name">
                              {card.name}
                            </span>
                            <span
                              className="yk-showcase-selection-remove"
                              aria-hidden="true"
                            >
                              ×
                            </span>
                          </button>
                          <div className="yk-showcase-selection-actions">
                            <button
                              type="button"
                              disabled={busy || index === 0}
                              onClick={() =>
                                moveFeaturedCard(card.instanceId, -1)
                              }
                              aria-label={t("profileUi.showcaseMoveEarlier", {
                                name: card.name
                              })}
                              title={t("profileUi.showcaseMoveEarlier", {
                                name: card.name
                              })}
                            >
                              ←
                            </button>
                            <button
                              type="button"
                              disabled={
                                busy ||
                                index === selectedFeaturedCards.length - 1
                              }
                              onClick={() =>
                                moveFeaturedCard(card.instanceId, 1)
                              }
                              aria-label={t("profileUi.showcaseMoveLater", {
                                name: card.name
                              })}
                              title={t("profileUi.showcaseMoveLater", {
                                name: card.name
                              })}
                            >
                              →
                            </button>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div className="yk-showcase-card-browser">
                  <div className="yk-showcase-card-browser-heading">
                    <h4>{t("profileUi.showcaseAvailableCards")}</h4>
                    <span>
                      {t("profileUi.showcaseSearchResults", {
                        count: featuredChoices.length
                      })}
                    </span>
                  </div>
                  <div className="yk-showcase-card-picker-layout">
                    <aside
                      className="yk-showcase-card-filters"
                      aria-label={t("collectionUi.collectionFilters")}
                    >
                      <button
                        type="button"
                        className="yk-filter-reset"
                        disabled={
                          !(
                            featuredQuery ||
                            featuredRarities.length ||
                            featuredCategories.length ||
                            featuredSpecialOnly ||
                            featuredSort !== "rarity"
                          )
                        }
                        onClick={() => {
                          setFeaturedQuery("");
                          setFeaturedRarities([]);
                          setFeaturedCategories([]);
                          setFeaturedSpecialOnly(false);
                          setFeaturedSort("rarity");
                        }}
                      >
                        {t("collectionUi.resetFilters")}
                      </button>
                      <div className="yk-showcase-card-filter-sections">
                        <FilterSection
                          title={t("collectionUi.rarity")}
                          count={featuredRarities.length}
                          sectionId="showcase-rarity"
                        >
                          <RarityChips
                            selected={featuredRarities}
                            count={rarity =>
                              unique.filter(card => card.rarity === rarity)
                                .length
                            }
                            onToggle={rarity =>
                              setFeaturedRarities(current =>
                                toggleFilterValue(current, rarity)
                              )
                            }
                          />
                        </FilterSection>
                        <FilterSection
                          title={t("collectionUi.category")}
                          count={featuredCategories.length}
                          sectionId="showcase-category"
                        >
                          {featuredCategoryChoices.map(category => (
                            <button
                              type="button"
                              key={category}
                              className="yk-filter-option"
                              aria-pressed={featuredCategories.includes(
                                category
                              )}
                              onClick={() =>
                                setFeaturedCategories(current =>
                                  toggleFilterValue(current, category)
                                )
                              }
                            >
                              <span className="yk-filter-check" />
                              <span>{category}</span>
                              <strong>
                                {
                                  unique.filter(
                                    card => card.category === category
                                  ).length
                                }
                              </strong>
                            </button>
                          ))}
                        </FilterSection>
                        <FilterSection
                          title={t("collectionUi.status")}
                          count={Number(featuredSpecialOnly)}
                          sectionId="showcase-status"
                        >
                          <button
                            type="button"
                            className="yk-filter-option"
                            aria-pressed={featuredSpecialOnly}
                            onClick={() =>
                              setFeaturedSpecialOnly(current => !current)
                            }
                          >
                            <span className="yk-filter-check" />
                            <span>{t("profileUi.showcaseSpecialCards")}</span>
                            <strong>
                              {
                                unique.filter(
                                  card => card.shiny || card.isEvolved
                                ).length
                              }
                            </strong>
                          </button>
                        </FilterSection>
                      </div>
                    </aside>
                    <div className="yk-showcase-card-results">
                      <div className="yk-showcase-card-results-toolbar">
                        <label className="sr-only" htmlFor="featured-query">
                          {t("profileUi.searchForACardToFeature")}
                        </label>
                        <input
                          id="featured-query"
                          className="auth-input"
                          type="search"
                          value={featuredQuery}
                          onChange={e => setFeaturedQuery(e.target.value)}
                          placeholder={t("collectionUi.search")}
                        />
                        <label className="yk-showcase-card-sort">
                          <span>{t("collectionUi.sortBy")}</span>
                          <select
                            value={featuredSort}
                            onChange={event =>
                              setFeaturedSort(
                                event.target.value as CollectionSort
                              )
                            }
                            aria-label={t("collectionUi.sortCollection")}
                          >
                            {COLLECTION_SORTS.map(option => (
                              <option key={option.value} value={option.value}>
                                {t("collectionUi.sortLabel", {
                                  sort: option.value
                                })}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {featuredChoices.length ? (
                        <div className="yk-featured-picker yk-showcase-card-browser-grid">
                          {featuredChoices.map(card => (
                            <button
                              type="button"
                              key={card.instanceId}
                              onClick={() => toggle(card.instanceId)}
                              aria-label={t("profileUi.showcaseAddCard", {
                                name: card.name
                              })}
                              disabled={
                                busy || selected.size >= FEATURED_CARD_LIMIT
                              }
                            >
                              <YokaiCard
                                {...card}
                                image={card.catalogueImage}
                                animated={false}
                                imageSizes={PROFILE_CARD_IMAGE_SIZES}
                              />
                              <span>
                                <b aria-hidden="true">+</b>
                                {t("profileUi.choose")}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p
                          className="yk-showcase-card-search-empty"
                          role="status"
                        >
                          {t("profileUi.showcaseSearchEmpty")}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              <section
                id="showcase-style-panel"
                role="tabpanel"
                aria-labelledby="showcase-style-tab"
              >
                {pro && (
                  <ShowcaseStyleFields
                    cards={selectedFeaturedCards}
                    value={style}
                    onChange={setStyle}
                    busy={busy}
                  />
                )}
              </section>
            )}
          </>
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
