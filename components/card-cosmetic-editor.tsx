"use client";

import { useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { useTranslations } from "next-intl";
import {
  CARD_COSMETIC_DISPLAY,
  replayCardCosmeticColor
} from "@/lib/ui/card-cosmetics";
import "@/styles/card-customize.css";

export function CardCosmeticEntry({
  onCustomize,
  customizing,
  customizeButtonRef,
  animationPreview,
  children
}: {
  onCustomize: () => void;
  customizing: boolean;
  customizeButtonRef: Ref<HTMLButtonElement>;
  animationPreview?: { id: string | null };
  children: ReactNode;
}) {
  const t = useTranslations("cosmeticShop");
  const art = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!animationPreview?.id) return;
    const effect = CARD_COSMETIC_DISPLAY[animationPreview.id];
    if (effect?.reflectionColor)
      replayCardCosmeticColor(art.current, "reflection");
    if (effect?.lightningColor)
      replayCardCosmeticColor(art.current, "lightning");
  }, [animationPreview]);
  return (
    <>
      <div ref={art} className="yk-detail-art">
        {children}
      </div>
      <div className="yk-detail-cosmetic-actions">
        <button
          type="button"
          ref={customizeButtonRef}
          onClick={onCustomize}
          aria-pressed={customizing}
          className="yk-button yk-button-primary"
        >
          {t("customize")}
        </button>
      </div>
    </>
  );
}
