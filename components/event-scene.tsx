"use client";
import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { CardShell } from "@/components/card-shell";
import "@/styles/event-scene.css";

export function MysteryCardBack() {
  const t = useTranslations("mysteryAuction");
  return (
    <div role="img" aria-label={t("cardBack")} className="yk-mystery-back">
      <Image
        src="/assets/events/mystery-card.png"
        width={1312}
        height={1199}
        alt=""
        aria-hidden="true"
        draggable={false}
        unoptimized
        className="yk-mystery-back-image"
      />
    </div>
  );
}

export function EventCardShowcase({
  children,
  revealed = false
}: {
  children: ReactNode;
  revealed?: boolean;
}) {
  return (
    <div className="yk-event-card-scene" data-revealed={revealed}>
      <span className="yk-event-card-aura" aria-hidden="true" />
      <div className="yk-event-card-foil" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="yk-event-card-streaks" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <i key={index} style={{ "--streak": index } as CSSProperties} />
        ))}
      </div>
      <div className="yk-event-card-object">
        <CardShell>{children}</CardShell>
        <span className="yk-event-card-glint" aria-hidden="true" />
      </div>
      <span className="yk-event-card-floor" aria-hidden="true" />
    </div>
  );
}
