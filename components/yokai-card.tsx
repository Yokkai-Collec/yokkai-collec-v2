"use client";

import { formatLicenseName } from "@/lib/ui/license-name";
import { useTranslations } from "next-intl";

import { cardRarityLabel } from "@/lib/ui/card-rarity-label";
import type { FirstLrCopySource } from "@/lib/data/first-lr-copies";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode, SyntheticEvent } from "react";
import type { Rarity } from "@/lib/data/cards";
import "@/styles/cards.css";

export type YokaiCardProps = {
  id?: string;
  rarity: Rarity;
  instanceId?: string;
  copyInstanceIds?: readonly string[];
  firstLrCopy?: FirstLrCopySource | null;
  hideFirstLrBadge?: boolean;
  shiny?: boolean;
  isEvolved?: boolean;
  name: string;
  image?: string;
  category: string;
  anime?: string;
  number?: string | number;
  animated?: boolean;
  className?: string;
  fallbackImage?: string;
  catalogueImage?: string;
  imageSizes?: string;
  imageLoading?: "lazy" | "eager";
  categoryAccessory?: ReactNode;
  rarityAccessory?: ReactNode;
};
// Grid size for card tiles: about 190 px on desktop, 2 columns on phones.
export const GRID_CARD_IMAGE_SIZES =
  "(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 190px";
