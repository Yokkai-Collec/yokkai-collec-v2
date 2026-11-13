"use client";
/* eslint-disable @next/next/no-img-element */
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations } from "next-intl";
import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent
} from "react";
import { Avatar, Button } from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import dynamic from "next/dynamic";
import { BannerCrop } from "@/components/banner-crop";
import { BannerImage } from "@/components/banner-image";
import {
  DEFAULT_PROFILE_STYLE,
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
import { cardSearchTerms, matchesCardSearch } from "@/lib/ui/card-search";
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
const PAGE_SIZES = [48, 96] as const;
const PickerArt = memo(function PickerArt({ card }: { card: CollectedCard }) {
  return (
    <YokaiCard
      {...card}
      image={card.catalogueImage || card.image}
      animated={false}
      imageSizes="(max-width: 640px) 42vw, 150px"
    />
  );
});
const SelectedShowcaseArt = memo(function SelectedShowcaseArt({
  card
}: {
  card: CollectedCard;
}) {
  return (
    <YokaiCard
      {...card}
      fallbackImage={card.catalogueImage}
      imageSizes="108px"
    />
  );
});

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
  const proAccess = useProAccess();
  const pro = proAccess || Boolean(adapter.saveShowcaseStyle);
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
  const deferredQuery = useDeferredValue(featuredQuery);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(48);
  const [moveNotice, setMoveNotice] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [replacement, setReplacement] = useState<CollectedCard | null>(null);
  const selectionHeading = useRef<HTMLDivElement>(null);
  const resultsHeading = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [featuredRarities, setFeaturedRarities] = useState<Rarity[]>([]);
  const [featuredCategories, setFeaturedCategories] = useState<string[]>([]);
  const [featuredSpecialOnly, setFeaturedSpecialOnly] = useState(false);
  const [featuredSort, setFeaturedSort] = useState<CollectionSort>("rarity");
  const [showcaseEditorTab, setShowcaseEditorTab] = useState<"cards" | "style">(
    "cards"
  );
  const featuredPointer = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    grabX: number;
    grabY: number;
    width: number;
    height: number;
    moving: boolean;
    preview?: HTMLImageElement;
    frame?: number;
  } | null>(null);
  useEffect(
    () => () => {
      const drag = featuredPointer.current;
      drag?.preview?.remove();
      if (drag?.frame !== undefined) cancelAnimationFrame(drag.frame);
    },
    []
  );
  const [draggingFeaturedId, setDraggingFeaturedId] = useState<string | null>(
    null
  );
  const [featuredDropTarget, setFeaturedDropTarget] = useState<{
    id: string;
    side: "before" | "after";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bannerQuery, setBannerQuery] = useState("");
  const ownedBannerChoices = useMemo(
    () =>
      mode === "showcase"
        ? []
        : ownedBannerCards
            .filter(card =>
              matchesCardSearch(bannerQuery, [
                card.name,
                card.category,
                card.anime
              ])
            )
            .toSorted(compareBannerCards),
    [ownedBannerCards, bannerQuery, mode]
  );
  const catalogue = useMemo(() => {
    const instances = new Map<string, CollectedCard>();
    const cards = new Map<string, CollectedCard>();
    const search = new Map<string, string[]>();
    const categories = new Map<string, number>();
    const rarities = new Map<Rarity, number>();
    let special = 0;
    if (mode === "showcase")
      for (const card of collection) {
        instances.set(card.instanceId, card);
        if (cards.has(card.id)) continue;
        cards.set(card.id, card);
        search.set(
          card.id,
          [card.name, card.category, card.anime ?? ""].map(value =>
            value.toLocaleLowerCase("en-US")
          )
        );
        categories.set(card.category, (categories.get(card.category) ?? 0) + 1);
        rarities.set(card.rarity, (rarities.get(card.rarity) ?? 0) + 1);
        if (card.shiny || card.isEvolved) special++;
      }
    return {
      instances,
      cards: [...cards.values()],
      search,
      categories,
      rarities,
      special
    };
  }, [collection, mode]);
  const orderedChoices = useMemo(
    () => sortCollection(catalogue.cards, featuredSort),
    [catalogue, featuredSort]
  );
  const selectedFeaturedCards = useMemo(
    () =>
      [...selected].flatMap(id => {
        const card =
          catalogue.instances.get(id) ??
          profile.featuredCards.find(item => item.instanceId === id);
        return card ? [card] : [];
      }),
    [catalogue, selected, profile.featuredCards]
  );
  const selectedCardIds = useMemo(
    () => new Set(selectedFeaturedCards.map(card => card.id)),
    [selectedFeaturedCards]
  );
  const featuredChoices = useMemo(() => {
    const terms = cardSearchTerms(deferredQuery);
    return orderedChoices.filter(
      card =>
        !selectedCardIds.has(card.id) &&
        (!featuredRarities.length || featuredRarities.includes(card.rarity)) &&
        (!featuredCategories.length ||
          featuredCategories.includes(card.category)) &&
        (!featuredSpecialOnly || card.shiny || card.isEvolved) &&
        terms.every(term =>
          catalogue.search.get(card.id)?.some(value => value.includes(term))
        )
    );
  }, [
    orderedChoices,
    catalogue,
    selectedCardIds,
    deferredQuery,
    featuredRarities,
    featuredCategories,
    featuredSpecialOnly
  ]);
  const featuredCategoryChoices = useMemo(
    () =>
      [...catalogue.categories.keys()].toSorted((a, b) => a.localeCompare(b)),
    [catalogue]
  );
  const pages = Math.max(1, Math.ceil(featuredChoices.length / pageSize));
  const activePage = Math.min(page, pages);
  const isFull = selected.size >= FEATURED_CARD_LIMIT;

  function chooseCard(card: CollectedCard) {
    if (isFull) {
      setReplacement(card);
      selectionHeading.current?.focus();
      return;
    }
    setSelected(current =>
      current.size < FEATURED_CARD_LIMIT
        ? new Set([...current, card.instanceId])
        : current
    );
  }
  function removeCard(id: string) {
    setSelected(current => new Set([...current].filter(item => item !== id)));
    setReplacement(null);
  }
  function replaceCard(id: string, card: CollectedCard) {
    setSelected(
      current =>
        new Set(
          [...current].map(item => (item === id ? card.instanceId : item))
        )
    );
    setReplacement(null);
    selectionHeading.current?.focus();
  }
  function selectTab(tab: "cards" | "style") {
    setShowcaseEditorTab(tab);
    setReplacement(null);
    body.current?.scrollTo({ top: 0 });
  }
  function moveFeaturedCard(id: string, target: number) {
    const ordered = selectedFeaturedCards.map(card => card.instanceId);
    const source = ordered.indexOf(id);
    if (
      source < 0 ||
      source === target ||
      target < 0 ||
      target >= ordered.length
    )
      return;
    const card = selectedFeaturedCards[source];
    ordered.splice(source, 1);
    ordered.splice(target, 0, id);
    setSelected(new Set(ordered));
    setMoveNotice(
      t("profileUi.showcaseMoved", { name: card.name, position: target + 1 })
    );
  }

  function startFeaturedDrag(event: PointerEvent<HTMLLIElement>, id: string) {
    if (
      busy ||
      replacement ||
      event.pointerType === "touch" ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button:not(:disabled), select")
    )
      return;
    const card = event.currentTarget.querySelector(".yk-card");
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    featuredPointer.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      grabX: event.clientX - bounds.left,
      grabY: event.clientY - bounds.top,
      width: bounds.width,
      height: bounds.height,
      moving: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function featuredDropAt(event: PointerEvent<HTMLLIElement>) {
    const strip = event.currentTarget.parentElement;
    if (!strip) return null;
    const { clientX: x, clientY: y } = event;
    const stripBounds = strip.getBoundingClientRect();
    if (
      x < stripBounds.left ||
      x > stripBounds.right ||
      y < stripBounds.top ||
      y > stripBounds.bottom
    )
      return null;

    for (const slot of strip.querySelectorAll<HTMLElement>(
      "[data-showcase-slot]"
    )) {
      if (!slot.dataset.showcaseSlot) continue;
      const bounds = slot.getBoundingClientRect();
      if (x <= bounds.left + bounds.width / 2)
        return { id: slot.dataset.showcaseSlot, side: "before" } as const;
      if (x <= bounds.right + 4 || slot === strip.lastElementChild)
        return { id: slot.dataset.showcaseSlot, side: "after" } as const;
    }
    return null;
  }

  function trackFeaturedDrag(event: PointerEvent<HTMLLIElement>) {
    const drag = featuredPointer.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moving) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5)
        return;
      drag.moving = true;
      setDraggingFeaturedId(drag.id);
      const source = event.currentTarget.querySelector(".yk-card");
      const dialog = event.currentTarget.closest("dialog");
      const art = source?.querySelector<HTMLImageElement>(".yk-card-art img");
      const poster =
        source?.querySelector<HTMLVideoElement>(".yk-card-art video")?.poster;
      const image = art?.currentSrc || art?.src || poster;
      if (source && dialog && image) {
        const preview = document.createElement("img");
        preview.className = "yk-showcase-drag-preview";
        preview.alt = "";
        preview.setAttribute("aria-hidden", "true");
        preview.src = image;
        preview.style.width = `${drag.width}px`;
        preview.style.height = `${drag.height}px`;
        drag.preview = preview;
        dialog.append(preview);
      }
    }
    const { clientX, clientY } = event;
    const preview = drag.preview;
    if (preview) {
      if (drag.frame !== undefined) cancelAnimationFrame(drag.frame);
      drag.frame = requestAnimationFrame(() => {
        preview.style.transform = `translate3d(${clientX - drag.grabX}px, ${clientY - drag.grabY}px, 0)`;
        preview.style.visibility = "visible";
        drag.frame = undefined;
      });
    }
    const hit = featuredDropAt(event);
    const next = hit?.id === drag.id ? null : hit;
    setFeaturedDropTarget(current =>
      current?.id === next?.id && current?.side === next?.side ? current : next
    );
  }

  function endFeaturedDrag() {
    const drag = featuredPointer.current;
    drag?.preview?.remove();
    if (drag?.frame !== undefined) cancelAnimationFrame(drag.frame);
    featuredPointer.current = null;
    setDraggingFeaturedId(null);
    setFeaturedDropTarget(null);
  }

  function finishFeaturedDrag(event: PointerEvent<HTMLLIElement>) {
    const drag = featuredPointer.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const hit = drag.moving ? featuredDropAt(event) : null;
    endFeaturedDrag();
    if (!hit || hit.id === drag.id || busy || replacement) return;
    const source = selectedFeaturedCards.findIndex(
      item => item.instanceId === drag.id
    );
    const target = selectedFeaturedCards.findIndex(
      item => item.instanceId === hit.id
    );
    if (source < 0 || target < 0) return;
    const insertion = target + Number(hit.side === "after");
    moveFeaturedCard(drag.id, insertion - Number(source < insertion));
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
          await (adapter.saveShowcaseStyle
            ? adapter.saveShowcaseStyle(style)
            : import("@/lib/data/showcase-style").then(module =>
                module.persistProfileStyle(style)
              ));
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
    <div
      className={
        mode === "profile"
          ? "space-y-6 yk-profile-edit-grid"
          : "yk-profile-edit-grid"
      }
      data-profile-editor={mode}
    >
      <div
        ref={body}
        className={
          mode === "showcase" ? "yk-showcase-editor-body" : "space-y-6"
        }
      >
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
              onKeyDown={event => {
                if (
                  !pro ||
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key
                  )
                )
                  return;
                event.preventDefault();
                const tab =
                  event.key === "Home"
                    ? "cards"
                    : event.key === "End"
                      ? "style"
                      : showcaseEditorTab === "cards"
                        ? "style"
                        : "cards";
                selectTab(tab);
                event.currentTarget
                  .querySelector<HTMLButtonElement>("#showcase-" + tab + "-tab")
                  ?.focus();
              }}
            >
              <button
                id="showcase-cards-tab"
                type="button"
                role="tab"
                aria-selected={showcaseEditorTab === "cards"}
                aria-controls="showcase-cards-panel"
                tabIndex={showcaseEditorTab === "cards" ? 0 : -1}
                onClick={() => selectTab("cards")}
              >
                {t("profileUi.showcaseEditorCards")}
              </button>
              {pro && (
                <button
                  id="showcase-style-tab"
                  type="button"
                  role="tab"
                  aria-selected={showcaseEditorTab === "style"}
                  aria-controls="showcase-style-panel"
                  tabIndex={showcaseEditorTab === "style" ? 0 : -1}
                  onClick={() => selectTab("style")}
                >
                  {t("profileUi.showcaseEditorStyle")}
                </button>
              )}
            </div>
            {showcaseEditorTab === "cards" ? (
              <section
                id="showcase-cards-panel"
                role="tabpanel"
                aria-labelledby="showcase-cards-tab"
              >
                <div
                  className="yk-showcase-card-selector"
                  data-replacing={Boolean(replacement)}
                >
                  <div
                    className="yk-showcase-card-selector-heading"
                    tabIndex={-1}
                    ref={selectionHeading}
                  >
                    <div>
                      <h3 className="font-display text-lg">
                        {t("profileUi.featuredCards")}
                      </h3>
                      <p role="status">
                        {replacement
                          ? t("profileUi.showcasePickSlot", {
                              name: replacement.name
                            })
                          : selectedFeaturedCards.length > 1
                            ? t("profileUi.showcaseReorderHint")
                            : t("profileUi.chooseFeatured", {
                                limit: FEATURED_CARD_LIMIT
                              })}
                      </p>
                      {replacement && (
                        <button
                          type="button"
                          className="yk-showcase-cancel-replace"
                          onClick={() => setReplacement(null)}
                        >
                          {t("packs.cancel")}
                        </button>
                      )}
                    </div>
                    <strong>
                      {t("profileUi.showcaseSelectedCount", {
                        count: selected.size,
                        limit: FEATURED_CARD_LIMIT
                      })}
                    </strong>
                  </div>
                  <p className="sr-only" role="status">
                    {moveNotice}
                  </p>
                  {selectedFeaturedCards.length > 0 && (
                    <ol
                      className="yk-showcase-selection-strip"
                      aria-label={t("profileUi.showcaseSelectedCards")}
                    >
                      {selectedFeaturedCards.map((card, index) => (
                        <li
                          key={card.instanceId}
                          data-showcase-slot={card.instanceId}
                          data-reorderable={!busy && !replacement}
                          data-dragging={
                            draggingFeaturedId === card.instanceId || undefined
                          }
                          data-drop-target={
                            featuredDropTarget?.id === card.instanceId
                              ? featuredDropTarget.side
                              : undefined
                          }
                          onPointerDown={event =>
                            startFeaturedDrag(event, card.instanceId)
                          }
                          onPointerMove={trackFeaturedDrag}
                          onPointerUp={finishFeaturedDrag}
                          onPointerCancel={endFeaturedDrag}
                          onLostPointerCapture={endFeaturedDrag}
                        >
                          <div
                            className="yk-showcase-selection-card"
                            onDragStart={event => event.preventDefault()}
                          >
                            <SelectedShowcaseArt card={card} />
                            {replacement && (
                              <button
                                type="button"
                                className="yk-showcase-replace-slot"
                                disabled={busy}
                                onClick={() =>
                                  replaceCard(card.instanceId, replacement)
                                }
                                aria-label={t("profileUi.showcaseReplaceSlot", {
                                  name: card.name
                                })}
                                title={t("profileUi.showcaseReplaceSlot", {
                                  name: card.name
                                })}
                              />
                            )}
                          </div>
                          {replacement ? (
                            <span className="yk-showcase-selection-order">
                              {index + 1}
                            </span>
                          ) : (
                            <span className="yk-showcase-selection-order">
                              <span aria-hidden="true">{index + 1}</span>
                              <select
                                className="yk-showcase-position"
                                aria-label={t("profileUi.showcaseMoveTo", {
                                  name: card.name
                                })}
                                title={t("profileUi.showcaseMoveTo", {
                                  name: card.name
                                })}
                                value={index}
                                disabled={
                                  busy || selectedFeaturedCards.length < 2
                                }
                                onChange={event =>
                                  moveFeaturedCard(
                                    card.instanceId,
                                    Number(event.target.value)
                                  )
                                }
                              >
                                {selectedFeaturedCards.map((item, position) => (
                                  <option
                                    key={item.instanceId}
                                    value={position}
                                  >
                                    {position + 1}
                                  </option>
                                ))}
                              </select>
                            </span>
                          )}
                          <button
                            type="button"
                            className="yk-showcase-selection-remove"
                            disabled={busy}
                            onClick={() => removeCard(card.instanceId)}
                            aria-label={t("profileUi.showcaseRemoveCard", {
                              name: card.name
                            })}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div className="yk-showcase-card-browser">
                  <div
                    className="yk-showcase-card-browser-heading"
                    ref={resultsHeading}
                    tabIndex={-1}
                  >
                    <h4>{t("profileUi.showcaseAvailableCards")}</h4>
                    <span>
                      {t("profileUi.showcaseSearchResults", {
                        count: featuredChoices.length
                      })}
                    </span>
                  </div>
                  <div className="yk-showcase-card-results-toolbar">
                    <label className="sr-only" htmlFor="featured-query">
                      {t("profileUi.searchForACardToFeature")}
                    </label>
                    <input
                      id="featured-query"
                      className="auth-input"
                      type="search"
                      value={featuredQuery}
                      onChange={e => {
                        setPage(1);
                        setFeaturedQuery(e.target.value);
                      }}
                      placeholder={t("collectionUi.search")}
                    />
                    <label className="yk-showcase-card-sort">
                      <span>{t("collectionUi.sortBy")}</span>
                      <select
                        value={featuredSort}
                        onChange={event => {
                          setPage(1);
                          setFeaturedSort(event.target.value as CollectionSort);
                        }}
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
                  <button
                    type="button"
                    className="yk-showcase-filter-toggle"
                    aria-controls="showcase-filters"
                    aria-expanded={filtersOpen}
                    onClick={() => setFiltersOpen(open => !open)}
                  >
                    {t("profileUi.showcaseFilterToggle")}
                    {featuredRarities.length +
                      featuredCategories.length +
                      Number(featuredSpecialOnly) >
                      0 && (
                      <span>
                        {" "}
                        ·{" "}
                        {featuredRarities.length +
                          featuredCategories.length +
                          Number(featuredSpecialOnly)}
                      </span>
                    )}
                    <span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
                  </button>
                  <div className="yk-showcase-card-picker-layout">
                    <aside
                      id="showcase-filters"
                      data-expanded={filtersOpen}
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
                          setPage(1);
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
                              catalogue.rarities.get(rarity) ?? 0
                            }
                            onToggle={rarity => {
                              setPage(1);
                              setFeaturedRarities(current =>
                                toggleFilterValue(current, rarity)
                              );
                            }}
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
                              onClick={() => {
                                setPage(1);
                                setFeaturedCategories(current =>
                                  toggleFilterValue(current, category)
                                );
                              }}
                            >
                              <span className="yk-filter-check" />
                              <span>{category}</span>
                              <strong>
                                {catalogue.categories.get(category)}
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
                            onClick={() => {
                              setPage(1);
                              setFeaturedSpecialOnly(current => !current);
                            }}
                          >
                            <span className="yk-filter-check" />
                            <span>{t("profileUi.showcaseSpecialCards")}</span>
                            <strong>{catalogue.special}</strong>
                          </button>
                        </FilterSection>
                      </div>
                    </aside>
                    <div className="yk-showcase-card-results">
                      {featuredChoices.length ? (
                        <div
                          className="yk-featured-picker yk-showcase-card-browser-grid"
                          aria-busy={featuredQuery !== deferredQuery}
                        >
                          {featuredChoices
                            .slice(
                              (activePage - 1) * pageSize,
                              activePage * pageSize
                            )
                            .map(card => (
                              <button
                                type="button"
                                key={card.instanceId}
                                onClick={() => chooseCard(card)}
                                aria-label={t(
                                  isFull
                                    ? "profileUi.showcaseUseReplacement"
                                    : "profileUi.showcaseAddCard",
                                  { name: card.name }
                                )}
                                disabled={busy}
                              >
                                <PickerArt card={card} />
                                <span>
                                  {t(
                                    isFull
                                      ? "profileUi.showcaseReplace"
                                      : "profileUi.choose"
                                  )}
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
                      <div className="yk-showcase-browse-controls">
                        <select
                          className="yk-showcase-page-size"
                          aria-label={t("profileUi.showcasePageSize")}
                          value={pageSize}
                          onChange={event => {
                            setPage(1);
                            setPageSize(event.target.value === "96" ? 96 : 48);
                          }}
                        >
                          {PAGE_SIZES.map(size => (
                            <option key={size} value={size}>
                              {t("profileUi.showcaseCardsPerPage", {
                                count: size
                              })}
                            </option>
                          ))}
                        </select>
                        {pages > 1 && (
                          <nav
                            className="yk-showcase-pagination"
                            aria-label={t("collectionShared.pagination")}
                          >
                            <button
                              type="button"
                              disabled={activePage === 1}
                              aria-label={t("collectionShared.previousPage")}
                              onClick={() => {
                                setPage(activePage - 1);
                                resultsHeading.current?.focus();
                              }}
                            >
                              ←
                            </button>
                            <span aria-live="polite">
                              {t("profileUi.showcasePage", {
                                page: activePage,
                                total: pages
                              })}
                            </span>
                            <button
                              type="button"
                              disabled={activePage === pages}
                              aria-label={t("collectionShared.nextPage")}
                              onClick={() => {
                                setPage(activePage + 1);
                                resultsHeading.current?.focus();
                              }}
                            >
                              →
                            </button>
                          </nav>
                        )}
                      </div>
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
        <Button
          disabled={busy || replacement !== null}
          onClick={() => void submit()}
        >
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
