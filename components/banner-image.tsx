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
  const ready = loaded?.src === src;
  const viewportAspect = ready ? loaded.aspect : 498 / 281;
  useEffect(() => {
    const container = imageRef.current?.parentElement;
    if (!fillContainer || !container) return;
    container.style.setProperty(
      "--profile-cover-aspect",
      String(viewportAspect)
    );
    return () => {
      container.style.removeProperty("--profile-cover-aspect");
    };
  }, [fillContainer, viewportAspect]);
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
  );
}