// Widths allowed by the Next image optimizer (imageSizes + deviceSizes). The
// large ones are only picked for landscape art (see fitCoverSizes).
const GRID_CARD_WIDTHS = [256, 384, 640, 1080, 1920];
// Art fills the portrait frame (object-fit: cover). Landscape art is scaled up
// to the frame height and cropped, so a variant chosen by the tile width alone
// is too small and looks blurry. Once loaded, ask for a variant as wide as the
// cover scale needs. Portrait art keeps its light variant.
export const fitCoverSizes = (img: HTMLImageElement | null) => {
  const frame = img?.parentElement;
  if (!img?.sizes || !frame || !img.naturalWidth || !img.naturalHeight) return;
  const { clientWidth: width, clientHeight: height } = frame;
  if (!width || !height) return;
  const cover = img.naturalWidth / img.naturalHeight / (width / height);
  if (cover <= 1.05) return;
  const sizes = `${Math.ceil(width * cover)}px`;
  if (img.sizes !== sizes) img.sizes = sizes;
};
// Grid tiles only (imageSizes given): catalogue art hosted on our public
// Storage gets resized WebP at quality 85, sharp at 2x density. Details keep
// the exact original, and other sources (custom art, GIFs) stay untouched.
function gridCardSrcSet(image?: string, sizes?: string) {
  const base =
    typeof process === "undefined"
      ? undefined
      : process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  if (!image || !sizes || !base) return undefined;
  const prefix = `${base}/storage/v1/object/public/card-images/`;
  if (!image.startsWith(prefix) || /[?#]/.test(image)) return undefined;
  const url = encodeURIComponent(image);
  return GRID_CARD_WIDTHS.map(
    width => `/_next/image?url=${url}&w=${width}&q=85 ${width}w`
  ).join(", ");
}
// Imgur serves animated GIFs as MP4 too, 10 to 20 times lighter. Same rule as
// imgurGifVideo in lib/ui/custom-image-media.ts (kept local: this component's
// tests load it with a closed import list).
const imgurGifVideo = (url?: string) => {
  const match = url
    ? /^https:\/\/i\.imgur\.com\/([A-Za-z0-9]+)\.gif$/i.exec(url)
    : null;
  return match ? `https://i.imgur.com/${match[1]}.mp4` : undefined;
};
// Custom art (Imgur, Pinterest) can weigh several MB. Until it is painted, the
// card shows its catalogue art (resized) instead of an empty frame.
const markArtReady = (media: HTMLElement | null) => {
  if (media?.parentElement) media.parentElement.dataset.artReady = "true";
};
const watchArtReady = (media: HTMLImageElement | HTMLVideoElement | null) => {
  // Loaded before hydration: the load event already fired, check the state.
  if (!media) return;
  const ready =
    media instanceof HTMLImageElement
      ? media.complete && media.naturalWidth > 0
      : media.readyState >= 2;
  if (ready) markArtReady(media);
};
// Imgur has no MP4 for this GIF: show the GIF itself.
const showGifInstead = (video: HTMLVideoElement) => {
  const gif = video.parentElement?.querySelector<HTMLImageElement>(
    "img[data-gif-fallback]"
  );
  video.remove();
  if (gif?.dataset.gifFallback) gif.src = gif.dataset.gifFallback;
};
const spots = [
  [12, 18],
  [78, 26],
  [20, 62],
  [70, 58],
  [48, 14],
  [84, 46],
  [8, 40],
  [58, 70]
];

function FirstLrCopyBadge({
  instanceId,
  copyInstanceIds,
  shiny,
  sunset,
  hidden,
  source: override
}: {
  instanceId?: string;
  copyInstanceIds?: readonly string[];
  shiny: boolean;
  sunset: boolean;
  hidden: boolean;
  source?: FirstLrCopySource | null;
}) {
  const t = useTranslations("collectionShared");
  const key = copyInstanceIds?.join(",") ?? instanceId ?? "";
  const [resolved, setResolved] = useState<{
    key: string;
    source?: FirstLrCopySource;
  }>({ key: "" });
  useEffect(() => {
    if (override !== undefined || !key) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void import("@/lib/data/first-lr-copies")
      .then(store => {
        if (cancelled) return;
        const ids = [...new Set(key.split(","))];
        const publish = () =>
          setResolved({ key, source: store.firstLrCopySource(ids) });
        unsubscribe = store.subscribeFirstLrCopies(ids, publish);
        publish();
        store.requestFirstLrCopies(ids);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [key, override]);
  const source =
    override === undefined
      ? resolved.key === key
        ? resolved.source
        : undefined
      : override;
  if (!source) return null;
  const badgeImage = sunset
    ? "/assets/events/gta-sunset/first-copy"
    : "/images/first-copy-shiny-pearl";
  const badgeStyle = sunset
    ? " yk-first-copy-sunset"
    : shiny
      ? " yk-first-copy-shiny"
      : "";
  return (
    <span
      className={`yk-card-copy-status yk-card-first-lr${badgeStyle}`}
      style={hidden ? { visibility: "hidden" } : undefined}
      title={t("firstLrBadge")}
      role="note"
      aria-label={t(source === "legacy" ? "firstLrLegacy" : "firstLrMint")}
      data-first-lr-copy={source}
    >
      <picture className="yk-first-copy-picture">
        <source
          media="(prefers-reduced-motion: reduce)"
          srcSet={`${badgeImage}-still.png`}
        />
        <img
          src={`${badgeImage}.webp`}
          width={sunset ? 132 : 295}
          height={sunset ? 99 : 225}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </picture>
    </span>
  );
}

export function YokaiCard({
  id,
  rarity,
  instanceId,
  copyInstanceIds,
  firstLrCopy,
  hideFirstLrBadge = false,
  shiny = false,
  isEvolved = false,
  name,
  image,
  category,
  anime,
  animated = true,
  imageLoading = "lazy",
  className = "",
  fallbackImage,
  catalogueImage,
  imageSizes,
  categoryAccessory,
  rarityAccessory
}: YokaiCardProps) {
  const blackoutPreview = id?.startsWith("blackout-") ?? false;
  const blackout =
    blackoutPreview ||
    /^\/assets\/events\/blackout\/cards\/[a-z0-9-]+\.webp$/.test(
      catalogueImage ?? image ?? ""
    );
  const t = useTranslations("collectionShared");
  const sunset = /^\/assets\/events\/gta-sunset\/(?:jason|lucia)\.png$/.test(
    catalogueImage ?? image ?? ""
  );
  const holo = shiny && (rarity === "SSR" || rarity === "LR");
  const evolved =
    (isEvolved || (shiny && rarity === "SSR")) &&
    (rarity === "SSR" || rarity === "LR");
  const evolvedStyle =
    (evolved || (blackout && rarity === "LR")) && !(shiny && rarity === "LR");
  const special = holo || evolvedStyle;
  const franchise = formatLicenseName(anime?.trim());
  const sparkCount = !animated
    ? 0
    : evolvedStyle
      ? 6
      : holo
        ? 8
        : rarity === "LR"
          ? 4
          : rarity === "SSR"
            ? 3
            : 0;
  const srcSet = gridCardSrcSet(image, imageSizes);
  const customArt = Boolean(
    image && catalogueImage && image !== catalogueImage
  );
  const placeholderSizes = imageSizes ?? "300px";
  const placeholderSrcSet = customArt
    ? gridCardSrcSet(catalogueImage, placeholderSizes)
    : undefined;
  const video = customArt ? imgurGifVideo(image) : undefined;
  const artProps = {
    src: image ?? "",
    ...(srcSet ? { srcSet, sizes: imageSizes } : {}),
    width: 300,
    height: 420,
    loading: imageLoading,
    decoding: "async" as const,
    ...(placeholderSrcSet || srcSet
      ? {
          ref: (img: HTMLImageElement | null) => {
            if (placeholderSrcSet) watchArtReady(img);
            if (img?.complete) fitCoverSizes(img);
          },
          onLoad: (event: SyntheticEvent<HTMLImageElement>) => {
            if (placeholderSrcSet) markArtReady(event.currentTarget);
            fitCoverSizes(event.currentTarget);
          }
        }
      : {}),
    onError: (event: SyntheticEvent<HTMLImageElement>) => {
      // A failed resized variant first retries the exact original.
      if (event.currentTarget.srcset) {
        event.currentTarget.removeAttribute("srcset");
        event.currentTarget.removeAttribute("sizes");
        return;
      }
      const fallback = fallbackImage ?? catalogueImage;
      if (fallback && event.currentTarget.src !== fallback) {
        event.currentTarget.removeAttribute("srcset");
        event.currentTarget.src = fallback;
      }
    }
  };
  return (
    <div
      data-sunset={sunset || undefined}
      data-blackout={blackout || undefined}
      className={`yk-card yk-rarity-${rarity} ${evolvedStyle ? "yk-evolved" : holo ? "yk-shiny" : ""} ${animated ? "yk-animated" : ""} ${className}`}
    >
      <div
        className="yk-card-clip"
        role="img"
        aria-label={`${name}, ${cardRarityLabel(rarity, shiny, isEvolved)}, ${franchise || category}`}
      >
        <div className="yk-card-frame" />
        {special && <div className="yk-shiny-frame" />}
        <div className="yk-card-interior">
          {rarity === "LR" && !sunset && <div className="yk-card-line" />}
          {image && (
            <div
              className="yk-card-art"
              data-art-layers={placeholderSrcSet || video ? "true" : undefined}
            >
              {placeholderSrcSet && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="yk-card-art-placeholder"
                  src={catalogueImage}
                  srcSet={placeholderSrcSet}
                  sizes={placeholderSizes}
                  width={300}
                  height={420}
                  loading={imageLoading}
                  decoding="async"
                  alt=""
                  aria-hidden="true"
                  ref={img => {
                    if (img?.complete) fitCoverSizes(img);
                  }}
                  onLoad={event => fitCoverSizes(event.currentTarget)}
                />
              )}
              {video ? (
                <>
                  <video
                    src={video}
                    width={300}
                    height={420}
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload={imageLoading === "lazy" ? "metadata" : "auto"}
                    aria-hidden="true"
                    ref={watchArtReady}
                    onLoadedData={event => markArtReady(event.currentTarget)}
                    onError={event => showGifInstead(event.currentTarget)}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    {...artProps}
                    src={undefined}
                    data-gif-fallback={image}
                    alt=""
                  />
                </>
              ) : (
                <>
                  {/* Grids and details use the same original bytes for every source. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img {...artProps} alt="" />
                </>
              )}
            </div>
          )}
          <div className="yk-card-foil" />
          {special && <div className="yk-holo" />}
          {evolvedStyle && (
            <div className="yk-evolved-energy" aria-hidden="true">
              <span className="yk-evolved-scan" />
            </div>
          )}
          {spots.slice(0, sparkCount).map(([left, top], i) => (
            <span
              className={`yk-sparkle${evolvedStyle ? " yk-evolved-spark" : ""}`}
              key={i}
              style={
                {
                  left: `${left}%`,
                  top: `${top}%`,
                  fontSize: i % 3 === 0 ? "9cqw" : "6cqw",
                  animationDelay: `${i * 0.37}s`
                } as CSSProperties
              }
            >
              ✦
            </span>
          ))}
          <div className="yk-card-content">
            <div className="yk-card-top">
              <span className="yk-card-category" title={category}>
                {category}
              </span>
              <span className="yk-card-badges">
                <span className="yk-card-badge">{rarity}</span>
                {evolved && shiny && rarity === "LR" && (
                  <span
                    className="yk-shiny-badge"
                    title="Shiny"
                    aria-label="Shiny"
                  >
                    ✧
                  </span>
                )}
                {(holo || evolved) && (
                  <span
                    className={`yk-shiny-badge${evolved ? " yk-evolved-badge" : ""}`}
                    title={cardRarityLabel(rarity, shiny, isEvolved)}
                  >
                    {evolved ? (
                      <svg
                        className="yk-evolved-symbol"
                        viewBox="0 4 24 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8Z" />
                      </svg>
                    ) : (
                      "✦"
                    )}
                  </span>
                )}
              </span>
            </div>
            {categoryAccessory && (
              <div className="yk-card-category-accessory">
                {categoryAccessory}
              </div>
            )}
            {rarityAccessory && (
              <div className="yk-card-rarity-accessory">{rarityAccessory}</div>
            )}
            {!image && (
              <span className="yk-card-missing">{t("artworkUnavailable")}</span>
            )}
            <div className="yk-card-bottom">
              <span className="yk-card-name" title={name}>
                {name}
              </span>
              {franchise && (
                <span className="yk-card-anime" title={franchise}>
                  {franchise}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      {rarity === "LR" &&
        !blackoutPreview &&
        Boolean(firstLrCopy || instanceId || copyInstanceIds?.length) && (
          <FirstLrCopyBadge
            instanceId={instanceId}
            copyInstanceIds={copyInstanceIds}
            shiny={holo && !evolvedStyle}
            sunset={sunset}
            hidden={hideFirstLrBadge}
            source={firstLrCopy}
          />
        )}
    </div>
  );
}

export function CardBack({ className = "" }: { className?: string }) {
  const t = useTranslations("collectionShared");
  const style = useOwnProfileStyle();
  return (
    <div
      role="img"
      aria-label={t("cardBack")}
      className={`yk-card-back ${className}`}
      style={
        style?.cardBackUrl
          ? {
              backgroundImage: `url(${JSON.stringify(style.cardBackUrl)})`,
              backgroundSize: "cover",
              backgroundPosition: "center"
            }
          : undefined
      }
    />
  );
}
import { useOwnProfileStyle } from "@/components/pro-access";
