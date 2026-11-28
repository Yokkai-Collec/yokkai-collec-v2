"use client";

import { useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { useTranslations } from "next-intl";
import {
  CARD_COSMETIC_DISPLAY,
  replayCardCosmeticColor
} from "@/lib/ui/card-cosmetics";

export function CardCosmeticEntry({
  onCustomize,
  onBack,
  customizing,
  busy,
  customizeButtonRef,
  animationPreview,
  children
}: {
  onCustomize: () => void;
  onBack: () => void;
  customizing: boolean;
  busy: boolean;
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
          onClick={customizing ? onBack : onCustomize}
          disabled={customizing && busy}
          className="yk-button yk-button-primary"
        >
          {t(customizing ? "backToCardDetails" : "customize")}
        </button>
      </div>
    </>
  );
}
