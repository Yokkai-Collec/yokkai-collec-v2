export type BannerFrame = {
  x: number;
  y: number;
  zoom: number;
  rotation?: number;
};
export const BANNER_ASPECT = 2.3;
export const DEFAULT_BANNER_FRAME: BannerFrame = { x: 50, y: 28, zoom: 1 };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Keep landscape covers generous without turning portrait uploads into tall headers. */
export function profileBannerAspect(imageAspect = 3, rotation = 0) {
  const aspect =
    Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 3;
  const rotated = Math.abs(rotation % 180) === 90 ? 1 / aspect : aspect;
  return clamp(rotated, 3, 5);
}

export function normalizeBannerFrame(frame: BannerFrame): BannerFrame {
  const finite = (value: number, fallback: number) =>
    Number.isFinite(value) ? value : fallback;
  return {
    x: clamp(finite(frame.x, 50), 0, 100),
    y: clamp(finite(frame.y, 50), 0, 100),
    zoom: clamp(finite(frame.zoom, 1), 0.01, 4),
    rotation: [0, 90, 180, 270].includes(frame.rotation ?? 0)
      ? (frame.rotation ?? 0)
      : 0
  };
}

/** Relative geometry: no raster export, CORS canvas access or GIF conversion. */
export function bannerGeometry(
  imageAspect: number,
  input: BannerFrame,
  viewportAspect = BANNER_ASPECT
) {
  const target =
    Number.isFinite(viewportAspect) && viewportAspect > 0
      ? viewportAspect
      : BANNER_ASPECT;
  const aspect =
    Number.isFinite(imageAspect) && imageAspect > 0
      ? imageAspect
      : BANNER_ASPECT;
  const frame = normalizeBannerFrame(input);
  // CSS first contains the unrotated image, then rotates/scales it. Account for
  // that initial fit before calculating cover/contain for the rotated bounds.
  const fit = Math.min(target / aspect, 1);
  const quarterTurn = frame.rotation === 90 || frame.rotation === 270;
  const width = quarterTurn ? fit : aspect * fit;
  const height = quarterTurn ? aspect * fit : fit;
  const cover = Math.max(target / width, 1 / height);
  const contain = Math.min(target / width, 1 / height);
  const overflowX = Math.max(0, (width * cover * frame.zoom) / target - 1);
  const overflowY = Math.max(0, height * cover * frame.zoom - 1);
  return {
    minZoom: contain / cover,
    scale: cover * frame.zoom,
    rotation: frame.rotation ?? 0,
    overflowX,
    overflowY,
    offsetX: (50 - frame.x) * overflowX,
    offsetY: (50 - frame.y) * overflowY
  };
}

/** Zoom is relative to cover, so 1 and above leave no uncovered space. */
export function bannerNeedsBackdrop(input: BannerFrame) {
  return normalizeBannerFrame(input).zoom < 1;
}

/** Preserve fit-to-cover zoom intent when the displayed banner changes shape. */
export function responsiveBannerFrame(
  imageAspect: number,
  input: BannerFrame,
  viewportAspect: number
): BannerFrame {
  const frame = normalizeBannerFrame(input);
  if (frame.zoom > 1) return frame;
  const source = bannerGeometry(imageAspect, frame);
  if (frame.zoom === 1 && source.minZoom < 1) return frame;
  const target = bannerGeometry(imageAspect, frame, viewportAspect);
  const progress =
    source.minZoom < 1
      ? clamp((frame.zoom - source.minZoom) / (1 - source.minZoom), 0, 1)
      : 0;
  return { ...frame, zoom: target.minZoom + progress * (1 - target.minZoom) };
}

export function rotateBanner(
  input: BannerFrame,
  aspect: number,
  viewportAspect = BANNER_ASPECT
): BannerFrame {
  const frame = normalizeBannerFrame(input);
  const entireImage =
    frame.zoom <=
    bannerGeometry(aspect, frame, viewportAspect).minZoom + 0.00001;
  const rotated = {
    ...frame,
    x: 50,
    y: 50,
    rotation: ((frame.rotation ?? 0) + 90) % 360
  };
  const minZoom = bannerGeometry(aspect, rotated, viewportAspect).minZoom;
  return normalizeBannerFrame({
    ...rotated,
    zoom: entireImage ? minZoom : Math.max(minZoom, frame.zoom)
  });
}

export function panBanner(
  frame: BannerFrame,
  aspect: number,
  dx: number,
  dy: number,
  viewportAspect = BANNER_ASPECT
): BannerFrame {
  const { overflowX, overflowY } = bannerGeometry(
    aspect,
    frame,
    viewportAspect
  );
  return normalizeBannerFrame({
    ...frame,
    x: overflowX > 0.00001 ? frame.x - (dx * 100) / overflowX : 50,
    y: overflowY > 0.00001 ? frame.y - (dy * 100) / overflowY : 50
  });
}
