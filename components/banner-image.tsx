"use client";
/* eslint-disable @next/next/no-img-element */

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type KeyboardEvent,
  type PointerEvent
} from "react";
import {
  bannerGeometry,
  panBanner,
  profileBannerAspect,
  type BannerFrame
} from "@/lib/ui/banner-frame";

export function BannerImage({
  src,
  frame,
  fillContainer = false,
  blurredSides = false,
  aspectRatio = 2.3,
  onReady,
  onError
}: {
  src: string;
  frame: BannerFrame;
  fillContainer?: boolean;
  blurredSides?: boolean;
  aspectRatio?: number;
  onReady?: (aspect: number) => void;
  onError?: () => void;
}) {
  const [loaded, setLoaded] = useState<{ src: string; aspect: number }>();
  const imageRef = useRef<HTMLImageElement>(null);
  const ready = loaded?.src === src;
  const blended = fillContainer || blurredSides;
  const [viewportAspect, setViewportAspect] = useState(3);
  const coverAspect = profileBannerAspect(
    ready ? loaded.aspect : undefined,
    frame.rotation
  );
  useEffect(() => {
    const container = imageRef.current?.parentElement?.parentElement;
    if (!fillContainer || !container) return;
    container.style.setProperty("--profile-cover-aspect", String(coverAspect));
    const measure = () => {
      if (container.clientHeight > 0)
        setViewportAspect(container.clientWidth / container.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => {
      observer.disconnect();
      container.style.removeProperty("--profile-cover-aspect");
    };
  }, [fillContainer, coverAspect]);
  const geometry = bannerGeometry(
    ready ? loaded.aspect : 2.3,
    frame,
    (fillContainer ? viewportAspect : aspectRatio) * (blended ? 0.82 : 1)
  );
  return (
    <>
      {blended && (
        <img
          className="yk-banner-blurred-background"
          src={src}
          alt=""
          aria-hidden="true"
          decoding="async"
          draggable={false}
          style={{ visibility: ready ? "visible" : "hidden" }}
        />
      )}
      <span
        className={blended ? "yk-banner-sharp-layer" : "yk-banner-image-layer"}
      >
        <img
          ref={imageRef}
          className="yk-banner-framed-image"
          src={src}
          alt=""
          aria-hidden="true"
          decoding="async"
          draggable={false}
          style={{
            visibility: ready ? "visible" : "hidden",
            transform: `translate(${geometry.offsetX}%, ${geometry.offsetY}%) scale(${geometry.scale}) rotate(${geometry.rotation}deg)`
          }}
          onLoad={event => {
            const image = event.currentTarget;
            const aspect = image.naturalWidth / image.naturalHeight;
            setLoaded({ src, aspect });
            onReady?.(aspect);
          }}
          onError={onError}
        />
      </span>
    </>
  );
}
export function useProfileBannerAspect(aspect?: number, rotation = 0) {
  const sourceAspect = profileBannerAspect(aspect, rotation);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(
      ".yk-profile-hub:not([data-profile-compact]) > .yk-profile-identity"
    );
    if (!header) return;
    const measure = () => setWidth(header.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return Math.max(sourceAspect, width / 300);
}

export function useBannerPan(
  frame: BannerFrame,
  aspect: number | undefined,
  viewportAspect: number,
  ready: boolean,
  setFrame: Dispatch<SetStateAction<BannerFrame>>,
  widthFraction = 1
) {
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    frame: BannerFrame;
  } | null>(null);
  const release = () => {
    drag.current = null;
  };
  return {
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const movement: Record<string, [number, number]> = {
        ArrowLeft: [-0.02, 0],
        ArrowRight: [0.02, 0],
        ArrowUp: [0, -0.02],
        ArrowDown: [0, 0.02]
      };
      const delta = movement[event.key];
      if (!delta || !ready || !aspect) return;
      event.preventDefault();
      setFrame(current =>
        panBanner(current, aspect, delta[0], delta[1], viewportAspect)
      );
    },
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (!ready || drag.current || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        frame
      };
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const start = drag.current;
      if (!start || start.id !== event.pointerId || !aspect) return;
      const box = event.currentTarget.getBoundingClientRect();
      setFrame(
        panBanner(
          start.frame,
          aspect,
          (event.clientX - start.x) / (box.width * widthFraction),
          (event.clientY - start.y) / box.height,
          viewportAspect
        )
      );
    },
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release
  };
}
