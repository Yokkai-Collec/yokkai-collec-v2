"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { CardShowcaseScene } from "@/lib/ui/card-cosmetics";
import "@/styles/card-showcase-effect.css";

const ShowcaseAtmosphere = dynamic(() =>
  import("@/components/showcase-atmosphere").then(
    module => module.ShowcaseAtmosphere
  )
);

export function CardShowcaseEffect({ scene }: { scene: CardShowcaseScene }) {
  const layer = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!layer.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
    });
    observer.observe(layer.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={layer}
      className="yk-card-showcase-effect"
      data-card-scene={scene}
      aria-hidden="true"
    >
      {visible && scene !== "velvet" && (
        <ShowcaseAtmosphere
          key={scene}
          scene={scene}
          intensity={scene === "vhs" || scene === "lightning" ? 75 : 100}
          onCard
        />
      )}
    </div>
  );
}
