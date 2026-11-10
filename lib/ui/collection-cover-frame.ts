import { normalizeBannerFrame, type BannerFrame } from "@/lib/ui/banner-frame";

export type CollectionCoverFrame = BannerFrame;

export const DEFAULT_COLLECTION_COVER_FRAME: CollectionCoverFrame = {
  x: 50,
  y: 50,
  zoom: 1,
  rotation: 0
};

export function normalizeCollectionCoverFrame(
  frame?: CollectionCoverFrame | null
): CollectionCoverFrame {
  return normalizeBannerFrame(frame ?? DEFAULT_COLLECTION_COVER_FRAME);
}

/** Keeps the original file intact, including animated GIFs. */
export function collectionCoverImageStyle(frame?: CollectionCoverFrame | null) {
  if (!frame) return undefined;
  const normalized = normalizeCollectionCoverFrame(frame);
  return {
    objectPosition: `${normalized.x}% ${normalized.y}%`,
    transform: `scale(${normalized.zoom}) rotate(${normalized.rotation ?? 0}deg)`,
    transformOrigin: "center"
  };
}
