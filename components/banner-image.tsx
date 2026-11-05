"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import {
  bannerGeometry,
  responsiveBannerFrame,
  type BannerFrame
} from "@/lib/ui/banner-frame";

export function BannerImage({
  src,
  frame,
  fillContainer = false,
  onReady,
  onError
}: {
  src: string;
  frame: BannerFrame;
  fillContainer?: boolean;
  onReady?: (aspect: number) => void;
  onError?: () => void;
}) {
  const [loaded, setLoaded] = useState<{ src: string; aspect: number }>();
  const imageRef = useRef<HTMLImageElement>(null);
  const [viewportAspect, setViewportAspect] = useState(2.3);
  useEffect(() => {
    const container = imageRef.current?.parentElement;
    if (!fillContainer || !container) return;
    const measure = () => {
      if (container.clientHeight > 0) {
        setViewportAspect(container.clientWidth / container.clientHeight);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fillContainer]);
  const ready = loaded?.src === src;
  const geometry = bannerGeometry(
    ready ? loaded.aspect : 2.3,
    fillContainer
      ? responsiveBannerFrame(
          ready ? loaded.aspect : 2.3,
          frame,
          viewportAspect
        )
      : frame,
    fillContainer ? viewportAspect : 2.3
  );
  return (
    <>
      {fillContainer && (
        <img
          className="yk-banner-backdrop"
          src={src}
          alt=""
          aria-hidden="true"
          decoding="async"
          draggable={false}
        />
      )}
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
    </>
  );
}
